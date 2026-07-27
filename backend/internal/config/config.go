package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	DatabaseURL       string
	APIPort           string
	CORSOrigin        string
	JWTSecret         string
	SeedAdminEmail    string
	SeedAdminPassword string
	LLM               LLMConfig
}

type LLMConfig struct {
	BaseURL    string
	APIKey     string
	Model      string
	Timeout    time.Duration
	MaxRetries int
}

func Load() (Config, error) {
	cfg := Config{
		DatabaseURL:       strings.TrimSpace(os.Getenv("DATABASE_URL")),
		APIPort:           valueOrDefault("API_PORT", "8080"),
		CORSOrigin:        valueOrDefault("CORS_ORIGIN", "http://localhost:5173"),
		JWTSecret:         strings.TrimSpace(os.Getenv("JWT_SECRET")),
		SeedAdminEmail:    valueOrDefault("SEED_ADMIN_EMAIL", "admin@example.com"),
		SeedAdminPassword: valueOrDefault("SEED_ADMIN_PASSWORD", "change-me-now"),
		LLM: LLMConfig{
			BaseURL:    strings.TrimRight(strings.TrimSpace(os.Getenv("LLM_BASE_URL")), "/"),
			APIKey:     strings.TrimSpace(os.Getenv("LLM_API_KEY")),
			Model:      strings.TrimSpace(os.Getenv("LLM_MODEL")),
			Timeout:    time.Duration(intValueOrDefault("LLM_TIMEOUT_SECONDS", 60)) * time.Second,
			MaxRetries: intValueOrDefault("LLM_MAX_RETRIES", 3),
		},
	}

	if cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL is required")
	}
	if len(cfg.JWTSecret) < 32 {
		return Config{}, fmt.Errorf("JWT_SECRET must be at least 32 characters")
	}
	return cfg, nil
}

func valueOrDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func intValueOrDefault(key string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(key)))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}
