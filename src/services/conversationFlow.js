"use strict";

/**
 * ConversationFlow v5.0 - Tamamen İnsansı Sohbet
 *
 * KURALLAR:
 * 1. HER ZAMAN kısa cevap (1-2 cümle max)
 * 2. Kullanıcının söylediğini DİNLE ve CEVAP VER
 * 3. Aynı mesajı tekrarlama
 * 4. Profil tamamlansa bile sohbete devam et
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
    const warmName = profile?.full_name?.split(" ")[0] || name || "kardeşim";
    const msg = message.trim();

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
        return { reply: `Aleyküm selam, hoş geldin. İsmin ne?`, action: "greeting" };
      }
      return { reply: `Aleyküm selam ${warmName}, nasılsın? Seni dinliyorum.`, action: "greeting" };
    }

    // === TEŞEKKÜR ===
    if (this.isThanks(msg)) {
      return { reply: `Rica ederim ${warmName}.`, action: "thanks" };
    }

    // === SORU SORUYORSA - DİNLE VE CEVAPLA ===
    if (this.isQuestion(msg)) {
      // Ne zaman arayacak sorusu
      if (msg.includes("ne zaman") && (msg.includes("ara") || msg.includes("dön"))) {
        return { reply: `${warmName}, hocamız genelde 1-2 gün içinde dönüş yapıyor. Biraz sabır.`, action: "answer" };
      }

      // Genel soru - AI ile cevapla
      if (this.aiChat) {
        const aiReply = await this._askAI(msg, warmName);
        if (aiReply) return { reply: aiReply, action: "ai_answer" };
      }

      return { reply: `${warmName}, bu konuda hocamız sana daha iyi cevap verir. Biraz bekle, döneceğiz.`, action: "answer" };
    }

    // === UZUN MESAJ (DERT ANLATIYORSA) ===
    if (msg.length > 40) {
      // Konu olarak kaydet
      if (!profile?.subject) {
        await this.db.updateProfile(chatId, clientId, { subject: msg });
        if (profile) profile.subject = msg;
      }

      // AI ile empati göster
      if (this.aiChat) {
        const aiReply = await this._empathize(msg, warmName, missing);
        if (aiReply) return { reply: aiReply, action: "empathy" };
      }

      return { reply: `Anlıyorum ${warmName}. Hocamız bu konuda sana yardımcı olur. Biraz bekle.`, action: "empathy" };
    }

    // === KISA CEVAP ALINDIYSA - BİR SONRAKİ BİLGİYİ SOR ===
    if (shortAnswer && missing.length > 0) {
      const next = missing[0];
      await this.db.updateProfile(chatId, clientId, { last_question_key: next.key, last_question_at: new Date() });
      return { reply: `Tamam ${warmName}. ${this._question(next.key)}`, action: "next_field" };
    }

    // === TÜM BİLGİLER TAMAM ===
    if (missing.length === 0 && profile) {
      // İlk kez tamamlandıysa
      if (profile.status !== "waiting") {
        try { await this.db.createAppointment(profile.id, clientId, profile.subject || ""); } catch {}
        await this.db.updateProfileStatus(chatId, clientId, "waiting");
        return { reply: `Tamam ${warmName}, hocamıza ilettim. Seni arayacak. Başka bir şey var mı?`, action: "complete" };
      }

      // Zaten bekliyorsa - doğal sohbet et
      if (this.aiChat) {
        const aiReply = await this._chat(msg, warmName);
        if (aiReply) return { reply: aiReply, action: "chat" };
      }

      return { reply: `Seni dinliyorum ${warmName}.`, action: "listening" };
    }

    // === EKSİK BİLGİ SOR ===
    if (missing.length > 0) {
      const next = missing[0];

      // Aynı soruyu 2 dk içinde tekrar sorma
      const lastAt = profile?.last_question_at ? new Date(profile.last_question_at).getTime() : 0;
      if (profile?.last_question_key === next.key && Date.now() - lastAt < 120000) {
        return { reply: `Seni dinliyorum ${warmName}.`, action: "waiting" };
      }

      await this.db.updateProfile(chatId, clientId, { last_question_key: next.key, last_question_at: new Date() });
      return { reply: this._question(next.key, warmName), action: "ask_" + next.key };
    }

    return { reply: `Seni dinliyorum ${warmName}.`, action: "default" };
  }

  // Doğal soru sor
  _question(key, warmName = "kardeşim") {
    const q = {
      full_name: `İsmin ne?`,
      city: `Nerelisin?`,
      phone: `Hocamız arasın mı? Numara bırak.`,
      birth_date: `Kaç yaşındasın?`,
      mother_name: `Anne adın ne? (Bakım için lazım)`,
      subject: `Anlat, derdin ne?`
    };
    return q[key] || "Nasıl yardımcı olabilirim?";
  }

  // AI: Soru cevapla
  async _askAI(msg, warmName) {
    if (!this.aiChat?.openai) return null;
    try {
      const resp = await this.aiChat.openai.chat.completions.create({
        model: this.aiChat.model,
        messages: [{
          role: "user",
          content: `Sen hocanın yardımcısısın. Kısa cevap ver (1-2 cümle). Tavsiye verme, hocaya yönlendir.

Soru: "${msg}"

"${warmName}" diye hitap et. Kısa ve samimi cevap:`
        }],
        temperature: 0.7,
        max_tokens: 60
      });
      return resp.choices[0]?.message?.content?.trim() || null;
    } catch { return null; }
  }

  // AI: Empati göster
  async _empathize(msg, warmName, missing) {
    if (!this.aiChat?.openai) return null;
    try {
      const askFor = missing.length > 0 ? missing[0].label : "";
      const resp = await this.aiChat.openai.chat.completions.create({
        model: this.aiChat.model,
        messages: [{
          role: "user",
          content: `Sen hocanın yardımcısısın. Biri derdini anlatıyor. Empati göster, kısa cevap ver (1-2 cümle).
${askFor ? `Laf arasında "${askFor}" sor.` : ""}

Mesaj: "${msg}"

"${warmName}" diye hitap et. Samimi ol:`
        }],
        temperature: 0.8,
        max_tokens: 70
      });
      return resp.choices[0]?.message?.content?.trim() || null;
    } catch { return null; }
  }

  // AI: Doğal sohbet (profil tamamken)
  async _chat(msg, warmName) {
    if (!this.aiChat?.openai) return null;
    try {
      const resp = await this.aiChat.openai.chat.completions.create({
        model: this.aiChat.model,
        messages: [{
          role: "user",
          content: `Sen hocanın yardımcısısın. Kısa ve samimi sohbet et (1 cümle). "${warmName}" diye hitap et.

Mesaj: "${msg}"

Kısa cevap:`
        }],
        temperature: 0.8,
        max_tokens: 50
      });
      return resp.choices[0]?.message?.content?.trim() || null;
    } catch { return null; }
  }
}

module.exports = { ConversationFlow };
