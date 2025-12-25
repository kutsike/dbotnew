"use strict";

class MessageDelay {
  constructor(db) {
    this.db = db;
  }

  /**
   * Mesaj için gereken tüm gecikmeleri hesaplar
   */
  async calculateDelays(incomingText, outgoingText) {
    // Ayarları çek
    const configStr = await this.db.getSetting("humanization_config");
    let config = {
      enabled: true,
      min_response_delay: 60,
      max_response_delay: 600,
      wpm_reading: 200,
      cpm_typing: 300,
      long_message_threshold: 150,
      long_message_extra_delay: 60,
      typing_variance: 20
    };

    try {
      if (configStr) Object.assign(config, JSON.parse(configStr));
    } catch (e) {}

    if (!config.enabled) {
      return { readDelay: 0, typeDelay: 0, totalDelay: 0 };
    }

    // 1. OKUMA SÜRESİ (Gelen mesaja göre)
    const wordCount = incomingText.trim().split(/\s+/).length;
    // Dakikada okunan kelime sayısına göre saniye cinsinden süre
    let readTime = (wordCount / config.wpm_reading) * 60; 
    
    // Uzun mesaj bonusu
    if (incomingText.length > config.long_message_threshold) {
      readTime += parseInt(config.long_message_extra_delay);
    }

    // 2. RASTGELE BEKLEME (1-10 dk arası gibi)
    const min = parseInt(config.min_response_delay);
    const max = parseInt(config.max_response_delay);
    const randomWait = Math.floor(Math.random() * (max - min + 1)) + min;

    // 3. YAZMA SÜRESİ (Gidecek cevaba göre)
    const charCount = outgoingText.length;
    // Dakikadaki karakter hızına göre saniye
    let typeTime = (charCount / config.cpm_typing) * 60;
    
    // Yazma hızına biraz varyasyon kat (çok robotik olmasın)
    const variance = (Math.random() * config.typing_variance * 2 - config.typing_variance) / 100;
    typeTime = typeTime * (1 + variance);

    // Minimum yazma süresi (çok kısa cevaplar için)
    if (typeTime < 2) typeTime = 2;

    return {
      readDelay: Math.floor((readTime + randomWait) * 1000), // Okuma + Boş Boş Bekleme (ms)
      typeDelay: Math.floor(typeTime * 1000),                // "Yazıyor..." süresi (ms)
      debug: { readTime, randomWait, typeTime }
    };
  }

  // Basit bekleme fonksiyonu
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { MessageDelay };