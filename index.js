"use strict";
require("dotenv").config(); // ← MUTLAKA EN ÜSTTE

const BotManager = require("./src/botManager");
const { startPanel } = require("./src/panel/server");

async function main() {
  try {
    console.log("\n🕌 Hocanın Yardımcısı - Final Version");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    // Bot yöneticisini başlat
    const manager = new BotManager({
      dataDir: process.env.DATA_DIR || "./data"
    });

    await manager.init();

    // Admin paneli başlat
    const panelPort = parseInt(process.env.PANEL_PORT || "3000");
    const panelHost = process.env.PANEL_HOST || "0.0.0.0";

    const { io } = startPanel({
      manager,
      port: panelPort,
      host: panelHost
    });

    // Socket.IO'yu manager'a bağla
    manager.setIO(io);

    console.log(`\n✅ Sistem başarıyla başlatıldı!`);
    console.log(`📊 Admin Paneli: http://${panelHost}:${panelPort}`);
    console.log(`🔑 Kullanıcı: ${process.env.ADMIN_USER || "admin"}`);
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  } catch (err) {
    console.error("❌ Başlatma hatası:", err);
    process.exit(1);
  }
}

// Hata yakalama
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

main();
