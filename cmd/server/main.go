package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"dash.algorithmics/internal/security"

	"dash.algorithmics/internal/api"
	"dash.algorithmics/internal/controller"
	"dash.algorithmics/internal/storage"
	"dash.algorithmics/internal/store"
	"github.com/gorilla/csrf"
	"github.com/joho/godotenv"
)

func main() {
	// .env dapat digunakan untuk konfigurasi produksi; environment proses
	// tetap menjadi sumber konfigurasi bila berkas ini tidak tersedia.
	if err := godotenv.Overload(); err != nil && !errors.Is(err, os.ErrNotExist) {
		log.Fatalf("load .env: %v", err)
	} else if err == nil {
		log.Printf(".env dimuat (menimpa variabel environment yang sama)")
	}

	config := api.ParseConfig()
	if config.Environment != "production" {
		log.Fatal("APP_ENV harus disetel eksplisit ke production")
	}
	if strings.EqualFold(strings.TrimSpace(os.Getenv("BOOTSTRAP_RESET_PASSWORDS")), "true") {
		log.Fatal("BOOTSTRAP_RESET_PASSWORDS telah dihapus; setel password akun secara manual")
	}
	csrfSecret := os.Getenv("CSRF_SECRET")
	if len(csrfSecret) < 32 {
		log.Fatal("CSRF_SECRET wajib berisi minimal 32 karakter")
	}
	if len(config.DeviceToken) < 32 {
		log.Fatal("DEVICE_TOKEN wajib berisi minimal 32 karakter")
	}
	if len(config.FaceServiceToken) < 32 {
		log.Fatal("FACE_SERVICE_TOKEN wajib berisi minimal 32 karakter")
	}

	mongoURI := strings.TrimSpace(os.Getenv("MONGODB_URI"))
	if mongoURI == "" {
		log.Fatal("MONGODB_URI wajib diatur")
	}
	mongoDB := env("MONGODB_DATABASE", "attendance")
	database, err := store.Open(mongoURI, mongoDB)
	if err != nil {
		log.Fatalf("initialize database (database: %s): %v", mongoDB, err)
	}
	defer database.Close()
	log.Printf("connected to MongoDB (database: %s)", mongoDB)
	bootstrapStaff(database)

	staticDir := env("STATIC_DIR", "static")
	viewDir := env("VIEW_DIR", "views")
	apiServer := api.New(database, config)
	web, err := controller.NewWeb(apiServer, viewDir)
	if err != nil {
		log.Fatalf("load page templates: %v", err)
	}
	sessions := security.NewSessionManager(true)
	authController := controller.NewAuth(database, sessions, web)
	retentionCtx, stopRetention := context.WithCancel(context.Background())
	defer stopRetention()
	setupImageStorage(retentionCtx, apiServer, config)
	partials, err := controller.NewPartials(apiServer, viewDir)
	if err != nil {
		log.Fatalf("load fragment templates: %v", err)
	}

	protected := http.NewServeMux()
	protected.HandleFunc("GET /login", authController.LoginPage)
	protected.Handle("POST /login", security.LoginRateLimit(10, 5*time.Minute)(http.HandlerFunc(authController.Login)))
	protected.Handle("POST /logout", security.RequireSession(sessions, database, false)(http.HandlerFunc(authController.Logout)))
	protected.Handle("GET /{$}", security.RequireSession(sessions, database, false)(http.HandlerFunc(web.Dashboard)))
	protected.Handle("GET /mahasiswa", security.RequireSession(sessions, database, false)(http.HandlerFunc(web.Students)))
	protected.Handle("GET /kelas", security.RequireSession(sessions, database, false)(http.HandlerFunc(web.Classes)))
	protected.Handle("GET /laporan", security.RequireSession(sessions, database, false)(http.HandlerFunc(web.Reports)))
	protected.Handle("GET /logs", security.RequireSession(sessions, database, false)(http.HandlerFunc(web.Logs)))
	protected.Handle("GET /akses", security.RequireSession(sessions, database, false)(security.RequireRole("administrator")(http.HandlerFunc(web.Access))))
	protected.Handle("/static/", apiServer.StaticHandler(staticDir))
	protected.Handle("/api/v1/", security.RequireSession(sessions, database, true)(apiServer.StaffHandler()))
	protected.Handle("/partials/", security.RequireSession(sessions, database, true)(partials.Handler()))

	csrfHandler := csrf.Protect(
		[]byte(csrfSecret),
		csrf.Secure(true),
		csrf.Path("/"),
		csrf.FieldName("csrf_token"),
		csrf.RequestHeader("X-CSRF-Token"),
		csrf.CookieName("itbjh_csrf"),
		csrf.SameSite(csrf.SameSiteLaxMode),
	)(protected)

	// Endpoint perangkat berada di luar sesi & CSRF; autentikasinya token/HMAC.
	deviceAPI := apiServer.DeviceHandler()
	router := http.NewServeMux()
	router.HandleFunc("GET /eggs", web.Eggs)
	router.Handle("POST /api/v1/scans", deviceAPI)
	router.Handle("GET /api/v1/health", deviceAPI)
	router.Handle("GET /api/v1/devices/ping", deviceAPI)
	router.Handle("POST /api/v1/devices/ping", deviceAPI)
	router.Handle("/", sessions.LoadAndSave(csrfHandler))
	address := env("HTTP_ADDR", ":8080")
	server := &http.Server{
		Addr:              address,
		Handler:           security.Recover(security.SecurityHeaders(router)),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	stop, stopSignal := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stopSignal()
	go func() {
		<-stop.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			log.Printf("server shutdown: %v", err)
		}
	}()

	log.Printf("attendance dashboard listening on %s (production)", address)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func bootstrapStaff(database *store.Database) {
	ctx := context.Background()
	adminCount, err := database.CountUsersByRole(ctx, "administrator")
	if err != nil {
		log.Fatalf("count administrator users: %v", err)
	}
	if adminCount == 0 {
		username := strings.TrimSpace(os.Getenv("BOOTSTRAP_ADMIN_USERNAME"))
		password := os.Getenv("BOOTSTRAP_ADMIN_PASSWORD")
		if username == "" || len(password) < store.MinPasswordLength {
			log.Fatalf("first startup requires BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD (%d+ chars)", store.MinPasswordLength)
		}
		if err := database.CreateUser(ctx, username, password, username, "administrator", nil); err != nil {
			log.Fatalf("create bootstrap administrator: %v", err)
		}
		log.Printf("bootstrap administrator created; unset bootstrap secrets after initial setup")
	}
	lecturerUsername := strings.TrimSpace(os.Getenv("BOOTSTRAP_LECTURER_USERNAME"))
	lecturerPassword := os.Getenv("BOOTSTRAP_LECTURER_PASSWORD")
	if lecturerUsername != "" && lecturerPassword != "" {
		if len(lecturerPassword) < store.MinPasswordLength {
			log.Fatalf("BOOTSTRAP_LECTURER_PASSWORD must contain at least %d characters", store.MinPasswordLength)
		}
		classes := splitCSV(env("BOOTSTRAP_LECTURER_CLASSES", "IK24-A,IK24-B"))
		if err := database.EnsureUser(ctx, lecturerUsername, lecturerPassword, lecturerUsername, "dosen", classes); err != nil {
			log.Fatalf("create bootstrap lecturer: %v", err)
		}
	}
}

// setupImageStorage mengaktifkan penyimpanan foto wajah di S3 (Garage) bila
// S3_* diisi. Garage yang tidak terjangkau saat start hanya menghasilkan
// peringatan: absensi tetap berjalan, foto tidak tersimpan sampai pulih.
func setupImageStorage(ctx context.Context, apiServer *api.Server, config api.Config) {
	cfg := config.ImageStorage
	if cfg.Endpoint == "" && cfg.Bucket == "" && cfg.AccessKeyID == "" && cfg.SecretAccessKey == "" {
		log.Printf("image storage: nonaktif (S3_* kosong); foto wajah tidak disimpan")
		return
	}
	client, err := storage.NewS3(cfg)
	if err != nil {
		log.Fatalf("image storage: %v", err)
	}
	apiServer.SetImageStore(client)
	checkCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := client.HeadBucket(checkCtx); err != nil {
		log.Printf("image storage: PERINGATAN bucket %q di %s belum bisa diakses: %v", cfg.Bucket, cfg.Endpoint, err)
	} else {
		log.Printf("image storage: bucket %q in %s ready", cfg.Bucket, cfg.Endpoint)
	}
	go apiServer.RunImageRetention(ctx, time.Hour)
}

func splitCSV(value string) []string {
	items := strings.Split(value, ",")
	result := make([]string, 0, len(items))
	for _, item := range items {
		if item = strings.TrimSpace(item); item != "" {
			result = append(result, item)
		}
	}
	return result
}

func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
