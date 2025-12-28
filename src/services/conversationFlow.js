"use strict";

/**
 * ConversationFlow v9.0 - Gerçek İnsan Gibi Manevi Rehber
 *
 * DAVRANIŞLAR:
 * 1. Kişinin sorununa odaklan
 * 2. Her mesajda soru sorma (bazen sadece empati)
 * 3. Konuya özel sorular sor
 * 4. Yazım hataları yap (insansı)
 * 5. Çok nadir dini emoji kullan
 * 6. 3-5 mesajda bir ayet/dua paylaş
 */

class ConversationFlow {
  constructor(db, aiChat = null) {
    this.db = db;
    this.aiChat = aiChat;

    // Son sorulan soruları takip et (chatId -> [son sorular])
    this.lastQuestions = new Map();

    // Sıcak hitaplar
    this.warmAddresses = ["kardeşim", "canım", "güzel kardeşim", "değerli kardeşim"];

    // Dini emojiler (çok nadir kullanılacak)
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

    // Kuran ayetleri - konuya göre
    this.quranVerses = {
      sabir: [
        { ayet: "Ey iman edenler! Sabır ve namazla yardım isteyin. Şüphesiz Allah sabredenlerle beraberdir.", kaynak: "Bakara 153" },
        { ayet: "Her zorlukla beraber bir kolaylık vardır.", kaynak: "İnşirah 5-6" },
        { ayet: "Gevşemeyin, üzülmeyin; eğer inanıyorsanız en üstün olan sizlersiniz.", kaynak: "Al-i İmran 139" }
      ],
      umut: [
        { ayet: "Allah'ın rahmetinden ümit kesmeyin.", kaynak: "Yusuf 87" },
        { ayet: "Kim Allah'a tevekkül ederse, O ona yeter.", kaynak: "Talak 3" },
        { ayet: "Bana dua edin, size cevap vereyim.", kaynak: "Mümin 60" }
      ],
      sikinti: [
        { ayet: "Allah hiçbir nefse gücünün yettiğinden fazlasını yüklemez.", kaynak: "Bakara 286" },
        { ayet: "Belki sevmediğiniz bir şey sizin için hayırlıdır.", kaynak: "Bakara 216" },
        { ayet: "Şüphesiz güçlükle beraber kolaylık vardır.", kaynak: "İnşirah 6" }
      ],
      korku: [
        { ayet: "Allah'ın velilerine korku yoktur ve onlar üzülmeyeceklerdir.", kaynak: "Yunus 62" },
        { ayet: "Allah'ın bizim için yazdığından başkası bize erişmez.", kaynak: "Tevbe 51" }
      ],
      aile: [
        { ayet: "Eşlerinize güzellikle davranın.", kaynak: "Nisa 19" },
        { ayet: "Bize eşlerimizden göz aydınlığı ihsan et.", kaynak: "Furkan 74" }
      ],
      rizik: [
        { ayet: "Nice canlı var ki rızkını taşıyamaz. Onları da sizi de Allah rızıklandırır.", kaynak: "Ankebut 60" },
        { ayet: "Kim Allah'tan korkarsa, Allah onu ummadığı yerden rızıklandırır.", kaynak: "Talak 2-3" }
      ],
      saglik: [
        { ayet: "Şifa veren ancak Sensin.", kaynak: "Şuara 80" },
        { ayet: "Kur'an müminler için şifa ve rahmettir.", kaynak: "İsra 82" }
      ]
    };

    // Dualar
    this.prayers = {
      genel: ["Hasbünallahü ve ni'mel vekil", "La havle vela kuvvete illa billah"],
      sikinti: ["Ya Hayyu ya Kayyum bi rahmetike esteğis"],
      sabir: ["Rabbena efrığ aleyna sabran"]
    };
  }

  // Rastgele hitap
  getWarmAddress() {
    return this.warmAddresses[Math.floor(Math.random() * this.warmAddresses.length)];
  }

  // Soru sorulsun mu? (%60 ihtimal)
  shouldAskQuestion() {
    return Math.random() < 0.6;
  }

  // Ayet/dua gösterilsin mi? (%20 ihtimal = ~5 mesajda 1)
  shouldShowVerse() {
    return Math.random() < 0.20;
  }

  // Emoji eklensin mi? (%10 ihtimal = çok nadir)
  shouldAddEmoji() {
    return Math.random() < 0.10;
  }

  // Rastgele emoji
  getRandomEmoji() {
    return this.religiousEmojis[Math.floor(Math.random() * this.religiousEmojis.length)];
  }

  // Konuya özel soru (tekrar etmez)
  getTopicQuestion(chatId, topic) {
    const questions = this.topicQuestions[topic] || this.topicQuestions.genel;
    const lastQs = this.lastQuestions.get(chatId) || [];

    // Son 3 soruyu hariç tut
    let available = questions.filter(q => !lastQs.includes(q));
    if (available.length === 0) available = questions;

    const question = available[Math.floor(Math.random() * available.length)];

    // Son soruları güncelle (max 3 tut)
    const newLastQs = [...lastQs, question].slice(-3);
    this.lastQuestions.set(chatId, newLastQs);

    // Map temizliği
    if (this.lastQuestions.size > 1000) {
      const firstKey = this.lastQuestions.keys().next().value;
      this.lastQuestions.delete(firstKey);
    }

    return question;
  }

  // Konuya göre ayet seç
  getVerse(topic = "umut") {
    const verses = this.quranVerses[topic] || this.quranVerses.umut;
    return verses[Math.floor(Math.random() * verses.length)];
  }

  // Konuya göre dua seç
  getPrayer(topic = "genel") {
    const prayers = this.prayers[topic] || this.prayers.genel;
    return prayers[Math.floor(Math.random() * prayers.length)];
  }

  // Mesajdan konu tespit et
  detectTopic(msg) {
    const lower = msg.toLowerCase();
    if (lower.includes("eş") || lower.includes("evlilik") || lower.includes("koca") || lower.includes("karı") || lower.includes("aile")) return "aile";
    if (lower.includes("hasta") || lower.includes("ağrı") || lower.includes("doktor") || lower.includes("ilaç")) return "saglik";
    if (lower.includes("para") || lower.includes("iş") || lower.includes("borç") || lower.includes("geçim") || lower.includes("maaş")) return "rizik";
    if (lower.includes("korku") || lower.includes("endişe") || lower.includes("kaygı") || lower.includes("panik")) return "korku";
    if (lower.includes("umutsuz") || lower.includes("çaresiz") || lower.includes("bıktım") || lower.includes("yoruldum")) return "umut";
    if (lower.includes("sabır") || lower.includes("dayanamı") || lower.includes("zor")) return "sabir";
    if (lower.includes("sıkıntı") || lower.includes("dert") || lower.includes("sorun") || lower.includes("problem")) return "sikinti";
    return "genel";
  }

  // İnsansı yazım hataları
  addHumanTouch(text) {
    if (!text) return text;

    // Yazım hataları (%40 ihtimal)
    if (Math.random() < 0.4) text = text.replace(/inşallah/gi, "insallah");
    if (Math.random() < 0.4) text = text.replace(/\bbir\b/g, "bi");
    if (Math.random() < 0.3) text = text.replace(/\bşey\b/g, "bişey");
    if (Math.random() < 0.2) text = text.replace(/\bşu an\b/g, "şuan");
    if (Math.random() < 0.2) text = text.replace(/\bdaha\b/g, "daa");
    if (Math.random() < 0.15) text = text.replace(/değil/g, "deil");
    if (Math.random() < 0.15) text = text.replace(/gelecek/g, "gelcek");
    if (Math.random() < 0.1) text = text.replace(/\byani\b/g, "yanii");

    // Emoji ekle (çok nadir)
    if (this.shouldAddEmoji()) {
      text = text + " " + this.getRandomEmoji();
    }

    return text;
  }

  // Türkçe normalize
  normalizeTR(str) {
    return String(str || "").replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase().trim();
  }

  // Selamlama mı?
  isGreeting(msg) {
    const lower = this.normalizeTR(msg);
    const greetings = ["selam", "merhaba", "mrb", "slm", "selamun", "aleyküm", "aleykum"];
    return greetings.some(g => lower.includes(g));
  }

  // Soru mu?
  isQuestion(msg) {
    const lower = this.normalizeTR(msg);
    return lower.includes("?") || lower.includes("nasıl") || lower.includes("ne zaman") ||
           lower.includes("neden") || lower.includes("ne yapmalı") || lower.includes("ne yapmam");
  }

  // Teşekkür mü?
  isThanks(msg) {
    const lower = this.normalizeTR(msg);
    return lower.includes("teşekkür") || lower.includes("sağol") || lower.includes("eyvallah") ||
           lower.includes("allah razı");
  }

  // Veda mı?
  isGoodbye(msg) {
    const lower = this.normalizeTR(msg);
    const hasGoodbye = lower.includes("görüşürüz") || lower.includes("hoşçakal") ||
                       lower.includes("allah'a emanet") || lower.includes("bye");
    const hasGreeting = this.isGreeting(msg);
    return hasGoodbye && !hasGreeting;
  }

  // === ANA FONKSİYON ===
  async processMessage(chatId, clientId, message, context = {}) {
    const { name, profile } = context;
    const warmName = profile?.full_name?.split(" ")[0] || name || this.getWarmAddress();
    const msg = message.trim();
    const topic = this.detectTopic(msg);

    // === SELAMLAMA ===
    if (this.isGreeting(msg)) {
      const reply = this.addHumanTouch(
        `Aleyküm selam ${warmName}, hoş geldin. Nasılsın, anlat dinliyorum.`
      );
      return { reply, action: "greeting" };
    }

    // === TEŞEKKÜR ===
    if (this.isThanks(msg)) {
      const reply = this.addHumanTouch(
        `Estağfurullah ${warmName}, ne demek. Her zaman buradayım.`
      );
      return { reply, action: "thanks" };
    }

    // === VEDA ===
    if (this.isGoodbye(msg)) {
      const reply = this.addHumanTouch(
        `Allah'a emanet ol ${warmName}. Kendine iyi bak, ihtiyacın olursa yaz.`
      );
      return { reply, action: "goodbye" };
    }

    // === SORU SORUYORSA ===
    if (this.isQuestion(msg)) {
      const showVerse = this.shouldShowVerse();
      const askQuestion = this.shouldAskQuestion();

      if (this.aiChat) {
        const aiReply = await this._answerQuestion(msg, warmName, topic, showVerse, askQuestion, chatId);
        if (aiReply) return { reply: this.addHumanTouch(aiReply), action: "answer" };
      }

      // AI yoksa basit cevap
      let reply = `${warmName}, bu konuda sabırlı ol, insallah hayırlısı olur.`;
      if (askQuestion) {
        reply += ` ${this.getTopicQuestion(chatId, topic)}`;
      }
      return { reply: this.addHumanTouch(reply), action: "answer" };
    }

    // === DERT ANLATIYORSA ===
    const showVerse = this.shouldShowVerse();
    const askQuestion = this.shouldAskQuestion();

    if (this.aiChat) {
      const aiReply = await this._empathize(msg, warmName, topic, showVerse, askQuestion, chatId);
      if (aiReply) return { reply: this.addHumanTouch(aiReply), action: "empathy" };
    }

    // AI yoksa basit empati
    let reply = `Anlıyorum ${warmName}, gerçekten zor bi durum. Yalnız değilsin.`;
    if (showVerse) {
      const verse = this.getVerse(topic);
      reply += ` "${verse.ayet}" (${verse.kaynak})`;
    }
    if (askQuestion) {
      reply += ` ${this.getTopicQuestion(chatId, topic)}`;
    }
    return { reply: this.addHumanTouch(reply), action: "empathy" };
  }

  // AI: Soruya cevap ver
  async _answerQuestion(msg, warmName, topic, showVerse, askQuestion, chatId) {
    if (!this.aiChat?.openai) return null;

    let systemContent = `Sen samimi bir manevi rehbersin. Kişinin SORUNUNA ODAKLAN.

KURALLAR:
- "${warmName}" diye hitap et
- 2-3 cümle max
- Samimi, içten ol
- Kişinin derdini anladığını göster`;

    if (showVerse) {
      const verse = this.getVerse(topic);
      systemContent += `\n- Bu ayeti doğal şekilde ekle: "${verse.ayet}" (${verse.kaynak})`;
    }

    if (askQuestion) {
      const question = this.getTopicQuestion(chatId, topic);
      systemContent += `\n- Sonunda bu soruyu sor: "${question}"`;
    } else {
      systemContent += `\n- Soru SORMA, sadece empati göster`;
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

  // AI: Empati göster, derdine odaklan
  async _empathize(msg, warmName, topic, showVerse, askQuestion, chatId) {
    if (!this.aiChat?.openai) return null;

    let systemContent = `Sen dertlere ortak olan samimi bi arkadaşsın. KİŞİNİN SORUNUNA ODAKLAN.

KURALLAR:
- "${warmName}" diye hitap et
- Önce EMPATİ göster, dinlediğini hissettir
- 2-3 cümle max
- Kişinin anlattığı SORUNA özel cevap ver
- Genel laflar etme, spesifik ol`;

    if (showVerse) {
      const verse = this.getVerse(topic);
      const prayer = this.getPrayer(topic);
      systemContent += `\n- Bu ayeti kişinin durumuna bağla: "${verse.ayet}" (${verse.kaynak})`;
      systemContent += `\n- Bu duayı öner: "${prayer}"`;
    }

    if (askQuestion) {
      const question = this.getTopicQuestion(chatId, topic);
      systemContent += `\n- Sonunda bu soruyu sor: "${question}"`;
    } else {
      systemContent += `\n- Soru SORMA, sadece destek ver ve dinle`;
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
