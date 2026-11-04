# Face Service (Python) dan Integrasinya dengan Go

> Status: **[TERSEDIA]**. Layanan ada di `services/face/` (FastAPI + ONNX
> Runtime: SCRFD untuk deteksi, ArcFace R50 untuk embedding 512-d,
> model diunduh dari Hugging Face `AkihikoSaburo/methics`). Deployment memakai
> Docker Compose, bearer token wajib, dan akses jaringan internal.

## 1. Pembagian tugas: satu API publik

```text
Browser / ESP32 ──► Go (satu-satunya API publik, :8080)
                     │  POST /register?student_id=…  (satu file per request, paralel) — enrollment
                     │  POST /embed                   (1 file "image")     — scan
                     ├──────────────────────────────► Python face service (:8000, internal)
                     │◄──────────── embedding ArcFace 512-d (+ confidence) per foto
                     │
                     ├── simpan semua embedding pose → MongoDB face_templates   (enrollment)
                     └── cosine similarity 1:N       → bandingkan dengan face_templates (scan)
```

Face service bersifat **stateless**: ia tidak menyimpan apa pun dan tidak
terhubung ke MongoDB (`student_id` pada `/register` hanya dikembalikan
lagi). Go yang:

- menyimpan template wajah (1–6 embedding per mahasiswa) di koleksi `face_templates`,
- melakukan pencocokan 1:N (cosine similarity) saat scan,
- menentukan status `Hadir` / `Perlu ditinjau` / `Ditolak`.

Akibatnya perangkat ESP32 dan dashboard cukup berbicara dengan **satu** API
(Go). Face service tidak perlu dan tidak boleh diekspos ke jaringan publik.

Kode Go: `internal/api/face.go` (klien `/embed` & `/register`, validasi
enrollment, pencocokan), dipanggil dari `EnrollFace` dan `receiveScan` di
`internal/api/server.go`. Foto wajah opsional disimpan di Garage (S3), lihat §8.

## 2. Endpoint Python yang dipakai Go

| Endpoint | Dipakai untuk | Request dari Go | Respons yang dibaca Go |
| --- | --- | --- | --- |
| `GET /health` | status di dashboard & `/api/v1/health` | — | `model_loaded`, `det_model`, `rec_model` |
| `POST /embed` | scan perangkat | multipart, 1 file `image` | `embedding` (512-d), `confidence`, `processing_time_ms` |
| `POST /register?student_id=<id>` | enrollment | multipart; Go mengirim satu file `images` per request dan menjalankan request paralel (batas dua inferensi bersamaan di Python); API tetap menerima batch 1–6 file | `num_templates`, `templates[].embedding`, `templates[].confidence`, `processing_time_ms` |
| `GET /models` | katalog model (via Go) | query opsional `refresh_remote` | `repo_id`, `defaults`, status online, katalog per kategori |
| `POST /models/download` | mengunduh model (via Go) | JSON `model_id`, opsional `force` | status, `model_id`, path, pesan |
| `POST /models/switch` | mengganti model aktif (via Go) | JSON opsional `det_model`, `rec_model`, `conf_threshold`, `iou_threshold` | status dan model aktif |

Semua endpoint Python mewajibkan bearer `FACE_SERVICE_TOKEN` yang diverifikasi
dengan perbandingan waktu-konstan. OpenAPI, Swagger, ReDoc, dan CORS publik
dinonaktifkan. Go mengirim token pada setiap request, termasuk health check.
Python memilih **wajah dengan confidence deteksi tertinggi** pada tiap foto;
foto berisi beberapa orang tidak ditolak, jadi pastikan
foto enrollment hanya berisi mahasiswa yang bersangkutan. `return_aligned`
tidak dipakai (crop wajah tidak dikirim balik). Endpoint manajemen model
dapat diakses melalui Go pada `/api/v1/face/models`,
`/api/v1/face/models/download`, dan `/api/v1/face/models/switch`; ketiganya
khusus administrator dan meneruskan format JSON layanan Python.

Status HTTP dari Python:

| Status Python | Perlakuan Go |
| --- | --- |
| `200` | diproses |
| `400` (gambar kosong/tidak bisa di-decode, atau lebih dari 6 foto) | enrollment `400 invalid_image`; scan `400 invalid_image` |
| `422` dengan `detail` "No face detected …" | enrollment `422 no_face` (nomor foto dibaca dari `image #N`); scan dicatat `Ditolak` "Wajah tidak terdeteksi" |
| `422` validasi FastAPI, `503` model belum siap, lainnya, timeout, tidak terjangkau | `502 face_service_error`; scan **tidak** dicatat |

## 3. Enrollment (administrator)

`POST /partials/mahasiswa/{nim}/face-template` (tombol **Enroll wajah** /
**Enroll ulang** di halaman Mahasiswa, pilih 1–6 file sekaligus) atau
`POST /api/v1/students/{nim}/face-template` (JSON, field `images`):

1. Go membaca 1–6 foto (maks 8 MB per foto; field `images`, atau `image`
   untuk klien lama), lalu mengirim setiap foto ke `POST /register` sebagai
   request terpisah secara paralel. Python menjalankan maksimal dua inferensi
   sekaligus di worker thread agar event loop API tetap responsif; hasil
   digabung Go menurut urutan foto awal. Timeout enrollment disesuaikan
   dengan jumlah batch inferensi.
   Pose yang disarankan: depan, kiri (~30°), kanan (~30°), atas, bawah,
   senyum. Satu foto depan tetap boleh.
2. Foto tanpa wajah → `422 no_face` dengan nomor fotonya.
3. **Konsistensi:** setiap foto harus orang yang sama: kemiripannya dengan
   foto pertama **atau** dengan rata-rata foto lain harus ≥
   `FACE_POSE_THRESHOLD` (default 0.30, lebih longgar dari ambang scan karena
   pose miring wajar kurang mirip foto depan). Bila tidak →
   `422 inconsistent_faces` (mis. foto ke-4 orang lain).
4. **Duplikat:** setiap embedding dibandingkan dengan template mahasiswa
   **lain**. Bila kemiripan ≥ ambang, enrollment ditolak
   (`409 face_already_enrolled`, menyebut NIM pemilik wajah) untuk mencegah
   satu wajah terdaftar di dua NIM (titip absen). Template milik mahasiswa itu
   sendiri diabaikan sehingga enrollment ulang tidak bentrok.
5. Semua embedding di-*upsert* ke **satu** dokumen `face_templates` milik
   mahasiswa itu (field `encodings`); enrollment ulang mengganti seluruh pose
   lama.

Dokumen `face_templates`:

```json
{
  "student_id": "student-241011001",
  "encodings": [[0.0123, -0.0456, "… 512 angka …"], "… 1–6 vektor …"],
  "template_count": 6,
  "dimension": 512,
  "detection_confidences": [0.93, 0.91, 0.9, 0.88, 0.9, 0.92],
  "image_key": "enroll/student-241011001/20261028T080000Z-3f9a1c2b4d5e.jpg",
  "image_keys": ["enroll/student-241011001/…", "… satu per foto …"],
  "created_at": "2026-10-28T08:00:00Z",
  "updated_at": "2026-10-28T08:00:00Z"
}
```

Dokumen dari versi lama (satu foto, field `encoding` dan
`detection_confidence`) tetap dibaca dan dicocokkan sebagai satu pose;
enrollment ulang mengubahnya ke format baru.

## 4. Verifikasi saat scan (perangkat)

Perangkat menyalakan kamera saat sensor ultrasonik mendeteksi orang, lalu
mengirim 1–6 frame dari jendela scan ±2 detik dalam satu
`POST /api/v1/scans` (setelah token, HMAC, timestamp, dan perangkat lolos
validasi; kode di `internal/api/scan.go`):

1. `matchFrames` mengirim frame **satu per satu** ke `POST /embed`. Frame
   tanpa wajah (`422`) atau rusak (`400`) dilewati; face service mati /
   timeout → `502`, scan tidak dicatat.
2. Embedding tiap frame dibandingkan dengan **semua pose semua** mahasiswa
   (1:N). Skor seorang mahasiswa = skor pose terbaiknya. Frame dengan skor ≥
   `FACE_SIM_THRESHOLD` dihitung sebagai satu "suara" untuk mahasiswa itu.
   Begitu satu mahasiswa mendapat `SCAN_MIN_MATCH_FRAMES` (2) suara, sisa
   frame tidak diproses (lebih cepat untuk wajah terdaftar).
3. `decideFrames` memilih mahasiswa dengan suara terbanyak (seri → skor
   tertinggi):
   - ≥ `SCAN_MIN_MATCH_FRAMES` suara (atau `liveness_passed=true`) →
     **Hadir** di kelas mahasiswa itu (`class_id` kosong) atau di kelas
     perangkat bila mahasiswa anggotanya;
   - 1 suara saja → **Perlu ditinjau**;
   - ada wajah tetapi tidak ada suara → **Ditolak**, "Wajah tidak
     Terdaftar" (`result: tidak_terdaftar`);
   - tidak ada wajah di semua frame → **Ditolak**, "Wajah tidak terdeteksi".
4. `confidence` pada event = skor terbaik mahasiswa yang menang (atau skor
   tertinggi keseluruhan untuk wajah tidak terdaftar).

Beberapa pose meningkatkan peluang cocok saat mahasiswa tidak tepat
menghadap kamera, tetapi juga sedikit menaikkan peluang salah cocok; ukur
ulang ambang setelah data nyata terkumpul (§7). Konsensus beberapa frame
hanya memastikan wajah yang sama terlihat konsisten selama ±2 detik —
**bukan** anti-spoof.

## 5. Konfigurasi

Sisi Go (`.env`):

| Variabel | Default | Keterangan |
| --- | --- | --- |
| `FACE_SERVICE_URL` | `http://127.0.0.1:8000` | base URL face service (port default `main.py`/`api.py`) |
| `FACE_SERVICE_TOKEN` | — | wajib minimal 32 karakter; harus sama dengan token Python |
| `FACE_SIM_THRESHOLD` | `0.45` | ambang cosine similarity untuk scan dan cek duplikat; samakan dengan `SIM_THRESHOLD` di Python |
| `FACE_POSE_THRESHOLD` | `0.30` | ambang kemiripan antar-foto dalam satu enrollment (cek konsistensi pose) |
| `SCAN_MIN_MATCH_FRAMES` | `2` | jumlah frame scan yang harus cocok dengan mahasiswa yang sama agar langsung **Hadir** tanpa liveness dari perangkat |
| `FACE_SERVICE_TIMEOUT_SECONDS` | `15` | batas waktu `/embed`; enrollment mendapat nilai ini dikali jumlah gelombang (dua inferensi Python bersamaan; 6 foto → 45 detik). Health memakai 3 detik |

Request enrollment juga mendapat batas baca/tulis sendiri **3 menit**
(`api.EnrollRequestTimeout`), menggantikan `ReadTimeout`/`WriteTimeout`
server 15 detik. Foto enrollment dikirim ke Python secara paralel dengan
batas dua inferensi sekaligus; unggahan foto ke Garage juga paralel.
Python mencatat `Registration request received`, `Registration completed`,
atau foto yang gagal dideteksi/didekode (tanpa mencatat gambar atau identitas
mahasiswa). Go mencatat hasil batch `enrollment … berhasil/gagal (N foto,
durasi)`. Karena penyimpanan template di Go dilakukan setelah semua response
foto lolos validasi, batch gagal tidak menulis sebagian embedding.

Sisi Python: lihat `services/face/src/config.py` (`DET_MODEL_PATH`,
`REC_MODEL_PATH`, `CONF_THRESHOLD`, `SIM_THRESHOLD`, `FACE_SERVICE_TOKEN`,
dst.). Host dan port diatur lewat argumen `main.py` (`--host`, `--port`).

## 6. Deployment production

Jalankan Go dan Python dari konfigurasi production di `.env.example`.
`FACE_SERVICE_TOKEN` harus sama di keduanya dan minimal 32 karakter. Secara
default Compose hanya memublikasikan port Python pada loopback host.

```powershell
docker compose --env-file .env -f services/face/docker-compose.yml up -d --build
go build -trimpath -ldflags="-s -w" -o bin/methics.exe ./cmd/server
.\bin\methics.exe
```

Jika Go berjalan di host berbeda, atur `FACE_SERVICE_BIND_ADDRESS` ke alamat
privat face service dan batasi firewall agar hanya host Go yang dapat
mengaksesnya. Jangan memublikasikan port Python ke internet.

Cek integrasi:

```bash
curl http://localhost:8080/api/v1/health
```

Lakukan enrollment melalui halaman **Mahasiswa** dan commissioning scan
menggunakan perangkat absensi production (`docs/devices.md` §2).

FastAPI memuat model saat start; model yang belum ada di cache container
diunduh dari Hugging Face. Egress internet harus tersedia saat provisioning
awal. Cache model perlu dipersistenkan atau disediakan ulang sesuai kebijakan
deployment.

## 7. Keamanan dan hal yang perlu diperhatikan

- FastAPI memverifikasi bearer `FACE_SERVICE_TOKEN` pada semua endpoint;
  startup gagal bila token kurang dari 32 karakter. API docs dan CORS publik
  dinonaktifkan.
- Port service harus tetap di loopback atau jaringan privat; bearer token
  bukan pengganti isolasi jaringan.
- **Ambang `0.45` belum dikalibrasi** dengan data kampus. Ukur FAR/FRR
  dengan beberapa foto per mahasiswa sebelum dipakai sungguhan.
- Pencocokan memuat seluruh template tiap scan (O(N)); cukup untuk ratusan
  hingga beberapa ribu mahasiswa. Untuk skala lebih besar, batasi kandidat
  per kelas atau tambahkan cache.
- Mengganti model recognition (`/models/switch` atau `REC_MODEL_PATH`)
  membuat embedding lama tidak sebanding → lakukan enrollment ulang. Template
  berdimensi berbeda otomatis diabaikan, tetapi model berbeda dengan dimensi
  sama **tidak** terdeteksi.
- Endpoint `/embed` dan `/register` di `api.py` menjalankan inferensi di
  dalam `async def`, sehingga request diproses **satu per satu** per worker.
  Enrollment 6 foto sesaat menahan scan lain; untuk banyak perangkat jalankan
  beberapa worker (`--workers`) atau pindahkan inferensi ke thread pool.
- Liveness/anti-spoof belum ada di Python maupun Go; `liveness_passed` masih
  klaim perangkat.
- Python tidak menyimpan foto. Go menyimpan foto di Garage hanya bila
  `S3_*` diisi (lihat §8). Embedding maupun foto adalah data biometrik
  sensitif.

## 8. Penyimpanan foto (S3 Garage)

Pencocokan hanya memakai embedding, jadi foto tidak dibutuhkan untuk
absensi. Foto tetap disimpan untuk tiga keperluan:

1. **Enrollment ulang otomatis** saat model recognition diganti (embedding
   model lama tidak sebanding dengan model baru).
2. **Peninjauan** scan `Perlu ditinjau` oleh dosen/admin.
3. **Audit dan sanggahan** (mahasiswa protes, dugaan titip absen).

Alur:

| Kejadian | Kunci objek | Dicatat di | Masa simpan |
| --- | --- | --- | --- |
| Enrollment berhasil | `enroll/{student_id}/{waktu}-{acak}.jpg`, satu per foto | `face_templates.image_keys` (semua) dan `image_key` (foto pertama) | sampai enrollment ulang (foto lama dihapus) |
| Scan `Hadir` | `scans/{yyyy}/{mm}/{dd}/{waktu}-{device}-{acak}.jpg` | `scan_events.image_key` | `IMAGE_RETENTION_DAYS` (30) |
| Scan `Perlu ditinjau` / `Ditolak` | sama | sama | `IMAGE_REVIEW_RETENTION_DAYS` (90) |
| Request gagal validasi / face service error | — | — | tidak disimpan |

- Unggah diberi batas 3 detik. Bila Garage mati, absensi dan enrollment
  tetap berjalan tanpa foto; kesalahannya dicatat di log.
- Job retensi berjalan saat start lalu tiap jam: foto kedaluwarsa dihapus
  dari bucket dan `image_key` di-`$unset`; event absensinya tetap ada.
- Foto dilihat lewat `GET /api/v1/images/{key}` (sesi staf; dosen hanya
  kelasnya). Bucket tidak perlu dan tidak boleh dibuka publik.
- Klien S3 ada di `internal/storage/s3.go` (pustaka standar, AWS Signature
  V4, gaya path); logika foto di `internal/api/images.go`.
- `GET /api/v1/health` menampilkan `imageStorage.enabled/online`; log start
  menulis `image storage: bucket "…" siap` atau peringatan.

Menyiapkan Garage (di server):

```bash
garage bucket create methics-faces
garage key create methics-app            # catat Key ID dan Secret key
garage bucket allow --read --write methics-faces --key methics-app
```

Lalu isi `S3_ENDPOINT=http://10.100.1.11:3900`, `S3_REGION=garage` (sama
dengan `s3_region` di `garage.toml`), `S3_BUCKET=methics-faces`,
`S3_ACCESS_KEY_ID`, dan `S3_SECRET_ACCESS_KEY` di `.env`. Jangan memakai
`admin_token` atau akun root server untuk aplikasi.

Menghapus mahasiswa (halaman Mahasiswa atau `DELETE /api/v1/students/{nim}`)
ikut menghapus foto enrollment dan foto scannya dari Garage.

Foto enrollment dibuka lewat tombol **Lihat foto** (foto pertama) dan
nomor **2–6** di sebelahnya (pose lain) di halaman Mahasiswa. Tombolnya
muncul hanya bila foto tersimpan di Garage; enrollment yang dibuat sebelum
`S3_*` diisi tidak punya foto. Foto scan dibuka dari kolom **Foto**
di halaman Log. Belum ada: enrollment ulang otomatis dari foto tersimpan.

## 9. Apa yang disimpan dari hasil Python

| Saat | Embedding dari Python | Yang disimpan |
| --- | --- | --- |
| Enrollment (`/register`) | disimpan Go | `face_templates.encodings` (1–6 × 512 angka) + `template_count`, `dimension`, `detection_confidences`, `image_key(s)`, waktu |
| Scan perangkat (`/embed`, 1–6 frame) | **tidak** disimpan; hanya dipakai untuk pencocokan lalu dibuang | `scan_events`: `student_id` kandidat, `confidence` (cosine similarity), `status`, `review_reason`, `frames_total/with_face/matched`, `image_key` (satu frame bukti) |

Python sendiri tidak menyimpan apa pun; folder `services/face/models/` hanya
berisi file model.
