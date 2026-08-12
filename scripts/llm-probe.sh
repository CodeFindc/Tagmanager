#!/usr/bin/env bash
# LLM Direct Endpoint Diagnostic Probe Script (Bash / curl)
# Probes http://192.168.110.209:8200/v1 without application overhead

BASE_URL="${LLM_BASE_URL:-http://192.168.110.209:8200/v1}"
MODEL="${LLM_MODEL:-Qwen3.6-27B-AEON-Ultimate-Uncensored-BF16}"
API_KEY="${LLM_API_KEY:-dummy-key}"

BASE_URL="${BASE_URL%/}"

echo -e "\033[36m==================================================\033[0m"
echo -e "\033[36m TagManager LLM Direct Probe Diagnostic Tool \033[0m"
echo -e "\033[36m Endpoint: ${BASE_URL} \033[0m"
echo -e "\033[36m Model:    ${MODEL} \033[0m"
echo -e "\033[36m==================================================\033[0m\n"

# 1. GET /v1/models
echo -n "[Test 1/4] Checking GET ${BASE_URL}/models ... "
START_TIME=$(date +%s%N)
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer ${API_KEY}" "${BASE_URL}/models")
END_TIME=$(date +%s%N)
ELAPSED_MS=$(( (END_TIME - START_TIME) / 1000000 ))

if [ "${HTTP_CODE}" -eq 200 ]; then
    echo -e "\033[32mSUCCESS (${ELAPSED_MS} ms)\033[0m"
else
    echo -e "\033[31mFAILED (HTTP ${HTTP_CODE}, ${ELAPSED_MS} ms)\033[0m"
fi
echo ""

# Helper function to send streaming request and log TTFB and TTFT
probe_stream() {
    local label="$1"
    local prompt="$2"
    local max_tokens="$3"

    echo -e "\033[33m[${label}] Initiating streaming request...\033[0m"

    local payload
    payload=$(cat <<EOF
{
  "model": "${MODEL}",
  "stream": true,
  "temperature": 0,
  "max_tokens": ${max_tokens},
  "messages": [{"role": "user", "content": ${prompt}}]
}
EOF
)

    local start_ts
    start_ts=$(date +%s%N)
    local ttfb_ts=0
    local ttft_ts=0
    local chunks=0

    curl -s -N -X POST "${BASE_URL}/chat/completions" \
        -H "Authorization: Bearer ${API_KEY}" \
        -H "Content-Type: application/json" \
        -H "Accept: text/event-stream" \
        -d "${payload}" | while read -r line; do
            if [ ${ttfb_ts} -eq 0 ]; then
                ttfb_ts=$(date +%s%N)
                local ttfb_ms=$(( (ttfb_ts - start_ts) / 1000000 ))
                echo -e "  \033[36mHTTP Response Headers Received (TTFB: ${ttfb_ms} ms)\033[0m"
            fi
            if [[ "${line}" == data:* ]]; then
                if [ ${ttft_ts} -eq 0 ]; then
                    ttft_ts=$(date +%s%N)
                    local ttft_ms=$(( (ttft_ts - start_ts) / 1000000 ))
                    local ttft_sec=$(awk "BEGIN {print ${ttft_ms}/1000}")
                    echo -e "  \033[32mFirst Token Received (TTFT: ${ttft_ms} ms / ${ttft_sec}s)!\033[0m"
                fi
                chunks=$((chunks + 1))
            fi
        done

    local end_ts
    end_ts=$(date +%s%N)
    local total_ms=$(( (end_ts - start_ts) / 1000000 ))
    local total_sec=$(awk "BEGIN {print ${total_ms}/1000}")
    echo -e "  \033[32mCompleted! Chunks: ${chunks}, Total Time: ${total_sec}s\033[0m\n"
}

# 2. Minimal 1-Sentence Prompt
probe_stream "Test 2/4: Minimal 1-Sentence Prompt" "\"你好，请用一句话介绍你自己。\"" 100

# 3. Candidate Window Snapshot Prompt
SNAPSHOT_PROMPT="\"{\\\"namespaceName\\\":\\\"事件标签\\\",\\\"existingTags\\\":[\\\"交通事故与交通违法\\\"],\\\"entries\\\":[{\\\"id\\\":\\\"cand-001\\\",\\\"name\\\":\\\"涉交通拥堵\\\",\\\"occurrences\\\":15},{\\\"id\\\":\\\"cand-002\\\",\\\"name\\\":\\\"军交通事故\\\",\\\"occurrences\\\":3}]}\""

probe_stream "Test 3/4: Real Candidate Window (Call #1)" "${SNAPSHOT_PROMPT}" 2048

# 4. Consecutive Call #2
probe_stream "Test 4/4: Real Candidate Window (Call #2 - Consecutive)" "${SNAPSHOT_PROMPT}" 2048
