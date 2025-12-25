"use strict";

/**
 * ConversationFlow
 *
 * Amaç:
 * - Kullanıcıyı sıcak/insani bir dille karşılamak
 * - Bilgileri "laf arasında" toparlamak (ad soyad, şehir, anne adı, doğum tarihi/yaş, konu)
 * - Bilgiler tamamlanınca profili "waiting" durumuna almak ve randevu mesajı göndermek
 * - Aynı soruyu üst üste sormayı engellemek (last_question_key)
 */

class ConversationFlow {
  constructor(db, aiChat = null) {
    this.db = db;
    this.aiChat = aiChat;

    this.requiredFields = [
      { key: "full_name", label: "Ad Soyad", priority: 1 },
      { key: "phone", label: "Telefon", priority: 2 },
      { key: "city", label: "Şehir", priority: 3 },
      { key: "mother_name", label: "Anne Adı", priority: 4 },
      { key: "birth_date", label: "Doğum Tarihi", priority: 5 },
      { key: "subject", label: "Konu", priority: 6 }
    ];

    // Basit şehir listesi (isteğe göre genişletilebilir)
    this.cities = [
      "istanbul", "ankara", "izmir", "bursa", "antalya", "konya", "adana",
      "gaziantep", "mersin", "diyarbakır", "kayseri", "eskişehir", "samsun",
      "denizli", "şanlıurfa", "sanliurfa", "malatya", "trabzon", "erzurum", "van",
      "batman", "elazığ", "elazig", "sivas", "manisa", "balıkesir", "balikesir", "kahramanmaraş", "kahramanmaras"
    ];

    this.monthMap = {
      "ocak": "01",
      "şubat": "02",
      "subat": "02",
      "mart": "03",
      "nisan": "04",
      "mayıs": "05",
      "mayis": "05",
      "haziran": "06",
      "temmuz": "07",
      "ağustos": "08",
      "agustos": "08",
      "eylül": "09",
      "eylul": "09",
      "ekim": "10",
      "kasım": "11",
      "kasim": "11",
      "aralık": "12",
      "aralik": "12"
    };
  }

  // Türkçe karakter/İstanbul problemi: "İ" -> "i", birleşik nokta vb.
  normalizeTR(str) {
    const s = String(str || "");
    return s
      .replace(/İ/g, "i")
      .replace(/I/g, "ı")
      .normalize("NFKD")
      .replace(/\u0307/g, "") // i üzerindeki birleşik nokta
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  isGreeting(message) {
    const lower = this.normalizeTR(message).trim();
    const greetings = [
      "selam", "selamun", "selamun aleykum", "aleykum selam", "merhaba", "meraba",
      "gunaydin", "iyi gunler", "iyi aksamlar", "hayirli",
      "sa", "as", "slm", "mrb"
    ];
    return greetings.some(g => lower === g || lower.includes(g));
  }

  extractInfo(message, profile) {
    const extracted = {};
    const raw = String(message || "");
    const lower = this.normalizeTR(raw);

    // Telefon
    const phoneMatch = raw.replace(/\s+/g, "").match(/(\+?90)?0?5\d{9}/);
    if (phoneMatch) {
      let p = phoneMatch[0].replace(/\D/g, "");
      if (p.startsWith("90") && p.length === 12) p = "+" + p;
      else if (p.startsWith("0") && p.length === 11) p = "+9" + p;
      else if (p.length === 10 && p.startsWith("5")) p = "+90" + p;
      extracted.phone = p;
    }

    // İsim
    const namePatterns = [
      /(?:adım|ismim|ben)\s+([A-ZÇĞİÖŞÜa-zçğıöşü]+(?:\s+[A-ZÇĞİÖŞÜa-zçğıöşü]+){0,3})/i,
      /^([A-ZÇĞİÖŞÜ][a-zçğıöşü]+(?:\s+[A-ZÇĞİÖŞÜ][a-zçğıöşü]+){1,3})$/
    ];
    for (const pattern of namePatterns) {
      const m = raw.match(pattern);
      if (m && m[1] && m[1].trim().length >= 3) {
        extracted.full_name = m[1].trim();
        break;
      }
    }

    // Şehir
    for (const city of this.cities) {
      if (lower.includes(this.normalizeTR(city))) {
        extracted.city = city.charAt(0).toUpperCase() + city.slice(1);
        break;
      }
    }

    // Anne adı
    const motherPatterns = [
      /anne(?:\s+adı)?(?:m|miz)?\s*[:=]?\s*([A-ZÇĞİÖŞÜa-zçğıöşü]{2,30})/i,
      /annem(?:in adı)?\s+([A-ZÇĞİÖŞÜa-zçğıöşü]{2,30})/i
    ];
    for (const pattern of motherPatterns) {
      const m = raw.match(pattern);
      if (m && m[1]) {
        extracted.mother_name = m[1].trim();
        break;
      }
    }

    // Doğum tarihi
    const datePatterns = [
      /(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})/,
      /(\d{4})\s*dogumluyum/i,
      /(\d{2,4})\s*yilinda\s*dogdum/i
    ];
    for (const pattern of datePatterns) {
      const m = lower.match(pattern);
      if (m) {
        if (m[3]) {
          const dd = String(m[1]).padStart(2, "0");
          const mm = String(m[2]).padStart(2, "0");
          const yy = String(m[3]).length === 2 ? `19${m[3]}` : String(m[3]);
          extracted.birth_date = `${dd}/${mm}/${yy}`;
        } else {
          extracted.birth_date = String(m[1]);
        }
        break;
      }
    }

    // "1 Ocak 1990" gibi
    if (!extracted.birth_date) {
      const m = lower.match(/\b(\d{1,2})\s+(ocak|subat|şubat|mart|nisan|mayis|mayıs|haziran|temmuz|agustos|ağustos|eylul|eylül|ekim|kasim|kasım|aralik|aralık)\s+(\d{4})\b/i);
      if (m) {
        const dd = String(m[1]).padStart(2, "0");
        const mm = this.monthMap[this.normalizeTR(m[2])] || "01";
        extracted.birth_date = `${dd}/${mm}/${m[3]}`;
      }
    }

    // Yaş
    const ageOnly = lower.match(/^\s*(\d{1,2})\s*$/);
    const ageLoose = lower.match(/(\d{1,2})\s*yas/i);
    const age = ageOnly ? parseInt(ageOnly[1], 10) : (ageLoose ? parseInt(ageLoose[1], 10) : null);
    if (age && !extracted.birth_date && age >= 7 && age <= 99) {
      const birthYear = new Date().getFullYear() - age;
      extracted.birth_date = String(birthYear);
    }

    // Konu (çok kısa değilse)
    if (raw.trim().length >= 18) {
      const maybeSubject = raw.trim();
      // Selam vb. değilse ve sadece şehir/ad değilse
      if (!this.isGreeting(maybeSubject)) {
        extracted.subject = maybeSubject;
      }
    }

    // Beklenen alan için bağlamsal yakalama (kısa cevaplar)
    // Örn: Bot "Anne adınız?" dedi -> kullanıcı "Ayten"
    if (profile) {
      const nextKey = this.getMissingFields(profile)[0]?.key;
      const plain = raw.trim();
      const isWord = /^[A-ZÇĞİÖŞÜa-zçğıöşü]{2,30}(?:\s+[A-ZÇĞİÖŞÜa-zçğıöşü]{2,30})?$/.test(plain);
      const isTwoWords = /^[A-ZÇĞİÖŞÜa-zçğıöşü]{2,30}\s+[A-ZÇĞİÖŞÜa-zçğıöşü]{2,30}(?:\s+[A-ZÇĞİÖŞÜa-zçğıöşü]{2,30})?$/.test(plain);

      if (nextKey === "mother_name" && !extracted.mother_name && isWord) extracted.mother_name = plain;
      if (nextKey === "city" && !extracted.city && isWord) extracted.city = plain;
      if (nextKey === "full_name" && !extracted.full_name && isTwoWords) extracted.full_name = plain;
      if (nextKey === "subject" && !extracted.subject && plain.length >= 12) extracted.subject = plain;
    }

    return extracted;
  }

  getMissingFields(profile) {
    return this.requiredFields
      .slice()
      .sort((a, b) => a.priority - b.priority)
      .filter(f => !profile?.[f.key] || String(profile[f.key]).trim() === "");
  }

  _pickWarmName(name, profile) {
    const full = (profile?.full_name || name || "").trim();
    if (!full) return "kardeşim";
    // sadece ilk isim
    return full.split(/\s+/)[0];
  }

  _questionFor(fieldKey, warmName) {
    // "laf arasında" daha insani akış
    switch (fieldKey) {
      case "full_name":
        return `Merhaba ${warmName} kardeşim, hoş geldin. İsmini bir de tam olarak alayım mı?`;
      case "phone":
        return `Tamam ${warmName} kardeşim. Sana dönüş yapabilmemiz için bir telefon numarası bırakır mısın?`;
      case "city":
        return `Anladım ${warmName} kardeşim. Hangi şehirde yaşıyorsun?`;
      case "mother_name":
        return `Peki ${warmName} kardeşim, hocamızın not alması için anne adını da alayım mı?`;
      case "birth_date":
        return `Bir de ${warmName} kardeşim; doğum tarihin ya da yaşın nedir? (Yaklaşık da olur)`;
      case "subject":
      default:
        return `Anladım ${warmName} kardeşim. Kısaca derdini anlatır mısın, hangi konuda destek istiyorsun?`;
    }
  }

  async _avoidRepeatQuestion(chatId, profile, nextKey) {
    // son sorulan alan aynıysa tekrar sormayalım
    // (kullanıcı başka bir şey yazsa bile bot aynı soruya kilitlenmesin)
    try {
      const lastKey = profile?.last_question_key;
      const lastAt = profile?.last_question_at ? new Date(profile.last_question_at).getTime() : 0;
      const now = Date.now();

      if (lastKey && String(lastKey) === String(nextKey) && (now - lastAt) < 60_000) {
        // 1 dk içinde aynı alanı tekrar sorma; bir "geçiş" cümlesi dön
        return true;
      }

      await this.db.updateProfile(chatId, {
        last_question_key: nextKey,
        last_question_at: new Date().toISOString().slice(0, 19).replace("T", " ")
      });
      if (profile) {
        profile.last_question_key = nextKey;
        profile.last_question_at = new Date();
      }
      return false;
    } catch {
      return false;
    }
  }

  async processMessage(chatId, clientId, message, context = {}) {
    const { name, profile } = context;
    const warmName = this._pickWarmName(name, profile);

    // chatId içinden telefon
    if (profile && !profile.phone && typeof chatId === "string") {
      const raw = chatId.split("@")[0];
      if (/^\d{10,15}$/.test(raw)) {
        const normalized = raw.startsWith("+") ? raw : `+${raw}`;
        await this.db.updateProfile(chatId, { phone: normalized });
        profile.phone = normalized;
      }
    }

    // Selamlama
    const isGreeting = this.isGreeting(message);
    if (isGreeting && (!profile?.full_name || profile?.status === "new")) {
      const greetingTpl = (await this.db.getSetting("greeting")) || "Merhaba {name} kardeşim, hoş geldin. Bugün nasılsın inşallah?";
      return {
        reply: greetingTpl.replace("{name}", warmName),
        action: "greeting"
      };
    }

    // Bilgi çıkar
    const extracted = this.extractInfo(message, profile);

    // subject'i agresif yazmayalım: kullanıcı sadece "İstanbul" yazınca subject set olmasın
    if (extracted.subject && extracted.subject.length < 18) delete extracted.subject;

    if (profile && Object.keys(extracted).length > 0) {
      await this.db.updateProfile(chatId, extracted);
      Object.assign(profile, extracted);
    }

    // Missing?
    const missing = this.getMissingFields(profile || {});

    // Tamamlandıysa: randevu aşaması
    if (missing.length === 0 && profile) {
      // profil oluşturuldu etiketi gibi davran: waiting + appointment
      if (!profile.status || profile.status === "new" || profile.status === "collecting" || profile.status === "waiting") {
        try {
          await this.db.createAppointment(profile.id, clientId, profile.subject || "");
        } catch {}
        await this.db.updateProfileStatus(chatId, "waiting");
        profile.status = "waiting";

        const tpl = (await this.db.getSetting("profile_complete_message"))
          || "{name} kardeşim o zaman ben hocamızın müsaitlik durumuna göre bir plan oluşturup tarafınıza randevu günü ve saati ile ilgili bilgi vermek için arayacağım.";

        return {
          reply: tpl.replace("{name}", warmName),
          action: "profile_complete",
          profile
        };
      }
    }

    // Bilgi toplama
    if (missing.length > 0) {
      const nextKey = missing[0].key;

      // Aynı soruyu tekrarlama koruması
      const skipped = await this._avoidRepeatQuestion(chatId, profile, nextKey);
      if (skipped) {
        // Bu durumda bot, kullanıcıyı kilitlemesin; akışı yumuşatıp tekrar soruyu hafifçe soralım.
        // (Ama soru metni aynı olmadan, farklı bir cümle)
        const alt = {
          city: `İstanbul'da mıydınız ${warmName} kardeşim, yoksa başka bir şehir mi?`,
          mother_name: `Anne adını bir de not alayım ${warmName} kardeşim; tek kelime yeterli.`,
          birth_date: `Yaşın kaçtı ${warmName} kardeşim, ya da doğum yılını yazsan da olur.`,
          full_name: `İsmini tam yazabilir misin ${warmName} kardeşim?`,
          phone: `Telefon numaranı yazarsan dönüş sağlayabiliriz ${warmName} kardeşim.`,
          subject: `Derdini biraz daha açar mısın ${warmName} kardeşim; hangi konuda destek istiyorsun?`
        };
        return { reply: alt[nextKey] || this._questionFor(nextKey, warmName), action: "collecting", nextField: nextKey };
      }

      return {
        reply: this._questionFor(nextKey, warmName),
        action: "collecting",
        nextField: nextKey
      };
    }

    // AI Chat (genel bilgi, fetva değil)
    if (this.aiChat && profile) {
      return await this.aiChat.answerIslamicQuestion(message, { chatId, profile });
    }

    return {
      reply: `Anladım ${warmName} kardeşim. Hocamızla görüşmek en sağlıklısı; istersen kısaca durumunu anlat, ben not alayım.`,
      action: "simple_response"
    };
  }
}

module.exports = { ConversationFlow };
