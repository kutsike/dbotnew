"use strict";

/**
 * ConversationFlow - Hoca'nın Yardımcısı (Derin Maneviyat Modu)
 * * Özellikler:
 * - Uzun, tasavvufi ve dini ağırlıklı cümleler.
 * - Soruları sohbetin içine, tavsiyelerin arasına gizleme.
 * - Hocayı ve tekniklerini övme.
 * - Kullanıcının derdine ortak olma.
 * - KISA CEVAP ALGILAMA: Tek kelimelik cevapları (isim, şehir, yaş) son sorulan soruyla ilişkilendirir.
 */

class ConversationFlow {
  constructor(db, aiChat = null) {
    this.db = db;
    this.aiChat = aiChat;

    // Öncelik sırası ve AI için bağlam ipuçları
    this.requiredFields = [
      { key: "full_name", label: "İsminiz", priority: 1 },
      { key: "city", label: "Yaşadığınız Şehir", priority: 2 },
      { key: "phone", label: "Telefon Numaranız", priority: 3 },
      { key: "birth_date", label: "Yaşınız veya Doğum Tarihiniz", priority: 4 },
      { key: "mother_name", label: "Anne Adınız (Yıldızname/Bakım için gerekli)", priority: 5 },
      { key: "subject", label: "Derdi/Sıkıntısı", priority: 6 }
    ];

    // Türk isimleri (yaygın olanlar - kısa cevap algılama için)
    this.commonNames = new Set([
      "ahmet", "mehmet", "mustafa", "ali", "hasan", "hüseyin", "ibrahim", "ismail", "osman", "yusuf",
      "fatma", "ayşe", "emine", "hatice", "zeynep", "elif", "meryem", "sultan", "hacer", "hanife",
      "ayten", "aysel", "gülşen", "sevim", "nurten", "nuriye", "naime", "naciye", "halime", "havva",
      "ömer", "recep", "ramazan", "süleyman", "abdullah", "abdulkadir", "murat", "burak", "emre", "can",
      "derya", "deniz", "ceren", "selin", "ece", "buse", "merve", "büşra", "seda", "gamze",
      "kemal", "cemal", "celal", "kadir", "yaşar", "şükrü", "rıza", "necati", "veli", "sami"
    ]);

    // Regex Desenleri (Değişmedi - Veri yakalama için gerekli)
    this.cities = [
      "istanbul", "ankara", "izmir", "bursa", "antalya", "konya", "adana", "gaziantep", "mersin", "diyarbakır",
      "kayseri", "eskişehir", "samsun", "denizli", "şanlıurfa", "malatya", "trabzon", "erzurum", "van", "batman",
      "elazığ", "sivas", "manisa", "balıkesir", "kahramanmaraş", "hatay", "sakarya", "kocaeli", "muğla", "aydın",
      "tekirdağ", "ordu", "mardin", "afyon", "çorum", "tokat", "aksaray", "giresun", "yozgat", "edirne", "düzce",
      "rize", "artvin", "isparta", "bolu", "çanakkale", "kastamonu", "zonguldak", "karabük", "kırıkkale", "osmaniye",
      "kilis", "niğde", "nevşehir", "bingöl", "muş", "bitlis", "siirt", "şırnak", "hakkari", "ağrı", "iğdır", "kars",
      "ardahan", "erzincan", "tunceli"
    ];

    this.greetingPatterns = ["selam", "merhaba", "mrb", "slm", "günaydın", "iyi günler", "iyi akşamlar", "hayırlı", "sa", "as"];
  }

  /**
   * KISA CEVAP ALGILAMA SİSTEMİ
   * Bot "Anne adın?" diye sorduğunda kullanıcı sadece "Ayten" yazarsa,
   * bu metot son sorulan soruyu (last_question_key) kontrol eder ve
   * kısa cevabı ilgili alana yerleştirir.
   */
  detectShortAnswer(message, profile) {
    const raw = String(message || "").trim();
    const lower = this.normalizeTR(raw);
    const words = raw.split(/\s+/);

    // Çok uzun mesajlar kısa cevap değildir
    if (words.length > 4 || raw.length > 50) return null;

    // Selamlama ise kısa cevap değil
    if (this.isGreeting(raw)) return null;

    // Son sorulan soru ne?
    const lastQ = profile?.last_question_key;
    if (!lastQ) return null;

    // Son soruyu sorma süresini kontrol et (10 dakika içinde cevaplanmalı)
    const lastAt = profile?.last_question_at ? new Date(profile.last_question_at).getTime() : 0;
    const now = Date.now();
    if (now - lastAt > 600000) return null; // 10 dakikadan eski

    // Her alan için kısa cevap algılama
    switch (lastQ) {
      case "full_name":
        // 1-3 kelime arası ve isim gibi görünüyor (harf ile başlıyor)
        if (words.length <= 3 && /^[a-zA-ZçğıöşüÇĞİÖŞÜ]/.test(raw)) {
          return { full_name: this._capitalizeWords(raw) };
        }
        break;

      case "mother_name":
        // Tek kelime veya 2 kelime (anne ismi genellikle tek kelime)
        if (words.length <= 2 && /^[a-zA-ZçğıöşüÇĞİÖŞÜ]/.test(raw)) {
          // Yaygın isimlerden biri mi veya isim formatında mı?
          const firstName = words[0];
          if (this.commonNames.has(this.normalizeTR(firstName)) || /^[A-ZÇĞİÖŞÜ]/.test(firstName)) {
            return { mother_name: this._capitalizeWords(raw) };
          }
          // Küçük harfle yazılmış olsa bile kabul et
          return { mother_name: this._capitalizeWords(raw) };
        }
        break;

      case "city":
        // Şehir listesinde var mı veya tek/iki kelime mi?
        for (const city of this.cities) {
          if (lower.includes(this.normalizeTR(city))) {
            return { city: city.charAt(0).toUpperCase() + city.slice(1).toLowerCase() };
          }
        }
        // Şehir listesinde yoksa ama tek kelime ise kabul et
        if (words.length === 1 && /^[a-zA-ZçğıöşüÇĞİÖŞÜ]/.test(raw)) {
          return { city: this._capitalizeWords(raw) };
        }
        break;

      case "birth_date":
        // Yaş (sayı) veya yıl (4 haneli)
        const ageMatch = raw.match(/^(\d{1,2})$/);
        if (ageMatch) {
          const age = parseInt(ageMatch[1]);
          if (age >= 10 && age <= 100) {
            return { birth_date: String(new Date().getFullYear() - age) };
          }
        }
        const yearMatch = raw.match(/^(19\d{2}|20[0-2]\d)$/);
        if (yearMatch) {
          return { birth_date: yearMatch[1] };
        }
        // "35 yaşındayım", "1988 doğumluyum" gibi
        const ageInText = lower.match(/(\d{1,2})\s*yaş/);
        if (ageInText) {
          return { birth_date: String(new Date().getFullYear() - parseInt(ageInText[1])) };
        }
        break;

      case "phone":
        // Telefon numarası (5xx ile başlayan)
        const phoneMatch = raw.replace(/\s+/g, "").match(/(\+?90)?0?5\d{9}/);
        if (phoneMatch) {
          return { phone: phoneMatch[0] };
        }
        break;
    }

    return null;
  }

  // Kelimelerin baş harflerini büyük yap
  _capitalizeWords(str) {
    return String(str || "")
      .split(/\s+/)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
  }

  // --- YARDIMCI METODLAR ---

  normalizeTR(str) {
    return String(str || "").replace(/İ/g, "i").replace(/I/g, "ı").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  }

  isGreeting(message) {
    const lower = this.normalizeTR(message);
    return this.greetingPatterns.some(g => lower.includes(g));
  }

  _pickWarmName(name, profile) {
    const full = (profile?.full_name || name || "").trim();
    return (!full || full === "kardeşim") ? "Mübarek" : full.split(/\s+/)[0];
  }

  // --- VERİ YAKALAMA MOTORU (REGEX) ---
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
        extracted.city = city.charAt(0).toUpperCase() + city.slice(1).toLowerCase();
        break;
      }
    }

    // Doğum Tarihi / Yaş
    const ageMatch = lower.match(/(\d{1,2})\s*yaş/);
    if (ageMatch) extracted.birth_date = String(new Date().getFullYear() - parseInt(ageMatch[1]));
    
    const dateMatch = lower.match(/(\d{4})/);
    if (dateMatch && !extracted.phone) extracted.birth_date = dateMatch[1]; // Telefonla karışmasın diye kontrol

    // İsim (Basit mantık: 2-3 kelime ve selam değilse)
    if (!this.isGreeting(raw) && raw.length < 30 && raw.split(" ").length >= 2 && !extracted.city) {
      // Eğer daha önce isim alınmadıysa
      if (!profile?.full_name) extracted.full_name = raw; 
    }

    // Konu (Uzun mesajlar)
    if (raw.length > 15 && !this.isGreeting(raw)) {
       // İçinde sadece şehir veya sadece telefon yoksa konudur
       if (!extracted.city && !extracted.phone) extracted.subject = raw;
    }

    return extracted;
  }

  getMissingFields(profile) {
    return this.requiredFields
      .filter(f => !profile?.[f.key] || String(profile[f.key]).trim() === "")
      .sort((a, b) => a.priority - b.priority);
  }

  // --- AI BRIDGE: HOCA EFENDİ MODU ---
  async _generateReligousConversation(profile, nextField, lastMessage) {
    if (!this.aiChat || !this.aiChat.openai) return null;

    try {
      const systemPrompt = `
      ROL: Sen çok derin maneviyata sahip, insanlara şifa dağıtan, ilmi kuvvetli bir 'Hocanın' yardımcısısın.
      KİMLİK: İsmiyle hitap eden, çok nazik, sürekli dua eden, orta-uzun cümleler kuran bir dert ortağısın.

      GÖREVİN:
      Kullanıcı sana bir şeyler yazdı ("${lastMessage}").
      Senin görevin hem bu yazılana cevap vermek hem de laf arasında şu bilgiyi istemek: "${nextField.label}".

      KONUŞMA KURALLARI (ÇOK ÖNEMLİ):
      1. UZUN KONUŞ: Asla tek cümle kurma. Kullanıcının derdine ortak ol.
      2. DİNİ BİTİRİŞLER: Neredeyse her cümlenin sonuna "İnşallah", "Maşallah", "Biiznillah", "Sübhanallah", "Allah'ın izniyle", "Rabbim kerimdir" gibi ifadeler ekle.
      3. HOCA FAKTÖRÜ: İlk başta dinle analiz et kişiden biraz detay aldıktan sonra konuyu mutlaka Hocana getir. Hocanın "havas ilmi", "yıldızname", "manevi reçeteler", "rukye" gibi konulardaki derinliğinden bahset. "Hocamız bu konuda çok ehildir, nice dertliler şifa buldu biiznillah" gibi şeyler söyle.
      4. SORUYU GİZLE: Soruyu (Örn: Şehir) sorgu memuru gibi sorma. Önce teselli ver, sonra "Peki bu manevi çalışmayı hangi şehrimize ulaştıracağız güzel kardeşim ?" gibi laf arasında iste.
      5. İSİM KULLAN: Kullanıcının adı "${profile.full_name || 'kardeşim'}" diye hitap et. Ve isminin anlamından kısaca bahset isminin karakteristik özelliğini çıkar ve kişiye biraz show havasında karakteristik profil analizinden bahset kısaca. Ardından konuya girmesini sağla. Örn : Evet güzel kardeşim Allah'ın dini o kadar güzel bir dindir ki devası olmayan dert yoktur senin de derdine derman olacak inşallah kalbini ferah tut. Bana biraz sorununun ne olduğundan bahset ama üstü kapalı değil açık ve doğru şekilde.
      ÖRNEK TAVIR:
      (Kullanıcı derdini anlattıysa): "Ah güzel kardeşim, bu anlattıkların yüreğimi dağladı, Rabbim ferahlık versin inşallah. Bu tür musibetler imtihandır lakin çaresiz değildir biiznillah.Aziz Hocamızın bu konularda çok derin çalışmaları var, nice yuvalar kurtuldu, nice sıkıntılar def edildi Allah'ın izniyle. Hocamızın manevi reçeteleri senin de yarana merhem olacaktır evelallah. Hocamızın programı çok yoğun olduğundan ve seninle irtibatı koparmamak adına, bu numaranı kaydediyorum bilgileri hocama aktardım. Kendisi seni arayıp derdine derman olacak inşallah güzel kardeşim Allah'ın rahmeti ve bereketi üzerinde olsun diyerek paylaşmak istediği başka birşey varsa bunu da dinle ve konuyu özenle çözüme kavuşturmak için en doğru ve makul yolu hocamızın aktaracağını söyleyip nazikçe müsade iste Namazın kazasını kılman gerekiyor Allah kulunu en çok namazda severmiş diyerek görüşmeyi hoca ya devret."
      (Kullanıcı mantık dışı şeylerden bahsediyorsa) : Konuyu onunla daha derine götür daha fazla detaya gir.
      `;

      const completion = await this.aiChat.openai.chat.completions.create({
        model: this.aiChat.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: lastMessage } // Kullanıcının son mesajı
        ],
        temperature: 0.8, // Biraz daha yaratıcı ve duygusal olsun
        max_tokens: 300   // Uzun cevaplar için limit artırıldı
      });

      return completion.choices[0].message.content;
    } catch (e) {
      console.error("AI Hoca Modu Hatası:", e.message);
      return null;
    }
  }

  // --- YEDEK SORULAR (AI YOKSA) ---
  _manualReligiousQuestion(fieldKey, warmName) {
    const q = {
      full_name: `Esselamü Aleyküm ve Rahmetullah ${warmName} kardeşim. Gönül kapılarını açmadan önce ismini bağışlar mısın, hitabımız güzel olsun inşallah?`,
      city: `Ah güzel kardeşim, Rabbim her yerde hazır ve nazırdır elbet biiznillah. Lakin Hocamızın manevi teveccühü için hangi diyarlarda, hangi şehrimizde ikamet ettiğini bilmemiz icap eder inşallah?`,
      phone: `Hocamızın o hikmetli ve şifalı sözlerini, hususi manevi reçetelerini sana ulaştırmak isteriz biiznillah. İletişim için hayırlı bir numara bırakır mısın mübarek kardeşim?`,
      birth_date: `İnsan ömrü bir yaprak misali ${warmName} kardeşim, Allah hayırlı, bereketli ömürler versin maşallah. Yıldızname bakımı ve ebced hesabı için doğum tarihini veya yaşını lütfeder misin inşallah?`,
      mother_name: `Bu manevi ilimlerde, havas çalışmalarında anne ismi çok mühimdir ${warmName} kardeşim. Hocamızın bakımı tam yapabilmesi için anne ismini de yazar mısın Allah'ın izniyle?`,
      subject: `Rabbim "Ben hüzünlü kalplerdeyim" buyuruyor ${warmName} kardeşim. İçini dök, derdini anlat ki Hocamız senin için en doğru manevi kapıyı aralasın inşallah. Seni dinliyoruz biiznillah.`
    };
    return q[fieldKey] || q.subject;
  }

  // --- ANA İŞLEM ---
  async processMessage(chatId, clientId, message, context = {}) {
    const { name, profile } = context;
    const warmName = this._pickWarmName(name, profile);

    // 1. ÖNCE KISA CEVAP ALGILAMA (SON SORULAN SORUYA GÖRE)
    const shortAnswer = this.detectShortAnswer(message, profile);
    if (shortAnswer && profile) {
      // Kısa cevabı doğrudan profil alanına kaydet
      await this.db.updateProfile(chatId, clientId, shortAnswer);
      Object.assign(profile, shortAnswer);
      console.log(`[ConversationFlow] Kısa cevap algılandı:`, shortAnswer);

      // Son soru key'ini temizle (tekrar sormasın)
      await this.db.updateProfile(chatId, clientId, { last_question_key: null });
    }

    // 2. Normal Veri Yakalama (Regex ile)
    const extracted = this.extractInfo(message, profile);

    // 3. Profili Güncelle (kısa cevap veya regex ile yakalananlar)
    if (profile && Object.keys(extracted).length > 0) {
      await this.db.updateProfile(chatId, clientId, extracted);
      Object.assign(profile, extracted);
    }

    // 4. Selamlama (Eğer yeni ise)
    const isGreeting = this.isGreeting(message);
    if (isGreeting && (!profile?.full_name || profile?.status === "new")) {
      return {
        reply: `Ve Aleyküm Selam ${warmName} kardeşim, hoş geldin. Seni dinliyorum, ismini öğrenebilir miyim?`,
        action: "greeting"
      };
    }

    // 5. Eksik Alan Kontrolü
    const missing = this.getMissingFields(profile || {});

    // --- DURUM A: TÜM BİLGİLER TAMAM (FİNAL) ---
    if (missing.length === 0 && profile) {
      if (profile.status !== "waiting") {
        try { await this.db.createAppointment(profile.id, clientId, profile.subject || ""); } catch {}
        await this.db.updateProfileStatus(chatId, clientId, "waiting");

        return {
          reply: "Hocama durumunuzu ilettim, kendisi sizinle iletişime geçecek inşallah.",
          action: "profile_complete"
        };
      }
      // Zaten waiting ise teşekkür et
      return {
        reply: "Bilgileriniz kayıtlı kardeşim, Hocamız en kısa sürede sizinle iletişime geçecek inşallah.",
        action: "already_complete"
      };
    }

    // --- DURUM B: BİLGİ EKSİK -> SOHBETLE İSTE ---
    if (missing.length > 0) {
      const nextField = missing[0];

      // Tekrar sorma kontrolü - AYNI SORUYU TEKRAR SORMA
      // Eğer zaten bu soru sorulmuşsa VE kısa cevap gelmediyse biraz bekle
      const now = Date.now();
      const lastAt = profile?.last_question_at ? new Date(profile.last_question_at).getTime() : 0;

      // Eğer son 2 dakika içinde aynı soruyu sorduysan ve cevap alamadıysan
      if (profile?.last_question_key === nextField.key && (now - lastAt < 120000)) {
        // Kısa cevap geldiyse (shortAnswer) sıradaki soruya geç
        if (!shortAnswer) {
          return { reply: null, action: "skip_repeat" };
        }
      }

      // Yeni soru sor
      await this.db.updateProfile(chatId, clientId, {
        last_question_key: nextField.key,
        last_question_at: new Date()
      });

      // KISA VE DOĞAL SORULAR (Abartısız)
      return {
        reply: this._shortQuestion(nextField.key, warmName),
        action: "collecting_" + nextField.key
      };
    }

    return { reply: "Teşekkürler kardeşim, notlarımıza aldık.", action: "default" };
  }

  // --- KISA VE DOĞAL SORULAR (Abartısız) ---
  _shortQuestion(fieldKey, warmName) {
    const questions = {
      full_name: `İsmini öğrenebilir miyim ${warmName}?`,
      city: `Hangi şehirdesin kardeşim?`,
      phone: `Hocamız seni arasın diye bir numara alabilir miyim?`,
      birth_date: `Kaç yaşındasın kardeşim?`,
      mother_name: `Anne ismini alabilir miyim? (Bakım için gerekli)`,
      subject: `Anlat bakalım kardeşim, derdin nedir?`
    };
    return questions[fieldKey] || "Nasıl yardımcı olabilirim?";
  }
}

module.exports = { ConversationFlow };