# Handoff Operasional — Algorithmics Face Recognation

Dokumen ringkas untuk operator dan engineer yang melanjutkan pemeliharaan
aplikasi absensi wajah ITBJH. Produk menyediakan dashboard staf, backend Go,
face service internal berbasis Python, penyimpanan MongoDB, dan firmware
perangkat absensi.

## Status dan Batasan Deployment

Aplikasi hanya mendukung konfigurasi production. Sebelum menyalakan layanan:

- Set `APP_ENV=production`.
- Isi `MONGODB_URI`; URI tidak boleh kosong.
- Isi `CSRF_SECRET`, `DEVICE_TOKEN`, dan `FACE_SERVICE_TOKEN` dengan secret
  acak minimal 32 karakter. Go dan face service harus memakai nilai
  `FACE_SERVICE_TOKEN` yang sama.
- Siapkan akun administrator awal memakai `BOOTSTRAP_ADMIN_USERNAME` dan
  `BOOTSTRAP_ADMIN_PASSWORD`. Bootstrap hanya membuat akun bila belum ada
  administrator aktif. `BOOTSTRAP_RESET_PASSWORDS` tidak didukung.
- Terminasi HTTPS pada reverse proxy dan batasi jaringan face service ke
  backend. Face service memerlukan bearer token pada setiap endpoint; jangan
  mengekspos port-nya ke jaringan publik.
- Semua heartbeat perangkat wajib memakai `DEVICE_TOKEN`. Health endpoint
  bersifat read-only dan tidak mendaftarkan atau memperbarui perangkat.

Rincian konfigurasi dan langkah deployment terdapat di [README.md](README.md).
Contoh variabel ada di [.env.example](.env.example); jangan menyimpan secret
produksi ke Git.

## Fungsi yang Tersedia

- Login staf berbasis session, role administrator/dosen, CSRF, rate limit
  login, dan pembatasan data dosen menurut kelas.
- Dashboard, roster mahasiswa, kelas, laporan, log scan, pengelolaan akun
  dosen, dan enrollment 1–6 foto per mahasiswa.
- Backend Go memanggil Python untuk embedding; Go menyimpan template ke
  MongoDB dan melakukan pencocokan cosine.
- Perangkat mengirim scan multi-frame dengan bearer token dan HMAC-SHA256.
  Heartbeat menggunakan bearer token.
- Foto enrollment dan bukti scan dapat disimpan secara opsional di Garage
  melalui konfigurasi S3.

## Arsitektur dan Dokumen Rujukan

| Area | Rujukan |
| --- | --- |
| Instalasi, environment, operasi dan checklist | [README.md](README.md) |
| Endpoint HTTP dan autentikasi | [API.md](API.md) |
| Komponen, alur data, dan konfigurasi | [docs/architecture.md](docs/architecture.md) |
| Koleksi, index, dan operasi MongoDB | [docs/database.md](docs/database.md) |
| Firmware absensi dan commissioning perangkat | [docs/devices.md](docs/devices.md) |
| Integrasi dan deployment face service | [docs/face-service.md](docs/face-service.md) |
| Struktur dan tanggung jawab kode | [docs/code-guide.md](docs/code-guide.md) |
| Kebutuhan produk dan status implementasi | [docs/SRS.md](docs/SRS.md) |

Alur request utama:

1. Staf masuk melalui backend Go dan memakai dashboard HTML/htmx.
2. Administrator mendaftarkan mahasiswa dan mengirim foto enrollment; Go
   meneruskan foto ke endpoint Python `/register`.
3. ESP32 utama mengambil frame dari ESP32-CAM melalui UART dan mengirim scan
   bertanda tangan ke Go.
4. Go meneruskan frame ke Python `/embed`, membandingkan embedding dengan
   template di MongoDB, lalu menyimpan hasil scan.

## Perangkat dan Commissioning

Firmware utama untuk pemakaian absensi adalah `devices/esp32_scanner` bersama
`devices/esp32cam_uart`. Commissioning kabel, catu daya, kamera, token, dan
hasil scan wajib dilakukan sebelum pemasangan.

Firmware ESP32-CAM Wi-Fi, kamera stream, ESP8266 heartbeat, serta sketch
ultrasonik/buzzer adalah alat commissioning/diagnostik, bukan konfigurasi
runtime produksi. Mode kamera Wi-Fi memakai HTTP tanpa TLS dan tidak untuk
jaringan produksi. Lihat [docs/devices.md](docs/devices.md) untuk prosedur
dan batasan keamanan perangkat.

Konsensus beberapa frame bukan liveness detection. Foto atau video replay
masih dapat lolos; jangan menganggap hasil identifikasi sebagai bukti
anti-spoof. Ambang kecocokan juga perlu dikalibrasi dengan data yang sah dan
persetujuan institusi sebelum penggunaan operasional.

## Operasi dan Risiko yang Belum Dituntaskan

- Test otomatis sengaja tidak disertakan dalam repository. Jalankan build dan
  pemeriksaan statis sebelum rilis; lakukan commissioning perangkat dan
  verifikasi deployment sesuai prosedur operasional.
- Session store dan login rate limiter berada di memori proses; multi-instance
  memerlukan penyimpanan bersama.
- HTTPS/TLS, hardening MongoDB, enkripsi serta pengujian backup, rotasi token
  perangkat, persetujuan biometrik, dan kebijakan retensi harus ditetapkan
  operator/institusi.
- Penghapusan mahasiswa menghapus template, foto terkait, dan riwayat scan;
  pastikan proses penghapusan sesuai kebijakan penyimpanan/backup institusi.
- Template hasil model recognition yang berbeda tidak dijamin sebanding;
  rencanakan enrollment ulang bila model recognition diganti.

Sebelum perubahan, periksa `git status` dan pertahankan perubahan lokal yang
tidak terkait. Jangan membaca, menyalin, atau mengubah `.env` lokal tanpa
permintaan eksplisit.
