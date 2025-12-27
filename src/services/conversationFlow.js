"use strict";

/**
 * ConversationFlow v3.0 - İnsansı Sohbet Motoru
 *
 * ÖNCELİK SIRASI:
 * 1. Kullanıcının niyetini anla (soru mu soruyor, bilgi mi veriyor, selamlama mı?)
 * 2. Doğal cevap ver (robot gibi değil, insan gibi)
 * 3. Bilgi toplamayı sohbetin içine gizle
 * 4. Aynı soruyu tekrar sorma
 */

class ConversationFlow {
  constructor(db, aiChat = null) {
    this.db = db;
    this.aiChat = aiChat;

    // Toplanacak bilgiler
    this.requiredFields = [
      { key: "full_name", label: "isim", priority: 1 },
      { key: "city", label: "şehir", priority: 2 },
      { key: "birth_date", label: "yaş", priority: 3 },
      { key: "mother_name", label: "anne adı", priority: 4 },
      { key: "phone", label: "telefon", priority: 5 },
      { key: "subject", label: "konu/dert", priority: 6 }
    ];

    // Türk isimleri
    this.commonNames = new Set([
      "ahmet", "mehmet", "mustafa", "ali", "hasan", "hüseyin", "ibrahim", "ismail", "osman", "yusuf",
      "fatma", "ayşe", "emine", "hatice", "zeynep", "elif", "meryem", "sultan", "hacer", "hanife",
      "ayten", "aysel", "gülşen", "sevim", "nurten", "nuriye", "naime", "naciye", "halime", "havva",
      "ömer", "recep", "ramazan", "süleyman", "abdullah", "abdulkadir", "murat", "burak", "emre", "can",
      "derya", "deniz", "ceren", "selin", "ece", "buse", "merve", "büşra", "seda", "gamze"
    ]);

    // Şehirler
    this.cities = [
      "istanbul", "ankara", "izmir", "bursa", "antalya", "konya", "adana", "gaziantep", "mersin", "diyarbakır",
      "kayseri", "eskişehir", "samsun", "denizli", "şanlıurfa", "malatya", "trabzon", "erzurum", "van", "batman",
      "elazığ", "sivas", "manisa", "balıkesir", "kahramanmaraş", "hatay", "sakarya", "kocaeli", "muğla", "aydın"
    ];

    // Niyet kalıpları
    this.intentPatterns = {
      greeting: ["selam", "merhaba", "mrb", "slm", "günaydın", "iyi günler", "iyi akşamlar", "sa", "as", "selamün"],
      question: ["soru", "sormak", "soracak", "merak", "öğrenmek", "bilgi", "nasıl", "neden", "ne zaman", "nerede"],
      help: ["yardım", "destek", "problem", "sıkıntı", "dert", "sorun", "muska", "büyü", "nazar", "ayrılık", "sevgi"],
      thanks: ["teşekkür", "sağol", "eyvallah", "allah razı", "çok iyi"],
      confirm: ["tamam", "olur", "evet", "peki", "anladım", "ok", "he", "hı", "tamamdır"],
      phone: ["ara", "arayın", "telefon", "numara", "iletişim"]
    };
  }

  // === NİYET ALGILAMA ===
  detectIntent(message) {
    const lower = this.normalizeTR(message);

    for (const [intent, patterns] of Object.entries(this.intentPatterns)) {
      if (patterns.some(p => lower.includes(p))) {
        return intent;
      }
    }
    return "unknown";
  }

  // === KISA CEVAP ALGILAMA ===
  detectShortAnswer(message, profile) {
    const raw = String(message || "").trim();
    const lower = this.normalizeTR(raw);
    const words = raw.split(/\s+/);

    if (words.length > 4 || raw.length > 50) return null;
    if (this.isGreeting(raw)) return null;

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
        if (words.length === 1) return { city: this._capitalizeWords(raw) };
        break;

      case "birth_date":
        const ageMatch = raw.match(/^(\d{1,2})$/);
        if (ageMatch && parseInt(ageMatch[1]) >= 10 && parseInt(ageMatch[1]) <= 100) {
          return { birth_date: String(new Date().getFullYear() - parseInt(ageMatch[1])) };
        }
        const yearMatch = raw.match(/^(19\d{2}|20[0-2]\d)$/);
        if (yearMatch) return { birth_date: yearMatch[1] };
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

    // Telefon
    const phoneMatch = raw.replace(/\s+/g, "").match(/(\+?90)?0?5\d{9}/);
    if (phoneMatch) extracted.phone = phoneMatch[0];

    // Şehir
    for (const city of this.cities) {
      if (lower.includes(this.normalizeTR(city))) {
        extracted.city = city.charAt(0).toUpperCase() + city.slice(1);
        break;
      }
    }

    // Yaş
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

    // === SELAMLAMAise ===
    if (intent === "greeting") {
      if (!profile?.full_name) {
        return {
          reply: `Aleyküm selam kardeşim, hoş geldin. İsmin nedir?`,
          action: "greeting"
        };
      }
      return {
        reply: `Aleyküm selam ${warmName}, nasılsın? Seni dinliyorum.`,
        action: "greeting"
      };
    }

    // === SORU SORMAK İSTİYORSA ===
    if (intent === "question") {
      return {
        reply: `Buyur ${warmName}, dinliyorum. Ne sormak istiyorsun?`,
        action: "listening"
      };
    }

    // === YARDIM/DERT ANLATIYORSA ===
    if (intent === "help" || message.length > 30) {
      // Konu olarak kaydet
      if (!profile?.subject && message.length > 15) {
        await this.db.updateProfile(chatId, clientId, { subject: message });
        if (profile) profile.subject = message;
      }

      // AI ile cevap üret
      if (this.aiChat) {
        const aiReply = await this._generateNaturalReply(message, profile, missing);
        if (aiReply) {
          return { reply: aiReply, action: "ai_response" };
        }
      }

      // AI yoksa basit cevap
      return {
        reply: `Anlıyorum ${warmName}. Bu konuda hocamız sana yardımcı olabilir inşallah. Seni hocamıza ileteceğim.`,
        action: "help_response"
      };
    }

    // === TEŞEKKÜR ===
    if (intent === "thanks") {
      return {
        reply: `Rica ederim ${warmName}, Allah razı olsun.`,
        action: "thanks"
      };
    }

    // === ONAY (evet, tamam vs) ===
    if (intent === "confirm") {
      // Eğer kısa cevap değilse ve eksik alan varsa sor
      if (missing.length > 0 && !shortAnswer) {
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
        reply: `Tamam ${warmName}, başka bir şey var mı?`,
        action: "confirm"
      };
    }

    // === TELEFON İSTEĞİ ===
    if (intent === "phone") {
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
        reply: `Numaran kayıtlı ${warmName}, hocamız en kısa sürede arayacak inşallah.`,
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
        reply: `Tamam ${warmName}, bilgilerini hocamıza ilettim. Seni arayacak inşallah.`,
        action: "profile_complete"
      };
    }

    // === EKSİK BİLGİ VAR AMA DOĞAL AKIŞTA SOR ===
    // Sadece her 3-4 mesajda bir eksik bilgi sor, sürekli sorma
    const msgCount = profile?.msg_count || 0;
    const shouldAsk = (msgCount % 3 === 0) || missing.length <= 2;

    if (missing.length > 0 && shouldAsk) {
      const nextField = missing[0];

      // Son 2 dakikada aynı soruyu sorma
      const lastAt = profile?.last_question_at ? new Date(profile.last_question_at).getTime() : 0;
      if (profile?.last_question_key === nextField.key && Date.now() - lastAt < 120000) {
        // AI ile devam et
        if (this.aiChat) {
          const aiReply = await this._generateNaturalReply(message, profile, missing);
          if (aiReply) return { reply: aiReply, action: "ai_continue" };
        }
        return { reply: null, action: "skip_repeat" };
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

    // === VARSAYILAN: AI İLE CEVAP VER ===
    if (this.aiChat) {
      const aiReply = await this._generateNaturalReply(message, profile, missing);
      if (aiReply) return { reply: aiReply, action: "ai_default" };
    }

    return {
      reply: `Seni dinliyorum ${warmName}.`,
      action: "default"
    };
  }

  // === AI İLE DOĞAL CEVAP ===
  async _generateNaturalReply(message, profile, missing) {
    if (!this.aiChat?.openai) return null;

    try {
      const warmName = profile?.full_name?.split(" ")[0] || "kardeşim";
      const missingInfo = missing.slice(0, 2).map(f => f.label).join(", ");

      const systemPrompt = `Sen bir hocanın yardımcısısın. WhatsApp'ta insanlarla sohbet ediyorsun.

KONUŞMA TARZI:
- Kısa ve doğal cevaplar ver (1-3 cümle max)
- "Hocam", "efendim" gibi resmi kalıplar kullanma
- Samimi ol ama saygılı: "kardeşim", "${warmName}" diye hitap et
- Emoji kullanma
- Her cümlenin sonuna "inşallah" veya dini terim ekleme, sadece uygun yerde kullan

GÖREV:
- Kullanıcının mesajına doğal cevap ver
- Eğer uygunsa laf arasında şu bilgiyi sor: ${missingInfo || "yok"}
- Ama zorlama, doğal akışta sor

KULLANICI BİLGİLERİ:
- İsim: ${profile?.full_name || "bilinmiyor"}
- Şehir: ${profile?.city || "bilinmiyor"}
- Konu: ${profile?.subject || "henüz belirtmedi"}

ÖNEMLİ: Robot gibi değil, gerçek bir insan gibi yaz.`;

      const completion = await this.aiChat.openai.chat.completions.create({
        model: this.aiChat.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message }
        ],
        temperature: 0.8,
        max_tokens: 120
      });

      let reply = completion.choices[0]?.message?.content || "";

      // Çok uzunsa kısalt
      if (reply.length > 200) {
        const sentences = reply.split(/[.!?]+/).filter(s => s.trim());
        reply = sentences.slice(0, 2).join(". ") + ".";
      }

      return reply.trim();
    } catch (e) {
      console.error("AI cevap hatası:", e.message);
      return null;
    }
  }

  // === DOĞAL SORULAR ===
  _naturalQuestion(fieldKey, warmName) {
    const questions = {
      full_name: `İsmin ne ${warmName}?`,
      city: `Nerelisin kardeşim?`,
      phone: `Hocamız seni arasın mı? Numara bırak istersen.`,
      birth_date: `Kaç yaşındasın?`,
      mother_name: `Anne adın ne kardeşim? (Bakım için lazım)`,
      subject: `Anlat bakalım, derdin ne?`
    };
    return questions[fieldKey] || "Nasıl yardımcı olabilirim?";
  }

  // === YARDIMCI METODLAR ===
  normalizeTR(str) {
    return String(str || "").replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase().trim();
  }

  isGreeting(message) {
    const lower = this.normalizeTR(message);
    return this.intentPatterns.greeting.some(g => lower.includes(g));
  }

  _capitalizeWords(str) {
    return String(str || "")
      .split(/\s+/)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
  }
}

module.exports = { ConversationFlow };
