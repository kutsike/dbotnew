"use strict";

/**
 * MessageDelay - İnsansı Mesaj Gecikmeleri
 * 
 * Amaç:
 * - Gerçek bir insan gibi okuma ve yazma süreleri simüle etmek
 * - Çok hızlı veya çok yavaş olmamak
 * - Doğal varyasyonlar eklemek
 */

class MessageDelay {
  constructor(db) {
    this.db = db;

    // Varsayılan ayarlar (daha insansı)
    this.defaults = {
      read_delay_ms: 1500,           // Mesajı "okuma" süresi (taban)
      think_delay_ms: 1000,          // Cevap yazmaya başlamadan önce düşünme
      typing_speed_cps: 35,          // Karakter/saniye (ortalama insan hızı)
      min_delay_ms: 800,             // Minimum toplam gecikme
      max_delay_ms: 8000,            // Maksimum toplam gecikme
      random_delay_enabled: true,
      random_delay_percent: 0.25,    // ±%25 rastgele varyasyon
      
      // Yeni: Mesaj uzunluğuna göre ek okuma süresi
      read_per_char_ms: 12,          // Her karakter için ek okuma süresi
      
      // Yeni: Kısa mesajlar için minimum bekleme
      short_message_delay_ms: 500,   // Çok kısa mesajlar için ek bekleme
      short_message_threshold: 20    // "Kısa mesaj" karakter sınırı
    };
  }

  async _getNumber(key, fallback) {
    try {
      const v = await this.db.getSetting(key);
      if (v === null || v === undefined || v === "") return fallback;
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    } catch (e) {
      return fallback;
    }
  }

  async _getBool(key, fallback) {
    try {
      const v = await this.db.getSetting(key);
      if (v === null || v === undefined || v === "") return fallback;
      if (typeof v === "boolean") return v;
      return String(v).toLowerCase() === "true" || String(v) === "1" || String(v).toLowerCase() === "on";
    } catch (e) {
      return fallback;
    }
  }

  /**
   * Okuma gecikmesi: taban + mesaj uzunluğu
   */
  async calculateReadingDelay(message) {
    const base = await this._getNumber("read_delay_ms", this.defaults.read_delay_ms);
    const perChar = await this._getNumber("read_per_char_ms", this.defaults.read_per_char_ms);
    
    // Mesaj uzunluğuna göre ek süre (maksimum 3 saniye)
    const lengthBonus = Math.min(message.length * perChar, 3000);
    
    // Kısa mesajlar için minimum bekleme
    const shortThreshold = await this._getNumber("short_message_threshold", this.defaults.short_message_threshold);
    const shortDelay = await this._getNumber("short_message_delay_ms", this.defaults.short_message_delay_ms);
    const shortBonus = message.length < shortThreshold ? shortDelay : 0;
    
    return base + lengthBonus + shortBonus;
  }

  /**
   * Yazma gecikmesi: düşünme + yazma süresi
   */
  async calculateTypingDelay(response) {
    const think = await this._getNumber("think_delay_ms", this.defaults.think_delay_ms);
    const cps = await this._getNumber("typing_speed_cps", this.defaults.typing_speed_cps);
    
    // Yazma süresi (karakter sayısı / hız)
    const typing = (response.length / Math.max(cps, 10)) * 1000;
    
    return think + typing;
  }

  /**
   * Toplam gecikme hesapla
   */
  async calculateTotalDelay(message, response) {
    const minDelay = await this._getNumber("min_delay_ms", this.defaults.min_delay_ms);
    const maxDelay = await this._getNumber("max_delay_ms", this.defaults.max_delay_ms);

    const readingDelay = await this.calculateReadingDelay(message);
    const typingDelay = await this.calculateTypingDelay(response);
    let total = readingDelay + typingDelay;

    // Rastgele varyasyon
    const randomEnabled = await this._getBool("random_delay_enabled", this.defaults.random_delay_enabled);
    if (randomEnabled) {
      const pct = await this._getNumber("random_delay_percent", this.defaults.random_delay_percent);
      // -pct ile +pct arasında rastgele değişim
      const delta = (Math.random() * 2 - 1) * Math.max(0, pct);
      total = total * (1 + delta);
    }

    // Sınırlar içinde tut
    total = Math.max(minDelay, Math.min(maxDelay, total));
    
    return Math.round(total);
  }

  /**
   * Belirli süre bekle
   */
  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Gecikmeyi uygula
   */
  async applyDelay(message, response) {
    const delayMs = await this.calculateTotalDelay(message, response);
    await this.delay(delayMs);
    return delayMs;
  }

  /**
   * Typing göstergesi için süre hesapla
   * (WhatsApp'ta "yazıyor..." göstermek için)
   */
  async getTypingDuration(response) {
    const cps = await this._getNumber("typing_speed_cps", this.defaults.typing_speed_cps);
    const duration = (response.length / Math.max(cps, 10)) * 1000;
    
    // Minimum 1 saniye, maksimum 5 saniye
    return Math.max(1000, Math.min(5000, Math.round(duration)));
  }
}

module.exports = { MessageDelay };
