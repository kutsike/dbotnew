"use strict";

/**
 * Mesaj Yönlendirici ve Sohbet Akış Yöneticisi
 * İnsansı Karşılama Asistanı
 */

const { AIChatService } = require("./services/aiChat");
const { ConversationFlow } = require("./services/conversationFlow");
const { ContentFilter } = require("./services/contentFilter");
const { MessageDelay } = require("./services/messageDelay");

class Router {
  constructor(manager) {
    this.manager = manager;
    this.db = manager.db;
    
    // Servisler
    this.aiChat = null;
    this.conversationFlow = null;
    this.contentFilter = null;
    this.messageDelay = null;
    
    this.initServices();
  }

  async initServices() {
    // AI Chat Service
    if (process.env.OPENAI_API_KEY) {
      this.aiChat = new AIChatService(this.db);
      console.log("✅ AI Chat servisi aktif (insansı mod)");
    } else {
      console.log("⚠️ OPENAI_API_KEY yok, basit mod aktif");
    }

    // Conversation Flow
    this.conversationFlow = new ConversationFlow(this.db, this.aiChat);
    
    // Content Filter
    this.contentFilter = new ContentFilter(this.db);
    
    // Message Delay
    this.messageDelay = new MessageDelay(this.db);
  }

  /**
   * Sesli mesaj transcribe (BotManager'dan çağrılır)
   */
  async transcribeVoice(filePath) {
    if (!this.aiChat) return "";
    try {
      const fs = require("fs");
      const data = fs.readFileSync(filePath);
      const base64 = data.toString("base64");
      const media = {
        data: base64,
        mimetype: "audio/ogg"
      };
      return await this.aiChat.transcribeVoiceMedia(media);
    } catch (e) {
      console.error("[Router] Transcribe hatası:", e.message);
      return "";
    }
  }

  /**
   * Ana mesaj işleyici
   */
  async handleMessage(msg, client, clientId, context = {}) {
    const chatId = msg.from;
    let body = msg.body?.trim() || "";
    const name = context.name || "kardeşim";

    // Sesli mesaj (ptt/audio) varsa metne çevir
    try {
      const isVoice = (msg.type === "ptt" || msg.type === "audio");
      if (!body && msg.hasMedia && isVoice) {
        if (this.aiChat && this.aiChat.transcribeVoiceMedia) {
          const media = await msg.downloadMedia();
          const transcript = await this.aiChat.transcribeVoiceMedia(media);
          if (transcript && transcript.trim()) {
            body = transcript.trim();
            console.log(`[${clientId}] 🎤 Sesli mesaj çevrildi: ${body.substring(0, 50)}...`);
          }
        }
      }
    } catch (e) {
      console.error("[Router] Sesli mesaj çeviri hatası:", e.message);
    }

    // Boş mesajları atla
    if (!body && msg.type === "chat") return null;

    try {
      // Bot dondurulmuş mu kontrol et
      const botClient = await this.db.getClient(clientId);
      if (botClient?.frozen) {
        const frozenMsg = botClient.frozen_message || 
          await this.db.getSetting("frozen_message") || 
          "Şu an müsait değilim kardeşim, biraz sonra tekrar yazabilir misin?";
        
        if (botClient.redirect_phone) {
          return `${frozenMsg}\n\nGüncel numaram: ${botClient.redirect_phone}`;
        }
        return frozenMsg;
      }

      // Profil al
      let profile = context.profile || await this.db.getProfile(chatId, clientId);
      
      // Admin devralınmış mı kontrol et
      if (profile?.status === "admin") {
        console.log(`[Router] Admin devralınmış, bot cevap vermiyor`);
        return null;
      }

      // Küfür kontrolü
      const badWordCheck = await this.contentFilter.check(body);
      if (badWordCheck.found) {
        const response = await this.contentFilter.getResponse(badWordCheck, name);
        await this.logActivity(chatId, profile?.id, clientId, "bad_word_detected", { word: badWordCheck.word });
        return response;
      }

      // Komut kontrolü
      const prefix = await this.db.getSetting("prefix") || "!";
      if (body.startsWith(prefix)) {
        return this.handleCommand(body, chatId, clientId, profile, context);
      }

      // Devir talebi kontrolü
      if (this.isHandoffRequest(body)) {
        await this.db.updateProfileStatus(chatId, clientId, "waiting");
        await this.logActivity(chatId, profile?.id, clientId, "handoff_requested", {});
        
        const handoffMessages = [
          `Tamam ${name} kardeşim, hocamıza ilettim. En kısa sürede sana dönüş yapacak inşallah.`,
          `${name} kardeşim, hocamız şu an meşgul ama müsait olunca hemen döneceğiz.`,
          `Anladım ${name} kardeşim, hocamızla görüşme talebini aldım. Biraz sabır, döneceğiz.`
        ];
        
        const customHandoff = await this.db.getSetting("handoff_message");
        return customHandoff || handoffMessages[Math.floor(Math.random() * handoffMessages.length)];
      }

      // Konuşmak/aramak isteyen var mı
      if (this.wantsToTalk(body)) {
        const busyMessages = [
          `${name} kardeşim, şu an telefonda görüşme imkanımız yok ama yazışarak yardımcı olabilirim.`,
          `Anlıyorum ${name} kardeşim, sesli görüşme şu an mümkün değil. Ama yazarak da hallederiz inşallah.`,
          `${name} kardeşim, şu an arama yapamıyoruz ama mesajlaşarak da yardımcı olabilirim.`
        ];

        const customBusy = await this.db.getSetting("busy_message");
        return customBusy || busyMessages[Math.floor(Math.random() * busyMessages.length)];
      }

      // ========== ANAHTAR KELİME KONTROLÜ (AI'DAN ÖNCE) ==========
      const matchedKeyword = await this.db.matchKeyword(body, clientId);
      if (matchedKeyword) {
        console.log(`[Router] Anahtar kelime eşleşti: "${matchedKeyword.keyword}"`);
        await this.logActivity(chatId, profile?.id, clientId, "keyword_matched", {
          keyword: matchedKeyword.keyword,
          category: matchedKeyword.category
        });

        // Yanıtı {name} placeholder ile değiştir
        let keywordResponse = matchedKeyword.response;
        keywordResponse = keywordResponse.replace(/\{name\}/g, name);
        keywordResponse = keywordResponse.replace(/\{isim\}/g, name);

        return keywordResponse;
      }

      // Conversation Flow ile işle
      const flowResult = await this.conversationFlow.processMessage(
        chatId, 
        clientId, 
        body, 
        { name, profile }
      );

      // Profil tamamlandıysa aktivite logu
      if (flowResult.action === "profile_complete") {
        await this.logActivity(chatId, flowResult.profile?.id || profile?.id, clientId, "profile_complete", {});
      }

      return flowResult.reply;

    } catch (err) {
      console.error("[Router] Hata:", err.message);
      
      // İnsansı hata mesajları
      const errorMessages = [
        `${name} kardeşim, bir aksaklık oldu. Birazdan tekrar yazar mısın?`,
        `Pardon ${name} kardeşim, bir sorun çıktı. Bir dakika sonra tekrar dener misin?`,
        `${name} kardeşim, sistemde ufak bir problem var. Biraz sonra tekrar yazarsan sevinirim.`
      ];
      
      return errorMessages[Math.floor(Math.random() * errorMessages.length)];
    }
  }

  /**
   * Komut işleyici
   */
  async handleCommand(body, chatId, clientId, profile, context) {
    const prefix = await this.db.getSetting("prefix") || "!";
    const parts = body.slice(prefix.length).trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);
    const name = context.name || "kardeşim";

    switch (cmd) {
      case "menu":
      case "yardim":
      case "yardım":
        return this.generateMenu(name);

      case "namaz":
        const city = args.join(" ") || "istanbul";
        return this.handlePrayerTimes(city, name);

      case "dua":
        return this.handleDuaRequest(args[0], name);

      case "haber":
        return `${name} kardeşim, güncel haberler için:\n🔗 https://www.diyanethaber.com.tr`;

      case "hutbe":
        return `${name} kardeşim, bu haftanın hutbesi için:\n🔗 https://www.diyanet.gov.tr/tr-TR/Kurumsal/Detay/11/diyanet-isleri-baskanligi-hutbeleri`;

      case "fetva":
        if (args.length === 0) {
          return `${name} kardeşim, fetva aramak için:\n!fetva [soru]\n\nÖrnek: !fetva namaz kılmak farz mı`;
        }
        if (this.aiChat) {
          const result = await this.aiChat.processFetva(args.join(" "));
          return result.reply;
        }
        return `${name} kardeşim, bu konuyu araştırmak için:\n🔗 https://kurul.diyanet.gov.tr/Cevap-Ara?SearchText=${encodeURIComponent(args.join(" "))}`;

      case "temsilci":
      case "hoca":
      case "yetkili":
        await this.db.updateProfileStatus(chatId, clientId, "waiting");
        const handoffMsg = await this.db.getSetting("handoff_message") ||
          `Tamam ${name} kardeşim, hocamıza ilettim. En kısa sürede dönüş yapacağız inşallah.`;
        return handoffMsg.replace("{name}", name);

      case "panel":
      case "giris":
      case "login":
        // Magic link oluştur ve gönder
        return this.handleMagicLinkCommand(chatId, clientId, name);

      default:
        return `${name} kardeşim, "${cmd}" komutunu tanımadım.\n\nKomutları görmek için !menu yazabilirsin.`;
    }
  }

  /**
   * Devir talebi kontrolü
   */
  isHandoffRequest(body) {
    const lower = body.toLowerCase();
    const keywords = [
      "temsilci", "yetkili", "insan", "gerçek kişi",
      "hoca ile", "hocayla", "görüşmek", "konuşmak istiyorum",
      "biriyle görüşmek", "canlı destek", "hocamla",
      "yetkiliye bağla", "müdür", "sorumlu"
    ];
    
    if (body.trim() === "0") return true;
    
    return keywords.some(kw => lower.includes(kw));
  }

  /**
   * Konuşmak istiyor mu
   */
  wantsToTalk(body) {
    const lower = body.toLowerCase();
    const patterns = [
      /aramak\s+istiyorum/i,
      /arayabilir\s+miyim/i,
      /telefonla\s+görüşmek/i,
      /sesli\s+görüşme/i,
      /müsait\s+misiniz/i,
      /ne\s+zaman\s+müsait/i,
      /sizi\s+arayabilir/i,
      /telefon\s+görüşmesi/i
    ];
    
    return patterns.some(p => p.test(lower));
  }

  /**
   * Menü oluştur - insansı
   */
  generateMenu(name = "kardeşim") {
    return `Merhaba ${name} kardeşim!

Sana nasıl yardımcı olabilirim?

*Kullanabileceğin komutlar:*

1️⃣ *!namaz [şehir]* - Namaz vakitlerini öğren
2️⃣ *!dua* - Günlük dua
3️⃣ *!haber* - Diyanet haberleri
4️⃣ *!hutbe* - Cuma hutbesi
5️⃣ *!fetva [soru]* - Fetva ara
0️⃣ *!temsilci* - Hocayla görüş

Ya da doğrudan derdini anlat, seni dinliyorum.`;
  }

  /**
   * Namaz vakitleri - insansı
   */
  async handlePrayerTimes(city, name = "kardeşim") {
    const cityName = city.charAt(0).toUpperCase() + city.slice(1).toLowerCase();
    
    return `${name} kardeşim, ${cityName} için namaz vakitlerini buradan görebilirsin:

🔗 https://namazvakti.diyanet.gov.tr

Kesin vakitler için Diyanet'in sitesini kontrol etmeni öneririm.`;
  }

  /**
   * Dua isteği - insansı
   */
  async handleDuaRequest(category, name = "kardeşim") {
    try {
      const dua = await this.db.getRandomDua(category);
      
      if (dua) {
        let response = `${name} kardeşim, işte sana bir dua:\n\n`;
        response += `*${dua.title}*\n\n`;
        
        if (dua.arabic) {
          response += `📖 *Arapça:*\n${dua.arabic}\n\n`;
        }
        
        if (dua.transliteration) {
          response += `🔤 *Okunuşu:*\n${dua.transliteration}\n\n`;
        }
        
        response += `📝 *Türkçe:*\n${dua.turkish}`;
        
        if (dua.source) {
          response += `\n\n_Kaynak: ${dua.source}_`;
        }
        
        return response;
      }
      
      return `${name} kardeşim, Rabbim dualarını kabul etsin. 🤲`;
    } catch (err) {
      console.error("Dua hatası:", err);
      return `${name} kardeşim, Rabbim dualarını kabul etsin. 🤲`;
    }
  }

  /**
   * Aktivite logu
   */
  async logActivity(chatId, profileId, clientId, action, details) {
    try {
      await this.db.logActivity({
        chatId,
        profileId,
        clientId,
        action,
        details,
        performedBy: "bot"
      });
    } catch (err) {
      console.error("Log hatası:", err);
    }
  }

  /**
   * Magic Link komutu - panel girişi için tek kullanımlık link oluşturur
   */
  async handleMagicLinkCommand(chatId, clientId, name) {
    try {
      // Magic link özelliği aktif mi kontrol et
      const magicLinkEnabled = await this.db.getSetting('magic_link_enabled');
      if (magicLinkEnabled === '0') {
        return `${name} kardeşim, bu özellik şu an aktif değil.`;
      }

      // Yetkili numara kontrolü
      const authorizedNumbers = await this.db.getSetting('authorized_numbers');
      if (authorizedNumbers && authorizedNumbers.trim()) {
        const authorized = authorizedNumbers.split(',').map(n => n.trim().replace(/\D/g, ''));
        const senderNumber = chatId.replace('@s.whatsapp.net', '').replace(/\D/g, '');

        if (authorized.length > 0 && !authorized.includes(senderNumber)) {
          return `${name} kardeşim, bu komutu kullanma yetkiniz yok.`;
        }
      }

      // Manager üzerinden magic link oluştur
      if (this.manager.generateMagicLink) {
        const result = await this.manager.generateMagicLink(chatId, clientId);

        if (result && result.link) {
          await this.logActivity(chatId, null, clientId, "magic_link_generated", { expiry: result.expiry });

          return `🔐 *Panel Giriş Linki*\n\n` +
            `Aşağıdaki linke tıklayarak panele şifresiz giriş yapabilirsiniz:\n\n` +
            `🔗 ${result.link}\n\n` +
            `⏰ Bu link *${result.expiry} dakika* geçerlidir.\n` +
            `⚠️ Linki kimseyle paylaşmayın!`;
        }
      }

      return `${name} kardeşim, giriş linki oluşturulamadı. Lütfen daha sonra tekrar deneyin.`;
    } catch (err) {
      console.error("[Router] Magic link hatası:", err.message);
      return `${name} kardeşim, bir hata oluştu. Lütfen daha sonra tekrar deneyin.`;
    }
  }
}

module.exports = Router;
