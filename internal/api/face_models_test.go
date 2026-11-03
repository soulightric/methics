package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"dash.algorithmics/internal/security"
)

func TestFaceModelManagementProxy(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /models", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("refresh_remote") != "false" {
			t.Errorf("refresh_remote = %q, want false", r.URL.Query().Get("refresh_remote"))
		}
		if r.Header.Get("Authorization") != "Bearer service-token" {
			t.Errorf("unexpected authorization header: %q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"repo_id":"models","online":false,"face_detection":[],"face_recognition":[]}`)
	})
	mux.HandleFunc("POST /models/download", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("content type = %q, want application/json", r.Header.Get("Content-Type"))
		}
		var input struct {
			ModelID string `json:"model_id"`
			Force   bool   `json:"force"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			t.Errorf("decode download request: %v", err)
		}
		if input.ModelID != "face_detection/scrfd_10g.onnx" || !input.Force {
			t.Errorf("unexpected download request: %+v", input)
		}
		_, _ = io.WriteString(w, `{"status":"success","model_id":"face_detection/scrfd_10g.onnx"}`)
	})
	mux.HandleFunc("POST /models/switch", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if string(body) != `{"rec_model":"face_recognition/arcface_r100.onnx"}` {
			t.Errorf("unexpected switch request: %s", body)
		}
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, `{"detail":"invalid model"}`)
	})
	upstream := httptest.NewServer(mux)
	t.Cleanup(upstream.Close)

	handler := New(nil, Config{FaceServiceURL: upstream.URL, FaceServiceToken: "service-token"}).StaffHandler()
	admin := security.Principal{Role: "administrator"}
	tests := []struct {
		name       string
		method     string
		path       string
		body       string
		wantStatus int
		wantBody   string
	}{
		{"catalog", http.MethodGet, "/api/v1/face/models?refresh_remote=false", "", http.StatusOK, `"repo_id":"models"`},
		{"download", http.MethodPost, "/api/v1/face/models/download", `{"model_id":"face_detection/scrfd_10g.onnx","force":true}`, http.StatusOK, `"status":"success"`},
		{"switch error", http.MethodPost, "/api/v1/face/models/switch", `{"rec_model":"face_recognition/arcface_r100.onnx"}`, http.StatusBadRequest, `"detail":"invalid model"`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			request = security.WithPrincipal(request, admin)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != tc.wantStatus || !strings.Contains(response.Body.String(), tc.wantBody) {
				t.Fatalf("got status %d body %s; want status %d containing %q", response.Code, response.Body.String(), tc.wantStatus, tc.wantBody)
			}
		})
	}
}

func TestFaceModelManagementRequiresAdministrator(t *testing.T) {
	called := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		_, _ = io.WriteString(w, `{}`)
	}))
	t.Cleanup(upstream.Close)
	handler := New(nil, Config{FaceServiceURL: upstream.URL}).StaffHandler()

	request := httptest.NewRequest(http.MethodGet, "/api/v1/face/models", nil)
	request = security.WithPrincipal(request, security.Principal{Role: "dosen"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusForbidden || called {
		t.Fatalf("got status %d, upstream called %v; want forbidden without upstream request", response.Code, called)
	}
}

func TestFaceModelManagementRejectsInvalidJSON(t *testing.T) {
	called := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		_, _ = io.WriteString(w, `{}`)
	}))
	t.Cleanup(upstream.Close)
	handler := New(nil, Config{FaceServiceURL: upstream.URL}).StaffHandler()

	request := httptest.NewRequest(http.MethodPost, "/api/v1/face/models/download", strings.NewReader(`{"model_id":`))
	request = security.WithPrincipal(request, security.Principal{Role: "administrator"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest || called {
		t.Fatalf("got status %d, upstream called %v; want invalid JSON without upstream request", response.Code, called)
	}
}

func TestFaceModelManagementUnavailableService(t *testing.T) {
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/face/models", nil)
	request = security.WithPrincipal(request, security.Principal{Role: "administrator"})
	New(nil, Config{FaceServiceURL: "http://127.0.0.1:1"}).StaffHandler().ServeHTTP(response, request)

	if response.Code != http.StatusBadGateway || !strings.Contains(response.Body.String(), "face_service_error") {
		t.Fatalf("got status %d body %s; want face service gateway error", response.Code, response.Body.String())
	}
}
