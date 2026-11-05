![svc by algorithmics](https://proxy-assets.etherthink.xyz/algorithmics/methiccs.webp)
# Algorithmics Face Recognation

Sistem absensi mahasiswa berbasis pengenalan wajah untuk Institut Teknologi
Bacharuddin Jusuf Habibie (ITBJH).

Satu aplikasi Go (halaman server-rendered + htmx dan API JSON) dengan MongoDB,
perangkat ESP8266/ESP32 sebagai pemindai, face service Python internal
untuk deteksi wajah & embedding, dan (opsional) object storage S3 Garage untuk
foto wajah.

Untuk orientasi cepat AI/kontributor berikutnya, mulai dari
[HANDOFF.md](HANDOFF.md): status, keputusan, batasan, dan prioritas lanjutan.

## Status singkat

| Komponen | Status |
| --- | --- |
| Backend Go + dashboard staf (login, ringkasan, mahasiswa, kelas, laporan, log, akses) | berjalan |
| Administrasi: tambah/hapus mahasiswa, buat/hapus akun dosen | berjalan (administrator) |
| Pengelolaan kelas: tambah/hapus kelas | berjalan (administrator dan dosen; penghapusan diblokir bila kelas masih dipakai) |
| MongoDB (index + seed kelas/perangkat otomatis) | berjalan |
| Firmware perangkat absensi ESP32 + ESP32-CAM (UART) (`devices/esp32_scanner`, `devices/esp32cam_uart`) | tersedia; commissioning perangkat keras wajib sebelum pemasangan |
| Firmware tambahan | alat commissioning perangkat, tidak termasuk runtime server |
| Face service Python (`services/face`, SCRFD + ArcFace) | ada; terhubung ke Go untuk enrollment & scan ([docs/face-service.md](docs/face-service.md)) |
| Penyimpanan foto wajah di Garage (S3) + retensi otomatis | ada, opsional (`S3_*`); tautan foto di halaman Log |
| Operasi aplikasi | production-only |

## Dokumentasi

| Dokumen | Isi |
| --- | --- |
| [docs/README.md](docs/README.md) | indeks seluruh dokumentasi |
| [HANDOFF.md](HANDOFF.md) | status, keputusan, risiko, langkah lanjutan |
| [API.md](API.md) | kontrak API JSON, fragment `/partials/*`, format error, HMAC perangkat |
| [docs/architecture.md](docs/architecture.md) | arsitektur, batas kepercayaan, ADR |
| [docs/code-guide.md](docs/code-guide.md) | penjelasan kode per lapisan dan resep tugas umum |
| [docs/database.md](docs/database.md) | koleksi MongoDB, index, seed, waktu, backup |
| [docs/devices.md](docs/devices.md) | firmware absensi, commissioning perangkat, protokol ping & scan, troubleshooting |
| [docs/face-service.md](docs/face-service.md) | integrasi face service Python dan penyimpanan foto (Garage) |
| [docs/diagram.excalidraw](docs/diagram.excalidraw) | diagram tahapan proyek, arsitektur, alur enrollment & scan |
| [docs/SRS.md](docs/SRS.md) | kebutuhan fungsional & non-fungsional |

## Struktur proyek

```text
cmd/server/main.go        entry point: env, routing, middleware, bootstrap akun, shutdown
internal/api/             endpoint JSON, query ber-scope role, logika domain,
                          klien face service (face.go), foto wajah (images.go),
                          fitur administrator (admin.go), scan multi-frame & HMAC (scan.go)
internal/storage/         klien S3 untuk Garage (pustaka standar, SigV4)
internal/controller/      halaman (web.go), fragment htmx (partials.go, admin_partials.go), login (auth.go)
internal/model/           view model halaman
internal/security/        session, principal, CSRF, rate limit login, CSP, recover
internal/store/           koneksi MongoDB, index, seed, akun staf
views/                    template html/template (layouts, pages, partials, fragments)
static/                   CSS, JS, htmx & Lucide yang di-vendor lokal
devices/                  firmware Arduino: esp32_scanner (perangkat absensi), esp32cam_uart (kamera),
                          firmware commissioning perangkat
services/face/            face service Python (FastAPI: deteksi wajah + embedding ArcFace)
docs/                     dokumentasi
```

## Mulai cepat

Kebutuhan deployment: **Go 1.23+** untuk build, Docker Compose untuk face
service, dan MongoDB produksi dengan autentikasi serta TLS sesuai topologi.

```powershell
Copy-Item .env.example .env
# Isi semua secret wajib dan URI MongoDB produksi dalam .env.
go mod download
go build -trimpath -ldflags="-s -w" -o bin/methics.exe ./cmd/server
docker compose --env-file .env -f services/face/docker-compose.yml up -d --build
.\bin\methics.exe
```

Pastikan face service, MongoDB, dan reverse proxy TLS siap sebelum membuka
aplikasi. Go menolak start bila `APP_ENV` bukan `production`, URI MongoDB
belum diisi, atau secret wajib kurang dari 32 karakter. Akun administrator
pertama dibuat dari `BOOTSTRAP_ADMIN_*`; hapus secret bootstrap setelah akun
berhasil dibuat. Jalankan binary dari direktori yang berisi `views/` dan
`static/`, atau atur `VIEW_DIR`/`STATIC_DIR`.

Nilai acak 32+ karakter bisa dibuat dengan `openssl rand -hex 32` atau di
PowerShell:

```powershell
-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 40 | % {[char]$_})
```

`.env` dimuat saat startup (`godotenv.Overload`) dan menimpa environment proses
dengan nama variabel yang sama. Jika `.env` tidak tersedia, konfigurasi harus
diberikan melalui environment proses. Gunakan berkas tanpa BOM dan batasi
aksesnya hanya untuk akun layanan.

### Build dan deployment

```powershell
go vet ./...
go build -trimpath -ldflags="-s -w" -o bin/methics.exe ./cmd/server
```

Binary membaca `views/` dan `static/` dari direktori kerja (atau dari
`VIEW_DIR`/`STATIC_DIR`); salin kedua folder bersama binary. Terminasi TLS,
HSTS, pembatasan ukuran/rate di edge, serta firewall adalah tanggung jawab
reverse proxy dan infrastruktur deployment.

## Halaman

| Route | Isi | Akses |
| --- | --- | --- |
| `/` | ringkasan absensi hari ini, status perangkat & face service | staf |
| `/mahasiswa` | roster, pendaftaran & penghapusan mahasiswa, enrollment wajah 1–6 foto langsung dari kamera perangkat, lihat foto enrollment | staf (aksi tulis: administrator) |
| `/kelas` | kehadiran dan enrollment per kelas; tambah/hapus kelas | staf (pengelolaan kelas: administrator dan dosen) |
| `/laporan` | rekap status scan hari ini, kehadiran per kelas, 50 scan terbaru, cetak | staf |
| `/logs` | log pemindaian seluruh waktu (200 terbaru) dengan filter status, kelas, pencarian, dan tautan foto capture | staf |
| `/akses` | buat & hapus akun dosen, daftar akun staf, matriks role | administrator |
| `/login` | login staf | publik |
| `/eggs` | halaman putih; ketuk gambar telur untuk memutar musik | publik |

Di halaman Mahasiswa, administrator diminta memberi izin kamera saat menekan
Enroll wajah. Kamera hanya aktif selama dialog enrollment digunakan; browser,
izin per-origin, Permissions-Policy, dan HTTPS dengan sertifikat valid
menentukan akses perangkat.

Dosen hanya melihat kelas yang ditugaskan (`users.class_ids`). Dosen yang
membuat kelas otomatis mendapat penugasan kelas itu; penghapusan hanya tersedia
untuk kelas dalam cakupannya dan ditolak selama masih dipakai mahasiswa,
perangkat, riwayat scan, atau akun staf lain. Filter kelas di Mahasiswa dan Log
diambil dari database. Halaman dirender Go dengan `html/template`; data dimuat
dan disegarkan oleh htmx dari `/partials/*` (bukan SPA/JSON render).

## Konfigurasi

| Variabel | Default | Keterangan |
| --- | --- | --- |
| `APP_ENV` | — | **wajib** bernilai `production`; mode lain ditolak |
| `CSRF_SECRET` | — | **wajib**, ≥ 32 karakter; cookie CSRF selalu `Secure` |
| `DEVICE_TOKEN` | — | **wajib**, ≥ 32 karakter; bearer + kunci HMAC perangkat |
| `MONGODB_URI` | — | **wajib**; koneksi MongoDB produksi dengan autentikasi/TLS sesuai topologi |
| `MONGODB_DATABASE` | `attendance` | nama database (dibuat otomatis saat pertama ditulisi) |
| `FACE_SERVICE_URL` | `http://127.0.0.1:8000` | face service internal (`services/face/api.py`) |
| `FACE_SIM_THRESHOLD` | `0.45` | ambang cosine similarity untuk menyatakan wajah cocok |
| `FACE_POSE_THRESHOLD` | `0.30` | ambang kemiripan antar-foto dalam satu enrollment (1–6 pose) |
| `SCAN_MIN_MATCH_FRAMES` | `2` | frame scan yang harus cocok dengan mahasiswa yang sama agar langsung Hadir |
| `FACE_SERVICE_TIMEOUT_SECONDS` | `15` | batas waktu `/embed`; enrollment dihitung per gelombang inferensi (maks. 2 foto paralel; 6 foto = hingga 45 detik) |
| `FACE_SERVICE_TOKEN` | — | **wajib**, ≥ 32 karakter, sama di Go dan Python; Python menolak request tanpa bearer valid |
| `FACE_SERVICE_BIND_ADDRESS` | `127.0.0.1` | alamat host untuk port face service di Docker Compose; gunakan jaringan privat bila Go berada di host lain |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET` | kosong, `garage`, kosong | object storage S3 (Garage) untuk foto wajah; kosong = foto tidak disimpan |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | kosong | kunci Garage khusus bucket (bukan kunci admin) |
| `IMAGE_RETENTION_DAYS` | `30` | masa simpan foto scan berstatus `Hadir`; `0` = tanpa batas |
| `IMAGE_REVIEW_RETENTION_DAYS` | `90` | masa simpan foto scan `Perlu ditinjau`/`Ditolak`; `0` = tanpa batas |
| `HTTP_ADDR` | `:8080` | alamat listen |
| `STATIC_DIR` | `static` | lokasi aset |
| `VIEW_DIR` | `views` | lokasi template |
| `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_PASSWORD` | — | wajib saat belum ada administrator aktif; password ≥ 12 karakter |
| `BOOTSTRAP_LECTURER_USERNAME`, `BOOTSTRAP_LECTURER_PASSWORD` | — | opsional; akun dosen dibuat bila username belum ada (akun dosen lain dibuat di `/akses`) |
| `BOOTSTRAP_LECTURER_CLASSES` | `IK24-A,IK24-B` | kelas untuk akun dosen bootstrap |

Server menolak start bila `APP_ENV` tidak persis `production`, secret wajib
kurang dari 32 karakter, `MONGODB_URI` kosong, MongoDB tidak dapat dihubungi
dalam 8 detik, atau belum ada administrator dan kredensial bootstrap tidak
diisi. `BOOTSTRAP_RESET_PASSWORDS=true` tidak didukung. Hapus secret bootstrap
setelah akun terbentuk. Templat lengkap ada di
[.env.example](.env.example).

Ambang deteksi (`CONF_THRESHOLD`) dan pilihan model diatur di face service
Python; ambang pencocokan wajah (`FACE_SIM_THRESHOLD`) diatur di Go karena
pencocokan dilakukan oleh Go.

## Keamanan akun staf

- Tidak ada kredensial demo bawaan; akun staf dibuat dari `BOOTSTRAP_*`.
- Password disimpan dengan bcrypt; login dibatasi 10 percobaan per IP per
  5 menit.
- Session cookie HttpOnly/SameSite/Secure (`itbjh_session`, 8 jam, idle
  30 menit) dan CSRF token (`itbjh_csrf`).
- Session store dan login limiter masih **in-memory**: restart mengakhiri
  semua sesi dan deployment multi-instance perlu store bersama.
- Mahasiswa adalah record roster/subjek absensi tanpa akun aplikasi.
- Administrator membuat akun dosen (username, nama, password, kelas yang
  diampu) dan menghapusnya di halaman `/akses`; akun administrator tidak bisa
  dihapus dari sana. Mengubah kelas dosen, reset password, dan menonaktifkan
  akun belum ada di UI; untuk sementara gunakan `mongosh` (contoh di
  [docs/database.md](docs/database.md) §6).
- Password minimal 12 karakter untuk semua akun.

## Perangkat

Perangkat absensi = **ESP32 utama** (`devices/esp32_scanner`: ultrasonik, layar
TFT, buzzer, Wi-Fi) + **ESP32-CAM** (`devices/esp32cam_uart`) yang tersambung
lewat kabel UART. Kamera mati saat idle; begitu sensor ultrasonik mendeteksi
orang, ESP32 menyalakan kamera, mengambil ±4 frame selama ±2 detik, lalu
mengirim semuanya ke `POST /api/v1/scans` (token + HMAC + jam NTP). Wajah yang
cocok di ≥ 2 frame langsung tercatat **Hadir** di kelas mahasiswa itu; wajah
yang tidak cocok dengan siapa pun tampil **"Wajah tidak Terdaftar"** di layar
TFT. Tiap 15 detik ESP32 juga mengirim heartbeat ke
`POST /api/v1/devices/ping`. Wiring, konfigurasi, urutan upload, dan
commissioning ada di [docs/devices.md](docs/devices.md) §2. Kamera Wi-Fi
alternatif hanya untuk commissioning; pemasangan permanen memakai UART.

Wi-Fi dan `DEVICE_TOKEN` untuk ESP32 disimpan di
`devices/esp32_scanner/secrets.h` (salin dari `secrets.example.h`; di-gitignore).

> **Kredensial perangkat sudah ter-commit.** Versi lama sketch ESP8266 menulis
> password Wi-Fi dan `DEVICE_TOKEN` langsung di kode dan sudah masuk riwayat
> Git. Ganti token dan password itu ([docs/devices.md](docs/devices.md) §4).

## Face service

Face service ada di `services/face/` (FastAPI + ONNX Runtime: SCRFD untuk
deteksi, ArcFace untuk embedding 512 dimensi). Layanan ini **stateless**: Go
memanggil `POST /register` satu request per foto secara paralel saat enrollment
(maksimal dua inferensi Python sekaligus) dan `POST /embed` saat scan, lalu Go sendiri yang
menyimpan embedding ke MongoDB dan mencocokkannya dengan cosine similarity
terhadap semua pose. Jadi dashboard dan perangkat ESP32 cukup memakai satu
API, yaitu Go.

Face service dijalankan dalam container production dari
`services/face/Dockerfile` melalui perintah Compose di atas. Container
memerlukan `FACE_SERVICE_TOKEN` yang sama dengan backend Go, mengikat port ke
loopback secara default, dan hanya menyediakan API internal bertoken.

Detail alur, konfigurasi, dan catatan keamanan ada di
[docs/face-service.md](docs/face-service.md).

## Penyimpanan foto (Garage)

Opsional. Bila `S3_*` diisi, Go menyimpan foto enrollment dan foto capture
scan di bucket Garage privat; MongoDB hanya menyimpan kuncinya. Foto dipakai
untuk peninjauan, audit, dan enrollment ulang saat model diganti — pencocokan
tetap memakai embedding. Foto enrollment bisa dibuka dari tombol **Lihat
foto** di halaman Mahasiswa; foto scan dari kolom **Foto** di halaman Log.
Foto scan dihapus otomatis setelah
`IMAGE_RETENTION_DAYS`/`IMAGE_REVIEW_RETENTION_DAYS`. Bila Garage mati,
absensi tetap berjalan tanpa foto.

```bash
# di server Garage
garage bucket create methics-faces
garage key create methics-app
garage bucket allow --read --write methics-faces --key methics-app
```

Isi Key ID dan Secret ke `.env`, lalu restart server; log start harus
menulis `image storage: bucket "methics-faces" di … siap`. Detail di
[docs/face-service.md](docs/face-service.md) §8.

Embedding dan foto adalah data biometrik sensitif: aktifkan enkripsi
disk/backup, batasi akses database dan bucket, dokumentasikan persetujuan
(consent) dan retensi, serta sediakan penghapusan data.

## API

Detail di [API.md](API.md). Ringkasan:

- `GET /api/v1/health` — publik
- `GET /api/v1/dashboard`, `/classes`, `/reports` — session staf
- `POST /api/v1/students` — administrator + CSRF (JSON)
- `POST /api/v1/students/{nim}/face-template` — administrator + CSRF (multipart `images`, 1–6 foto JPEG dari kamera browser; halaman kamera memerlukan HTTPS atau localhost)
- `DELETE /api/v1/students/{nim}` — administrator + CSRF (hapus mahasiswa + data wajah, foto, riwayat scan)
- `GET|POST /api/v1/staff`, `DELETE /api/v1/staff/{id}` — administrator + CSRF (akun dosen)
- `POST /api/v1/scans` — perangkat (multipart `device_id`, `class_id` opsional, `captured_at`, `liveness_passed`, 1–6 `image`; bearer + HMAC)
- `GET|POST /api/v1/devices/ping` — heartbeat perangkat
- `GET /api/v1/images/{key...}` — foto enrollment/scan dari Garage (session staf; dosen hanya kelasnya)

HMAC dan timestamp melindungi integritas request dan membantu menolak replay;
keduanya tidak membuktikan bahwa wajah hidup. Implementasi ini belum melakukan
liveness detection, dan tidak boleh dipakai untuk keputusan kehadiran berisiko
tinggi tanpa mekanisme anti-spoof tervalidasi, persetujuan yang sesuai, serta
peninjauan manusia untuk hasil tidak pasti.

## Panduan Hardening MongoDB Menuju Production

MongoDB produksi wajib menggunakan autentikasi dan konfigurasi jaringan yang
dibatasi. Terapkan langkah-langkah hardening berikut sebelum layanan digunakan:

1. **Buat User Otentikasi Khusus Aplikasi:**
   Buka terminal di server MongoDB (`mongosh`), pindah ke database `admin`, dan buat akun aplikasi dengan izin `readWrite` hanya pada database aplikasi (nilai `MONGODB_DATABASE`; contoh di bawah memakai `attendance`):
   ```javascript
   use admin
   db.createUser({
     user: "methics_app",
     pwd: "GantiDenganPasswordSangatKuatDanPanjang123!",
     roles: [
       { role: "readWrite", db: "attendance" }
     ]
   })
   ```

2. **Aktifkan Autentikasi di Konfigurasi MongoDB (`/etc/mongod.conf`):**
   Pastikan blok `security.authorization` disetel ke `enabled`:
   ```yaml
   security:
     authorization: enabled
   ```

3. **Batasi Network Binding & Firewall:**
   - Jangan membuka MongoDB ke internet publik (`0.0.0.0`). Setel `net.bindIp` hanya ke IP private/internal atau VPN:
     ```yaml
     net:
       port: 27017
       bindIp: 127.0.0.1,10.100.1.11
     ```
   - Gunakan firewall Ubuntu (`ufw`) agar hanya server backend Go (dan face service) yang diizinkan mengakses port 27017:
     ```bash
     sudo ufw allow from <IP_SERVER_GO> to any port 27017 proto tcp
     ```

4. **Perbarui Connection String di environment aplikasi:**
   Sesuaikan URI di environment file server backend:
   ```env
   MONGODB_URI=mongodb://<user>:<password>@<host>:27017/attendance?authSource=admin
   MONGODB_DATABASE=attendance
   ```
   URI koneksi tidak dicatat ke log aplikasi. Batasi akses environment file
   dan log server hanya untuk operator berwenang.

5. **Restart Service MongoDB:**
   ```bash
   sudo systemctl restart mongod
   ```

6. **Enkripsi In-Transit (TLS/SSL) & Backup:**
   - Bila MongoDB dan server Go berjalan pada server fisik yang terpisah melewati jaringan umum, aktifkan TLS pada MongoDB (`net.tls.mode: requireTLS`).
   - Jadwalkan backup berkala menggunakan utilitas `mongodump` dan simpan arsip backup secara aman (contoh perintah di [docs/database.md](docs/database.md) §7).

## Checklist sebelum production

- [ ] `APP_ENV=production`, semua secret acak ≥ 32 karakter, secret bootstrap dihapus.
- [ ] TLS di reverse proxy (HSTS belum dipasang oleh aplikasi).
- [ ] MongoDB di-hardening sesuai panduan di atas, backup terenkripsi terjadwal.
- [ ] Zona waktu server = zona waktu kampus (batas "hari ini" mengikuti jam server).
- [ ] Face service berjalan di jaringan internal dengan `FACE_SERVICE_TOKEN`.
- [ ] Kredensial perangkat tidak ada di Git; `DEVICE_TOKEN` diganti bila pernah bocor.
- [ ] Heartbeat memakai `DEVICE_TOKEN`; `/api/v1/health` hanya read-only.
- [ ] Session store bersama bila lebih dari satu instance.
- [ ] Bila foto disimpan: bucket Garage privat, kunci khusus bucket (bukan `admin_token`), port RPC 3901 dibatasi, retensi disetujui institusi.

## Pemecahan masalah

| Gejala | Penyebab / solusi |
| --- | --- |
| `CSRF_SECRET must contain at least 32 characters` | `.env` belum terisi/terbaca (cek BOM, cek direktori kerja) |
| `initialize database (...): ... ping mongodb` | MongoDB tidak terjangkau; cek `MONGODB_URI`, firewall, `bindIp` |
| `first startup requires BOOTSTRAP_ADMIN_USERNAME ...` | belum ada administrator aktif; isi variabel bootstrap |
| Login `429` | lebih dari 10 percobaan dari IP yang sama dalam 5 menit; tunggu |
| Semua pengguna ter-logout | server di-restart (session in-memory) |
| "Verifikasi Python" offline | face service belum berjalan, model belum selesai dimuat, atau `FACE_SERVICE_URL` salah (default port `8000`) |
| Enrollment: "Tidak ada wajah yang terdeteksi (foto ke-N)" | foto ke-N buram/terlalu gelap/wajah terlalu kecil; ganti foto itu |
| Enrollment: "Wajah (foto ke-N) tidak cocok dengan foto pertama" | foto ke-N orang lain, atau pose terlalu ekstrem (> ~45°); kurangi sudut atau buang foto itu (ambang `FACE_POSE_THRESHOLD`) |
| Enrollment banyak foto gagal / notifikasi hilang | Go menyimpan semua embedding sekaligus hanya setelah seluruh foto berhasil; satu foto gagal membatalkan batch. Saat request bermasalah, UI sekarang menampilkan indikator/toast. Periksa log Go `enrollment … gagal (N foto, durasi)` dan log Python `Registration request received` / `Registration completed` untuk memastikan tiap request sampai ke Face Service. Jika koneksi terputus, muat ulang roster untuk memeriksa status template sebelum mencoba lagi. |
| Enrollment: "Wajah … sudah terdaftar atas NIM …" | wajah mirip (≥ `FACE_SIM_THRESHOLD`) dengan template mahasiswa lain |
| Enrollment / scan: `face_service_error` setelah memperbarui `services/face` | Go versi lama masih memanggil `POST /detect` (sudah dihapus dari `api.py`); pakai Go terbaru yang memanggil `/embed` dan `/register` |
| Perangkat "offline" | tidak ada ping/scan dalam 2 menit; lihat [docs/devices.md](docs/devices.md) §8 |
| Log: `image storage: PERINGATAN bucket … belum bisa diakses` | Garage tidak terjangkau dari server Go, bucket belum dibuat, atau `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` salah |
| Kolom Foto di Log berisi `-` | penyimpanan foto nonaktif, unggah gagal (lihat log `image storage: upload … gagal`), scan dibuat sebelum `S3_*` diisi/server di-restart, atau foto sudah lewat retensi |
| `image storage: S3 endpoint, bucket, access key, dan secret wajib diisi` | `S3_*` terisi sebagian; lengkapi semua atau kosongkan semua |
| Perubahan `.env` tidak berpengaruh | pastikan binary direstart dan `.env` berada di working directory; nilai di `.env` menimpa environment proses |
| Login gagal setelah `BOOTSTRAP_ADMIN_PASSWORD` diubah | bootstrap hanya membuat administrator jika belum ada; lakukan rotasi kredensial akun aktif melalui prosedur operator database yang disetujui |
| Mahasiswa contoh lama (`IK24001`–`IK24005`) masih tampil | sisa seed versi lama di MongoDB; seed tidak membuatnya lagi, jadi hapus sekali lewat tombol hapus di halaman Mahasiswa |
| `NIM harus 9 digit angka` | NIM wajib 9 digit angka, mis. `241011001` |
| Face service gagal start | periksa log container, `FACE_SERVICE_TOKEN` minimal 32 karakter, jaringan Hugging Face, dan izin direktori cache model |

## Lisensi

Lihat [LICENSE](LICENSE). Lisensi pustaka pihak ketiga yang di-vendor ada di
`static/js/vendor/*.LICENSE.txt`.
