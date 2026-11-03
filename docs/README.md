# Dokumentasi Algorithmics Face Recognation

Indeks seluruh dokumentasi proyek. Kalau baru pertama kali menyentuh proyek ini,
mulai dari **[HANDOFF.md](../HANDOFF.md)**, lalu kembali ke sini untuk detail.

| Dokumen | Isi | Untuk siapa |
| --- | --- | --- |
| [HANDOFF.md](../HANDOFF.md) | Titik masuk: status, keputusan, risiko, langkah lanjutan | Engineer/AI yang melanjutkan pekerjaan |
| [README.md](../README.md) | Build, konfigurasi production, hardening, deployment dan operasi | Operator |
| [API.md](../API.md) | Kontrak API JSON, fragment `/partials/*`, format error, HMAC perangkat | Integrator (perangkat, klien lain) |
| [architecture.md](architecture.md) | Komponen, alur data, batas kepercayaan, ADR, invarian | Perancang/peninjau teknis |
| [code-guide.md](code-guide.md) | Penjelasan kode per lapisan dan alur request | Engineer pemelihara |
| [database.md](database.md) | Koleksi MongoDB, index, seed, aturan waktu, operasi `mongosh`, backup | Developer & operator |
| [devices.md](devices.md) | Firmware absensi, commissioning perangkat, protokol ping & scan, troubleshooting | Operator perangkat |
| [face-service.md](face-service.md) | Integrasi Go ↔ face service Python (enrollment, pencocokan, konfigurasi) dan penyimpanan foto di Garage (§8) | Pengembang backend & ML |
| [SRS.md](SRS.md) | Kebutuhan fungsional & non-fungsional dengan status implementasi | Penyusun SRS / kebutuhan formal |
| [diagram.excalidraw](diagram.excalidraw) | Tahapan proyek, arsitektur, alur enrollment & scan (buka di excalidraw.com atau ekstensi VS Code) | Semua |

## Peta cepat

```text
cmd/server/main.go          entry point, routing, middleware chain, bootstrap akun
internal/api/server.go      endpoint JSON + query ber-scope role + domain method
internal/api/admin.go       hapus mahasiswa, buat & hapus akun dosen
internal/api/scan.go        scan perangkat (multi-frame, HMAC, konsensus frame)
internal/controller/        web.go (halaman), partials.go + admin_partials.go (fragment htmx), auth.go (login)
internal/model/page.go      view model halaman
internal/security/          session, principal, CSRF, rate limit, CSP, panic recovery
internal/store/             database.go (koneksi MongoDB, index, seed), users.go (akun staf)
views/                      layouts/, pages/, partials/, fragments/, login.html
static/css|js               aset; htmx + Lucide di-vendor lokal
devices/esp32_scanner/      firmware ESP32 utama (sensor, layar, buzzer, scan, heartbeat)
devices/esp32cam_uart/      firmware ESP32-CAM (foto lewat UART)
devices/esp32cam_wifi/ firmware kamera Wi-Fi alternatif untuk commissioning
services/face/              face service Python (SCRFD + ArcFace, FastAPI)
internal/api/face.go        klien face service + pencocokan cosine di Go
internal/api/images.go      foto wajah: unggah, otorisasi & stream, retensi
internal/storage/s3.go      klien S3 (Garage) dengan pustaka standar
docs/                       dokumentasi (Anda di sini)
.env.example                templat konfigurasi production
```

## Pertanyaan umum → dokumen

| Saya ingin… | Baca |
| --- | --- |
| membangun dan deploy aplikasi | [README.md](../README.md) §Mulai cepat |
| menambah halaman atau endpoint | [code-guide.md](code-guide.md) §7 |
| mengubah/menambah field data | [database.md](database.md) §8 |
| membuat akun dosen & memilih kelasnya | halaman `/akses` ([README.md](../README.md) §Keamanan akun staf) |
| mengubah kelas dosen yang sudah ada | [database.md](database.md) §6 (`mongosh`) |
| menghapus mahasiswa beserta data wajahnya | [database.md](database.md) §5a |
| merakit & mem-flash perangkat absensi | [devices.md](devices.md) §2 |
| memahami protokol kamera ↔ ESP32 | [devices.md](devices.md) §3 |
| commissioning firmware perangkat | [devices.md](devices.md) §2 |
| membangun face service | [face-service.md](face-service.md) |
| menyimpan/melihat foto wajah (Garage) | [face-service.md](face-service.md) §8, [API.md](../API.md) `GET /api/v1/images` |
| tahu batasan dan risiko produksi | [HANDOFF.md](../HANDOFF.md) |

## Konvensi penulisan dokumen

- Bahasa: Indonesia, istilah teknis dipertahankan apa adanya.
- Semua klaim tentang kode dapat dilacak ke berkas/fungsi; sebutkan nama
  berkas saat merujuk perilaku.
- Bedakan jelas antara **yang sudah ada di kode** dan **usulan/belum ada**.
  Dokumen di folder ini menandai status dengan `[TERSEDIA]`, `[SEBAGIAN]`,
  `[BELUM]`.
- Bila kode berubah, perbarui dokumen terkait pada perubahan yang sama dan
  catat tanggalnya di bagian status `HANDOFF.md`.
