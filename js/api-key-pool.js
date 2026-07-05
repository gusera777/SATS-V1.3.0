/* ═══════════════════════════════════════════════════════════
   POOL API KEY BAWAAN (auto-switch)
   ─────────────────────────────────────────────────────────
   5 API key Twelve Data ditanam sebagai pool bawaan supaya app langsung bisa
   dipakai tanpa setup. Karena key ini dibagikan lewat kode sumber (terlihat via
   view-source, sama seperti API key client-side manapun), quota-nya dipakai
   bersama oleh semua orang yang menjalankan file ini — cukup untuk pemakaian
   ringan/personal, TAPI auto-switch di bawah ini yang membuatnya tetap jalan
   walau satu-dua key kena rate-limit duluan. Untuk pemakaian rutin/produksi,
   isi API key pribadi Anda sendiri di ⚙ Pengaturan — key pribadi selalu dicoba
   LEBIH DULU sebelum pool bawaan (lihat getApiKeyPool()). */
export const API_KEY_POOL = [
  'd8eb085a72984fdfa4effa40746458f5',
  'c6b8d923e13448e2aaa3401fcc57d003',
  '9dc53a7534c94008ab338ca174cec529',
  'aeae5c0d888042b9a374f6cc36334499',
  '17b2bb1a7191434d989bc757ea699f33',
];
export const DEFAULT_API_KEY = '';
