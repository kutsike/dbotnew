"use strict";

/**
 * ConversationFlow v4.0 - İnsansı Sohbet Motoru
 *
 * DEĞİŞİKLİKLER:
 * - Niyet algılama düzeltildi (greeting false positive önlendi)
 * - Manevi konularda empati ve hocaya yönlendirme
 * - Doğal sohbet akışı
 */

class ConversationFlow {
  constructor(db, aiChat = null) {
    this.db = db;
    this.aiChat = aiChat;

    this.requiredFields = [
      { key: "full_name", label: "isim", priority: 1 },
      { key: "city", label: "şehir", priority: 2 },
      { key: "birth_date", label: "yaş", priority: 3 },
      { key: "mother_name", label: "anne adı", priority: 4 },
      { key: "phone", label: "telefon", priority: 5 },
      { key: "subject", label: "konu/dert", priority: 6 }
    ];

    this.commonNames = new Set([
      "ahmet", "mehmet", "mustafa", "ali", "hasan", "hüseyin", "ibrahim", "ismail", "osman", "yusuf",
      "fatma", "ayşe", "emine", "hatice", "zeynep", "elif", "meryem", "sultan", "hacer", "hanife",
      "ayten", "aysel", "gülşen", "sevim", "nurten", "nuriye", "naime", "naciye", "halime", "havva"
    ]);

    this.cities = [
      "istanbul", "ankara", "izmir", "bursa", "antalya", "konya", "adana", "gaziantep", "mersin", "diyarbakır",
      "kayseri", "eskişehir", "samsun", "denizli", "şanlıurfa", "malatya", "trabzon", "erzurum", "van", "batman"
    ];

    // Manevi/spiritüel konular - bunlarda hocaya yönlendir
    this.spiritualTopics = [
      "büyü", "muska", "nazar", "cin", "rüya", "fal", "bağlama", "ayrılık", "sevgi", "geri getirme",
      "kısmet", "uğur", "şans", "bereket", "hastalık", "iyileşme", "dua", "zikir", "vefk", "tılsım",
      "eş", "evlilik", "boşanma", "koca", "karı", "aldatma", "ihanet", "aile", "anne", "baba",
      "para", "borç", "iş", "rızık", "zenginlik", "fakirlik", "sıkıntı", "dert", "sorun", "problem"
    ];
  }

  // === NİYET ALGILAMA (GELİŞTİRİLMİŞ) ===
  detectIntent(message) {
    const lower = this.normalizeTR(message);
    const words = lower.split(/\s+/);

    // SELAMLAMA: Sadece mesaj selam ile BAŞLIYORSA veya çok kısaysa
    const greetingStarts = ["selam", "merhaba", "mrb", "slm", "sa ", "as ", "selamun", "selamın"];
    const isGreeting = greetingStarts.some(g => lower.startsWith(g)) ||
                       (words.length <= 2 && greetingStarts.some(g => lower.includes(g)));
    if (isGreeting) return "greeting";

    // MANEVİ KONU: Büyü, muska, nazar vs.
    if (this.spiritualTopics.some(t => lower.includes(t))) {
      return "spiritual";
    }

    // SORU SORMAK İSTİYOR
    if (lower.includes("soru") || lower.includes("sormak") || lower.includes("soracak") ||
        lower.includes("merak") || lower.includes("öğrenmek")) {
      return "question";
    }

    // NASIL sorusu
    if (lower.includes("nasıl") || lower.includes("ne yapmalı") || lower.includes("ne yapmam")) {
      return "how_question";
    }

    // TEŞEKKÜR
    if (lower.includes("teşekkür") || lower.includes("sağol") || lower.includes("eyvallah")) {
      return "thanks";
    }

    // ONAY
    if (words.length <= 3 && (lower.includes("tamam") || lower.includes("olur") ||
        lower.includes("evet") || lower.includes("peki") || lower === "ok" || lower === "he")) {
      return "confirm";
    }

    // TELEFON/ARAMA İSTEĞİ
    if (lower.includes("ara") || lower.includes("telefon") || lower.includes("numara")) {
      return "phone_request";
    }

    return "general";
  }

  // === KISA CEVAP ALGILAMA ===
  detectShortAnswer(message, profile) {
    const raw = String(message || "").trim();
    const lower = this.normalizeTR(raw);
    const words = raw.split(/\s+/);

    if (words.length > 4 || raw.length > 50) return null;

    const lastQ = profile?.last_question_key;
    if (!lastQ) return null;

    const lastAt = profile?.last_question_at ? new Date(profile.last_question_at).getTime() : 0;
    if (Date.now() - lastAt > 600000) return null;

    switch (lastQ) {
      case "full_name":
        if (words.length <= 3 && /^[a-zA-ZçğıöşüÇĞİÖŞÜ]/.test(raw)) {
          return { full_name: this._capitalizeWords(raw) };
        }
        break;

      case "mother_name":
        if (words.length <= 2 && /^[a-zA-ZçğıöşüÇĞİÖŞÜ]/.test(raw)) {
          return { mother_name: this._capitalizeWords(raw) };
        }
        break;

      case "city":
        for (const city of this.cities) {
          if (lower.includes(this.normalizeTR(city))) {
            return { city: city.charAt(0).toUpperCase() + city.slice(1) };
          }
        }
        if (words.length === 1 && /^[a-zA-ZçğıöşüÇĞİÖŞÜ]/.test(raw)) {
          return { city: this._capitalizeWords(raw) };
        }
        break;

      case "birth_date":
        const ageMatch = raw.match(/^(\d{1,2})$/);
        if (ageMatch && parseInt(ageMatch[1]) >= 10 && parseInt(ageMatch[1]) <= 100) {
          return { birth_date: String(new Date().getFullYear() - parseInt(ageMatch[1])) };
        }
        break;

      case "phone":
        const phoneMatch = raw.replace(/\s+/g, "").match(/(\+?90)?0?5\d{9}/);
        if (phoneMatch) return { phone: phoneMatch[0] };
        break;
    }

    return null;
  }

  // === VERİ ÇIKARMA ===
  extractInfo(message, profile) {
    const extracted = {};
    const raw = String(message || "");
    const lower = this.normalizeTR(raw);

    const phoneMatch = raw.replace(/\s+/g, "").match(/(\+?90)?0?5\d{9}/);
    if (phoneMatch) extracted.phone = phoneMatch[0];

    for (const city of this.cities) {
      if (lower.includes(this.normalizeTR(city))) {
        extracted.city = city.charAt(0).toUpperCase() + city.slice(1);
        break;
      }
    }

    const ageMatch = lower.match(/(\d{1,2})\s*yaş/);
    if (ageMatch) extracted.birth_date = String(new Date().getFullYear() - parseInt(ageMatch[1]));

    return extracted;
  }

  getMissingFields(profile) {
    return this.requiredFields
      .filter(f => !profile?.[f.key] || String(profile[f.key]).trim() === "")
      .sort((a, b) => a.priority - b.priority);
  }

  // === ANA İŞLEM ===
  async processMessage(chatId, clientId, message, context = {}) {
    const { name, profile } = context;
    const warmName = profile?.full_name?.split(" ")[0] || name || "kardeşim";

    // 1. Kısa cevap algılama
    const shortAnswer = this.detectShortAnswer(message, profile);
    if (shortAnswer && profile) {
      await this.db.updateProfile(chatId, clientId, shortAnswer);
      Object.assign(profile, shortAnswer);
      await this.db.updateProfile(chatId, clientId, { last_question_key: null });

      // Kısa cevap alındıysa teşekkür et ve devam et
      const missing = this.getMissingFields(profile);
      if (missing.length > 0) {
        const nextField = missing[0];
        await this.db.updateProfile(chatId, clientId, {
          last_question_key: nextField.key,
          last_question_at: new Date()
        });
        return {
          reply: `Tamam ${warmName}. ${this._naturalQuestion(nextField.key, warmName)}`,
          action: "short_answer_next"
        };
      }
    }

    // 2. Normal veri çıkarma
    const extracted = this.extractInfo(message, profile);
    if (profile && Object.keys(extracted).length > 0) {
      await this.db.updateProfile(chatId, clientId, extracted);
      Object.assign(profile, extracted);
    }

    // 3. Niyet algıla
    const intent = this.detectIntent(message);
    const missing = this.getMissingFields(profile || {});

    // === SELAMLAMA ===
    if (intent === "greeting") {
      if (!profile?.full_name) {
        return {
          reply: `Aleyküm selam kardeşim, hoş geldin. İsmin nedir?`,
          action: "greeting"
        };
      }
      return {
        reply: `Aleyküm selam ${warmName}, hoş geldin. Nasıl yardımcı olabilirim?`,
        action: "greeting"
      };
    }

    // === MANEVİ KONU (büyü, muska, nazar vs.) ===
    if (intent === "spiritual") {
      // Konuyu kaydet
      if (!profile?.subject) {
        await this.db.updateProfile(chatId, clientId, { subject: message });
        if (profile) profile.subject = message;
      }

      // AI ile empati ve yönlendirme
      if (this.aiChat) {
        const aiReply = await this._generateSpiritualReply(message, profile, missing, warmName);
        if (aiReply) return { reply: aiReply, action: "spiritual_response" };
      }

      // AI yoksa manuel cevap
      return {
        reply: `${warmName}, bu konuda hocamız çok deneyimli. Endişelenme, daha detaylı anlat bana, hocamıza iletelim.`,
        action: "spiritual_fallback"
      };
    }

    // === SORU SORMAK İSTİYOR ===
    if (intent === "question") {
      return {
        reply: `Buyur ${warmName}, dinliyorum. Ne sormak istiyorsun?`,
        action: "listening"
      };
    }

    // === NASIL SORUSU (nasıl yapmalıyım vs.) ===
    if (intent === "how_question") {
      if (this.aiChat) {
        const aiReply = await this._generateHelpfulReply(message, profile, warmName);
        if (aiReply) return { reply: aiReply, action: "how_response" };
      }
      return {
        reply: `${warmName}, bu konuda hocamız sana daha iyi yol gösterir. Biraz daha anlat, ne oldu?`,
        action: "how_fallback"
      };
    }

    // === TEŞEKKÜR ===
    if (intent === "thanks") {
      return {
        reply: `Rica ederim ${warmName}. Başka bir şey var mı yardımcı olabileceğim?`,
        action: "thanks"
      };
    }

    // === ONAY ===
    if (intent === "confirm") {
      if (missing.length > 0) {
        const nextField = missing[0];
        await this.db.updateProfile(chatId, clientId, {
          last_question_key: nextField.key,
          last_question_at: new Date()
        });
        return {
          reply: this._naturalQuestion(nextField.key, warmName),
          action: "collecting_" + nextField.key
        };
      }
      return {
        reply: `Tamam ${warmName}. Başka bir şey var mı?`,
        action: "confirm"
      };
    }

    // === TELEFON İSTEĞİ ===
    if (intent === "phone_request") {
      if (!profile?.phone) {
        await this.db.updateProfile(chatId, clientId, {
          last_question_key: "phone",
          last_question_at: new Date()
        });
        return {
          reply: `Tabii ${warmName}, hocamız seni arasın. Numaranı yazar mısın?`,
          action: "collecting_phone"
        };
      }
      return {
        reply: `Numaran kayıtlı ${warmName}. Hocamız müsait olunca arayacak inşallah.`,
        action: "phone_exists"
      };
    }

    // === TÜM BİLGİLER TAMAM ===
    if (missing.length === 0 && profile) {
      if (profile.status !== "waiting") {
        try { await this.db.createAppointment(profile.id, clientId, profile.subject || ""); } catch {}
        await this.db.updateProfileStatus(chatId, clientId, "waiting");
      }
      return {
        reply: `Tamam ${warmName}, bilgilerini hocamıza ilettim. Seni arayacak inşallah. Başka bir şey var mı?`,
        action: "profile_complete"
      };
    }

    // === GENEL MESAJ - AI İLE CEVAPLA ===
    if (this.aiChat && message.length > 5) {
      // Uzun mesajsa konu olarak kaydet
      if (!profile?.subject && message.length > 20) {
        await this.db.updateProfile(chatId, clientId, { subject: message });
        if (profile) profile.subject = message;
      }

      const aiReply = await this._generateNaturalReply(message, profile, missing, warmName);
      if (aiReply) return { reply: aiReply, action: "ai_response" };
    }

    // === EKSİK BİLGİ SOR ===
    if (missing.length > 0) {
      const nextField = missing[0];

      // Aynı soruyu 2 dk içinde sorma
      const lastAt = profile?.last_question_at ? new Date(profile.last_question_at).getTime() : 0;
      if (profile?.last_question_key === nextField.key && Date.now() - lastAt < 120000) {
        return {
          reply: `Seni dinliyorum ${warmName}.`,
          action: "waiting"
        };
      }

      await this.db.updateProfile(chatId, clientId, {
        last_question_key: nextField.key,
        last_question_at: new Date()
      });

      return {
        reply: this._naturalQuestion(nextField.key, warmName),
        action: "collecting_" + nextField.key
      };
    }

    return {
      reply: `Seni dinliyorum ${warmName}.`,
      action: "default"
    };
  }

  // === MANEVİ KONULAR İÇİN AI CEVABI ===
  async _generateSpiritualReply(message, profile, missing, warmName) {
    if (!this.aiChat?.openai) return null;

    try {
      const prompt = `Sen bir hocanın yardımcısısın. Biri sana manevi bir konu hakkında danışıyor.

KONUŞMA TARZI:
- Samimi ve anlayışlı ol
- EMPATİ göster - "Anlıyorum", "Zor bir durum" gibi
- Hocaya güven ver - "Hocamız bu konularda çok deneyimli"
- Kısa cevap ver (2-3 cümle)
- Tavsiye verme, sadece dinle ve hocaya yönlendir

ÖRNEK:
Kullanıcı: "Eşime büyü yapmışlar mı acaba?"
Sen: "Anlıyorum ${warmName}, bu tür şeyler insanı tedirgin eder. Hocamız bu konularda çok tecrübeli, onunla konuşalım. Biraz daha anlat, neler oluyor?"

Kullanıcı: "${message}"

Kısa ve samimi cevap ver:`;

      const completion = await this.aiChat.openai.chat.completions.create({
        model: this.aiChat.model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.8,
        max_tokens: 100
      });

      return completion.choices[0]?.message?.content?.trim() || null;
    } catch (e) {
      console.error("AI spiritual hatası:", e.message);
      return null;
    }
  }

  // === NASIL SORULARI İÇİN AI CEVABI ===
  async _generateHelpfulReply(message, profile, warmName) {
    if (!this.aiChat?.openai) return null;

    try {
      const prompt = `Sen bir hocanın yardımcısısın. Biri sana "nasıl yapmalıyım" tarzı bir soru soruyor.

KURAL: Direkt tavsiye verme, dinle ve hocaya yönlendir.

Kullanıcı: "${message}"

Kısa cevap ver (1-2 cümle). Örnek: "Anlıyorum ${warmName}. Bu konuda hocamızla konuşalım, sana daha iyi yol gösterir. Biraz daha anlat?"`;

      const completion = await this.aiChat.openai.chat.completions.create({
        model: this.aiChat.model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 80
      });

      return completion.choices[0]?.message?.content?.trim() || null;
    } catch (e) {
      return null;
    }
  }

  // === GENEL AI CEVABI ===
  async _generateNaturalReply(message, profile, missing, warmName) {
    if (!this.aiChat?.openai) return null;

    try {
      const missingInfo = missing.slice(0, 1).map(f => f.label).join(", ");

      const prompt = `Sen bir hocanın yardımcısısın. WhatsApp'ta sohbet ediyorsun.

KURAL:
- Kısa cevap (1-2 cümle)
- Samimi ol, "${warmName}" diye hitap et
- Robot gibi olma
- Eğer uygunsa laf arasında şunu sor: ${missingInfo || "bir şey sorma"}

Kullanıcı: "${message}"

Kısa ve doğal cevap:`;

      const completion = await this.aiChat.openai.chat.completions.create({
        model: this.aiChat.model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.8,
        max_tokens: 80
      });

      return completion.choices[0]?.message?.content?.trim() || null;
    } catch (e) {
      return null;
    }
  }

  // === DOĞAL SORULAR ===
  _naturalQuestion(fieldKey, warmName) {
    const questions = {
      full_name: `İsmin ne ${warmName}?`,
      city: `Nerelisin?`,
      phone: `Hocamız seni arasın mı? Numara bırakır mısın?`,
      birth_date: `Kaç yaşındasın?`,
      mother_name: `Anne adın ne? (Hocamızın bakımı için lazım)`,
      subject: `Anlat bakalım, derdin ne?`
    };
    return questions[fieldKey] || "Nasıl yardımcı olabilirim?";
  }

  // === YARDIMCI METODLAR ===
  normalizeTR(str) {
    return String(str || "").replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase().trim();
  }

  _capitalizeWords(str) {
    return String(str || "")
      .split(/\s+/)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
  }
}

module.exports = { ConversationFlow };
