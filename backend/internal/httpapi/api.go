package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/codefun/tagmanager/backend/internal/config"
	"github.com/codefun/tagmanager/backend/internal/domain"
	"github.com/codefun/tagmanager/backend/internal/repository"
	"github.com/codefun/tagmanager/backend/internal/service"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"github.com/google/uuid"
)

type API struct {
	store *repository.Store
	cfg   config.Config
}
type authContextKey struct{}

func New(store *repository.Store, cfg config.Config) http.Handler {
	api := &API{store: store, cfg: cfg}
	router := chi.NewRouter()
	router.Use(cors.Handler(cors.Options{AllowedOrigins: []string{cfg.CORSOrigin}, AllowedMethods: []string{"GET", "POST", "PATCH", "OPTIONS"}, AllowedHeaders: []string{"Accept", "Authorization", "Content-Type", "Idempotency-Key"}}))
	router.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		respond(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	router.Route("/api/v1", func(r chi.Router) {
		r.Post("/auth/login", api.login)
		r.Group(func(r chi.Router) {
			r.Use(api.authenticate)
			r.Get("/me", api.me)
			r.Get("/namespaces", api.listNamespaces)
			r.Post("/namespaces", api.require(domain.RoleAdmin, api.createNamespace))
			r.Get("/tags", api.listTags)
			r.Get("/candidate-pools/{namespaceID}/entries", api.listPool)
			r.Post("/imports", api.require(domain.RoleAdmin, api.importTags))
			r.Get("/review/proposals", api.listProposals)
			r.Get("/review/proposals/{proposalID}", api.getProposal)
			r.Post("/review/proposals/{proposalID}/decision", api.require(domain.RoleReviewer, api.decideProposal))
		})
	})
	return router
}

func (a *API) login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if decode(w, r, &body) != nil {
		return
	}
	id, hash, role, err := a.store.FindUserByEmail(r.Context(), body.Email)
	if err != nil || service.VerifyPassword(hash, body.Password) != nil {
		respondError(w, http.StatusUnauthorized, "invalid email or password")
		return
	}
	token, err := service.IssueToken(a.cfg.JWTSecret, id, role)
	if err != nil {
		respondError(w, 500, "could not issue token")
		return
	}
	respond(w, 200, map[string]any{"token": token, "user": domain.User{ID: id, Email: body.Email, Role: role}})
}
func (a *API) me(w http.ResponseWriter, r *http.Request) { respond(w, 200, currentUser(r)) }
func (a *API) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Fields(r.Header.Get("Authorization"))
		if len(parts) != 2 || parts[0] != "Bearer" {
			respondError(w, 401, "authentication required")
			return
		}
		claims, err := service.ParseToken(a.cfg.JWTSecret, parts[1])
		if err != nil {
			respondError(w, 401, "invalid token")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), authContextKey{}, domain.User{ID: claims.Subject, Role: claims.Role})))
	})
}
func (a *API) require(role domain.Role, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := currentUser(r)
		if user.Role != domain.RoleAdmin && user.Role != role {
			respondError(w, 403, "insufficient permission")
			return
		}
		next(w, r)
	}
}
func (a *API) listNamespaces(w http.ResponseWriter, r *http.Request) {
	items, err := a.store.ListNamespaces(r.Context())
	if err != nil {
		respondError(w, 500, err.Error())
		return
	}
	respond(w, 200, map[string]any{"data": items})
}
func (a *API) createNamespace(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name               string `json:"name"`
		Description        string `json:"description"`
		CandidateThreshold int    `json:"candidateThreshold"`
	}
	if decode(w, r, &body) != nil {
		return
	}
	if body.CandidateThreshold == 0 {
		body.CandidateThreshold = 50
	}
	item, err := a.store.CreateNamespace(r.Context(), strings.TrimSpace(body.Name), body.Description, body.CandidateThreshold)
	if err != nil {
		respondError(w, 400, err.Error())
		return
	}
	respond(w, 201, item)
}
func (a *API) listTags(w http.ResponseWriter, r *http.Request) {
	items, err := a.store.ListTags(r.Context(), r.URL.Query().Get("namespaceId"), r.URL.Query().Get("q"))
	if err != nil {
		respondError(w, 500, err.Error())
		return
	}
	respond(w, 200, map[string]any{"data": items})
}
func (a *API) listPool(w http.ResponseWriter, r *http.Request) {
	items, threshold, err := a.store.ListPool(r.Context(), chi.URLParam(r, "namespaceID"))
	if err != nil {
		respondError(w, 500, err.Error())
		return
	}
	respond(w, 200, map[string]any{"data": items, "threshold": threshold})
}
func (a *API) importTags(w http.ResponseWriter, r *http.Request) {
	var body struct {
		NamespaceID string   `json:"namespaceId"`
		SourceName  string   `json:"sourceName"`
		Tags        []string `json:"tags"`
		InitialSeed bool     `json:"initialSeed"`
	}
	if decode(w, r, &body) != nil {
		return
	}
	key := r.Header.Get("Idempotency-Key")
	if key == "" {
		key = uuid.NewString()
	}
	result, err := a.store.ImportTags(r.Context(), body.NamespaceID, key, body.SourceName, currentUser(r).ID, body.Tags, body.InitialSeed, service.NormalizeTag)
	if err != nil {
		respondError(w, 400, err.Error())
		return
	}
	respond(w, 201, result)
}
func (a *API) listProposals(w http.ResponseWriter, r *http.Request) {
	items, err := a.listProposalData(r.Context(), "")
	if err != nil {
		respondError(w, 500, err.Error())
		return
	}
	respond(w, 200, map[string]any{"data": items})
}
func (a *API) getProposal(w http.ResponseWriter, r *http.Request) {
	items, err := a.listProposalData(r.Context(), chi.URLParam(r, "proposalID"))
	if err != nil || len(items) == 0 {
		respondError(w, 404, "proposal not found")
		return
	}
	respond(w, 200, items[0])
}
func (a *API) decideProposal(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Approve  bool                             `json:"approve"`
		Version  int                              `json:"version"`
		Comments string                           `json:"comments"`
		Tags     []repository.ProposalTagDecision `json:"tags"`
	}
	if decode(w, r, &body) != nil {
		return
	}
	if body.Version < 1 {
		respondError(w, 400, "proposal version is required")
		return
	}
	err := a.store.DecideProposal(r.Context(), chi.URLParam(r, "proposalID"), currentUser(r).ID, repository.ProposalDecision{Approve: body.Approve, Version: body.Version, Comments: body.Comments, Tags: body.Tags}, service.NormalizeTag)
	if err != nil {
		if strings.Contains(err.Error(), "another reviewer") || strings.Contains(err.Error(), "no longer pending") {
			respondError(w, 409, err.Error())
		} else {
			respondError(w, 400, err.Error())
		}
		return
	}
	respond(w, http.StatusOK, map[string]string{"status": "accepted"})
}

func (a *API) listProposalData(ctx context.Context, proposalID string) ([]domain.Proposal, error) {
	return a.store.ListProposals(ctx, proposalID)
}
func currentUser(r *http.Request) domain.User {
	user, _ := r.Context().Value(authContextKey{}).(domain.User)
	return user
}
func decode(w http.ResponseWriter, r *http.Request, target any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
	de := json.NewDecoder(r.Body)
	de.DisallowUnknownFields()
	if err := de.Decode(target); err != nil {
		respondError(w, 400, "invalid JSON request")
		return err
	}
	return nil
}
func respond(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
func respondError(w http.ResponseWriter, status int, message string) {
	respond(w, status, map[string]any{"error": map[string]string{"message": message}})
}
