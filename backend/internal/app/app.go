package app

import (
	"context"
	"log/slog"

	"github.com/codefun/tagmanager/backend/internal/config"
	"github.com/codefun/tagmanager/backend/internal/repository"
	"github.com/codefun/tagmanager/backend/internal/service"
)

type App struct {
	Config   config.Config
	Database *repository.Database
	Store    *repository.Store
}

func Open(ctx context.Context, cfg config.Config) (*App, error) {
	db, err := repository.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return nil, err
	}
	if err = db.Migrate(ctx); err != nil {
		db.Close()
		return nil, err
	}
	hash, err := service.HashPassword(cfg.SeedAdminPassword)
	if err != nil {
		db.Close()
		return nil, err
	}
	if err = db.SeedAdmin(ctx, cfg.SeedAdminEmail, hash); err != nil {
		db.Close()
		return nil, err
	}
	slog.Info("database migrated and default administrator ensured", "email", cfg.SeedAdminEmail)
	return &App{Config: cfg, Database: db, Store: repository.NewStore(db)}, nil
}

func (a *App) Close() { a.Database.Close() }
