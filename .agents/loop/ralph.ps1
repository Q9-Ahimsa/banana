<#
.SYNOPSIS
    Headless ralph loop runner — fresh-context iterations calling `claude -p` until
    the prd.json backlog is complete or the iteration cap is hit.

.DESCRIPTION
    PowerShell 7+ port of the snarktank ralph.sh pattern. Each iteration:
      1. On the FIRST run against a given branchName, does nothing special. On any
         SUBSEQUENT run where prd.json's branchName has changed since last time,
         archives the previous run's per-iteration logs (and a snapshot copy of the
         current prd.json, for audit) to archive/YYYY-MM-DD-<old-branch>/, then
         starts a clean logs/ dir. prd.json is copied, not moved — the loop below
         still needs it on disk to run.
      2. Invokes `claude -p <loop-prompt.md content> --dangerously-skip-permissions`.
         Fresh context every iteration — state lives on disk (prd.json,
         .agents/session.log), never in the agent's memory.
      3. Tees output to console + .agents/loop/logs/iter-NNN.log.
      4. Greps output for the literal sentinel <promise>COMPLETE</promise>.
         Exits 0 if found.
      5. Sleeps 2s, repeats until -MaxIterations is exhausted (then exits 1).

    SANDBOX WARNING: this script runs Claude with --dangerously-skip-permissions,
    unattended, for up to -MaxIterations turns. Run it in a dedicated worktree or a
    throwaway repo clone. Never point it at ~ or a system directory. Ask "what's the
    blast radius if this goes wrong unsupervised?" before launching — see the loops
    skill's preflight gate (~/.claude/skills/loops/SKILL.md).

.PARAMETER MaxIterations
    Hard cap on iterations. There is no unbounded mode.

.PARAMETER LoopDir
    Directory holding prd.json, loop-prompt.md, logs/, archive/. Default .agents/loop.

.PARAMETER Tool
    CLI binary to invoke. Default claude.

.EXAMPLE
    ./.agents/loop/ralph.ps1 -MaxIterations 10
#>

param(
    [int]$MaxIterations = 10,
    [string]$LoopDir = ".agents/loop",
    [string]$Tool = "claude"
)

$ErrorActionPreference = "Stop"

$prdPath = Join-Path $LoopDir "prd.json"
$promptPath = Join-Path $LoopDir "loop-prompt.md"
$logsDir = Join-Path $LoopDir "logs"
$archiveDir = Join-Path $LoopDir "archive"
$lastBranchPath = Join-Path $LoopDir ".last-branch"

if (-not (Test-Path $prdPath)) {
    Write-Error "Missing $prdPath — run the loops skill's prep operation first."
    exit 1
}
if (-not (Test-Path $promptPath)) {
    Write-Error "Missing $promptPath — copy templates/loop-prompt.md into $LoopDir first."
    exit 1
}

if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
}

# --- Archive-on-branch-change ---
$prd = Get-Content -Raw $prdPath | ConvertFrom-Json
$currentBranch = $prd.branchName
$lastBranch = $null
if (Test-Path $lastBranchPath) {
    $lastBranch = (Get-Content -Raw $lastBranchPath).Trim()
}

if ($lastBranch -and $lastBranch -ne $currentBranch) {
    $date = Get-Date -Format "yyyy-MM-dd"
    $safeOldBranch = ($lastBranch -replace '[\\/:*?"<>|]', '-')
    $dest = Join-Path $archiveDir "$date-$safeOldBranch"
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Write-Host "Branch changed ($lastBranch -> $currentBranch). Archiving prior run to $dest"
    Copy-Item -Path $prdPath -Destination (Join-Path $dest "prd.json") -Force
    $priorLogs = Get-ChildItem -Path $logsDir -ErrorAction SilentlyContinue
    if ($priorLogs) {
        Move-Item -Path (Join-Path $logsDir "*") -Destination $dest -Force
    }
}
Set-Content -Path $lastBranchPath -Value $currentBranch -NoNewline

# --- Main loop ---
$promptText = Get-Content -Raw $promptPath
$sentinel = "<promise>COMPLETE</promise>"
$completed = $false

for ($i = 1; $i -le $MaxIterations; $i++) {
    $iterLabel = "{0:D3}" -f $i
    $logPath = Join-Path $logsDir "iter-$iterLabel.log"
    Write-Host "=== Iteration $i / $MaxIterations ==="

    $output = & $Tool -p $promptText --dangerously-skip-permissions 2>&1 |
        Tee-Object -FilePath $logPath
    $outputText = $output | Out-String

    if ($outputText -match [regex]::Escape($sentinel)) {
        $completed = $true
        Write-Host "=== COMPLETE at iteration $i / $MaxIterations ==="
        break
    }

    if ($i -lt $MaxIterations) {
        Start-Sleep -Seconds 2
    }
}

if ($completed) {
    exit 0
}

Write-Host "=== NOT COMPLETE after $MaxIterations iterations — see $logsDir ==="
exit 1
