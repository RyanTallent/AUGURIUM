# One-time GitHub setup for AUGURIUM
# Run from repo root: .\scripts\setup-github.ps1

$ErrorActionPreference = "Stop"

Write-Host "AUGURIUM — GitHub setup" -ForegroundColor Cyan
Write-Host ""

# Check gh
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Write-Host "Installing GitHub CLI..." -ForegroundColor Yellow
  winget install GitHub.cli --accept-package-agreements --accept-source-agreements
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
}

# Auth check
gh auth status 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Log in to GitHub (browser flow):" -ForegroundColor Yellow
  gh auth login -p https -w
}

$repoName = "AUGURIUM"
$visibility = "private"

Write-Host ""
Write-Host "Creating GitHub repo '$repoName' and pushing main..." -ForegroundColor Green

gh repo create $repoName --$visibility --source=. --remote=origin --push

if ($LASTEXITCODE -eq 0) {
  Write-Host ""
  Write-Host "Done. From now on: commit in Cursor -> Sync/Push -> GitHub." -ForegroundColor Green
  gh repo view --web
} else {
  Write-Host "Repo may already exist. Adding remote manually..." -ForegroundColor Yellow
  $user = gh api user -q .login
  git remote add origin "https://github.com/$user/$repoName.git" 2>$null
  git push -u origin main
}
