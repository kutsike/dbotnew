"use strict";

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
        { word: "aptal", severity: "low" }
      ];
    }
  }

  /**
   * Mesajı kontrol et
   */
  async check(message) {
    const lower = message.toLowerCase();
    
    for (const item of this.badWords) {
      if (lower.includes(item.word)) {
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
   * Uyarı mesajı oluştur
   */
  async getResponse(checkResult, name = "kardeşim") {
    const { severity } = checkResult;
    
    // Veritabanından uyarı mesajını al
    const customWarning = await this.db.getSetting("profanity_warning");
    
    if (customWarning) {
      return customWarning.replace("{name}", name);
    }
    
    // Varsayılan mesajlar
    const responses = {
      high: `${name}, lütfen güzel konuşalım. Dilimizi temiz tutalım inşallah. Kötü söz söyleyen kişi, kendi nefsine zarar verir.`,
      medium: `${name}, böyle konuşmak yakışmaz kardeşim. Güzel söz sadakadır.`,
      low: `${name}, biraz daha nazik olalım kardeşim.`
    };
    
    return responses[severity] || responses.medium;
  }
}

module.exports = { ContentFilter };
