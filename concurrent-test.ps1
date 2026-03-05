param (
    [Parameter(Mandatory=$true)]
    [ValidateSet("pessimistic", "optimistic")]
    [string]$Strategy
)

$ProductId = 1
$Quantity = 10
$Url = "http://localhost:8081/api/orders/$Strategy"

Write-Host "Resetting product stock..." -ForegroundColor Cyan
Invoke-RestMethod -Method Post -Uri "http://localhost:8081/api/products/reset" | Out-Null

Write-Host "`nStarting concurrent test on $Url..." -ForegroundColor Yellow

$jobs = @()
for ($i = 1; $i -le 20; $i++) {
    $userId = "user$i"
    $body = @{
        productId = $ProductId
        quantity = $Quantity
        userId = $userId
    } | ConvertTo-Json

    # Start curl as a background process to simulate concurrency
    $jobs += Start-Process curl.exe -ArgumentList "-s -X POST -H `"Content-Type: application/json`" -d '$body' $Url" -PassThru
}

# Wait for all processes to finish
Write-Host "Waiting for requests to complete..." -ForegroundColor Gray
$jobs | Wait-Process

Write-Host "`nTest finished. Checking stats..." -ForegroundColor Green
$stats = Invoke-RestMethod -Method Get -Uri "http://localhost:8081/api/orders/stats"
$stats | Format-Table
