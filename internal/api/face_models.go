package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	faceModelRequestTimeout  = 10 * time.Minute
	faceModelRequestMaxSize  = 1 << 20
	faceModelResponseMaxSize = 8 << 20
)

func (s *Server) listFaceModels(w http.ResponseWriter, r *http.Request) {
	query := url.Values{}
	if refresh := r.URL.Query()["refresh_remote"]; len(refresh) > 0 {
		query["refresh_remote"] = refresh
	}
	s.proxyFaceModelRequest(w, r, http.MethodGet, "/models", query)
}

func (s *Server) downloadFaceModel(w http.ResponseWriter, r *http.Request) {
	s.proxyFaceModelRequest(w, r, http.MethodPost, "/models/download", nil)
}

func (s *Server) switchFaceModels(w http.ResponseWriter, r *http.Request) {
	s.proxyFaceModelRequest(w, r, http.MethodPost, "/models/switch", nil)
}

func (s *Server) proxyFaceModelRequest(w http.ResponseWriter, r *http.Request, method, path string, query url.Values) {
	user, ok := principalFromRequest(r)
	if !ok || user.role != "administrator" {
		writeError(w, http.StatusForbidden, "forbidden", "Hanya administrator yang dapat mengelola model wajah.")
		return
	}

	controller := http.NewResponseController(w)
	deadline := time.Now().Add(faceModelRequestTimeout)
	if err := controller.SetReadDeadline(deadline); err != nil && !errors.Is(err, http.ErrNotSupported) {
		log.Printf("set face model request read deadline: %v", err)
	}
	if err := controller.SetWriteDeadline(deadline); err != nil && !errors.Is(err, http.ErrNotSupported) {
		log.Printf("set face model request write deadline: %v", err)
	}

	var body io.Reader
	if method == http.MethodPost {
		raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, faceModelRequestMaxSize))
		if err != nil || !json.Valid(raw) {
			writeError(w, http.StatusBadRequest, "invalid_json", "Body JSON tidak valid.")
			return
		}
		body = strings.NewReader(string(raw))
	}

	ctx, cancel := context.WithTimeout(r.Context(), faceModelRequestTimeout)
	defer cancel()
	endpoint := strings.TrimRight(s.config.FaceServiceURL, "/") + path
	if len(query) > 0 {
		endpoint += "?" + query.Encode()
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		writeError(w, http.StatusBadGateway, "face_service_error", "Tidak dapat membuat request ke layanan wajah.")
		return
	}
	if method == http.MethodPost {
		request.Header.Set("Content-Type", "application/json")
	}
	if s.config.FaceServiceToken != "" {
		request.Header.Set("Authorization", "Bearer "+s.config.FaceServiceToken)
	}

	response, err := s.client.Do(request)
	if err != nil {
		writeError(w, http.StatusBadGateway, "face_service_error", "Layanan wajah tidak dapat dihubungi atau timeout.")
		return
	}
	defer response.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(response.Body, faceModelResponseMaxSize+1))
	if err != nil {
		writeError(w, http.StatusBadGateway, "face_service_error", "Respons layanan wajah tidak dapat dibaca.")
		return
	}
	if len(raw) > faceModelResponseMaxSize || !json.Valid(raw) {
		writeError(w, http.StatusBadGateway, "face_service_error", "Respons layanan wajah bukan JSON yang valid.")
		return
	}
	if contentType := response.Header.Get("Content-Type"); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	} else {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
	}
	w.WriteHeader(response.StatusCode)
	if _, err := w.Write(raw); err != nil {
		log.Printf("write face model response: %v", err)
	}
}
