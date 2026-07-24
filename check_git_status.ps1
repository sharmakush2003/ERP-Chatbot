# Unified Master Git Status & Sync Checker
# Scans and syncs ALL projects in both 'App Development' and 'Web Development'

$basePaths = @(
    'C:\Users\kushs\OneDrive\Documents\App Development',
    'C:\Users\kushs\OneDrive\Documents\Web Development'
)

Write-Host "
==================== MASTER GIT SYNC & STATUS CHECKER ====================" -ForegroundColor Cyan
Write-Host "Fetching and checking Git status across ALL App & Web Development projects...
" -ForegroundColor Cyan

$results = @()

foreach ($base in $basePaths) {
    if (-not (Test-Path $base)) { continue }
    $category = Split-Path $base -Leaf
    $dirs = Get-ChildItem -Path $base -Directory | Where-Object { Test-Path (Join-Path $_.FullName '.git') }
    
    foreach ($d in $dirs) {
        $folderName = $d.Name
        $fullPath = $d.FullName
        
        Push-Location $fullPath
        try {
            Write-Host "Syncing [$category] '$folderName' with GitHub..." -NoNewline
            git fetch --all 2>&1 | Out-Null
            Write-Host " [DONE]" -ForegroundColor Green
            
            $branch = (git rev-parse --abbrev-ref HEAD 2>&1).Trim()
            $remoteUrl = (git config --get remote.origin.url 2>&1).Trim()
            if ($remoteUrl -match '@github\.com') {
                $remoteUrl = 'https://github.com/' + ($remoteUrl -split '@github\.com/')[1]
            }
            
            $upstream = (git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>&1).Trim()
            $ahead = 0
            $behind = 0
            $statusStr = ''
            
            if ($upstream -like '*fatal*' -or [string]::IsNullOrWhiteSpace($upstream)) {
                $statusStr = 'No Upstream Remote'
            } else {
                $aheadStr = (git rev-list --count '@{u}..HEAD' 2>&1).Trim()
                $behindStr = (git rev-list --count 'HEAD..@{u}' 2>&1).Trim()
                if ($aheadStr -match '^\d+$') { $ahead = [int]$aheadStr }
                if ($behindStr -match '^\d+$') { $behind = [int]$behindStr }
                
                if ($ahead -eq 0 -and $behind -eq 0) {
                    $statusStr = 'Up to date'
                } elseif ($ahead -gt 0 -and $behind -eq 0) {
                    $statusStr = "Ahead ($ahead commits)"
                } elseif ($ahead -eq 0 -and $behind -gt 0) {
                    $statusStr = "Behind ($behind commits)"
                } else {
                    $statusStr = "Diverged (+ $ahead / - $behind)"
                }
            }
            
            $dirty = (git status --porcelain 2>&1)
            $uncommittedStr = if ($dirty) { 'Uncommitted Changes' } else { 'Clean' }
            
            $results += [PSCustomObject]@{
                Category     = $category
                Project      = $folderName
                Branch       = $branch
                GitStatus    = $statusStr
                LocalChanges = $uncommittedStr
                GitHubRepo   = $remoteUrl
            }
        } finally {
            Pop-Location
        }
    }
}

Write-Host "
==================== MASTER GIT STATUS REPORT ====================" -ForegroundColor Yellow
$results | Format-Table -AutoSize