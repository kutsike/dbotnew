"use strict";

class MessageDelay {
  constructor(db) {
    this.db = db;

    // Varsayılanlar (ayarlar yoksa bunlar kullanılır)
    this.defaults = {
      read_delay_ms: 3000,           // mesajı "okuma" süresi (taban)
      think_delay_ms: 2000,          // cevap yazmaya başlamadan önce düşünme
      typing_speed_cps: 45,          // karakter/saniye
      min_delay_ms: 400,             // minimum toplam gecikme
      max_delay_ms: 12000,           // maksimum toplam gecikme
      random_delay_enabled: true,
      random_delay_percent: 0.30     // ±%30
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
   * Okuma gecikmesi: ayar + mesaj uzunluğu
   */
  async calculateReadingDelay(message) {
    const base = await this._getNumber("read_delay_ms", this.defaults.read_delay_ms);
    // Mesaj uzunluğuna göre küçük ekleme
    const extra = Math.min(message.length * 8, 2500);
    return base + extra;
  }

  /**
   * Yazma gecikmesi: düşünme + yazma süresi
   */
  async calculateTypingDelay(response) {
    const think = await this._getNumber("think_delay_ms", this.defaults.think_delay_ms);
    const cps = await this._getNumber("typing_speed_cps", this.defaults.typing_speed_cps);
    const typing = (response.length / Math.max(cps, 5)) * 1000;
    return think + typing;
  }

  async calculateTotalDelay(message, response) {
    const minDelay = await this._getNumber("min_delay_ms", this.defaults.min_delay_ms);
    const maxDelay = await this._getNumber("max_delay_ms", this.defaults.max_delay_ms);

    const readingDelay = await this.calculateReadingDelay(message);
    const typingDelay = await this.calculateTypingDelay(response);
    let total = readingDelay + typingDelay;

    const randomEnabled = await this._getBool("random_delay_enabled", this.defaults.random_delay_enabled);
    if (randomEnabled) {
      const pct = await this._getNumber("random_delay_percent", this.defaults.random_delay_percent);
      const delta = (Math.random() * 2 - 1) * Math.max(0, pct);
      total = total * (1 + delta);
    }

    total = Math.max(minDelay, Math.min(maxDelay, total));
    return Math.round(total);
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async applyDelay(message, response) {
    const delayMs = await this.calculateTotalDelay(message, response);
    await this.delay(delayMs);
    return delayMs;
  }
}

module.exports = { MessageDelay };
