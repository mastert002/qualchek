# QualChek - Start both servers
# Kills any existing processes on port 3001 and 3100 first

Write-Host "Stopping any existing servers..." -ForegroundColor Yellow

$ports = @(3100, 3001)
foreach ($port in $ports) {
    $proc = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
            Select-Object -First 1 -ExpandProperty OwningProcess
    if ($proc) {
        Stop-Process -Id $proc -Force -ErrorAction SilentlyContinue
        Write-Host "  Killed PID $proc on port $port" -ForegroundColor Gray
    }
}

Start-Sleep -Seconds 1

Write-Host ""
Write-Host "Starting Backend (port 3001)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\backend'; node src/index.js"

Start-Sleep -Seconds 2

Write-Host "Starting Frontend (port 3100)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\frontend'; npm run dev"

Write-Host ""
Write-Host "QualChek is starting up!" -ForegroundColor Green
Write-Host "  Frontend: http://localhost:3100" -ForegroundColor White
Write-Host "  Backend:  http://localhost:3001" -ForegroundColor White
