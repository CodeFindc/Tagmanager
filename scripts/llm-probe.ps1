# PowerShell LLM Direct Endpoint Diagnostic Probe Script
# Probes http://192.168.110.209:8200/v1 without application overhead

param (
    [string]$BaseURL = "http://192.168.110.209:8200/v1",
    [string]$Model = "Qwen3.6-27B-AEON-Ultimate-Uncensored-BF16",
    [string]$APIKey = "dummy-key"
)

$ErrorActionPreference = "Stop"
$BaseURL = $BaseURL.TrimEnd('/')

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " TagManager LLM Direct Probe Diagnostic Tool " -ForegroundColor Cyan
Write-Host " Endpoint: $BaseURL " -ForegroundColor Cyan
Write-Host " Model:    $Model " -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Models List Test
Write-Host "[Test 1/4] Checking GET $BaseURL/models ..." -NoNewline
$sw = [System.Diagnostics.Stopwatch]::StartNew()
try {
    $modelsResp = Invoke-RestMethod -Uri "$BaseURL/models" -Headers @{ "Authorization" = "Bearer $APIKey" } -TimeoutSec 15
    $sw.Stop()
    Write-Host " SUCCESS ($($sw.ElapsedMilliseconds) ms)" -ForegroundColor Green
    $modelIds = $modelsResp.data | ForEach-Object { $_.id }
    Write-Host "  Available Models ($($modelIds.Count)): $($modelIds -join ', ')" -ForegroundColor Gray
} catch {
    $sw.Stop()
    Write-Host " FAILED ($($sw.ElapsedMilliseconds) ms): $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Helper function to send streaming request and time TTFB, TTFT, and total
function Test-LLMStream {
    param (
        [string]$TestName,
        [string]$PromptText,
        [int]$MaxTokens = 2048
    )

    Write-Host "[$TestName] Initiating streaming request..." -ForegroundColor Yellow
    Write-Host "  Prompt preview: $($PromptText.Substring(0, [Math]::Min(80, $PromptText.Length)))..." -ForegroundColor Gray

    $uri = "$BaseURL/chat/completions"
    $bodyJson = @{
        model = $Model
        stream = $true
        temperature = 0
        max_tokens = $MaxTokens
        messages = @(
            @{ role = "user"; content = $PromptText }
        )
    } | ConvertTo-Json -Depth 5 -Compress

    $request = [System.Net.HttpWebRequest]::Create($uri)
    $request.Method = "POST"
    $request.ContentType = "application/json"
    $request.Headers.Add("Authorization", "Bearer $APIKey")
    $request.Accept = "text/event-stream"

    $swTotal = [System.Diagnostics.Stopwatch]::StartNew()
    $ttfb = $null
    $ttft = $null
    $chunks = 0
    $totalBytes = 0

    try {
        $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($bodyJson)
        $request.ContentLength = $bodyBytes.Length
        $reqStream = $request.GetRequestStream()
        $reqStream.Write($bodyBytes, 0, $bodyBytes.Length)
        $reqStream.Close()

        $response = $request.GetResponse()
        $ttfb = $swTotal.ElapsedMilliseconds
        Write-Host "  HTTP Headers Received (TTFB: $ttfb ms, Status: $($response.StatusCode))" -ForegroundColor Cyan

        $streamReader = New-Object System.IO.StreamReader($response.GetResponseStream(), [System.Text.Encoding]::UTF8)

        while (-not $streamReader.EndOfStream) {
            $line = $streamReader.ReadLine()
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            if ($line.StartsWith("data:")) {
                $data = $line.Substring(5).Trim()
                if ($data -eq "[DONE]") { break }

                if ($null -eq $ttft) {
                    $ttft = $swTotal.ElapsedMilliseconds
                    Write-Host "  First Token Received (TTFT: $ttft ms / $([Math]::Round($ttft/1000, 2))s)!" -ForegroundColor Green
                }
                $chunks++
                $totalBytes += $data.Length

                if ($chunks % 50 -eq 0) {
                    Write-Host "    Stream Progress: $chunks chunks, $totalBytes bytes, elapsed: $([Math]::Round($swTotal.ElapsedMilliseconds/1000, 1))s" -ForegroundColor Gray
                }
            }
        }
        $swTotal.Stop()
        $totalSec = [Math]::Round($swTotal.ElapsedMilliseconds / 1000, 2)
        Write-Host "  Stream Completed Successfully! Total Chunks: $chunks, Total Time: ${totalSec}s" -ForegroundColor Green
        return @{ TTFB = $ttfb; TTFT = $ttft; TotalSec = $totalSec; Success = $true }
    } catch {
        $swTotal.Stop()
        $errSec = [Math]::Round($swTotal.ElapsedMilliseconds / 1000, 2)
        Write-Host "  Stream Error after ${errSec}s: $($_.Exception.Message)" -ForegroundColor Red
        return @{ TTFB = $ttfb; TTFT = $ttft; TotalSec = $errSec; Success = $false }
    }
}

# 2. Minimal 1-Sentence Streaming Test
$resMin = Test-LLMStream -TestName "Test 2/4: Minimal 1-Sentence Prompt" -PromptText "Hello, please introduce yourself in one sentence." -MaxTokens 100
Write-Host ""

# Sample Candidate Window Snapshot Payload
$sampleEntriesPrompt = '{"namespaceName":"event_tags","existingTags":["Traffic Accident","Water Safety"],"entries":[{"id":"cand-001","name":"traffic_congestion","occurrences":15},{"id":"cand-002","name":"military_traffic_accident","occurrences":3},{"id":"cand-003","name":"drone_illegal_flight","occurrences":8},{"id":"cand-004","name":"ebike_collision","occurrences":12},{"id":"cand-005","name":"falling_object_hazard","occurrences":5}]}'

# 3. First 81-Entry Snapshot Test
$res81_1 = Test-LLMStream -TestName "Test 3/4: Real Candidate Window (Call #1)" -PromptText $sampleEntriesPrompt -MaxTokens 2048
Write-Host ""

# 4. Immediate Consecutive Call #2 to test GPU Queueing/Release
Write-Host "[Test 4/4] Sending immediate consecutive Call #2 to verify GPU queueing / release..." -ForegroundColor Yellow
$res81_2 = Test-LLMStream -TestName "Test 4/4: Real Candidate Window (Call #2 - Consecutive)" -PromptText $sampleEntriesPrompt -MaxTokens 2048
Write-Host ""

# Diagnostic Summary Report
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " Diagnostic Probe Summary Report " -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " 1. Minimal Prompt TTFT:  $($resMin.TTFT) ms ($([Math]::Round($resMin.TTFT/1000, 2))s)"
Write-Host " 2. Real Snapshot Call #1: TTFT = $($res81_1.TTFT) ms ($([Math]::Round($res81_1.TTFT/1000, 2))s), Total = $($res81_1.TotalSec)s"
Write-Host " 3. Real Snapshot Call #2: TTFT = $($res81_2.TTFT) ms ($([Math]::Round($res81_2.TTFT/1000, 2))s), Total = $($res81_2.TotalSec)s"

if ($res81_2.TTFT -gt ($res81_1.TTFT * 1.5)) {
    Write-Host " WARNING: Call #2 TTFT is significantly higher than Call #1! Indicates GPU queuing / cancellation unreleased memory." -ForegroundColor Red
} else {
    Write-Host " INFO: Call #2 TTFT is consistent with Call #1." -ForegroundColor Green
}
Write-Host "==================================================" -ForegroundColor Cyan
