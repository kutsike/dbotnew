"use strict";

/**
 * Mesaj Yönlendirici ve Sohbet Akış Yöneticisi
 * Hocanın Yardımcısı Konsepti
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
      console.log("✅ AI Chat servisi aktif");
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
        if (this.aiChat && this.aiChat.transcribeMedia) {
          const media = await msg.downloadMedia();
          const transcript = await this.aiChat.transcribeMedia(media);
          if (transcript && transcript.trim()) {
            body = transcript.trim();
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
          "Şu an müsait değilim, lütfen daha sonra tekrar deneyin.";
        
        if (botClient.redirect_phone) {
          return `${frozenMsg}\n\nGüncel numaram: ${botClient.redirect_phone}`;
        }
        return frozenMsg;
      }

      // Profil al
      let profile = context.profile || await this.db.getProfile(chatId);
      
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
        await this.db.updateProfileStatus(chatId, "waiting");
        await this.logActivity(chatId, profile?.id, clientId, "handoff_requested", {});
        
        const handoffMsg = await this.db.getSetting("handoff_message") || 
          "Hocamız şu an dergahtaki namazını kılıyor. En kısa sürede size dönüş yapacağız inşallah.";
        
        return handoffMsg;
      }

      // Konuşmak isteyen var mı
      if (this.wantsToTalk(body)) {
        const busyMsg = await this.db.getSetting("busy_message") || 
          "Dergahtaki namazımı kıldıktan sonra müsait olabilirim inşallah.";
        return busyMsg;
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
      return "Özür dilerim, bir aksaklık yaşandı. Birazdan tekrar deneyebilir misiniz?";
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
        return this.generateMenu();

      case "namaz":
        const city = args.join(" ") || "istanbul";
        return this.handlePrayerTimes(city);

      case "dua":
        return this.handleDuaRequest(args[0]);

      case "haber":
        return "📰 Son haberler için: https://www.diyanethaber.com.tr";

      case "hutbe":
        return "📜 Güncel hutbe için: https://www.diyanet.gov.tr/tr-TR/Kurumsal/Detay/11/diyanet-isleri-baskanligi-hutbeleri";

      case "fetva":
        if (args.length === 0) {
          return "Fetva aramak için: !fetva [soru]\n\nÖrnek: !fetva namaz kılmak farz mı";
        }
        if (this.aiChat) {
          const result = await this.aiChat.processFetva(args.join(" "));
          return result.reply;
        }
        return `🔍 Fetva arama: https://kurul.diyanet.gov.tr/Cevap-Ara?SearchText=${encodeURIComponent(args.join(" "))}`;

      case "temsilci":
      case "hoca":
      case "yetkili":
        await this.db.updateProfileStatus(chatId, "waiting");
        return await this.db.getSetting("handoff_message") || 
          "Hocamız şu an dergahtaki namazını kılıyor. En kısa sürede size dönüş yapacağız inşallah.";

      default:
        return `Bilinmeyen komut: ${cmd}\n\nKomutları görmek için !menu yazabilirsiniz.`;
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
      "biriyle görüşmek", "canlı destek", "hocamla"
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
      /ne\s+zaman\s+müsait/i
    ];
    
    return patterns.some(p => p.test(lower));
  }

  /**
   * Menü oluştur
   */
  generateMenu() {
    return `🕌 *Hocanın Yardımcısı*

Merhaba kardeşim, size nasıl yardımcı olabilirim?

Aşağıdaki komutları kullanabilirsiniz:

1️⃣ *!namaz [şehir]* - Namaz vakitleri
2️⃣ *!dua* - Dua
3️⃣ *!haber* - Son haberler
4️⃣ *!hutbe* - Güncel hutbe
5️⃣ *!fetva [soru]* - Fetva arama
0️⃣ *!temsilci* - Hocayla görüşme

Ya da doğrudan durumunuzu anlatabilirsiniz, size yardımcı olmaya çalışayım.

_Diyanet İşleri Başkanlığı kaynaklarından beslenmektedir._`;
  }

  /**
   * Namaz vakitleri
   */
  async handlePrayerTimes(city) {
    const cityName = city.charAt(0).toUpperCase() + city.slice(1).toLowerCase();
    
    return `🕌 *${cityName} Namaz Vakitleri*

Güncel vakitler için:
🔗 https://namazvakti.diyanet.gov.tr

_Not: Kesin vakitler için Diyanet'in resmi sitesini kontrol ediniz._`;
  }

  /**
   * Dua isteği
   */
  async handleDuaRequest(category) {
    try {
      const dua = await this.db.getRandomDua(category);
      
      if (dua) {
        let response = `🤲 *${dua.title}*\n\n`;
        
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
      
      return "🤲 Rabbim dualarınızı kabul etsin.";
    } catch (err) {
      console.error("Dua hatası:", err);
      return "🤲 Rabbim dualarınızı kabul etsin.";
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
}

module.exports = Router;
