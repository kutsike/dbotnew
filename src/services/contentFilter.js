"use strict";

/**
 * ContentFilter - İnsansı Küfür Filtresi
 * 
 * Amaç:
 * - Uygunsuz içeriği tespit etmek
 * - Nazik ve yapıcı uyarılar vermek
 * - Kullanıcıyı kırmadan yönlendirmek
 */

class ContentFilter {
  constructor(db) {
    this.db = db;
    this.badWords = [];
    this.loadBadWords();
  }

  async loadBadWords() {
    try {
      this.badWords = await this.db.getBadWords();
    } catch (e) {
      // Varsayılan kelimeler
      this.badWords = [
        { word: "amk", severity: "high" },
        { word: "aq", severity: "high" },
        { word: "oç", severity: "high" },
        { word: "piç", severity: "high" },
        { word: "sik", severity: "high" },
        { word: "yarak", severity: "high" },
        { word: "göt", severity: "medium" },
        { word: "mal", severity: "low" },
        { word: "salak", severity: "low" },
        { word: "aptal", severity: "low" },
        { word: "gerizekalı", severity: "medium" },
        { word: "dangalak", severity: "low" },
        { word: "ahmak", severity: "low" }
      ];
    }
  }

  /**
   * Mesajı kontrol et
   */
  async check(message) {
    const lower = message.toLowerCase();
    
    for (const item of this.badWords) {
      // Kelime sınırlarını kontrol et (yanlış pozitiflerden kaçın)
      const regex = new RegExp(`\\b${this.escapeRegex(item.word)}\\b`, 'i');
      if (regex.test(lower) || lower.includes(item.word)) {
        return {
          found: true,
          word: item.word,
          severity: item.severity
        };
      }
    }
    
    return { found: false };
  }

  /**
   * Regex özel karakterlerini escape et
   */
  escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * İnsansı uyarı mesajı oluştur
   */
  async getResponse(checkResult, name = "kardeşim") {
    const { severity } = checkResult;
    
    // Veritabanından özel uyarı mesajı
    const customWarning = await this.db.getSetting("profanity_warning");
    
    if (customWarning) {
      return customWarning.replace("{name}", name);
    }
    
    // Seviyeye göre insansı uyarılar
    const responses = {
      high: [
        `${name} kardeşim, böyle konuşmak hiç yakışmıyor. Gel güzel konuşalım, derdini anlat dinleyeyim.`,
        `${name} kardeşim, bu kelimeler sana yakışmıyor. Sakin ol, ne oldu anlat bakalım.`,
        `Kardeşim ${name}, dilimizi temiz tutalım. Kötü söz söyleyen kendi nefsine zarar verir. Gel derdini anlat.`
      ],
      medium: [
        `${name} kardeşim, böyle konuşmasak daha iyi olur. Güzel söz sadakadır. Anlat bakalım ne oldu?`,
        `${name} kardeşim, biraz daha nazik olalım. Seni dinliyorum, ne var?`,
        `Kardeşim ${name}, bu üslup yakışmıyor sana. Sakin sakin konuşalım.`
      ],
      low: [
        `${name} kardeşim, biraz daha nazik olalım. Anlat bakalım, ne oldu?`,
        `${name} kardeşim, güzel konuşalım. Seni dinliyorum.`,
        `Kardeşim ${name}, sakin ol. Ne oldu, anlat.`
      ]
    };
    
    const list = responses[severity] || responses.medium;
    return list[Math.floor(Math.random() * list.length)];
  }

  /**
   * Mesajı temizle (opsiyonel - loglama için)
   */
  sanitize(message) {
    let sanitized = message;
    for (const item of this.badWords) {
      const regex = new RegExp(this.escapeRegex(item.word), 'gi');
      sanitized = sanitized.replace(regex, '*'.repeat(item.word.length));
    }
    return sanitized;
  }
}

module.exports = { ContentFilter };
