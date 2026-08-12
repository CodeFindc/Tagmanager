package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

func main() {
	defaultURL := os.Getenv("LLM_BASE_URL")
	if defaultURL == "" {
		defaultURL = "http://192.168.110.209:8200/v1"
	}
	defaultModel := os.Getenv("LLM_MODEL")
	if defaultModel == "" {
		defaultModel = "Qwen3.6-27B-AEON-Ultimate-Uncensored-BF16"
	}
	defaultKey := os.Getenv("LLM_API_KEY")

	baseURL := flag.String("url", defaultURL, "LLM Base URL")
	apiKey := flag.String("key", defaultKey, "LLM API Key")
	model := flag.String("model", defaultModel, "LLM Model Name")
	flag.Parse()

	url := strings.TrimRight(*baseURL, "/")
	key := strings.TrimSpace(*apiKey)

	fmt.Println("==================================================")
	fmt.Println(" TagManager LLM Direct Probe Diagnostic Tool (Go) ")
	fmt.Printf(" BaseURL: %s\n", url)
	fmt.Printf(" Model:   %s\n", *model)
	fmt.Println("==================================================")

	client := &http.Client{Timeout: 30 * time.Minute}

	// 1. Models Test
	fmt.Print("\n[Test 1/4] GET /v1/models ... ")
	req, _ := http.NewRequest("GET", url+"/models", nil)
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	start := time.Now()
	resp, err := client.Do(req)
	elapsed := time.Since(start)

	if err != nil {
		fmt.Printf("FAILED (%v): %v\n", elapsed, err)
	} else {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode == 200 {
			fmt.Printf("SUCCESS (%v)\n Response: %s\n", elapsed, truncateStr(string(body), 200))
		} else {
			fmt.Printf("HTTP %d (%v)\n Response: %s\n", resp.StatusCode, elapsed, truncateStr(string(body), 200))
		}
	}

	// 2. Minimal Prompt Streaming Test
	fmt.Println("\n[Test 2/4] Minimal 1-Sentence Streaming Prompt ...")
	probeStream(client, url, key, *model, "你好，请用一句话简短介绍你自己。", 100)

	// 3. 81-Entry Snapshot Payload Test #1
	snapshotPrompt := `{"namespaceName":"事件标签","existingTags":["交通事故与交通违法","水域安全事故","消防火灾与隐患"],"entries":[{"id":"cand-001","name":"涉交通拥堵","occurrences":15},{"id":"cand-002","name":"军交通事故","occurrences":3},{"id":"cand-003","name":"无人机黑飞黑关","occurrences":8},{"id":"cand-004","name":"电动自行车擦碰机动车","occurrences":12},{"id":"cand-005","name":"高空抛物危险因素","occurrences":5},{"id":"cand-006","name":"小区内部道路积水","occurrences":4},{"id":"cand-007","name":"商铺违规占用消防通道","occurrences":9},{"id":"cand-008","name":"电线短路冒烟着火","occurrences":11},{"id":"cand-009","name":"河道非法钓鱼与溺水隐患","occurrences":7},{"id":"cand-010","name":"违规燃放烟花爆竹","occurrences":6}]}`

	fmt.Println("\n[Test 3/4] Real Candidate Window Streaming Prompt (Call #1) ...")
	ttft1, total1 := probeStream(client, url, key, *model, snapshotPrompt, 2048)

	// 4. Consecutive Call #2
	fmt.Println("\n[Test 4/4] Real Candidate Window Streaming Prompt (Call #2 - Consecutive) ...")
	ttft2, total2 := probeStream(client, url, key, *model, snapshotPrompt, 2048)

	fmt.Println("\n==================================================")
	fmt.Println(" Diagnostic Probe Summary Report ")
	fmt.Println("==================================================")
	fmt.Printf(" Call #1: TTFT = %v, Total Time = %v\n", ttft1, total1)
	fmt.Printf(" Call #2: TTFT = %v, Total Time = %v\n", ttft2, total2)
	if ttft1 > 0 && ttft2 > ttft1*3/2 {
		fmt.Println(" WARNING: Call #2 TTFT is significantly higher than Call #1! Indicates GPU queuing / cancellation unreleased memory.")
	} else if ttft1 > 0 {
		fmt.Println(" INFO: Call #2 TTFT is consistent with Call #1.")
	}
	fmt.Println("==================================================")
}

func probeStream(client *http.Client, baseURL, apiKey, model, prompt string, maxTokens int) (time.Duration, time.Duration) {
	reqBody := map[string]any{
		"model":       model,
		"stream":      true,
		"temperature": 0,
		"max_tokens":  maxTokens,
		"messages": []map[string]string{
			{"role": "user", "content": prompt},
		},
	}
	bodyBytes, _ := json.Marshal(reqBody)

	req, err := http.NewRequestWithContext(context.Background(), "POST", baseURL+"/chat/completions", bytes.NewReader(bodyBytes))
	if err != nil {
		fmt.Printf("  Create request failed: %v\n", err)
		return 0, 0
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}

	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		fmt.Printf("  HTTP Request error after %v: %v\n", time.Since(start).Round(time.Millisecond), err)
		return 0, 0
	}
	defer resp.Body.Close()

	ttfb := time.Since(start).Round(time.Millisecond)
	fmt.Printf("  HTTP Response Headers Received (TTFB: %v, Status: %s)\n", ttfb, resp.Status)

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		fmt.Printf("  HTTP Error Response Body: %s\n", string(body))
		return 0, 0
	}

	scanner := bufio.NewScanner(resp.Body)
	chunks := 0
	var ttft time.Duration
	var contentBuilder strings.Builder

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, ":") {
			continue
		}
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			break
		}

		if ttft == 0 {
			ttft = time.Since(start).Round(time.Millisecond)
			fmt.Printf("  First Token Received (TTFT: %v / %.2fs)!\n", ttft, ttft.Seconds())
		}
		chunks++

		var piece struct {
			Choices []struct {
				Delta struct {
					Content          string `json:"content"`
					ReasoningContent string `json:"reasoning_content"`
				} `json:"delta"`
			} `json:"choices"`
		}
		if err := json.Unmarshal([]byte(data), &piece); err == nil && len(piece.Choices) > 0 {
			txt := piece.Choices[0].Delta.Content
			if txt == "" {
				txt = piece.Choices[0].Delta.ReasoningContent
			}
			contentBuilder.WriteString(txt)
		}
	}

	total := time.Since(start).Round(time.Millisecond)
	if err := scanner.Err(); err != nil {
		fmt.Printf("  Stream Error after %v: %v\n", total, err)
		return ttft, total
	}

	fmt.Printf("  Stream Completed Successfully! Chunks: %d, ContentBytes: %d, Total Time: %v\n", chunks, contentBuilder.Len(), total)
	if contentBuilder.Len() > 0 {
		fmt.Printf("  Output Preview: %s\n", truncateStr(contentBuilder.String(), 150))
	}
	return ttft, total
}

func truncateStr(s string, n int) string {
	s = strings.ReplaceAll(s, "\n", " ")
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
