"use strict";

/**
 * ConversationFlow v7.0 - Manevi Destek Arkadaşı
 *
 * DAVRANIŞLAR:
 * 1. HİÇ soru sorma, bilgi isteme
 * 2. Sadece dinle, empati göster, teselli et
 * 3. Derdine ortak ol, paylaş
 * 4. Soru sorarsa samimi cevap ver
 * 5. Çözüm noktaları ara, yol göster
 * 6. Dini/manevi destek ver
 */

class ConversationFlow {
  constructor(db, aiChat = null) {
    this.db = db;
    this.aiChat = aiChat;

    // Dua ve teselli ifadeleri
    this.comfortPhrases = [
      "Allah kolaylık versin",
      "Rabbim yardımcın olsun",
      "Allah hayırlısını nasip etsin",
      "Rabbim sıkıntını gidersin",
      "Allah gönlüne göre versin",
      "Sabır dilerim",
      "Her zorlukla beraber bir kolaylık var",
      "Allah'ın rahmeti geniştir",
      "Rabbim sana güç versin"
    ];

    // Sıcak hitaplar
    this.warmAddresses = ["kardeşim", "canım", "güzel kardeşim", "değerli kardeşim"];
  }

  // Rastgele teselli al
  getRandomComfort() {
    return this.comfortPhrases[Math.floor(Math.random() * this.comfortPhrases.length)];
  }

  // Rastgele hitap al
  getWarmAddress() {
    return this.warmAddresses[Math.floor(Math.random() * this.warmAddresses.length)];
  }

  // İnsansı yazım
  addHumanTouch(text) {
    if (!text) return text;
    if (Math.random() < 0.3) text = text.replace(/inşallah/gi, "insallah");
    if (Math.random() < 0.3) text = text.replace(/\bbir\b/g, "bi");
    if (Math.random() < 0.2) text = text.replace(/\bşey\b/g, "bişey");
    return text;
  }

  // Türkçe normalize
  normalizeTR(str) {
    return String(str || "").replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase().trim();
  }

  // Selamlama mı?
  isGreeting(msg) {
    const lower = this.normalizeTR(msg);
    const greetings = ["selam", "merhaba", "mrb", "slm", "sa", "as", "selamun", "hey", "iyi günler"];
    return greetings.some(g => lower.startsWith(g)) || (msg.length < 25 && greetings.some(g => lower.includes(g)));
  }

  // Soru mu?
  isQuestion(msg) {
    const lower = this.normalizeTR(msg);
    return lower.includes("?") || lower.includes("nasıl") || lower.includes("ne zaman") ||
           lower.includes("neden") || lower.includes("nerede") || lower.includes("kim") ||
           lower.includes("mi") || lower.includes("mı") || lower.includes("mu") || lower.includes("mü") ||
           lower.includes("ne yapmalı") || lower.includes("ne yapmam");
  }

  // Teşekkür mü?
  isThanks(msg) {
    const lower = this.normalizeTR(msg);
    return lower.includes("teşekkür") || lower.includes("sağol") || lower.includes("eyvallah") ||
           lower.includes("allah razı") || lower.includes("çok iyi");
  }

  // Veda mı?
  isGoodbye(msg) {
    const lower = this.normalizeTR(msg);
    return lower.includes("görüşürüz") || lower.includes("hoşçakal") || lower.includes("bye") ||
           lower.includes("allah'a emanet") || lower.includes("hayırlı günler");
  }

  // === ANA FONKSİYON ===
  async processMessage(chatId, clientId, message, context = {}) {
    const { name, profile } = context;
    const warmName = profile?.full_name?.split(" ")[0] || name || this.getWarmAddress();
    const msg = message.trim();

    // === SELAMLAMA ===
    if (this.isGreeting(msg)) {
      const reply = this.addHumanTouch(
        `Aleyküm selam ${this.getWarmAddress()}, hoş geldin. ` +
        `Nasılsın, anlat dinliyorum seni.`
      );
      return { reply, action: "greeting" };
    }

    // === TEŞEKKÜR ===
    if (this.isThanks(msg)) {
      const reply = this.addHumanTouch(
        `Estağfurullah ${warmName}. Ne demek, her zaman buradayım. ${this.getRandomComfort()}.`
      );
      return { reply, action: "thanks" };
    }

    // === VEDA ===
    if (this.isGoodbye(msg)) {
      const reply = this.addHumanTouch(
        `Allah'a emanet ol ${warmName}. İhtiyacın olursa yaz, buradayım. ${this.getRandomComfort()}.`
      );
      return { reply, action: "goodbye" };
    }

    // === SORU SORUYORSA ===
    if (this.isQuestion(msg)) {
      if (this.aiChat) {
        const aiReply = await this._answerQuestion(msg, warmName);
        if (aiReply) return { reply: this.addHumanTouch(aiReply), action: "answer" };
      }
      // AI yoksa basit cevap
      const reply = this.addHumanTouch(
        `${warmName}, bu konuda şunu söyleyebilirim - sabırla ve duayla yaklaş. ` +
        `${this.getRandomComfort()}.`
      );
      return { reply, action: "answer" };
    }

    // === DERT ANLATIYORSA (her türlü mesaj) ===
    if (this.aiChat) {
      const aiReply = await this._empathize(msg, warmName);
      if (aiReply) return { reply: this.addHumanTouch(aiReply), action: "empathy" };
    }

    // AI yoksa basit empati
    const reply = this.addHumanTouch(
      `Anlıyorum ${warmName}, zor bir durum. ${this.getRandomComfort()}. ` +
      `Yalnız değilsin, anlat dinliyorum.`
    );
    return { reply, action: "empathy" };
  }

  // AI: Soruya samimi cevap ver
  async _answerQuestion(msg, warmName) {
    if (!this.aiChat?.openai) return null;
    try {
      const resp = await this.aiChat.openai.chat.completions.create({
        model: this.aiChat.model,
        messages: [{
          role: "system",
          content: `Sen manevi destek veren, dertlere ortak olan bir arkadaşsın.

KURALLAR:
- Samimi ve sıcak ol, "${warmName}" diye hitap et
- Kısa cevap ver (2-3 cümle max)
- Çözüm odaklı ol, yol göster
- Dini/manevi tavsiyeler ver (dua, sabır, tevekkül)
- Asla soru sorma, bilgi isteme
- Teselli et, umut ver
- "Allah", "insallah", "dua" gibi ifadeler kullan`
        }, {
          role: "user",
          content: msg
        }],
        temperature: 0.8,
        max_tokens: 120
      });
      return resp.choices[0]?.message?.content?.trim() || null;
    } catch { return null; }
  }

  // AI: Empati göster, derdine ortak ol
  async _empathize(msg, warmName) {
    if (!this.aiChat?.openai) return null;
    try {
      const resp = await this.aiChat.openai.chat.completions.create({
        model: this.aiChat.model,
        messages: [{
          role: "system",
          content: `Sen manevi destek veren, dertlere ortak olan bir arkadaşsın.

KURALLAR:
- "${warmName}" diye hitap et, samimi ol
- Kısa cevap ver (2-3 cümle max)
- Empati göster, dinlediğini hissettir
- Derdini paylaş, yalnız olmadığını söyle
- Teselli et, moral ver
- Çözüm noktaları öner (dua, sabır, pozitif bakış)
- ASLA soru sorma, bilgi isteme
- Dini ifadeler kullan (Allah, dua, sabır, rahmet)
- Umut ver, karamsarlığa izin verme`
        }, {
          role: "user",
          content: msg
        }],
        temperature: 0.85,
        max_tokens: 150
      });
      return resp.choices[0]?.message?.content?.trim() || null;
    } catch { return null; }
  }
}

module.exports = { ConversationFlow };
