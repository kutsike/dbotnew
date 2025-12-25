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

    const defaultPrompt = `Sen bir din görevlisinin (imam/hoca) yardımcısı gibi konuşan bir WhatsApp asistanısın.
Adın "${botName}".

Konuşma dili: Türkçe.
Üslup: sıcak, insani, sakin; gereksiz resmiyetten kaçın. Kısa cümleler kur.
Kullanıcıya hitap: saygılı ve samimi ("kardeşim" gibi), ama aşırıya kaçma.

ÖNEMLİ KURALLAR:
1) Fetva verme. "Bu konuda en sağlıklısı bir hocaya/din görevlisine danışmak" de.
2) Diyanet hassasiyetinde, genellemeleri "genel olarak" diye çerçevele.
3) Kullanıcı büyü/nazar/ailevi kriz/psikolojik zorlanma gibi hassas bir şey söylüyorsa: önce dinle, sakinleştir, sonra hocamızla görüşmeye yönlendir.
4) Tıbbi/psikolojik acil durum hissedersen: profesyonel yardım/112 öner.
5) Cevap uzunluğu: 4-8 cümle. Gereksiz ayrıntı yok.
6) Kaynak iddiası yapma ("kesin böyledir" yerine "genelde" / "çoğu alim" gibi).`;

    // Karakter (persona) desteği: panelden seçilen karakter promptu eklenir.
    // settings:
    // - characters_json: [{"id":"soft","name":"Sıcak & Samimi","prompt":"..."}]
    // - active_character_id: "soft"
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
          // Persona promptunu en sona ekle (daha etkili olur)
          const combined = (template || defaultPrompt) + `\n\nKARAKTER / ÜSLUP AYARI:\n${cPrompt}\n`;
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
   * İslami soruları cevapla (Hafıza destekli)
   */
  async answerIslamicQuestion(message, context = {}) {
    const { chatId, profile } = context;
    
    // Geçmiş mesajları al (Hafıza)
    let historyMessages = [];
    try {
      const history = await this.db.getChatHistory(chatId, 6);
      historyMessages = history.map(h => ({
        role: h.direction === "incoming" ? "user" : "assistant",
        content: h.content
      }));
    } catch (e) {
      // Hafıza alınamadı, devam et
    }

    const systemPrompt = await this.buildSystemPrompt(profile);

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          ...historyMessages,
          { role: "user", content: message }
        ],
        temperature: 0.65,
        max_tokens: 450
      });

      const answer = (response.choices[0].message.content || "").trim();

      return { reply: answer, action: "ai_response" };
    } catch (err) {
      console.error("AI Chat Hatası:", err.message);
      return { 
        reply: "Kardeşim şu an bir yoğunluk var, birazdan tekrar yazar mısın inşallah?",
        action: "ai_error"
      };
    }
  }

  /**
   * Fetva işle
   */
  async processFetva(question) {
    return { 
      reply: `Kardeşim bu konuda hocamızla görüşmen daha sağlıklı olacaktır. İstersen randevu oluşturabilirim.`,
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
        temperature: 0.7,
        max_tokens: 300
      });

      return response.choices[0].message.content;
    } catch (err) {
      console.error("Test hatası:", err.message);
      return "Test yanıtı oluşturulamadı.";
    }
  }

  /**
   * WhatsApp media (base64) sesli mesajı metne çevir.
   * OPENAI_API_KEY yoksa boş döner.
   */
  async transcribeVoiceMedia(media) {
    try {
      if (!process.env.OPENAI_API_KEY) return "";
      if (!media || !media.data || !media.mimetype) return "";

      // Node 22: fetch + FormData hazır
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
}

module.exports = { AIChatService };
