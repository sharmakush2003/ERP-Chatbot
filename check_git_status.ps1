# Dedicated Git Status & Sync Script for Erp-Chatbot
# Target GitHub Repository: https://github.com/sharmakush2003/ERP-Chatbot.git

$projectName = "Erp-Chatbot"
$targetRemote = "https://github.com/sharmakush2003/ERP-Chatbot.git"
$projectPath  = $PSScriptRoot

Write-Host "
[Syncing $projectName with GitHub Repository: $targetRemote]
" -ForegroundColor Cyan

Push-Location $projectPath
try {
    Write-Host "Fetching latest changes from GitHub..." -NoNewline
    git fetch origin 2>&1 | Out-Null
    Write-Host " [DONE]" -ForegroundColor Green
    
    $branch = (git rev-parse --abbrev-ref HEAD 2>&1).Trim()
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
    
    Write-Host "
==================== GIT STATUS REPORT ====================" -ForegroundColor Yellow
    [PSCustomObject]@{
        Project      = $projectName
        Branch       = $branch
        GitStatus    = $statusStr
        LocalChanges = $uncommittedStr
        GitHubRepo   = $targetRemote
    } | Format-Table -AutoSize
} finally {
    Pop-Location
}