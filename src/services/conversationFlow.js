"use strict";

/**
 * ConversationFlow v11.0 - Anahtar Kelime Sistemi
 *
 * DAVRANIŞLAR:
 * 1. Anahtar kelime eşleşmesi (öncelikli)
 * 2. Dini terimlerle konuş (inşallah, maşallah, Allah'ın izniyle)
 * 3. Cümle sonları dini ifadelerle bitsin
 * 4. Kişinin sorununa odaklan
 * 5. Mesajlardan profil bilgisi çıkar
 * 6. 4+ metrik toplandığında otomatik kart oluştur
 */

class ConversationFlow {
  constructor(db, aiChat = null) {
    this.db = db;
    this.aiChat = aiChat;

    // Son sorulan soruları takip et
    this.lastQuestions = new Map();

    // Sohbet sayacı (chatId -> mesaj sayısı)
    this.messageCount = new Map();

    // Sıcak hitaplar
    this.warmAddresses = ["kardeşim", "canım", "güzel kardeşim", "değerli kardeşim"];

    // Dini cümle sonları
    this.religiousEndings = [
      "inşallah",
      "Allah'ın izniyle",
      "hayırlısı olur inşallah",
      "Rabbim yardımcın olsun",
      "Allah kolaylık versin",
      "maşallah",
      "Allah hayırlısını nasip etsin",
      "Rabbim sabır versin",
      "Allah'a emanet",
      "hayırlısıyla inşallah"
    ];

    // Dini emojiler (çok nadir)
    this.religiousEmojis = ["🤲", "☪️", "📿", "🕌", "❤️"];

    // Konuya özel sorular
    this.topicQuestions = {
      aile: [
        "Eşinle en son ne zaman güzel vakit geçirdiniz?",
        "Bu sorunlar ne zamandır var?",
        "Ailenden destek alabiliyor musun?",
        "Çocuklar varsa onlar nasıl etkileniyor?",
        "Birbirinizle konuşabiliyor musunuz?"
      ],
      sikinti: [
        "Bu sıkıntı ne zamandır var?",
        "En çok ne zaman bunalıyorsun?",
        "Seni en çok ne üzüyor?",
        "Bi çıkış yolu denedin mi?",
        "Yanında seni dinleyen biri var mı?"
      ],
      saglik: [
        "Ne zamandır bu şikayetin var?",
        "Doktora gittin mi?",
        "Ağrıların sürekli mi?",
        "Uyku düzenin nasıl?",
        "Ailende benzer şikayet olan var mı?"
      ],
      rizik: [
        "İş durumun nasıl şu an?",
        "Bu sıkıntı ne zamandır var?",
        "Aileni geçindirebiliyor musun?",
        "Bi iş fırsatı var mı?",
        "Birikimin var mıydı?"
      ],
      korku: [
        "Bu korku ne zamandır var?",
        "En çok neden korkuyorsun?",
        "Geceleri uyuyabiliyor musun?",
        "Daha önce böyle bi dönem geçirdin mi?",
        "Biriyle konuşuyor musun bu konuyu?"
      ],
      umut: [
        "En son ne zaman umutlu hissettin?",
        "Seni bu hale getiren ne oldu?",
        "Hayattan ne bekliyorsun?",
        "Daha önce zor dönemler atlattın mı?",
        "Sana güç veren bişey var mı?"
      ],
      genel: [
        "Biraz daha anlatır mısın?",
        "Bu durum seni nasıl etkiliyor?",
        "Ne hissediyorsun şu an?",
        "Seni en çok ne üzüyor?"
      ]
    };

    // Kuran ayetleri
    this.quranVerses = {
      sabir: [
        { ayet: "Sabır ve namazla yardım isteyin. Allah sabredenlerle beraberdir.", kaynak: "Bakara 153" },
        { ayet: "Her zorlukla beraber bir kolaylık vardır.", kaynak: "İnşirah 5-6" }
      ],
      umut: [
        { ayet: "Allah'ın rahmetinden ümit kesmeyin.", kaynak: "Yusuf 87" },
        { ayet: "Bana dua edin, size cevap vereyim.", kaynak: "Mümin 60" }
      ],
      sikinti: [
        { ayet: "Allah hiçbir nefse gücünün yettiğinden fazlasını yüklemez.", kaynak: "Bakara 286" },
        { ayet: "Belki sevmediğiniz bir şey sizin için hayırlıdır.", kaynak: "Bakara 216" }
      ],
      aile: [
        { ayet: "Eşlerinize güzellikle davranın.", kaynak: "Nisa 19" }
      ],
      rizik: [
        { ayet: "Kim Allah'tan korkarsa, Allah onu ummadığı yerden rızıklandırır.", kaynak: "Talak 2-3" }
      ],
      saglik: [
        { ayet: "Şifa veren ancak Sensin.", kaynak: "Şuara 80" }
      ],
      korku: [
        { ayet: "Allah'ın velilerine korku yoktur.", kaynak: "Yunus 62" }
      ]
    };

    // Şehirler listesi
    this.cities = [
      "istanbul", "ankara", "izmir", "bursa", "antalya", "konya", "adana",
      "gaziantep", "mersin", "diyarbakır", "kayseri", "eskişehir", "samsun"
    ];
  }

  // Rastgele dini cümle sonu
  getReligiousEnding() {
    return this.religiousEndings[Math.floor(Math.random() * this.religiousEndings.length)];
  }

  // Rastgele hitap
  getWarmAddress() {
    return this.warmAddresses[Math.floor(Math.random() * this.warmAddresses.length)];
  }

  // Soru sorulsun mu? (%55 ihtimal)
  shouldAskQuestion() {
    return Math.random() < 0.55;
  }

  // Ayet gösterilsin mi? (%18 ihtimal)
  shouldShowVerse() {
    return Math.random() < 0.18;
  }

  // Emoji eklensin mi? (%8 ihtimal)
  shouldAddEmoji() {
    return Math.random() < 0.08;
  }

  getRandomEmoji() {
    return this.religiousEmojis[Math.floor(Math.random() * this.religiousEmojis.length)];
  }

  // Konuya özel soru
  getTopicQuestion(chatId, topic) {
    const questions = this.topicQuestions[topic] || this.topicQuestions.genel;
    const lastQs = this.lastQuestions.get(chatId) || [];
    let available = questions.filter(q => !lastQs.includes(q));
    if (available.length === 0) available = questions;

    const question = available[Math.floor(Math.random() * available.length)];
    const newLastQs = [...lastQs, question].slice(-3);
    this.lastQuestions.set(chatId, newLastQs);

    if (this.lastQuestions.size > 1000) {
      const firstKey = this.lastQuestions.keys().next().value;
      this.lastQuestions.delete(firstKey);
    }
    return question;
  }

  getVerse(topic = "umut") {
    const verses = this.quranVerses[topic] || this.quranVerses.umut;
    return verses[Math.floor(Math.random() * verses.length)];
  }

  // Mesajdan konu tespit et
  detectTopic(msg) {
    const lower = msg.toLowerCase();
    if (lower.includes("eş") || lower.includes("evlilik") || lower.includes("koca") || lower.includes("karı") || lower.includes("aile")) return "aile";
    if (lower.includes("hasta") || lower.includes("ağrı") || lower.includes("doktor")) return "saglik";
    if (lower.includes("para") || lower.includes("iş") || lower.includes("borç") || lower.includes("geçim")) return "rizik";
    if (lower.includes("korku") || lower.includes("endişe") || lower.includes("kaygı")) return "korku";
    if (lower.includes("umutsuz") || lower.includes("çaresiz") || lower.includes("bıktım")) return "umut";
    if (lower.includes("sabır") || lower.includes("dayanamı") || lower.includes("zor")) return "sabir";
    if (lower.includes("sıkıntı") || lower.includes("dert") || lower.includes("sorun")) return "sikinti";
    return "genel";
  }

  // === MESAJDAN PROFİL BİLGİSİ ÇIKAR ===
  extractProfileInfo(msg, existingProfile = {}) {
    const extracted = {};
    const lower = msg.toLowerCase();
    const words = msg.split(/\s+/);

    // İsim tespiti (benim adım X, ben X, ismim X)
    const nameMatch = msg.match(/(?:ben|benim\s+ad[ıi]m|ismim|ad[ıi]m)\s+([A-ZÇĞİÖŞÜa-zçğıöşü]+)/i);
    if (nameMatch && !existingProfile.full_name) {
      extracted.full_name = this.capitalize(nameMatch[1]);
    }

    // Şehir tespiti
    if (!existingProfile.city) {
      for (const city of this.cities) {
        if (lower.includes(city) || lower.includes(city + "da") || lower.includes(city + "dan") || lower.includes(city + "lı") || lower.includes(city + "lu")) {
          extracted.city = this.capitalize(city);
          break;
        }
      }
      // "X şehrindeyim", "X'da yaşıyorum" pattern
      const cityMatch = msg.match(/([A-ZÇĞİÖŞÜa-zçğıöşü]+)(?:'da|'de|'ta|'te|\s+şehrinde|\s+ilinde)/i);
      if (cityMatch && !extracted.city) {
        extracted.city = this.capitalize(cityMatch[1]);
      }
    }

    // Yaş tespiti
    if (!existingProfile.birth_date) {
      const ageMatch = lower.match(/(\d{1,2})\s*yaşındayım|yaşım\s*(\d{1,2})/);
      if (ageMatch) {
        const age = parseInt(ageMatch[1] || ageMatch[2]);
        if (age >= 15 && age <= 90) {
          extracted.birth_date = String(new Date().getFullYear() - age);
        }
      }
    }

    // Telefon tespiti
    if (!existingProfile.phone) {
      const phoneMatch = msg.replace(/\s+/g, "").match(/(\+?90)?0?(5\d{9})/);
      if (phoneMatch) {
        extracted.phone = phoneMatch[2].startsWith("5") ? "0" + phoneMatch[2] : phoneMatch[2];
      }
    }

    // Meslek tespiti
    if (!existingProfile.occupation) {
      const jobMatch = msg.match(/(?:mesleğim|işim|çalışıyorum)\s+([A-ZÇĞİÖŞÜa-zçğıöşü\s]+?)(?:\.|,|$)/i);
      if (jobMatch) {
        extracted.occupation = jobMatch[1].trim();
      }
    }

    // Medeni hal tespiti
    if (!existingProfile.marital_status) {
      if (lower.includes("evliyim") || lower.includes("eşim")) {
        extracted.marital_status = "evli";
      } else if (lower.includes("bekarım") || lower.includes("bekar")) {
        extracted.marital_status = "bekar";
      }
    }

    // Konu/Dert tespiti (uzun mesajlar)
    if (!existingProfile.subject && msg.length > 50) {
      extracted.subject = msg.substring(0, 200);
    }

    return extracted;
  }

  // Profil doluluk kontrolü
  getProfileMetrics(profile) {
    let count = 0;
    if (profile?.full_name) count++;
    if (profile?.city) count++;
    if (profile?.phone) count++;
    if (profile?.birth_date) count++;
    if (profile?.subject) count++;
    if (profile?.occupation) count++;
    if (profile?.marital_status) count++;
    return count;
  }

  capitalize(str) {
    return String(str || "").split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
  }

  // İnsansı yazım + dini ifadeler
  addHumanTouch(text) {
    if (!text) return text;

    // Yazım hataları
    if (Math.random() < 0.4) text = text.replace(/inşallah/gi, "insallah");
    if (Math.random() < 0.4) text = text.replace(/\bbir\b/g, "bi");
    if (Math.random() < 0.3) text = text.replace(/\bşey\b/g, "bişey");
    if (Math.random() < 0.2) text = text.replace(/\bşu an\b/g, "şuan");
    if (Math.random() < 0.15) text = text.replace(/değil/g, "deil");

    // Dini cümle sonu ekle (%70 ihtimal)
    if (Math.random() < 0.7) {
      // Eğer zaten dini ifade ile bitmiyorsa
      const lowerText = text.toLowerCase();
      const hasDiniEnding = this.religiousEndings.some(e => lowerText.includes(e.toLowerCase()));
      if (!hasDiniEnding) {
        const ending = this.getReligiousEnding();
        // Nokta veya ? ile bitiyorsa önce kaldır
        text = text.replace(/[.!]$/, "");
        text = text + ", " + ending + ".";
      }
    }

    // Emoji (nadir)
    if (this.shouldAddEmoji()) {
      text = text + " " + this.getRandomEmoji();
    }

    return text;
  }

  normalizeTR(str) {
    return String(str || "").replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase().trim();
  }

  isGreeting(msg) {
    const lower = this.normalizeTR(msg);
    const greetings = ["selam", "merhaba", "mrb", "slm", "selamun", "aleyküm", "aleykum"];
    return greetings.some(g => lower.includes(g));
  }

  isQuestion(msg) {
    const lower = this.normalizeTR(msg);
    return lower.includes("?") || lower.includes("nasıl") || lower.includes("ne zaman") ||
           lower.includes("neden") || lower.includes("ne yapmalı") || lower.includes("ne yapmam");
  }

  isThanks(msg) {
    const lower = this.normalizeTR(msg);
    return lower.includes("teşekkür") || lower.includes("sağol") || lower.includes("eyvallah") ||
           lower.includes("allah razı");
  }

  isGoodbye(msg) {
    const lower = this.normalizeTR(msg);
    const hasGoodbye = lower.includes("görüşürüz") || lower.includes("hoşçakal") ||
                       lower.includes("allah'a emanet") || lower.includes("bye");
    return hasGoodbye && !this.isGreeting(msg);
  }

  // === ANA FONKSİYON ===
  async processMessage(chatId, clientId, message, context = {}) {
    const { name, profile } = context;
    let currentProfile = profile || {};
    const msg = message.trim();
    const topic = this.detectTopic(msg);

    // Mesaj sayısını artır
    const msgCount = (this.messageCount.get(chatId) || 0) + 1;
    this.messageCount.set(chatId, msgCount);

    // === ANAHTAR KELİME KONTROLÜ (ÖNCELİKLİ) ===
    try {
      if (this.db?.findMatchingKeyword) {
        const keywordMatch = await this.db.findMatchingKeyword(clientId, msg);
        if (keywordMatch) {
          // Değişkenleri değiştir
          let response = keywordMatch.response;
          const warmName = currentProfile?.full_name?.split(" ")[0] || name || "kardeşim";
          response = response.replace(/\{name\}/gi, warmName);
          response = response.replace(/\{time\}/gi, new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }));

          console.log(`🔑 Keyword eşleşti: "${keywordMatch.keyword}" -> yanıt gönderiliyor`);

          return {
            reply: this.addHumanTouch(response),
            action: "keyword_match",
            keyword: keywordMatch.keyword,
            extracted: {}
          };
        }
      }
    } catch (e) {
      console.log("Keyword kontrol hatası:", e.message);
    }

    // === MESAJDAN PROFİL BİLGİSİ ÇIKAR ===
    const extracted = this.extractProfileInfo(msg, currentProfile);
    if (Object.keys(extracted).length > 0 && this.db) {
      try {
        await this.db.updateProfile(chatId, clientId, extracted);
        currentProfile = { ...currentProfile, ...extracted };
      } catch (e) {
        console.log("Profil güncelleme hatası:", e.message);
      }
    }

    const warmName = currentProfile?.full_name?.split(" ")[0] || name || this.getWarmAddress();
    const metricsCount = this.getProfileMetrics(currentProfile);

    // === 4+ METRİK TOPLANDIYSA KART OLUŞTUR ===
    let profileCardMessage = "";
    if (metricsCount >= 4 && currentProfile.status !== "card_created" && currentProfile.status !== "waiting") {
      try {
        // Appointment/kart oluştur
        if (this.db?.createAppointment) {
          await this.db.createAppointment(currentProfile.id, clientId, currentProfile.subject || "Görüşme talebi");
        }
        await this.db.updateProfileStatus(chatId, clientId, "card_created");

        profileCardMessage = `\n\n${warmName}, seninle güzel bi sohbet ettik elhamdülillah. ` +
          `Bilgilerini aldım, en kısa sürede seninle ilgilenilecek inşallah. ` +
          `Allah hayırlı kapılar açsın. 🤲`;
      } catch (e) {
        console.log("Kart oluşturma hatası:", e.message);
      }
    }

    // === SELAMLAMA ===
    if (this.isGreeting(msg)) {
      let reply = `Ve aleykümselam ${warmName}, hoş geldin. Nasılsın, hayırdır inşallah? Anlat dinliyorum.`;
      return { reply: this.addHumanTouch(reply), action: "greeting", extracted };
    }

    // === TEŞEKKÜR ===
    if (this.isThanks(msg)) {
      let reply = `Estağfurullah ${warmName}, ne demek. Allah razı olsun senden de. Her zaman buradayım.`;
      return { reply: this.addHumanTouch(reply) + profileCardMessage, action: "thanks", extracted };
    }

    // === VEDA ===
    if (this.isGoodbye(msg)) {
      let reply = `Allah'a emanet ol ${warmName}. Rabbim yolunu açık etsin, hayırlı günler.`;
      return { reply: this.addHumanTouch(reply), action: "goodbye", extracted };
    }

    // === SORU SORUYORSA ===
    if (this.isQuestion(msg)) {
      const showVerse = this.shouldShowVerse();
      const askQuestion = this.shouldAskQuestion();

      if (this.aiChat) {
        const aiReply = await this._answerQuestion(msg, warmName, topic, showVerse, askQuestion, chatId);
        if (aiReply) {
          return { reply: this.addHumanTouch(aiReply) + profileCardMessage, action: "answer", extracted };
        }
      }

      let reply = `${warmName}, bu konuda sabırlı ol, Allah'ın izniyle hayırlısı olur.`;
      if (askQuestion) reply += ` ${this.getTopicQuestion(chatId, topic)}`;
      return { reply: this.addHumanTouch(reply) + profileCardMessage, action: "answer", extracted };
    }

    // === DERT ANLATIYORSA ===
    const showVerse = this.shouldShowVerse();
    const askQuestion = this.shouldAskQuestion();

    if (this.aiChat) {
      const aiReply = await this._empathize(msg, warmName, topic, showVerse, askQuestion, chatId);
      if (aiReply) {
        return { reply: this.addHumanTouch(aiReply) + profileCardMessage, action: "empathy", extracted };
      }
    }

    let reply = `Anlıyorum ${warmName}, gerçekten zor bi durum. Rabbim yardımcın olsun.`;
    if (showVerse) {
      const verse = this.getVerse(topic);
      reply += ` "${verse.ayet}" (${verse.kaynak})`;
    }
    if (askQuestion) reply += ` ${this.getTopicQuestion(chatId, topic)}`;
    return { reply: this.addHumanTouch(reply) + profileCardMessage, action: "empathy", extracted };
  }

  // AI: Soruya cevap (dini dil ile)
  async _answerQuestion(msg, warmName, topic, showVerse, askQuestion, chatId) {
    if (!this.aiChat?.openai) return null;

    let systemContent = `Sen samimi bir dini danışman/hocasın. DİNİ TERİMLERLE KONUŞ.

MUTLAKA KULLAN:
- Cümle sonlarında: "inşallah", "Allah'ın izniyle", "hayırlısı olur inşallah", "Rabbim yardımcın olsun"
- "maşallah", "elhamdülillah", "Allah razı olsun" gibi ifadeler
- "${warmName}" diye hitap et

KURALLAR:
- 2-3 cümle max
- Samimi, içten ol
- Her cümle dini bi ifadeyle bitsin
- Kişinin derdini anladığını göster`;

    if (showVerse) {
      const verse = this.getVerse(topic);
      systemContent += `\n- Bu ayeti ekle: "${verse.ayet}" (${verse.kaynak})`;
    }

    if (askQuestion) {
      const question = this.getTopicQuestion(chatId, topic);
      systemContent += `\n- Sonunda bu soruyu sor: "${question}"`;
    } else {
      systemContent += `\n- Soru sorma, sadece destek ver`;
    }

    try {
      const resp = await this.aiChat.openai.chat.completions.create({
        model: this.aiChat.model,
        messages: [
          { role: "system", content: systemContent },
          { role: "user", content: msg }
        ],
        temperature: 0.85,
        max_tokens: 150
      });
      return resp.choices[0]?.message?.content?.trim() || null;
    } catch { return null; }
  }

  // AI: Empati (dini dil ile)
  async _empathize(msg, warmName, topic, showVerse, askQuestion, chatId) {
    if (!this.aiChat?.openai) return null;

    let systemContent = `Sen dertlere ortak olan samimi bi dini danışmansın. DİNİ TERİMLERLE KONUŞ.

MUTLAKA KULLAN:
- "inşallah", "maşallah", "elhamdülillah", "Allah'ın izniyle"
- "Rabbim yardımcın olsun", "Allah kolaylık versin", "hayırlısı olur inşallah"
- "${warmName}" diye hitap et

KURALLAR:
- Önce empati göster, dinlediğini hissettir
- 2-3 cümle max
- HER CÜMLE dini ifadeyle bitsin
- Kişinin anlattığı soruna özel cevap ver`;

    if (showVerse) {
      const verse = this.getVerse(topic);
      systemContent += `\n- Bu ayeti kişinin durumuna bağla: "${verse.ayet}" (${verse.kaynak})`;
    }

    if (askQuestion) {
      const question = this.getTopicQuestion(chatId, topic);
      systemContent += `\n- Sonunda bu soruyu sor: "${question}"`;
    } else {
      systemContent += `\n- Soru sorma, sadece destek ver`;
    }

    try {
      const resp = await this.aiChat.openai.chat.completions.create({
        model: this.aiChat.model,
        messages: [
          { role: "system", content: systemContent },
          { role: "user", content: msg }
        ],
        temperature: 0.85,
        max_tokens: 180
      });
      return resp.choices[0]?.message?.content?.trim() || null;
    } catch { return null; }
  }
}

module.exports = { ConversationFlow };
