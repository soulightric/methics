# Face Service Production

Layanan internal FastAPI menggunakan SCRFD untuk deteksi wajah dan ArcFace
untuk embedding 512-d. Go adalah satu-satunya gateway publik; Python tidak
boleh diekspos langsung ke internet.

## Deployment

Prasyarat: Docker Compose dan `.env` production di root repository. Pastikan
`FACE_SERVICE_TOKEN` memiliki minimal 32 karakter dan nilainya sama untuk Go
serta layanan ini.

Dari root repository:

```powershell
docker compose --env-file .env -f services/face/docker-compose.yml up -d --build
```

Port container hanya terikat ke `127.0.0.1` secara default. Bila backend Go
berada pada host berbeda, atur `FACE_SERVICE_BIND_ADDRESS` ke alamat privat
dan batasi firewall ke host Go saja. Model ONNX diunduh saat provisioning
pertama dan disimpan pada volume Docker `face-model-cache`.

Go harus dijalankan dengan `APP_ENV=production`, `FACE_SERVICE_URL` yang dapat
dijangkau, serta `FACE_SERVICE_TOKEN` yang sama. Build backend dari root:

```powershell
go build -trimpath -ldflags="-s -w" -o bin/methics.exe ./cmd/server
.\bin\methics.exe
```

## API internal

Semua endpoint memerlukan `Authorization: Bearer <FACE_SERVICE_TOKEN>`.
Token dibandingkan secara waktu-konstan dan layanan menolak startup bila
token tidak tersedia atau lebih pendek dari 32 karakter. Swagger, ReDoc,
OpenAPI, dan CORS publik dinonaktifkan.

Go menggunakan endpoint berikut:

| Python endpoint | Fungsi |
| --- | --- |
| `GET /health` | readiness dan model aktif |
| `POST /embed` | satu gambar scan; menghasilkan embedding dan confidence |
| `POST /register` | 1–6 gambar enrollment; satu embedding per gambar |
| `GET /models` | katalog model lokal dan Hugging Face |
| `POST /models/download` | mengunduh model |
| `POST /models/switch` | mengganti model aktif |

Operator administrator mengelola model lewat endpoint Go
`/api/v1/face/models*`; jangan memanggil service Python dari browser atau
perangkat. Perubahan recognition model membuat embedding lama tidak
sebanding, sehingga semua mahasiswa harus di-enroll ulang sebelum scan.

Backend Go mengirim enrollment satu gambar per request secara paralel. Python
menjalankan maksimal dua inferensi sekaligus pada worker thread agar enam
request tidak memblokir event loop atau membuat beban inferensi tanpa batas.

Lihat [../../docs/face-service.md](../../docs/face-service.md) untuk kontrak
integrasi, konfigurasi, dan batasan sistem.
