"use strict";

/**
 * ConversationFlow - Hoca'nın Yardımcısı (Derin Maneviyat Modu)
 * * Özellikler:
 * - Uzun, tasavvufi ve dini ağırlıklı cümleler.
 * - Soruları sohbetin içine, tavsiyelerin arasına gizleme.
 * - Hocayı ve tekniklerini övme.
 * - Kullanıcının derdine ortak olma.
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

    // 1. Veri Yakalama
    const extracted = this.extractInfo(message, profile);

    // 2. Profili Güncelle
    if (profile && Object.keys(extracted).length > 0) {
      await this.db.updateProfile(chatId, clientId, extracted);
      Object.assign(profile, extracted);
    }

    // 3. Selamlama (Eğer yeni ise)
    const isGreeting = this.isGreeting(message);
    if (isGreeting && (!profile?.full_name || profile?.status === "new")) {
      return { 
        reply: `Ve Aleyküm Selam ve Rahmetullahi ve Berekatuhu ${warmName} kardeşim, hoş geldin, safalar getirdin inşallah. Gönül dergahımıza adım attın, Rabbim hayırlara vesile kılsın maşallah. Hocamızın manevi desteğiyle nice gönüller ferahladı, inşallah senin de derdine derman olacağız biiznillah. Öncelikle seni daha yakından tanımak, ismen dua etmek isteriz. İsmini bağışlar mısın güzel kardeşim?`, 
        action: "greeting" 
      };
    }

    // 4. Eksik Alan Kontrolü
    const missing = this.getMissingFields(profile || {});

    // --- DURUM A: TÜM BİLGİLER TAMAM (FİNAL) ---
    if (missing.length === 0 && profile) {
      if (profile.status !== "waiting") {
        try { await this.db.createAppointment(profile.id, clientId, profile.subject || ""); } catch {}
        await this.db.updateProfileStatus(chatId, clientId, "waiting");
        
        // İSTENİLEN ÖZEL FİNAL MESAJI
        const finalReply = "Hocama durumunuzu ilettim kendisi sizinle iletişime geçecek ve inşallah yaralarınıza derman olacaktır.";

        return { reply: finalReply, action: "profile_complete" };
      }
    }

    // --- DURUM B: BİLGİ EKSİK -> SOHBETLE İSTE ---
    if (missing.length > 0) {
      const nextField = missing[0];
      
      // Tekrar sorma kontrolü (spam önleme)
      const now = Date.now();
      const lastAt = profile.last_question_at ? new Date(profile.last_question_at).getTime() : 0;
      if (profile.last_question_key === nextField.key && (now - lastAt < 40000)) {
        return { reply: null, action: "skip_repeat" }; // Çok sık sorma
      }

      await this.db.updateProfile(chatId, clientId, { 
        last_question_key: nextField.key,
        last_question_at: new Date()
      });

      // AI VARSA: Hoca Modunda Sor
      if (this.aiChat) {
        const aiResponse = await this._generateReligousConversation(profile, nextField, message);
        if (aiResponse) {
          return { reply: aiResponse, action: "collecting_" + nextField.key };
        }
      }

      // AI YOKSA: Manuel Hoca Modu Soruları
      return { 
        reply: this._manualReligiousQuestion(nextField.key, warmName), 
        action: "collecting_" + nextField.key 
      };
    }

    return { reply: "Mesajınızı aldık kardeşim, sabret, inşallah dönüş yapacağız.", action: "default" };
  }
}

module.exports = { ConversationFlow };