# Hocanın Yardımcısı - WhatsApp Bot Final

Diyanet tarzı WhatsApp bot sistemi. Çoklu bot desteği, AI entegrasyonu, modern admin paneli.

## Özellikler

### Bot Özellikleri
- ✅ Doğal sohbet akışı ile bilgi toplama
- ✅ Çoklu WhatsApp numara desteği
- ✅ OpenAI entegrasyonu (opsiyonel)
- ✅ Küfür filtresi ve nazik uyarı
- ✅ Arama isteği yanıtı
- ✅ Bot dondurma/çözme ve yönlendirme
- ✅ Admin devralma (takeover) özelliği
- ✅ Randevu sistemi

### Toplanan Bilgiler
- Ad Soyad
- Telefon
- Şehir
- Anne Adı
- Doğum Tarihi
- Konu/Sorun

### Admin Panel
- Modern koyu tema tasarım
- Dashboard istatistikleri
- Canlı sohbet izleme
- Randevu yönetimi
- Bot yönetimi (QR kod, dondurma)
- Profil yönetimi
- Dua yönetimi
- Ayarlar

## Kurulum

### Gereksinimler
- Node.js 18+
- MySQL 8+
- Chrome/Chromium (WhatsApp Web için)

> Not: Bot, mesaj göndermeden önce "yazıyor..." durumunu gösterip küçük bir gecikme uygular (insansı akış). Aynı sohbette üst üste gelen mesajlar da sıraya alınır.

### Adımlar

1. **Dosyaları yükleyin:**
```bash
unzip diyanet-bot-final.zip
cd diyanet-bot-final
```

2. **Bağımlılıkları yükleyin:**
```bash
npm install
```

3. **Ortam değişkenlerini ayarlayın:**
```bash
cp .env.example .env
nano .env
```

**Ubuntu / Debian için Chromium kurulumu (önerilen):**
```bash
sudo apt update
sudo apt install -y chromium-browser
```

Ardından `.env` içinde `PUPPETEER_EXECUTABLE_PATH` tanımlayın (örnek):
```env
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
```

4. **MySQL veritabanı oluşturun:**
```sql
CREATE DATABASE diyanetbot CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'diyanetbot'@'localhost' IDENTIFIED BY 'your_password';
GRANT ALL PRIVILEGES ON diyanetbot.* TO 'diyanetbot'@'localhost';
FLUSH PRIVILEGES;
```

5. **Başlatın:**
```bash
npm start
```

6. **PM2 ile çalıştırın (önerilen):**
```bash
npm install -g pm2
pm2 start index.js --name diyanet-bot
pm2 save
pm2 startup
```

## Yapılandırma

### .env Dosyası

```env
# MySQL
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=diyanetbot
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=diyanetbot

# OpenAI (Opsiyonel)
OPENAI_API_KEY=sk-your-api-key
AI_MODEL=gpt-4o-mini

# Chromium / Chrome (WhatsApp Web için)
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Panel
PANEL_PORT=3000
PANEL_HOST=0.0.0.0
ADMIN_USER=admin
ADMIN_PASS=diyanet123

# Veri Dizini
DATA_DIR=./data

# Chromium / Chrome (Opsiyonel ama sunucuda önerilir)
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
```

### İnsansı cevaplar (AI + Prompt Yönetimi)
AI açıkken botun üslubunu ve kurallarını panelden yönetebilirsiniz:

1) Panel → **Ayarlar** sayfasında `ai_system_prompt` değerini düzenleyin.
2) Kullanabileceğiniz değişkenler: `{bot_name}`, `{full_name}`, `{city}`, `{phone}`
3) Öneri: "fetva verme", "kısa cevap" gibi kuralları promptta net tutun.

## Kullanım

### Panel Erişimi
```
http://sunucu-ip:3000
Kullanıcı: admin
Şifre: diyanet123
```

### Bot Komutları
- `!menu` - Menüyü göster
- `!namaz [şehir]` - Namaz vakitleri
- `!dua` - Rastgele dua
- `!fetva [soru]` - Fetva arama
- `!temsilci` - Hocayla görüşme talebi

## İnsansı Cevaplar (AI)

- OpenAI anahtarı tanımlıysa bot, konuşma geçmişinin son birkaç mesajını hatırlayarak daha doğal yanıt verir.
- Sistem promptu admin panelinden **Ayarlar** sayfasındaki `ai_system_prompt` ile değiştirilebilir.
- Varsayılan prompt *fetva vermeme* ve hassas konularda *hocaya yönlendirme* kurallarını içerir.

## Dosya Yapısı

```
diyanet-bot-final/
├── index.js              # Ana giriş noktası
├── package.json
├── .env.example
├── README.md
├── data/                 # Veri dizini
│   ├── sessions/         # WhatsApp oturumları
│   └── media/            # Medya dosyaları
├── logs/                 # Log dosyaları
└── src/
    ├── db.js             # Veritabanı modülü
    ├── botManager.js     # Bot yöneticisi
    ├── router.js         # Mesaj yönlendirici
    ├── services/
    │   ├── aiChat.js         # AI Chat servisi
    │   ├── conversationFlow.js # Sohbet akışı
    │   ├── contentFilter.js   # Küfür filtresi
    │   └── messageDelay.js    # Mesaj gecikmesi
    └── panel/
        ├── server.js     # Panel sunucusu
        ├── public/
        │   ├── css/style.css
        │   └── js/app.js
        └── views/
            ├── partials/
            │   ├── header.ejs
            │   └── footer.ejs
            ├── dashboard.ejs
            ├── chats.ejs
            ├── appointments.ejs
            ├── bots.ejs
            ├── profiles.ejs
            ├── duas.ejs
            └── settings.ejs
```

## Sorun Giderme

### QR Kod Görünmüyor
- Chrome/Chromium kurulu olduğundan emin olun
- `data/sessions` klasörünü silip yeniden başlatın

### Bot Mesajlara Cevap Vermiyor
- Logları kontrol edin: `pm2 logs diyanet-bot`
- MySQL bağlantısını kontrol edin
- Bot durumunun "ready" olduğundan emin olun

### Panel Açılmıyor
- Port'un açık olduğundan emin olun
- Firewall ayarlarını kontrol edin

## Lisans

MIT License
