"use strict";

/**
 * ConversationFlow v8.0 - Manevi Rehber
 *
 * DAVRANIŞLAR:
 * 1. Dinle, empati göster, teselli et
 * 2. Kuran ayetleri ve dualarla destek ver
 * 3. Kişinin durumuna özel ayet/dua seç
 * 4. Sohbeti sürdüren ufak sorular sor
 * 5. Umut ver, yalnız olmadığını hissettir
 */

class ConversationFlow {
  constructor(db, aiChat = null) {
    this.db = db;
    this.aiChat = aiChat;

    // Sıcak hitaplar
    this.warmAddresses = ["kardeşim", "canım", "güzel kardeşim", "değerli kardeşim"];

    // Sohbet soruları (bilgi toplama değil, sohbeti sürdürme)
    this.conversationQuestions = [
      "Peki bu durum seni en çok ne zaman etkiliyor?",
      "Biraz daha anlatır mısın?",
      "Bu konuda en çok neyi hissediyorsun?",
      "Yanında seni destekleyen biri var mı?",
      "Dua ettiğinde içini rahatlatıyor mu?",
      "Bu sıkıntı ne zamandır var?",
      "En son ne zaman huzur hissettin?",
      "Namazlarını kılabiliyor musun bu dönemde?"
    ];

    // Kuran ayetleri - konuya göre
    this.quranVerses = {
      sabir: [
        { ayet: "Ey iman edenler! Sabır ve namazla yardım isteyin. Şüphesiz Allah sabredenlerle beraberdir.", kaynak: "Bakara 153" },
        { ayet: "Her zorlukla beraber bir kolaylık vardır. Gerçekten, zorlukla beraber bir kolaylık vardır.", kaynak: "İnşirah 5-6" },
        { ayet: "Gevşemeyin, üzülmeyin; eğer inanıyorsanız en üstün olan sizlersiniz.", kaynak: "Al-i İmran 139" }
      ],
      umut: [
        { ayet: "Allah'ın rahmetinden ümit kesmeyin. Çünkü kafirler topluluğundan başkası Allah'ın rahmetinden ümit kesmez.", kaynak: "Yusuf 87" },
        { ayet: "Kim Allah'a tevekkül ederse, O ona yeter.", kaynak: "Talak 3" },
        { ayet: "Rabbiniz buyurdu ki: Bana dua edin, size cevap vereyim.", kaynak: "Mümin 60" }
      ],
      sikinti: [
        { ayet: "Allah hiçbir nefse gücünün yettiğinden fazlasını yüklemez.", kaynak: "Bakara 286" },
        { ayet: "Belki sevmediğiniz bir şey sizin için hayırlıdır, belki sevdiğiniz bir şey sizin için şerlidir. Allah bilir, siz bilmezsiniz.", kaynak: "Bakara 216" },
        { ayet: "Şüphesiz güçlükle beraber kolaylık vardır.", kaynak: "İnşirah 6" }
      ],
      korku: [
        { ayet: "Haberiniz olsun ki, Allah'ın velilerine korku yoktur ve onlar üzülmeyeceklerdir.", kaynak: "Yunus 62" },
        { ayet: "De ki: Allah'ın bizim için yazdığından başkası bize asla erişmez. O bizim Mevlamızdır.", kaynak: "Tevbe 51" }
      ],
      aile: [
        { ayet: "Eşlerinize güzellikle davranın. Onlardan hoşlanmasanız bile, olabilir ki hoşlanmadığınız şeyde Allah çok hayır kılar.", kaynak: "Nisa 19" },
        { ayet: "Rabbimiz! Bize eşlerimizden ve nesillerimizden göz aydınlığı olacak kimseler ihsan et.", kaynak: "Furkan 74" }
      ],
      rizik: [
        { ayet: "Nice canlı var ki rızkını taşıyamaz. Onları da sizi de Allah rızıklandırır.", kaynak: "Ankebut 60" },
        { ayet: "Kim Allah'tan korkarsa, Allah ona bir çıkış yolu yaratır ve onu ummadığı yerden rızıklandırır.", kaynak: "Talak 2-3" }
      ],
      saglik: [
        { ayet: "Rabbim! Bana şifa ver, şüphesiz şifa veren ancak Sensin.", kaynak: "Şuara 80" },
        { ayet: "Biz Kur'an'dan, müminler için şifa ve rahmet olan şeyler indiriyoruz.", kaynak: "İsra 82" }
      ]
    };

    // Dualar - konuya göre
    this.prayers = {
      genel: [
        "Allahümme yessir vela tuassir",
        "Hasbünallahü ve ni'mel vekil",
        "La havle vela kuvvete illa billah"
      ],
      sikinti: [
        "Allahümme la sehle illa ma cealtehü sehla, ve ente tec'alül hazne iza şi'te sehla",
        "Ya Hayyu ya Kayyum, bi rahmetike esteğis"
      ],
      sabir: [
        "Rabbena efrığ aleyna sabran ve teveffena müslimin",
        "Allahümme'ğfirli hatıeti ve cehli ve israfi fi emri"
      ]
    };
  }

  // Rastgele hitap
  getWarmAddress() {
    return this.warmAddresses[Math.floor(Math.random() * this.warmAddresses.length)];
  }

  // Ayet/dua gösterilsin mi? (yaklaşık 3-5 mesajda 1)
  shouldShowVerse() {
    return Math.random() < 0.25; // %25 ihtimal = ortalama 4 mesajda 1
  }

  // Rastgele sohbet sorusu
  getConversationQuestion() {
    return this.conversationQuestions[Math.floor(Math.random() * this.conversationQuestions.length)];
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
    if (lower.includes("sabır") || lower.includes("dayanamı") || lower.includes("zor")) return "sabir";
    if (lower.includes("korku") || lower.includes("endişe") || lower.includes("kaygı")) return "korku";
    if (lower.includes("eş") || lower.includes("evlilik") || lower.includes("aile") || lower.includes("anne") || lower.includes("baba")) return "aile";
    if (lower.includes("para") || lower.includes("iş") || lower.includes("geçim") || lower.includes("borç")) return "rizik";
    if (lower.includes("hasta") || lower.includes("sağlık") || lower.includes("ağrı") || lower.includes("hastalık")) return "saglik";
    if (lower.includes("umutsuz") || lower.includes("çaresiz") || lower.includes("ümit")) return "umut";
    if (lower.includes("sıkıntı") || lower.includes("dert") || lower.includes("sorun") || lower.includes("problem")) return "sikinti";
    return "umut";
  }

  // İnsansı yazım
  addHumanTouch(text) {
    if (!text) return text;
    if (Math.random() < 0.3) text = text.replace(/inşallah/gi, "insallah");
    if (Math.random() < 0.3) text = text.replace(/\bbir\b/g, "bi");
    if (Math.random() < 0.2) text = text.replace(/\bşey\b/g, "bişey");
    return text;
  }

  // Türkçe normalize
  normalizeTR(str) {
    return String(str || "").replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase().trim();
  }

  // Selamlama mı?
  isGreeting(msg) {
    const lower = this.normalizeTR(msg);
    const greetings = ["selam", "merhaba", "mrb", "slm", "sa", "as", "selamun", "hey", "iyi günler"];
    return greetings.some(g => lower.startsWith(g)) || (msg.length < 25 && greetings.some(g => lower.includes(g)));
  }

  // Soru mu?
  isQuestion(msg) {
    const lower = this.normalizeTR(msg);
    return lower.includes("?") || lower.includes("nasıl") || lower.includes("ne zaman") ||
           lower.includes("neden") || lower.includes("nerede") || lower.includes("kim") ||
           lower.includes("mi") || lower.includes("mı") || lower.includes("mu") || lower.includes("mü") ||
           lower.includes("ne yapmalı") || lower.includes("ne yapmam");
  }

  // Teşekkür mü?
  isThanks(msg) {
    const lower = this.normalizeTR(msg);
    return lower.includes("teşekkür") || lower.includes("sağol") || lower.includes("eyvallah") ||
           lower.includes("allah razı") || lower.includes("çok iyi") || lower.includes("minnettarım");
  }

  // Veda mı?
  isGoodbye(msg) {
    const lower = this.normalizeTR(msg);
    return lower.includes("görüşürüz") || lower.includes("hoşçakal") || lower.includes("bye") ||
           lower.includes("allah'a emanet") || lower.includes("hayırlı günler");
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
        `Aleyküm selam ${this.getWarmAddress()}, hoş geldin. ` +
        `Nasılsın, gönlünde ne var?`
      );
      return { reply, action: "greeting" };
    }

    // === TEŞEKKÜR ===
    if (this.isThanks(msg)) {
      const reply = this.addHumanTouch(
        `Estağfurullah ${warmName}. Dua ederim sana, Allah yolunu açık etsin. ` +
        `İhtiyacın olursa yine yaz, buradayım.`
      );
      return { reply, action: "thanks" };
    }

    // === VEDA ===
    if (this.isGoodbye(msg)) {
      const prayer = this.getPrayer("genel");
      const reply = this.addHumanTouch(
        `Allah'a emanet ol ${warmName}. "${prayer}" duasını unutma. ` +
        `Rabbim işlerini rast getirsin.`
      );
      return { reply, action: "goodbye" };
    }

    // === SORU SORUYORSA ===
    if (this.isQuestion(msg)) {
      const showVerse = this.shouldShowVerse();
      if (this.aiChat) {
        const aiReply = await this._answerQuestion(msg, warmName, topic, showVerse);
        if (aiReply) return { reply: this.addHumanTouch(aiReply), action: "answer" };
      }
      // AI yoksa
      const question = this.getConversationQuestion();
      if (showVerse) {
        const verse = this.getVerse(topic);
        const reply = this.addHumanTouch(
          `${warmName}, Rabbimiz "${verse.ayet}" buyuruyor (${verse.kaynak}). ` +
          `${question}`
        );
        return { reply, action: "answer" };
      }
      const reply = this.addHumanTouch(
        `${warmName}, sabır ve dua ile yaklaş. İnsallah hayırlısı olur. ${question}`
      );
      return { reply, action: "answer" };
    }

    // === DERT ANLATIYORSA ===
    const showVerse = this.shouldShowVerse();
    if (this.aiChat) {
      const aiReply = await this._empathize(msg, warmName, topic, showVerse);
      if (aiReply) return { reply: this.addHumanTouch(aiReply), action: "empathy" };
    }

    // AI yoksa
    const question = this.getConversationQuestion();
    if (showVerse) {
      const verse = this.getVerse(topic);
      const reply = this.addHumanTouch(
        `Anlıyorum ${warmName}. "${verse.ayet}" (${verse.kaynak}). ` +
        `${question}`
      );
      return { reply, action: "empathy" };
    }
    const reply = this.addHumanTouch(
      `Anlıyorum ${warmName}, zor bi durum. Yalnız değilsin, Allah yardımcın olsun. ${question}`
    );
    return { reply, action: "empathy" };
  }

  // AI: Soruya cevap ver (bazen ayet/dua ile)
  async _answerQuestion(msg, warmName, topic, showVerse = false) {
    if (!this.aiChat?.openai) return null;
    const question = this.getConversationQuestion();

    let systemContent = `Sen manevi rehber ve samimi bir arkadaşsın.

KURALLAR:
- "${warmName}" diye hitap et
- 2-3 cümle max, kısa ve öz
- Samimi ve sıcak ol
- Sonunda bu soruyu sor: "${question}"`;

    if (showVerse) {
      const verse = this.getVerse(topic);
      const prayer = this.getPrayer(topic);
      systemContent = `Sen manevi rehber ve dini danışmansın.

BU MESAJDA AYET/DUA KULLAN:
- Bu ayeti dahil et: "${verse.ayet}" (${verse.kaynak})
- Bu duayı öner: "${prayer}"
- Sonunda bu soruyu sor: "${question}"

KURALLAR:
- "${warmName}" diye hitap et
- Ayeti kişinin durumuna bağla
- 3-4 cümle max
- Samimi ol`;
    }

    try {
      const resp = await this.aiChat.openai.chat.completions.create({
        model: this.aiChat.model,
        messages: [
          { role: "system", content: systemContent },
          { role: "user", content: msg }
        ],
        temperature: 0.8,
        max_tokens: showVerse ? 200 : 120
      });
      return resp.choices[0]?.message?.content?.trim() || null;
    } catch { return null; }
  }

  // AI: Empati göster (bazen ayet/dua ile)
  async _empathize(msg, warmName, topic, showVerse = false) {
    if (!this.aiChat?.openai) return null;
    const question = this.getConversationQuestion();

    let systemContent = `Sen dertlere ortak olan samimi bir arkadaşsın.

KURALLAR:
- "${warmName}" diye hitap et
- Empati göster, dinlediğini hissettir
- 2-3 cümle max
- Yalnız olmadığını söyle
- Sonunda bu soruyu sor: "${question}"`;

    if (showVerse) {
      const verse = this.getVerse(topic);
      const prayer = this.getPrayer(topic);
      systemContent = `Sen manevi rehber ve dini danışmansın. Biri derdini anlatıyor.

BU MESAJDA AYET/DUA KULLAN:
- Bu ayeti dahil et ve duruma bağla: "${verse.ayet}" (${verse.kaynak})
- Bu duayı öner: "${prayer}"
- Sonunda bu soruyu sor: "${question}"

KURALLAR:
- "${warmName}" diye hitap et
- Önce empati göster
- Ayeti kişinin durumuna özel yorumla
- 4-5 cümle max
- Umut ver`;
    }

    try {
      const resp = await this.aiChat.openai.chat.completions.create({
        model: this.aiChat.model,
        messages: [
          { role: "system", content: systemContent },
          { role: "user", content: msg }
        ],
        temperature: 0.85,
        max_tokens: showVerse ? 220 : 130
      });
      return resp.choices[0]?.message?.content?.trim() || null;
    } catch { return null; }
  }
}

module.exports = { ConversationFlow };
