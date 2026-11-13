# Builds the app and publishes dist/ to the gh-pages branch.
# GitHub Pages serves that branch, so no workflow permissions are required.
#
# Usage (from the repository root):
#   npm run deploy:pages
#
# Requires: Node, npm, git and an authenticated `origin` remote.

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
  $remote = (git remote get-url origin 2>$null)
  if (-not $remote) {
    throw "No 'origin' remote configured. Add one with: git remote add origin <url>"
  }

  $userName = (git config user.name)
  $userEmail = (git config user.email)
  if (-not $userName) { $userName = 'github-actions[bot]' }
  if (-not $userEmail) { $userEmail = '41898282+github-actions[bot]@users.noreply.github.com' }

  Write-Host 'Building production bundle...'
  npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'Build failed. Nothing was published.' }

  $deployDir = Join-Path $env:TEMP 'tournament-manager-gh-pages'
  if (Test-Path $deployDir) { Remove-Item -Recurse -Force $deployDir }
  New-Item -ItemType Directory -Path $deployDir | Out-Null
  Copy-Item -Path (Join-Path $repoRoot 'dist\*') -Destination $deployDir -Recurse -Force
  New-Item -ItemType File -Path (Join-Path $deployDir '.nojekyll') -Force | Out-Null

  Push-Location $deployDir
  try {
    git init -q -b gh-pages
    git config user.name $userName
    git config user.email $userEmail
    git add -A
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
    git commit -q -m "Deploy tournament manager ($stamp)"
    git push --force $remote gh-pages
    if ($LASTEXITCODE -ne 0) { throw 'Push to gh-pages failed.' }
  }
  finally {
    Pop-Location
    Remove-Item -Recurse -Force $deployDir
  }

  Write-Host 'Published. GitHub Pages usually updates within a minute.'
}
finally {
  Pop-Location
}
