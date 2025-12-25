"use strict";

/**
 * ConversationFlow - İnsansı Karşılama Asistanı
 *
 * Amaç:
 * - Kullanıcıyı sıcak ve doğal bir dille karşılamak
 * - Bilgileri zorlamadan, sohbet akışı içinde toplamak
 * - Empati göstermek ve kullanıcıyı rahat hissettirmek
 * - Profesyonel ama samimi bir üslup korumak
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

    // Genişletilmiş şehir listesi
    this.cities = [
      "istanbul", "ankara", "izmir", "bursa", "antalya", "konya", "adana",
      "gaziantep", "mersin", "diyarbakır", "kayseri", "eskişehir", "samsun",
      "denizli", "şanlıurfa", "sanliurfa", "malatya", "trabzon", "erzurum", "van",
      "batman", "elazığ", "elazig", "sivas", "manisa", "balıkesir", "balikesir", 
      "kahramanmaraş", "kahramanmaras", "hatay", "sakarya", "kocaeli", "muğla",
      "aydın", "tekirdağ", "ordu", "mardin", "afyon", "afyonkarahisar", "çorum",
      "tokat", "aksaray", "giresun", "yozgat", "edirne", "düzce", "rize", "artvin",
      "isparta", "bolu", "çanakkale", "kastamonu", "zonguldak", "karabük", "kırıkkale",
      "osmaniye", "kilis", "niğde", "nevşehir", "bingöl", "muş", "bitlis", "siirt",
      "şırnak", "hakkari", "ağrı", "iğdır", "kars", "ardahan", "erzincan", "tunceli"
    ];

    this.monthMap = {
      "ocak": "01", "şubat": "02", "subat": "02", "mart": "03", "nisan": "04",
      "mayıs": "05", "mayis": "05", "haziran": "06", "temmuz": "07",
      "ağustos": "08", "agustos": "08", "eylül": "09", "eylul": "09",
      "ekim": "10", "kasım": "11", "kasim": "11", "aralık": "12", "aralik": "12"
    };

    // Selamlama varyasyonları
    this.greetingPatterns = [
      "selam", "selamun", "selamun aleykum", "aleykum selam", "as", "sa",
      "merhaba", "meraba", "mrb", "slm", "gunaydin", "günaydın",
      "iyi gunler", "iyi günler", "iyi aksamlar", "iyi akşamlar",
      "hayirli", "hayırlı", "hey", "hi", "hello"
    ];
  }

  // Türkçe karakter normalizasyonu
  normalizeTR(str) {
    const s = String(str || "");
    return s
      .replace(/İ/g, "i")
      .replace(/I/g, "ı")
      .normalize("NFKD")
      .replace(/\u0307/g, "")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  // Selamlama kontrolü
  isGreeting(message) {
    const lower = this.normalizeTR(message);
    return this.greetingPatterns.some(g => lower === g || lower.startsWith(g + " ") || lower.includes(g));
  }

  // Saat bazlı selamlama
  getTimeBasedGreeting() {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return "Günaydın";
    if (hour >= 12 && hour < 18) return "İyi günler";
    if (hour >= 18 && hour < 22) return "İyi akşamlar";
    return "İyi geceler";
  }

  // Bilgi çıkarma - geliştirilmiş
  extractInfo(message, profile) {
    const extracted = {};
    const raw = String(message || "");
    const lower = this.normalizeTR(raw);

    // Telefon - çeşitli formatlar
    const phonePatterns = [
      /(\+?90)?[\s\-]?0?[\s\-]?5\d{2}[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/,
      /(\+?90)?0?5\d{9}/,
      /05\d{2}\s?\d{3}\s?\d{2}\s?\d{2}/
    ];
    
    for (const pattern of phonePatterns) {
      const phoneMatch = raw.replace(/\s+/g, "").match(pattern);
      if (phoneMatch) {
        let p = phoneMatch[0].replace(/[\s\-]/g, "").replace(/\D/g, "");
        if (p.startsWith("90") && p.length === 12) p = "+" + p;
        else if (p.startsWith("0") && p.length === 11) p = "+9" + p;
        else if (p.length === 10 && p.startsWith("5")) p = "+90" + p;
        extracted.phone = p;
        break;
      }
    }

    // İsim - çeşitli kalıplar
    const namePatterns = [
      /(?:adım|ismim|ben|benim adım|adım benim)\s+([A-ZÇĞİÖŞÜa-zçğıöşü]+(?:\s+[A-ZÇĞİÖŞÜa-zçğıöşü]+){0,3})/i,
      /^([A-ZÇĞİÖŞÜ][a-zçğıöşü]+(?:\s+[A-ZÇĞİÖŞÜ][a-zçğıöşü]+){1,3})$/,
      /([A-ZÇĞİÖŞÜ][a-zçğıöşü]+\s+[A-ZÇĞİÖŞÜ][a-zçğıöşü]+)/
    ];
    
    for (const pattern of namePatterns) {
      const m = raw.match(pattern);
      if (m && m[1] && m[1].trim().length >= 3) {
        const name = m[1].trim();
        // Şehir adı değilse isim olarak al
        if (!this.cities.includes(this.normalizeTR(name))) {
          extracted.full_name = name;
          break;
        }
      }
    }

    // Şehir
    for (const city of this.cities) {
      const normalizedCity = this.normalizeTR(city);
      if (lower.includes(normalizedCity) || lower === normalizedCity) {
        // Şehir adını düzgün formatta kaydet
        extracted.city = city.charAt(0).toUpperCase() + city.slice(1).toLowerCase();
        break;
      }
    }

    // Anne adı
    const motherPatterns = [
      /anne(?:\s+adı)?(?:m|mız)?\s*[:=]?\s*([A-ZÇĞİÖŞÜa-zçğıöşü]{2,30})/i,
      /annem(?:in adı)?\s+([A-ZÇĞİÖŞÜa-zçğıöşü]{2,30})/i,
      /annemin\s+adı\s+([A-ZÇĞİÖŞÜa-zçğıöşü]{2,30})/i
    ];
    
    for (const pattern of motherPatterns) {
      const m = raw.match(pattern);
      if (m && m[1]) {
        extracted.mother_name = m[1].trim();
        break;
      }
    }

    // Doğum tarihi - çeşitli formatlar
    const datePatterns = [
      /(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})/,
      /(\d{4})\s*doğumluyum/i,
      /(\d{4})\s*dogumluyum/i,
      /(\d{2,4})\s*yılında\s*doğdum/i,
      /(\d{2,4})\s*yilinda\s*dogdum/i,
      /doğum\s*(?:tarihim|yılım)?\s*[:=]?\s*(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})/i
    ];
    
    for (const pattern of datePatterns) {
      const m = lower.match(pattern);
      if (m) {
        if (m[3]) {
          const dd = String(m[1]).padStart(2, "0");
          const mm = String(m[2]).padStart(2, "0");
          const yy = String(m[3]).length === 2 ? `19${m[3]}` : String(m[3]);
          extracted.birth_date = `${dd}/${mm}/${yy}`;
        } else if (m[1]) {
          extracted.birth_date = String(m[1]);
        }
        break;
      }
    }

    // "1 Ocak 1990" formatı
    if (!extracted.birth_date) {
      const monthPattern = /\b(\d{1,2})\s+(ocak|subat|şubat|mart|nisan|mayis|mayıs|haziran|temmuz|agustos|ağustos|eylul|eylül|ekim|kasim|kasım|aralik|aralık)\s+(\d{4})\b/i;
      const m = lower.match(monthPattern);
      if (m) {
        const dd = String(m[1]).padStart(2, "0");
        const mm = this.monthMap[this.normalizeTR(m[2])] || "01";
        extracted.birth_date = `${dd}/${mm}/${m[3]}`;
      }
    }

    // Sadece yaş
    const agePatterns = [
      /^\s*(\d{1,2})\s*$/,
      /(\d{1,2})\s*yaşındayım/i,
      /(\d{1,2})\s*yasindayim/i,
      /yaşım\s*[:=]?\s*(\d{1,2})/i,
      /yasim\s*[:=]?\s*(\d{1,2})/i
    ];
    
    for (const pattern of agePatterns) {
      const m = lower.match(pattern);
      if (m && !extracted.birth_date) {
        const age = parseInt(m[1], 10);
        if (age >= 7 && age <= 99) {
          const birthYear = new Date().getFullYear() - age;
          extracted.birth_date = String(birthYear);
          break;
        }
      }
    }

    // Konu - yeterince uzun mesajlar
    if (raw.trim().length >= 20 && !this.isGreeting(raw)) {
      // Sadece bilgi içermeyen mesajları konu olarak al
      const hasOnlyInfo = extracted.phone || extracted.city || extracted.mother_name || extracted.birth_date;
      if (!hasOnlyInfo) {
        extracted.subject = raw.trim();
      }
    }

    // Bağlamsal yakalama - beklenen alan için kısa cevaplar
    if (profile) {
      const nextKey = this.getMissingFields(profile)[0]?.key;
      const plain = raw.trim();
      const isWord = /^[A-ZÇĞİÖŞÜa-zçğıöşü]{2,30}(?:\s+[A-ZÇĞİÖŞÜa-zçğıöşü]{2,30})?$/.test(plain);
      const isTwoWords = /^[A-ZÇĞİÖŞÜa-zçğıöşü]{2,30}\s+[A-ZÇĞİÖŞÜa-zçğıöşü]{2,30}(?:\s+[A-ZÇĞİÖŞÜa-zçğıöşü]{2,30})?$/.test(plain);

      if (nextKey === "mother_name" && !extracted.mother_name && isWord) {
        extracted.mother_name = plain;
      }
      if (nextKey === "city" && !extracted.city && isWord) {
        extracted.city = plain;
      }
      if (nextKey === "full_name" && !extracted.full_name && isTwoWords) {
        extracted.full_name = plain;
      }
      if (nextKey === "subject" && !extracted.subject && plain.length >= 15) {
        extracted.subject = plain;
      }
    }

    return extracted;
  }

  // Eksik alanları al
  getMissingFields(profile) {
    return this.requiredFields
      .slice()
      .sort((a, b) => a.priority - b.priority)
      .filter(f => !profile?.[f.key] || String(profile[f.key]).trim() === "");
  }

  // Sıcak isim seç
  _pickWarmName(name, profile) {
    const full = (profile?.full_name || name || "").trim();
    if (!full || full === "kardeşim") return "kardeşim";
    return full.split(/\s+/)[0];
  }

  // İnsansı soru oluştur - çeşitli varyasyonlar
  _questionFor(fieldKey, warmName) {
    const questions = {
      full_name: [
        `${warmName} kardeşim, hoş geldin! Seninle tanışalım, adın ne?`,
        `Merhaba ${warmName} kardeşim! İsmini öğrenebilir miyim?`,
        `Hoş geldin ${warmName} kardeşim! Adını bir de tam olarak alayım mı?`
      ],
      phone: [
        `Tamam ${warmName} kardeşim. Sana ulaşabilmemiz için telefon numaranı alabilir miyim?`,
        `${warmName} kardeşim, hocamız sana dönüş yapabilsin diye bir numara bırakır mısın?`,
        `Peki ${warmName} kardeşim, iletişim için telefon numaranı yazabilir misin?`
      ],
      city: [
        `Anladım ${warmName} kardeşim. Hangi şehirdesin?`,
        `${warmName} kardeşim, nerelisin, hangi şehirde yaşıyorsun?`,
        `Peki ${warmName} kardeşim, şehrini de öğrenebilir miyim?`
      ],
      mother_name: [
        `${warmName} kardeşim, hocamızın not alması için anne adını da alayım mı?`,
        `Bir de ${warmName} kardeşim, annenin adı ne?`,
        `${warmName} kardeşim, kayıt için anne adını yazabilir misin?`
      ],
      birth_date: [
        `${warmName} kardeşim, doğum tarihin ya da yaşın kaç?`,
        `Bir de ${warmName} kardeşim, kaç yaşındasın?`,
        `${warmName} kardeşim, doğum yılını veya yaşını söyler misin?`
      ],
      subject: [
        `${warmName} kardeşim, kısaca derdini anlatır mısın? Hangi konuda destek istiyorsun?`,
        `Peki ${warmName} kardeşim, ne konuda yardımcı olabiliriz?`,
        `${warmName} kardeşim, seni dinliyorum. Neler oluyor, anlat bakalım.`
      ]
    };

    const list = questions[fieldKey] || questions.subject;
    return list[Math.floor(Math.random() * list.length)];
  }

  // Tekrar soru sormayı engelle
  async _avoidRepeatQuestion(chatId, clientId, profile, nextKey) {
    try {
      const lastKey = profile?.last_question_key;
      const lastAt = profile?.last_question_at ? new Date(profile.last_question_at).getTime() : 0;
      const now = Date.now();

      if (lastKey && String(lastKey) === String(nextKey) && (now - lastAt) < 90_000) {
        return true;
      }

      await this.db.updateProfile(chatId, clientId, {
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

  // Alternatif sorular - tekrar durumunda
  _alternativeQuestion(fieldKey, warmName) {
    const alternatives = {
      city: [
        `${warmName} kardeşim, İstanbul'da mısın yoksa başka bir şehirde mi?`,
        `Şehrini bir de yazabilir misin ${warmName} kardeşim?`
      ],
      mother_name: [
        `Anne adını bir de not alayım ${warmName} kardeşim, tek kelime yeterli.`,
        `${warmName} kardeşim, annenin adını yazabilir misin?`
      ],
      birth_date: [
        `Yaşın kaçtı ${warmName} kardeşim? Yaklaşık da olur.`,
        `${warmName} kardeşim, doğum yılını yazsan yeter.`
      ],
      full_name: [
        `İsmini tam yazabilir misin ${warmName} kardeşim?`,
        `Ad soyadını bir de alayım ${warmName} kardeşim.`
      ],
      phone: [
        `Telefon numaranı yazarsan dönüş sağlarız ${warmName} kardeşim.`,
        `${warmName} kardeşim, bir numara bırakır mısın?`
      ],
      subject: [
        `Derdini biraz daha açar mısın ${warmName} kardeşim?`,
        `${warmName} kardeşim, ne konuda yardım istiyorsun, kısaca anlat.`
      ]
    };

    const list = alternatives[fieldKey] || [this._questionFor(fieldKey, warmName)];
    return list[Math.floor(Math.random() * list.length)];
  }

  // Ana mesaj işleyici
  async processMessage(chatId, clientId, message, context = {}) {
    const { name, profile } = context;
    const warmName = this._pickWarmName(name, profile);

    // chatId'den telefon çıkar
    if (profile && !profile.phone && typeof chatId === "string") {
      const raw = chatId.split("@")[0];
      if (/^\d{10,15}$/.test(raw)) {
        const normalized = raw.startsWith("+") ? raw : `+${raw}`;
        await this.db.updateProfile(chatId, clientId, { phone: normalized });
        profile.phone = normalized;
      }
    }

    // Selamlama kontrolü
    const isGreeting = this.isGreeting(message);
    if (isGreeting && (!profile?.full_name || profile?.status === "new")) {
      // Saat bazlı, çeşitli selamlama
      const timeGreeting = this.getTimeBasedGreeting();
      const greetings = [
        `${timeGreeting} ${warmName} kardeşim, hoş geldin! Nasılsın bugün?`,
        `Hoş geldin ${warmName} kardeşim! ${timeGreeting}, nasıl yardımcı olabilirim?`,
        `${timeGreeting} ${warmName} kardeşim! Seni görmek güzel, nasılsın?`,
        `Merhaba ${warmName} kardeşim, hoş geldin! Bugün sana nasıl yardımcı olabilirim?`
      ];
      
      // Özel selamlama varsa kullan
      const customGreeting = await this.db.getSetting("greeting");
      const reply = customGreeting 
        ? customGreeting.replace("{name}", warmName)
        : greetings[Math.floor(Math.random() * greetings.length)];

      return {
        reply,
        action: "greeting"
      };
    }

    // Bilgi çıkar
    const extracted = this.extractInfo(message, profile);

    // Çok kısa subject'leri atla
    if (extracted.subject && extracted.subject.length < 20) {
      delete extracted.subject;
    }

    // Profili güncelle
    if (profile && Object.keys(extracted).length > 0) {
      await this.db.updateProfile(chatId, clientId, extracted);
      Object.assign(profile, extracted);
    }

    // Eksik alanları kontrol et
    const missing = this.getMissingFields(profile || {});

    // Tüm bilgiler tamam - randevu aşaması
    if (missing.length === 0 && profile) {
      if (!profile.status || profile.status === "new" || profile.status === "collecting" || profile.status === "waiting") {
        try {
          await this.db.createAppointment(profile.id, clientId, profile.subject || "");
        } catch {}
        
        await this.db.updateProfileStatus(chatId, clientId, "waiting");
        profile.status = "waiting";

        // Tamamlanma mesajları
        const completionMessages = [
          `${warmName} kardeşim, bilgilerini aldım. Hocamızın müsaitlik durumuna göre sana randevu günü ve saati için döneceğiz inşallah.`,
          `Tamam ${warmName} kardeşim, her şeyi not ettim. En kısa sürede hocamız seninle iletişime geçecek.`,
          `${warmName} kardeşim, kaydını oluşturdum. Hocamız müsait olunca seni arayacağız inşallah.`
        ];

        const customComplete = await this.db.getSetting("profile_complete_message");
        const reply = customComplete 
          ? customComplete.replace("{name}", warmName)
          : completionMessages[Math.floor(Math.random() * completionMessages.length)];

        return {
          reply,
          action: "profile_complete",
          profile
        };
      }
    }

    // Bilgi toplama aşaması
    if (missing.length > 0) {
      const nextKey = missing[0].key;

      // Tekrar soru kontrolü
      const skipped = await this._avoidRepeatQuestion(chatId, clientId, profile, nextKey);
      if (skipped) {
        return { 
          reply: this._alternativeQuestion(nextKey, warmName), 
          action: "collecting", 
          nextField: nextKey 
        };
      }

      return {
        reply: this._questionFor(nextKey, warmName),
        action: "collecting",
        nextField: nextKey
      };
    }

    // AI Chat ile genel sohbet
    if (this.aiChat && profile) {
      // Duygu analizi
      const emotion = this.aiChat.detectEmotion ? this.aiChat.detectEmotion(message) : "neutral";
      const empatheticPrefix = this.aiChat.getEmpatheticPrefix ? this.aiChat.getEmpatheticPrefix(emotion, warmName) : "";
      
      const aiResult = await this.aiChat.answerIslamicQuestion(message, { chatId, profile });
      
      // Empati ön eki ekle (eğer varsa ve cevap zaten empati içermiyorsa)
      if (empatheticPrefix && aiResult.reply && !aiResult.reply.toLowerCase().includes("anlıyorum")) {
        aiResult.reply = empatheticPrefix + aiResult.reply;
      }
      
      return aiResult;
    }

    // Fallback cevap
    const fallbacks = [
      `Anladım ${warmName} kardeşim. Hocamızla görüşmek en sağlıklısı olur, istersen durumunu kısaca anlat, ben not alayım.`,
      `${warmName} kardeşim, seni dinliyorum. Ne konuda yardımcı olabilirim?`,
      `Tamam ${warmName} kardeşim, anlattıklarını not ediyorum. Başka eklemek istediğin bir şey var mı?`
    ];

    return {
      reply: fallbacks[Math.floor(Math.random() * fallbacks.length)],
      action: "simple_response"
    };
  }
}

module.exports = { ConversationFlow };
