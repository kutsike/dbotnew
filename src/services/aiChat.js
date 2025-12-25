"use strict";

const { OpenAI } = require("openai");

class AIChatService {
  constructor(db) {
    this.db = db;
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    this.model = process.env.AI_MODEL || "gpt-4o-mini";
  }

  /**
   * Panelden yönetilebilir sistem promptu.
   * settings.ai_system_prompt boşsa güvenli bir varsayılan kullanır.
   */
  async buildSystemPrompt(profile) {
    const botName = (await this.db.getSetting("bot_name")) || "Hocanın Yardımcısı";
    const template = await this.db.getSetting("ai_system_prompt");

    const defaultPrompt = `Sen "${botName}" adında, profesyonel ve sıcakkanlı bir karşılama asistanısın. WhatsApp üzerinden insanlarla iletişim kuruyorsun.

## KİMLİĞİN VE ÜSLUBUN
- Gerçek bir insan gibi konuş; robotik veya şablon cümlelerden kaçın
- Samimi ama saygılı ol; "kardeşim" hitabını doğal kullan
- Kısa ve öz cevaplar ver (2-5 cümle ideal)
- Emoji kullanımı minimal olsun (sadece gerektiğinde)
- Türkçe'yi akıcı ve doğal kullan

## KONUŞMA PRENSİPLERİ
1. **Empati göster**: Karşındaki kişinin duygularını anla ve yansıt
2. **Aktif dinle**: Söyleneni özetle ve doğru anladığını teyit et
3. **Yardımcı ol**: Pratik çözümler sun, yönlendir
4. **Sabırlı ol**: Tekrarlayan sorulara bile nazik cevap ver
5. **Profesyonel kal**: Kişisel görüş belirtme, tarafsız ol

## YASAKLAR
- Fetva verme, dini hüküm bildirme
- Tıbbi/hukuki tavsiye verme
- Politik konulara girme
- Uzun ve akademik cevaplar verme
- "Ben bir yapay zekayım" deme

## HASSAS KONULAR
Kullanıcı aşağıdaki konularda yardım isterse:
- Psikolojik sıkıntı → Sakinleştir, profesyonel yardım öner
- Acil durum → 112'yi ara demesini söyle
- Dini soru → "Bu konuda hocamızla görüşmeniz daha sağlıklı olur" de
- Aile krizi → Dinle, empati göster, uzman yönlendir

## ÖRNEK ÜSLUP
❌ "Merhaba, size nasıl yardımcı olabilirim?"
✅ "Hoş geldin kardeşim, bugün nasılsın?"

❌ "Talebiniz alınmıştır. En kısa sürede dönüş yapılacaktır."
✅ "Tamam kardeşim, not aldım. Hocamız müsait olunca hemen döneriz sana."

❌ "Bu konuda yetkim bulunmamaktadır."
✅ "Bu konuda en iyisi hocamızla konuşman, o sana daha net bilgi verir."`;

    // Karakter (persona) desteği: panelden seçilen karakter promptu eklenir.
    try {
      const charsJson = await this.db.getSetting("characters_json");
      const activeId = await this.db.getSetting("active_character_id");
      if (charsJson && activeId) {
        const list = JSON.parse(charsJson);
        const active = Array.isArray(list) ? list.find(c => String(c.id) === String(activeId)) : null;
        if (active?.prompt) {
          const cPrompt = String(active.prompt)
            .replace("{bot_name}", botName)
            .replace("{full_name}", profile?.full_name || "")
            .replace("{city}", profile?.city || "")
            .replace("{phone}", profile?.phone || "");
          const combined = (template || defaultPrompt) + `\n\n## AKTİF KARAKTER ÜSLUBU\n${cPrompt}\n`;
          return combined;
        }
      }
    } catch (e) {
      // JSON bozuksa veya yoksa sorun değil
    }

    const p = (template && template.trim().length > 0) ? template : defaultPrompt;

    // Basit değişkenler
    return p
      .replaceAll("{bot_name}", botName)
      .replaceAll("{full_name}", profile?.full_name || "Kardeşim")
      .replaceAll("{city}", profile?.city || "Bilinmiyor")
      .replaceAll("{phone}", profile?.phone || "Bilinmiyor");
  }

  /**
   * Sohbet geçmişini formatlı şekilde al
   */
  async getFormattedHistory(chatId, limit = 8) {
    try {
      const history = await this.db.getChatHistory(chatId, limit);
      return history.map(h => ({
        role: h.direction === "incoming" ? "user" : "assistant",
        content: h.content
      }));
    } catch (e) {
      return [];
    }
  }

  /**
   * Ana sohbet işleyici - insansı cevaplar
   */
  async answerIslamicQuestion(message, context = {}) {
    const { chatId, profile } = context;
    
    // Geçmiş mesajları al (Hafıza)
    const historyMessages = await this.getFormattedHistory(chatId, 8);
    const systemPrompt = await this.buildSystemPrompt(profile);

    // Kullanıcı adını al
    const userName = profile?.full_name?.split(/\s+/)[0] || "kardeşim";

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          ...historyMessages,
          { 
            role: "user", 
            content: `[Kullanıcı: ${userName}]\n${message}` 
          }
        ],
        temperature: 0.75,
        max_tokens: 350,
        presence_penalty: 0.3,
        frequency_penalty: 0.3
      });

      let answer = (response.choices[0].message.content || "").trim();
      
      // Çok uzun cevapları kısalt
      if (answer.length > 500) {
        const sentences = answer.split(/[.!?]+/);
        answer = sentences.slice(0, 4).join(". ").trim();
        if (!answer.endsWith(".") && !answer.endsWith("!") && !answer.endsWith("?")) {
          answer += ".";
        }
      }

      return { reply: answer, action: "ai_response" };
    } catch (err) {
      console.error("AI Chat Hatası:", err.message);
      
      // Hata durumunda insansı fallback mesajları
      const fallbacks = [
        `${userName} kardeşim, bir saniye bekler misin? Şu an biraz yoğunuz, hemen döneceğim.`,
        `Pardon ${userName} kardeşim, bir aksaklık oldu. Birazdan tekrar yazar mısın?`,
        `${userName} kardeşim, sistemde ufak bir sorun var. Bir dakika sonra tekrar dener misin?`
      ];
      
      return { 
        reply: fallbacks[Math.floor(Math.random() * fallbacks.length)],
        action: "ai_error"
      };
    }
  }

  /**
   * Selamlama cevabı oluştur
   */
  async generateGreeting(name, timeOfDay = null) {
    const hour = new Date().getHours();
    let greeting = "";
    
    if (hour >= 5 && hour < 12) {
      greeting = "Günaydın";
    } else if (hour >= 12 && hour < 18) {
      greeting = "İyi günler";
    } else if (hour >= 18 && hour < 22) {
      greeting = "İyi akşamlar";
    } else {
      greeting = "İyi geceler";
    }

    const greetings = [
      `${greeting} ${name} kardeşim, hoş geldin! Nasılsın bugün?`,
      `Hoş geldin ${name} kardeşim! ${greeting}, nasıl yardımcı olabilirim?`,
      `${greeting} ${name} kardeşim! Seni görmek güzel, nasılsın?`,
      `${name} kardeşim, ${greeting.toLowerCase()}! Bugün sana nasıl yardımcı olabilirim?`
    ];

    return greetings[Math.floor(Math.random() * greetings.length)];
  }

  /**
   * Fetva işle - nazik yönlendirme
   */
  async processFetva(question) {
    const responses = [
      `Bu konuda hocamızla görüşmen daha sağlıklı olur kardeşim. İstersen randevu ayarlayabilirim.`,
      `Güzel soru kardeşim, ama bu tür konularda hocamız sana daha net bilgi verebilir. Görüşme ayarlayalım mı?`,
      `Bu konuyu hocamıza sormak en doğrusu olur. Müsaitlik durumuna göre sana dönüş yaparız, olur mu?`
    ];
    
    return { 
      reply: responses[Math.floor(Math.random() * responses.length)],
      action: "fetva_redirect"
    };
  }

  /**
   * Karakter testi
   */
  async testPersonality(message, personality = {}) {
    const systemPrompt = personality.system_prompt ||
      (await this.buildSystemPrompt({ full_name: "Kardeşim", city: "" }));

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message }
        ],
        temperature: 0.75,
        max_tokens: 300
      });

      return response.choices[0].message.content;
    } catch (err) {
      console.error("Test hatası:", err.message);
      return "Test yanıtı oluşturulamadı.";
    }
  }

  /**
   * Duygu analizi - basit
   */
  detectEmotion(message) {
    const lower = message.toLowerCase();
    
    const sadWords = ["üzgün", "kötü", "mutsuz", "ağlıyorum", "zor", "sıkıntı", "dert", "problem", "sorun"];
    const happyWords = ["mutlu", "iyi", "güzel", "harika", "süper", "teşekkür", "sağol"];
    const angryWords = ["sinir", "kızgın", "öfke", "bıktım", "yeter"];
    const anxiousWords = ["endişe", "korku", "kaygı", "panik", "stres"];

    if (sadWords.some(w => lower.includes(w))) return "sad";
    if (happyWords.some(w => lower.includes(w))) return "happy";
    if (angryWords.some(w => lower.includes(w))) return "angry";
    if (anxiousWords.some(w => lower.includes(w))) return "anxious";
    
    return "neutral";
  }

  /**
   * Duyguya göre empati cümlesi
   */
  getEmpatheticPrefix(emotion, name) {
    const prefixes = {
      sad: [
        `${name} kardeşim, anlıyorum seni, zor bir dönemden geçiyorsun.`,
        `Üzüldüğünü hissediyorum ${name} kardeşim.`,
        `${name} kardeşim, böyle hissetmen çok normal.`
      ],
      angry: [
        `${name} kardeşim, sinirlenmeni anlıyorum.`,
        `Haklısın ${name} kardeşim, bu durum insanı zorlar.`,
        `${name} kardeşim, böyle hissetmen gayet normal.`
      ],
      anxious: [
        `${name} kardeşim, endişelenme, birlikte çözeriz.`,
        `Sakin ol ${name} kardeşim, her şey yoluna girecek inşallah.`,
        `${name} kardeşim, kaygılanma, yanındayız.`
      ],
      happy: [
        `Ne güzel ${name} kardeşim!`,
        `Sevindim ${name} kardeşim!`,
        `Harika ${name} kardeşim!`
      ]
    };

    const list = prefixes[emotion];
    if (list) {
      return list[Math.floor(Math.random() * list.length)] + " ";
    }
    return "";
  }

  /**
   * WhatsApp media (base64) sesli mesajı metne çevir.
   */
  async transcribeVoiceMedia(media) {
    try {
      if (!process.env.OPENAI_API_KEY) return "";
      if (!media || !media.data || !media.mimetype) return "";

      const buf = Buffer.from(media.data, "base64");
      const ext = (() => {
        const m = String(media.mimetype);
        if (m.includes("ogg")) return "ogg";
        if (m.includes("webm")) return "webm";
        if (m.includes("mp4")) return "mp4";
        if (m.includes("mpeg")) return "mp3";
        if (m.includes("wav")) return "wav";
        return "audio";
      })();

      const fd = new FormData();
      fd.append("model", process.env.AI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe");
      fd.append("file", new Blob([buf], { type: media.mimetype }), `voice.${ext}`);

      const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: fd
      });

      if (!resp.ok) {
        const txt = await resp.text().catch(() => "");
        console.error("Transcribe hata:", resp.status, txt.slice(0, 200));
        return "";
      }
      const json = await resp.json();
      return (json.text || "").trim();
    } catch (err) {
      console.error("Transcribe exception:", err.message);
      return "";
    }
  }

  // Alias for backward compatibility
  async transcribeMedia(media) {
    return this.transcribeVoiceMedia(media);
  }
}

module.exports = { AIChatService };
