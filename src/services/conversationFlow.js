"use strict";

/**
 * ConversationFlow v6.0 - İnsansı Hoca Asistanı
 *
 * DAVRANIŞLAR:
 * 1. Bilgi toplanana kadar HOCA gibi davran
 * 2. Bilgi tamamlanınca yardımcı olduğunu açıkla
 * 3. Kısa cevaplar (1-3 cümle max)
 * 4. Doğal sohbet, laf arasında bilgi topla
 * 5. Bazen küçük yazım hataları yap (insallah, bi vs)
 * 6. İsim bilinmiyorsa "değerli kardeşim" de
 * 7. Dua alıntıları ekle
 */

class ConversationFlow {
  constructor(db, aiChat = null) {
    this.db = db;
    this.aiChat = aiChat;

    this.requiredFields = [
      { key: "full_name", label: "isim", priority: 1 },
      { key: "city", label: "şehir", priority: 2 },
      { key: "phone", label: "telefon", priority: 3 },
      { key: "birth_date", label: "yaş", priority: 4 },
      { key: "mother_name", label: "anne adı", priority: 5 },
      { key: "subject", label: "konu", priority: 6 }
    ];

    this.cities = [
      "istanbul", "ankara", "izmir", "bursa", "antalya", "konya", "adana", "gaziantep", "mersin", "diyarbakır",
      "kayseri", "eskişehir", "samsun", "denizli", "şanlıurfa", "malatya", "trabzon", "erzurum", "van", "batman"
    ];

    // Dua alıntıları
    this.prayers = [
      "Allah kolaylık versin",
      "Rabbim yardımcın olsun",
      "Allah hayırlısını nasip etsin",
      "insallah hayırlara vesile olur",
      "Rabbim sıkıntını gidersin",
      "Allah gönlüne göre versin"
    ];

    // Hitap şekilleri (isim bilinmiyorsa)
    this.warmAddresses = ["değerli kardeşim", "güzel kardeşim", "kıymetli kardeşim"];
  }

  // Rastgele dua al
  getRandomPrayer() {
    return this.prayers[Math.floor(Math.random() * this.prayers.length)];
  }

  // Rastgele hitap al
  getWarmAddress() {
    return this.warmAddresses[Math.floor(Math.random() * this.warmAddresses.length)];
  }

  // İnsansı yazım hataları ekle
  addHumanTouch(text) {
    if (!text) return text;

    // %30 ihtimalle inşallah -> insallah
    if (Math.random() < 0.3) {
      text = text.replace(/inşallah/gi, "insallah");
    }
    // %30 ihtimalle bir -> bi
    if (Math.random() < 0.3) {
      text = text.replace(/\bbir\b/g, "bi");
    }
    // %20 ihtimalle şey -> bişey
    if (Math.random() < 0.2) {
      text = text.replace(/\bşey\b/g, "bişey");
    }
    return text;
  }

  // Türkçe normalize
  normalizeTR(str) {
    return String(str || "").replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase().trim();
  }

  // Kelime başlarını büyük yap
  capitalize(str) {
    return String(str || "").split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
  }

  // Selamlama mı?
  isGreeting(msg) {
    const lower = this.normalizeTR(msg);
    const greetings = ["selam", "merhaba", "mrb", "slm", "sa", "as", "selamun"];
    return greetings.some(g => lower.startsWith(g)) || (msg.length < 20 && greetings.some(g => lower.includes(g)));
  }

  // Soru mu soruyor?
  isQuestion(msg) {
    const lower = this.normalizeTR(msg);
    return lower.includes("?") || lower.includes("nasıl") || lower.includes("ne zaman") ||
           lower.includes("neden") || lower.includes("nerede") || lower.includes("kim") ||
           lower.includes("mi") || lower.includes("mı") || lower.includes("mu") || lower.includes("mü");
  }

  // Teşekkür mü?
  isThanks(msg) {
    const lower = this.normalizeTR(msg);
    return lower.includes("teşekkür") || lower.includes("sağol") || lower.includes("eyvallah");
  }

  // Eksik alanları bul
  getMissing(profile) {
    return this.requiredFields.filter(f => !profile?.[f.key] || String(profile[f.key]).trim() === "");
  }

  // Kısa cevap algılama (isim, şehir vs.)
  detectShortAnswer(msg, profile) {
    const raw = msg.trim();
    const lower = this.normalizeTR(raw);
    const words = raw.split(/\s+/);
    const lastQ = profile?.last_question_key;

    if (!lastQ || words.length > 4 || raw.length > 50) return null;

    // Son soru 10 dk'dan eski mi?
    const lastAt = profile?.last_question_at ? new Date(profile.last_question_at).getTime() : 0;
    if (Date.now() - lastAt > 600000) return null;

    switch (lastQ) {
      case "full_name":
        if (words.length <= 3 && /^[a-zA-ZçğıöşüÇĞİÖŞÜ]/.test(raw)) {
          return { full_name: this.capitalize(raw) };
        }
        break;
      case "mother_name":
        if (words.length <= 2 && /^[a-zA-ZçğıöşüÇĞİÖŞÜ]/.test(raw)) {
          return { mother_name: this.capitalize(raw) };
        }
        break;
      case "city":
        for (const city of this.cities) {
          if (lower.includes(this.normalizeTR(city))) {
            return { city: this.capitalize(city) };
          }
        }
        if (words.length === 1) return { city: this.capitalize(raw) };
        break;
      case "birth_date":
        const age = raw.match(/^(\d{1,2})$/);
        if (age && parseInt(age[1]) >= 10 && parseInt(age[1]) <= 100) {
          return { birth_date: String(new Date().getFullYear() - parseInt(age[1])) };
        }
        break;
      case "phone":
        const phone = raw.replace(/\s+/g, "").match(/(\+?90)?0?5\d{9}/);
        if (phone) return { phone: phone[0] };
        break;
    }
    return null;
  }

  // Mesajdan bilgi çıkar
  extractInfo(msg) {
    const extracted = {};
    const lower = this.normalizeTR(msg);

    // Telefon
    const phone = msg.replace(/\s+/g, "").match(/(\+?90)?0?5\d{9}/);
    if (phone) extracted.phone = phone[0];

    // Şehir
    for (const city of this.cities) {
      if (lower.includes(this.normalizeTR(city))) {
        extracted.city = this.capitalize(city);
        break;
      }
    }

    // Yaş
    const age = lower.match(/(\d{1,2})\s*yaş/);
    if (age) extracted.birth_date = String(new Date().getFullYear() - parseInt(age[1]));

    return extracted;
  }

  // === ANA FONKSİYON ===
  async processMessage(chatId, clientId, message, context = {}) {
    const { name, profile } = context;
    // İsim biliniyorsa kullan, yoksa sıcak hitap
    const warmName = profile?.full_name?.split(" ")[0] || name || this.getWarmAddress();
    const msg = message.trim();

    // Profil tamamlanmış mı?
    const isComplete = this.getMissing(profile || {}).length === 0;

    // 1. Kısa cevap algıla ve kaydet
    const shortAnswer = this.detectShortAnswer(msg, profile);
    if (shortAnswer && profile) {
      await this.db.updateProfile(chatId, clientId, shortAnswer);
      Object.assign(profile, shortAnswer);
      await this.db.updateProfile(chatId, clientId, { last_question_key: null });
    }

    // 2. Mesajdan bilgi çıkar
    const extracted = this.extractInfo(msg);
    if (profile && Object.keys(extracted).length > 0) {
      await this.db.updateProfile(chatId, clientId, extracted);
      Object.assign(profile, extracted);
    }

    // 3. Eksik alanlar
    const missing = this.getMissing(profile || {});

    // === SELAMLAMA ===
    if (this.isGreeting(msg)) {
      if (!profile?.full_name) {
        const reply = this.addHumanTouch(`Aleyküm selam, hoş geldin ${this.getWarmAddress()}. Nasılsın, ismin ne senin?`);
        return { reply, action: "greeting" };
      }
      const prayer = Math.random() < 0.4 ? ` ${this.getRandomPrayer()}.` : "";
      const reply = this.addHumanTouch(`Aleyküm selam ${warmName}, nasılsın?${prayer} Anlat bakalım.`);
      return { reply, action: "greeting" };
    }

    // === TEŞEKKÜR ===
    if (this.isThanks(msg)) {
      const prayer = this.getRandomPrayer();
      const reply = this.addHumanTouch(`Estağfurullah ${warmName}. ${prayer}.`);
      return { reply, action: "thanks" };
    }

    // === SORU SORUYORSA - DİNLE VE CEVAPLA ===
    if (this.isQuestion(msg)) {
      // Ne zaman arayacak sorusu
      if (msg.includes("ne zaman") && (msg.includes("ara") || msg.includes("dön"))) {
        const reply = this.addHumanTouch(`${warmName}, bi kaç gün içinde mutlaka döneriz. Sabır hayırlıdır.`);
        return { reply, action: "answer" };
      }

      // Profil tamamsa AI ile cevapla
      if (isComplete && this.aiChat) {
        const aiReply = await this._askAI(msg, warmName);
        if (aiReply) return { reply: this.addHumanTouch(aiReply), action: "ai_answer" };
      }

      // Eksik bilgi varken soruya cevap verip bilgi sor
      if (!isComplete && missing.length > 0) {
        const next = missing[0];
        await this.db.updateProfile(chatId, clientId, { last_question_key: next.key, last_question_at: new Date() });
        const reply = this.addHumanTouch(`${warmName}, bu konuyu konuşuruz insallah. ${this._questionNatural(next.key)}`);
        return { reply, action: "ask_in_flow" };
      }

      const reply = this.addHumanTouch(`${warmName}, bu konuda sana yardımcı olurum. Biraz bekle.`);
      return { reply, action: "answer" };
    }

    // === UZUN MESAJ (DERT ANLATIYORSA) ===
    if (msg.length > 40) {
      // Konu olarak kaydet
      if (!profile?.subject) {
        await this.db.updateProfile(chatId, clientId, { subject: msg });
        if (profile) profile.subject = msg;
      }

      // AI ile empati göster (hoca gibi)
      if (this.aiChat) {
        const aiReply = await this._empathize(msg, warmName, missing, isComplete);
        if (aiReply) return { reply: this.addHumanTouch(aiReply), action: "empathy" };
      }

      // Eksik bilgi varsa laf arasında sor
      if (!isComplete && missing.length > 0) {
        const next = missing[0];
        await this.db.updateProfile(chatId, clientId, { last_question_key: next.key, last_question_at: new Date() });
        const prayer = this.getRandomPrayer();
        const reply = this.addHumanTouch(`Anlıyorum ${warmName}, ${prayer}. ${this._questionNatural(next.key)}`);
        return { reply, action: "empathy_ask" };
      }

      const prayer = this.getRandomPrayer();
      const reply = this.addHumanTouch(`Anlıyorum ${warmName}. ${prayer}. Sana yardımcı olurum.`);
      return { reply, action: "empathy" };
    }

    // === KISA CEVAP ALINDIYSA - BİR SONRAKİ BİLGİYİ SOR ===
    if (shortAnswer && missing.length > 0) {
      const next = missing[0];
      await this.db.updateProfile(chatId, clientId, { last_question_key: next.key, last_question_at: new Date() });
      const reply = this.addHumanTouch(`Tamam ${warmName}. ${this._questionNatural(next.key)}`);
      return { reply, action: "next_field" };
    }

    // === TÜM BİLGİLER TAMAM - YARDIMCI OLDUĞUNU AÇIKLA ===
    if (missing.length === 0 && profile) {
      // İlk kez tamamlandıysa - yardımcı olduğunu söyle
      if (profile.status !== "waiting") {
        try { await this.db.createAppointment(profile.id, clientId, profile.subject || ""); } catch {}
        await this.db.updateProfileStatus(chatId, clientId, "waiting");
        const reply = this.addHumanTouch(
          `${warmName}, ben aslında hocanın yardımcısıyım. Bilgilerini aldım, ` +
          `hocam en kısa sürede seni arayacak insallah. ${this.getRandomPrayer()}.`
        );
        return { reply, action: "complete" };
      }

      // Zaten bekliyorsa - doğal sohbet et
      if (this.aiChat) {
        const aiReply = await this._chat(msg, warmName);
        if (aiReply) return { reply: this.addHumanTouch(aiReply), action: "chat" };
      }

      const reply = this.addHumanTouch(`Seni dinliyorum ${warmName}.`);
      return { reply, action: "listening" };
    }

    // === EKSİK BİLGİ SOR ===
    if (missing.length > 0) {
      const next = missing[0];

      // Aynı soruyu 3 dk içinde tekrar sorma
      const lastAt = profile?.last_question_at ? new Date(profile.last_question_at).getTime() : 0;
      if (profile?.last_question_key === next.key && Date.now() - lastAt < 180000) {
        const reply = this.addHumanTouch(`Seni dinliyorum ${warmName}. ${this.getRandomPrayer()}.`);
        return { reply, action: "waiting" };
      }

      await this.db.updateProfile(chatId, clientId, { last_question_key: next.key, last_question_at: new Date() });
      const reply = this.addHumanTouch(this._questionNatural(next.key, warmName));
      return { reply, action: "ask_" + next.key };
    }

    const reply = this.addHumanTouch(`Seni dinliyorum ${warmName}.`);
    return { reply, action: "default" };
  }

  // Basit soru (fallback)
  _question(key, warmName = "kardeşim") {
    const q = {
      full_name: `İsmin ne?`,
      city: `Nerelisin?`,
      phone: `Numara bırak, seni arayalım.`,
      birth_date: `Kaç yaşındasın?`,
      mother_name: `Anne adın ne?`,
      subject: `Anlat, derdin ne?`
    };
    return q[key] || "Nasıl yardımcı olabilirim?";
  }

  // Doğal, insansı soru sor
  _questionNatural(key, warmName = "kardeşim") {
    const questions = {
      full_name: [
        `Adın ne senin?`,
        `İsmin nedir?`,
        `Nasıl hitap edeyim sana?`
      ],
      city: [
        `Nerelisin sen?`,
        `Hangi şehirdesin?`,
        `Nereden yazıyorsun?`
      ],
      phone: [
        `Bi numara bırak, seni arayalım.`,
        `Numaran ne, hocam seni arasın?`,
        `Telefon numarası bırakır mısın?`
      ],
      birth_date: [
        `Kaç yaşındasın?`,
        `Yaşın kaç senin?`,
        `Kaç yaşında olduğunu söyler misin?`
      ],
      mother_name: [
        `Anne adın ne?`,
        `Annenin adı ne?`,
        `Anne ismini alabilir miyim?`
      ],
      subject: [
        `Anlat bakalım, ne sıkıntı var?`,
        `Derdin ne senin?`,
        `Neyle ilgili yardım istiyorsun?`
      ]
    };

    const opts = questions[key] || [`${key} nedir?`];
    return opts[Math.floor(Math.random() * opts.length)];
  }

  // AI: Soru cevapla (hoca gibi)
  async _askAI(msg, warmName) {
    if (!this.aiChat?.openai) return null;
    try {
      const resp = await this.aiChat.openai.chat.completions.create({
        model: this.aiChat.model,
        messages: [{
          role: "system",
          content: `Sen bir dini danışman/hocasın. Samimi, sıcak ve kısa cevaplar ver.
- 1-2 cümle max
- Dini ifadeler kullan (Allah, insallah, maşallah vs)
- "${warmName}" diye hitap et
- Ciddi konularda "hocamız seni arayacak" de`
        }, {
          role: "user",
          content: msg
        }],
        temperature: 0.75,
        max_tokens: 80
      });
      return resp.choices[0]?.message?.content?.trim() || null;
    } catch { return null; }
  }

  // AI: Empati göster (hoca gibi)
  async _empathize(msg, warmName, missing, isComplete = false) {
    if (!this.aiChat?.openai) return null;
    try {
      const askFor = !isComplete && missing.length > 0 ? missing[0].label : "";
      const resp = await this.aiChat.openai.chat.completions.create({
        model: this.aiChat.model,
        messages: [{
          role: "system",
          content: `Sen bir dini danışman/hocasın. Biri derdini anlatıyor.
- Empati göster, dinlediğini hissettir
- 1-2 cümle max
- Dua/hayır dile (Allah yardımcın olsun gibi)
- "${warmName}" diye hitap et
${askFor ? `- Laf arasında doğal şekilde "${askFor}" bilgisini sor` : ""}`
        }, {
          role: "user",
          content: msg
        }],
        temperature: 0.8,
        max_tokens: 90
      });
      return resp.choices[0]?.message?.content?.trim() || null;
    } catch { return null; }
  }

  // AI: Doğal sohbet (profil tamamken - yardımcı olarak)
  async _chat(msg, warmName) {
    if (!this.aiChat?.openai) return null;
    try {
      const resp = await this.aiChat.openai.chat.completions.create({
        model: this.aiChat.model,
        messages: [{
          role: "system",
          content: `Sen hocanın yardımcısısın (artık bunu biliyorlar).
- Kısa ve samimi sohbet et (1 cümle)
- "${warmName}" diye hitap et
- Hocam sizi arayacak de
- Dini ifadeler kullan`
        }, {
          role: "user",
          content: msg
        }],
        temperature: 0.8,
        max_tokens: 60
      });
      return resp.choices[0]?.message?.content?.trim() || null;
    } catch { return null; }
  }
}

module.exports = { ConversationFlow };
