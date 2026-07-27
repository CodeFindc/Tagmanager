package main

import (
	"context"
	"log"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/codefun/tagmanager/backend/internal/app"
	"github.com/codefun/tagmanager/backend/internal/config"
	"github.com/codefun/tagmanager/backend/internal/httpapi"
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
	server := &http.Server{Addr: ":" + cfg.APIPort, Handler: httpapi.New(application.Store, cfg), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		slog.Info("API server listening", "port", cfg.APIPort)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()
	<-ctx.Done()
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdown)
}
