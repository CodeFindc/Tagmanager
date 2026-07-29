package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/codefun/tagmanager/backend/internal/config"
	"github.com/codefun/tagmanager/backend/internal/domain"
	"github.com/codefun/tagmanager/backend/internal/llm"
	"github.com/codefun/tagmanager/backend/internal/repository"
	"github.com/codefun/tagmanager/backend/internal/service"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"github.com/google/uuid"
)

type API struct {
	store     *repository.Store
	cfg       config.Config
	llmClient *llm.OpenAICompatibleClient
}
type authContextKey struct{}

func New(store *repository.Store, cfg config.Config) http.Handler {
	api := &API{
		store:     store,
		cfg:       cfg,
		llmClient: llm.NewOpenAICompatible(cfg.LLM, nil),
	}
	router := chi.NewRouter()
	router.Use(cors.Handler(cors.Options{AllowedOrigins: []string{cfg.CORSOrigin}, AllowedMethods: []string{"GET", "POST", "PATCH", "OPTIONS"}, AllowedHeaders: []string{"Accept", "Authorization", "Content-Type", "Idempotency-Key"}}))
	router.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		respond(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	router.Get("/readyz", func(w http.ResponseWriter, r *http.Request) {
		if err := api.store.Ping(r.Context()); err != nil {
			respondError(w, http.StatusServiceUnavailable, "database unready")
			return
		}
		respond(w, http.StatusOK, map[string]string{"status": "ready"})
	})
	router.Route("/api/v1", func(r chi.Router) {
		r.Post("/auth/login", api.login)
		r.Group(func(r chi.Router) {
			r.Use(api.authenticate)
			r.Get("/me", api.me)
			r.Post("/auth/change-password", api.changePassword)
			r.Get("/namespaces", api.listNamespaces)
			r.Post("/namespaces", api.require(domain.RoleAdmin, api.createNamespace))
			r.Get("/tags", api.listTags)
			r.Post("/tags/match", api.matchTags)
			r.Get("/candidate-pools/{namespaceID}/entries", api.listPool)
			r.Post("/candidate-pools/{namespaceID}/consolidate", api.require(domain.RoleAdmin, api.triggerConsolidation))
			r.Get("/consolidation-jobs", api.listConsolidationJobs)
			r.Get("/consolidation-jobs/{jobID}", api.getConsolidationJob)
			r.Post("/imports", api.require(domain.RoleAdmin, api.importTags))
			r.Get("/review/proposals", api.listProposals)
			r.Get("/review/proposals/{proposalID}", api.getProposal)
			r.Post("/review/proposals/{proposalID}/decision", api.require(domain.RoleReviewer, api.decideProposal))
			r.Post("/review/proposals/{proposalID}/ai-evaluate", api.require(domain.RoleReviewer, api.evaluateProposalAI))
			r.Get("/api-keys", api.listAPIKeys)
			r.Post("/api-keys", api.createAPIKey)
			r.Delete("/api-keys/{id}", api.revokeAPIKey)
			r.Get("/settings", api.getSettings)
			r.Patch("/settings", api.require(domain.RoleAdmin, api.updateSettings))
			r.Post("/settings/fetch-models", api.require(domain.RoleAdmin, api.fetchLLMModels))
			r.Post("/settings/test-llm", api.require(domain.RoleAdmin, api.testLLMConnection))
			r.Get("/users", api.require(domain.RoleAdmin, api.listUsers))
			r.Post("/users", api.require(domain.RoleAdmin, api.createUser))
			r.Patch("/users/{id}/role", api.require(domain.RoleAdmin, api.updateUserRole))
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
	user, hash, err := a.store.FindUserByEmail(r.Context(), body.Email)
	if err != nil || service.VerifyPassword(hash, body.Password) != nil {
		respondError(w, http.StatusUnauthorized, "invalid email or password")
		return
	}
	token, err := service.IssueToken(a.cfg.JWTSecret, user.ID, user.Role)
	if err != nil {
		respondError(w, 500, "could not issue token")
		return
	}
	respond(w, 200, map[string]any{"token": token, "user": user})
}
func (a *API) me(w http.ResponseWriter, r *http.Request) { respond(w, 200, currentUser(r)) }
func (a *API) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tokenStr := ""
		apiKeyHeader := r.Header.Get("X-API-Key")
		if apiKeyHeader != "" {
			tokenStr = apiKeyHeader
		} else {
			parts := strings.Fields(r.Header.Get("Authorization"))
			if len(parts) == 2 && (parts[0] == "Bearer" || parts[0] == "ApiKey") {
				tokenStr = parts[1]
			}
		}

		if strings.HasPrefix(tokenStr, "tm_live_") {
			user, err := a.store.AuthenticateAPIKey(r.Context(), tokenStr)
			if err != nil {
				respondError(w, 401, err.Error())
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), authContextKey{}, user)))
			return
		}

		if tokenStr == "" {
			respondError(w, 401, "authentication required")
			return
		}

		claims, err := service.ParseToken(a.cfg.JWTSecret, tokenStr)
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
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	items, err := a.store.ListTags(r.Context(), r.URL.Query().Get("namespaceId"), r.URL.Query().Get("q"), limit)
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
func (a *API) triggerConsolidation(w http.ResponseWriter, r *http.Request) {
	result, err := a.store.TriggerConsolidation(r.Context(), chi.URLParam(r, "namespaceID"), currentUser(r).ID)
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "namespace not found") {
			respondError(w, http.StatusNotFound, msg)
			return
		}
		if strings.Contains(msg, "no open candidates") {
			respondError(w, http.StatusBadRequest, msg)
			return
		}
		respondError(w, http.StatusBadRequest, msg)
		return
	}
	respond(w, http.StatusOK, result)
}
func (a *API) listConsolidationJobs(w http.ResponseWriter, r *http.Request) {
	namespaceID := strings.TrimSpace(r.URL.Query().Get("namespaceId"))
	if namespaceID == "" {
		respondError(w, http.StatusBadRequest, "namespaceId is required")
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	items, err := a.store.ListConsolidationJobs(r.Context(), namespaceID, limit)
	if err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	respond(w, http.StatusOK, map[string]any{"data": items})
}
func (a *API) getConsolidationJob(w http.ResponseWriter, r *http.Request) {
	item, err := a.store.GetConsolidationJob(r.Context(), chi.URLParam(r, "jobID"))
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			respondError(w, http.StatusNotFound, "job not found")
			return
		}
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	respond(w, http.StatusOK, item)
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
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if key == "" {
		respondError(w, http.StatusBadRequest, "Idempotency-Key header is required")
		return
	}
	result, err := a.store.ImportTags(r.Context(), body.NamespaceID, key, body.SourceName, currentUser(r).ID, body.Tags, body.InitialSeed, service.NormalizeTag)
	if err != nil {
		respondError(w, 400, err.Error())
		return
	}
	respond(w, 201, result)
}
func (a *API) listProposals(w http.ResponseWriter, r *http.Request) {
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	items, err := a.listProposalData(r.Context(), "", status)
	if err != nil {
		if strings.Contains(err.Error(), "invalid status filter") {
			respondError(w, 400, err.Error())
			return
		}
		respondError(w, 500, err.Error())
		return
	}
	respond(w, 200, map[string]any{"data": items})
}
func (a *API) getProposal(w http.ResponseWriter, r *http.Request) {
	items, err := a.listProposalData(r.Context(), chi.URLParam(r, "proposalID"), "")
	if err != nil || len(items) == 0 {
		respondError(w, 404, "proposal not found")
		return
	}
	respond(w, 200, items[0])
}
func (a *API) decideProposal(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Approve  bool                             `json:"approve"`
		Action   string                           `json:"action"`
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
	err := a.store.DecideProposal(r.Context(), chi.URLParam(r, "proposalID"), currentUser(r).ID, repository.ProposalDecision{
		Approve:  body.Approve,
		Action:   body.Action,
		Version:  body.Version,
		Comments: body.Comments,
		Tags:     body.Tags,
	}, service.NormalizeTag)
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

func (a *API) listProposalData(ctx context.Context, proposalID, statusFilter string) ([]domain.Proposal, error) {
	return a.store.ListProposals(ctx, proposalID, statusFilter)
}

func (a *API) listUsers(w http.ResponseWriter, r *http.Request) {
	users, err := a.store.ListUsers(r.Context())
	if err != nil {
		respondError(w, 500, err.Error())
		return
	}
	respond(w, http.StatusOK, map[string]any{"data": users})
}

func (a *API) createUser(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string      `json:"email"`
		Password string      `json:"password"`
		Role     domain.Role `json:"role"`
	}
	if decode(w, r, &body) != nil {
		return
	}
	if body.Role != domain.RoleAdmin && body.Role != domain.RoleReviewer && body.Role != domain.RoleOperator {
		respondError(w, 400, "invalid role")
		return
	}
	if body.Password != "" {
		if err := service.ValidatePasswordStrength(body.Password); err != nil {
			respondError(w, 400, err.Error())
			return
		}
	} else {
		body.Password = "TempPwd!" + uuid.NewString()[:8]
	}
	hash, err := service.HashPassword(body.Password)
	if err != nil {
		respondError(w, 500, "failed to hash password")
		return
	}
	user, err := a.store.CreateUser(r.Context(), body.Email, hash, body.Role, true)
	if err != nil {
		respondError(w, 400, err.Error())
		return
	}
	respond(w, http.StatusCreated, map[string]any{
		"user":            user,
		"initialPassword": body.Password,
	})
}

func (a *API) updateUserRole(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Role domain.Role `json:"role"`
	}
	if decode(w, r, &body) != nil {
		return
	}
	if body.Role != domain.RoleAdmin && body.Role != domain.RoleReviewer && body.Role != domain.RoleOperator {
		respondError(w, 400, "invalid role")
		return
	}
	user, err := a.store.UpdateUserRole(r.Context(), chi.URLParam(r, "id"), body.Role)
	if err != nil {
		respondError(w, 400, err.Error())
		return
	}
	respond(w, http.StatusOK, user)
}

func (a *API) changePassword(w http.ResponseWriter, r *http.Request) {
	var body struct {
		OldPassword string `json:"oldPassword"`
		NewPassword string `json:"newPassword"`
	}
	if decode(w, r, &body) != nil {
		return
	}
	if err := service.ValidatePasswordStrength(body.NewPassword); err != nil {
		respondError(w, 400, err.Error())
		return
	}
	user := currentUser(r)
	_, hash, err := a.store.FindUserByEmail(r.Context(), user.Email)
	if err != nil || service.VerifyPassword(hash, body.OldPassword) != nil {
		respondError(w, http.StatusBadRequest, "incorrect old password")
		return
	}
	newHash, err := service.HashPassword(body.NewPassword)
	if err != nil {
		respondError(w, 500, "failed to hash password")
		return
	}
	if err := a.store.UpdateUserPassword(r.Context(), user.ID, newHash); err != nil {
		respondError(w, 500, err.Error())
		return
	}
	respond(w, http.StatusOK, map[string]string{"status": "password updated"})
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
	if status >= 500 {
		slog.Error("internal server error", "status", status, "internalMessage", message)
		message = "internal server error"
	}
	respond(w, status, map[string]any{"error": map[string]string{"message": message}})
}

func (a *API) matchTags(w http.ResponseWriter, r *http.Request) {
	var body domain.TagMatchRequest
	if decode(w, r, &body) != nil {
		return
	}
	res, err := a.store.MatchTags(r.Context(), body, currentUser(r).ID, service.NormalizeTag)
	if err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	respond(w, http.StatusOK, res)
}

func (a *API) listAPIKeys(w http.ResponseWriter, r *http.Request) {
	keys, err := a.store.ListAPIKeys(r.Context(), currentUser(r).ID)
	if err != nil {
		respondError(w, 500, err.Error())
		return
	}
	respond(w, http.StatusOK, map[string]any{"data": keys})
}

func (a *API) createAPIKey(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if decode(w, r, &body) != nil {
		return
	}
	res, err := a.store.CreateAPIKey(r.Context(), currentUser(r).ID, body.Name)
	if err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	respond(w, http.StatusCreated, res)
}

func (a *API) revokeAPIKey(w http.ResponseWriter, r *http.Request) {
	keyID := chi.URLParam(r, "id")
	if keyID == "" {
		respondError(w, http.StatusBadRequest, "missing key id")
		return
	}
	if err := a.store.RevokeAPIKey(r.Context(), currentUser(r).ID, keyID); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	respond(w, http.StatusOK, map[string]string{"status": "api key revoked"})
}

func (a *API) evaluateProposalAI(w http.ResponseWriter, r *http.Request) {
	proposalID := chi.URLParam(r, "proposalID")
	if proposalID == "" {
		respondError(w, http.StatusBadRequest, "missing proposal id")
		return
	}

	var body domain.AIAuditEvaluateRequest
	_ = decode(w, r, &body)

	proposals, err := a.store.ListProposals(r.Context(), proposalID, "")
	if err != nil || len(proposals) == 0 {
		respondError(w, http.StatusNotFound, "proposal not found")
		return
	}
	proposal := proposals[0]

	candidateEntries, _ := a.store.GetProposalCandidateEntries(r.Context(), proposalID)

	res, err := a.llmClient.EvaluateProposal(r.Context(), body.Config, proposal, candidateEntries)
	if err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	respond(w, http.StatusOK, res)
}

func (a *API) getSettings(w http.ResponseWriter, r *http.Request) {
	var payload domain.SystemSettingsPayload
	_ = a.store.GetSystemSetting(r.Context(), "consolidation_llm_config", &payload.ConsolidationLLM)
	_ = a.store.GetSystemSetting(r.Context(), "audit_llm_config", &payload.AuditLLM)

	if payload.ConsolidationLLM.BaseURL == "" {
		payload.ConsolidationLLM.BaseURL = a.cfg.LLM.BaseURL
	}
	if payload.ConsolidationLLM.Model == "" {
		payload.ConsolidationLLM.Model = a.cfg.LLM.Model
	}
	if payload.AuditLLM.BaseURL == "" {
		payload.AuditLLM.BaseURL = a.cfg.LLM.BaseURL
	}
	if payload.AuditLLM.Model == "" {
		payload.AuditLLM.Model = a.cfg.LLM.Model
	}

	respond(w, http.StatusOK, payload)
}

func (a *API) updateSettings(w http.ResponseWriter, r *http.Request) {
	var payload domain.SystemSettingsPayload
	if decode(w, r, &payload) != nil {
		return
	}
	userID := currentUser(r).ID
	if err := a.store.SaveSystemSetting(r.Context(), "consolidation_llm_config", payload.ConsolidationLLM, userID); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := a.store.SaveSystemSetting(r.Context(), "audit_llm_config", payload.AuditLLM, userID); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	respond(w, http.StatusOK, map[string]string{"status": "settings updated"})
}

func (a *API) fetchLLMModels(w http.ResponseWriter, r *http.Request) {
	var body domain.FetchModelsRequest
	if decode(w, r, &body) != nil {
		return
	}
	models, err := a.llmClient.FetchModels(r.Context(), body.BaseURL, body.APIKey)
	if err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	respond(w, http.StatusOK, domain.FetchModelsResponse{Models: models})
}

func (a *API) testLLMConnection(w http.ResponseWriter, r *http.Request) {
	var body domain.TestLLMRequest
	if decode(w, r, &body) != nil {
		return
	}
	latency, err := a.llmClient.TestConnection(r.Context(), body)
	if err != nil {
		respond(w, http.StatusOK, domain.TestLLMResponse{
			Success:   false,
			LatencyMs: latency,
			Message:   err.Error(),
		})
		return
	}
	respond(w, http.StatusOK, domain.TestLLMResponse{
		Success:   true,
		LatencyMs: latency,
		Message:   fmt.Sprintf("连接成功！延迟 %d ms", latency),
	})
}
