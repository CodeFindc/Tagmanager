package main

import (
	"context"
	"log"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/codefun/tagmanager/backend/internal/app"
	"github.com/codefun/tagmanager/backend/internal/config"
	"github.com/codefun/tagmanager/backend/internal/llm"
	"github.com/codefun/tagmanager/backend/internal/worker"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	application, err := app.Open(ctx, cfg)
	if err != nil {
		log.Fatal(err)
	}
	defer application.Close()
	processor := worker.New(application.Database.Pool, llm.NewOpenAICompatible(cfg.LLM), slog.Default(), cfg.LLM.MaxRetries)
	if err := processor.Run(ctx); err != nil && ctx.Err() == nil {
		log.Fatal(err)
	}
}
