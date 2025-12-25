# 🤖 İnsansı Karşılama Asistanı Dönüşümü

Bu güncelleme ile WhatsApp botunuz profesyonel ve insansı bir karşılama asistanına dönüştürüldü.

## 📋 Yapılan Değişiklikler

### 1. AI Chat Servisi (`src/services/aiChat.js`)

**Yeni Sistem Promptu:**
- Daha doğal ve sıcak üslup
- Kısa ve öz cevaplar (2-5 cümle)
- Empati odaklı iletişim
- Hassas konularda uygun yönlendirme

**Yeni Özellikler:**
- `generateGreeting()` - Saat bazlı selamlama (günaydın/iyi günler/iyi akşamlar)
- `detectEmotion()` - Basit duygu analizi
- `getEmpatheticPrefix()` - Duyguya göre empati cümlesi
- Geliştirilmiş hata mesajları (insansı fallback)

### 2. Conversation Flow (`src/services/conversationFlow.js`)

**İnsansı Karşılama:**
- Saat bazlı selamlama varyasyonları
- Her soru için 3+ farklı varyasyon
- Tekrar soru sormayı önleme mekanizması
- Alternatif soru formatları

**Geliştirilmiş Bilgi Çıkarma:**
- Daha geniş şehir listesi (60+ şehir)
- Çoklu telefon formatı desteği
- Bağlamsal isim/şehir algılama
- Yaş ve doğum tarihi çeşitli formatları

### 3. Content Filter (`src/services/contentFilter.js`)

**Nazik Uyarılar:**
- Seviyeye göre 3'er farklı uyarı mesajı
- Yapıcı ve yönlendirici üslup
- Kullanıcıyı kırmadan düzeltme

### 4. Message Delay (`src/services/messageDelay.js`)

**Gerçekçi Gecikmeler:**
- Mesaj uzunluğuna göre okuma süresi
- Doğal yazma hızı (35 karakter/saniye)
- Kısa mesajlar için minimum bekleme
- ±%25 rastgele varyasyon

### 5. Router (`src/router.js`)

**İnsansı Mesaj İşleme:**
- Tüm komutlarda isim kullanımı
- Hata mesajlarında çeşitlilik
- Yönlendirme mesajlarında varyasyon
- Sesli mesaj transcribe desteği

### 6. Bot Manager (`src/botManager.js`)

**Yeni Karakter Seçenekleri:**

| ID | İsim | Açıklama |
|---|---|---|
| `warm` | Sıcak & Samimi | Kardeşim hitabı, içten üslup |
| `professional` | Profesyonel | Siz hitabı, iş odaklı |
| `empathetic` | Empatik Dinleyici | Duygu odaklı, sakinleştirici |
| `wise` | Bilge & Sakin | Az ama öz, hikmetli |
| `friendly` | Arkadaş Canlısı | Enerjik, pozitif |

## 🎯 Örnek Mesaj Karşılaştırması

### Eski Üslup:
```
"Merhaba, size nasıl yardımcı olabilirim?"
"Talebiniz alınmıştır. En kısa sürede dönüş yapılacaktır."
```

### Yeni Üslup:
```
"Günaydın Ahmet kardeşim, hoş geldin! Nasılsın bugün?"
"Tamam Ahmet kardeşim, not aldım. Hocamız müsait olunca hemen döneriz sana."
```

## ⚙️ Admin Panel Ayarları

Panelden şu ayarları özelleştirebilirsiniz:

- `ai_system_prompt` - AI'ın ana davranış kuralları
- `characters_json` - Karakter listesi
- `active_character_id` - Aktif karakter
- `greeting` - Özel karşılama mesajı
- `handoff_message` - Hocaya yönlendirme mesajı
- `profile_complete_message` - Profil tamamlanma mesajı

## 🔄 Geriye Uyumluluk

Tüm mevcut fonksiyonlar geriye uyumlu şekilde güncellendi. Eski kod çağrıları çalışmaya devam edecektir.

## 📝 Notlar

- Bot artık daha kısa ve öz cevaplar veriyor
- Emoji kullanımı minimuma indirildi
- Her mesaj varyasyonu rastgele seçiliyor (tekrar önleme)
- Duygu analizi basit anahtar kelime bazlı çalışıyor

---

*Güncelleme Tarihi: 25 Aralık 2025*
