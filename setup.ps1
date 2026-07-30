# Claude Code configuration installer for Windows
# Run from PowerShell: .\setup.ps1

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ClaudeDir = Join-Path $env:USERPROFILE ".claude"
$Force = $args -contains "-Force"
$NoPrune = $args -contains "-NoPrune"
$DryRun = $args -contains "-DryRun"

if ($DryRun) {
    Write-Host "DRY-RUN MODE -- no files will be written, no symlinks created."
    Write-Host "Re-run without -DryRun to actually apply."
    Write-Host ""
}

Write-Host "Installing Claude Code configuration from $ScriptDir"
Write-Host "Target: $ClaudeDir"
Write-Host ""

# Symlink capability probe -- runs ONCE, before any file is touched.
# Uses cmd's mklink, which honors Windows Developer Mode (unprivileged symlink
# creation flag). PowerShell's New-Item -SymbolicLink does NOT use that flag
# and demands admin even when Dev Mode is on, so it is unsuitable here.
# If the probe fails, the symlink helper will skip without removing originals.
$script:CanSymlink = $false
$probeTarget = Join-Path $env:TEMP "claude-starter-symlink-probe-target.txt"
$probeLink = Join-Path $env:TEMP "claude-starter-symlink-probe-link.txt"
try {
    if (Test-Path $probeLink) { Remove-Item $probeLink -Force -ErrorAction SilentlyContinue }
    "probe" | Out-File $probeTarget -Encoding ascii -Force
    $mklinkOut = cmd /c "mklink `"$probeLink`" `"$probeTarget`"" 2>&1
    if ($LASTEXITCODE -eq 0 -and (Test-Path $probeLink)) {
        $script:CanSymlink = $true
        Remove-Item $probeLink -Force -ErrorAction SilentlyContinue
        Remove-Item $probeTarget -Force -ErrorAction SilentlyContinue
        Write-Host "  Symlink capability: OK"
    } else {
        throw ($mklinkOut | Out-String).Trim()
    }
} catch {
    if (Test-Path $probeTarget) { Remove-Item $probeTarget -Force -ErrorAction SilentlyContinue }
    if (Test-Path $probeLink) { Remove-Item $probeLink -Force -ErrorAction SilentlyContinue }
    Write-Host "  Symlink capability: UNAVAILABLE ($($_.Exception.Message.Trim()))"
    Write-Host "    CLAUDE.md and dev-layer files will be left in place. Enable Developer Mode at"
    Write-Host "    Settings > Privacy & Security > For developers, then re-run setup.ps1."
}
Write-Host ""

# Create directories
$dirs = @("agents", "rules", "commands", "contexts", "scripts\hooks", "scripts\lib", "skills")
foreach ($dir in $dirs) {
    $p = Join-Path $ClaudeDir $dir
    if ($DryRun) {
        if (-not (Test-Path $p)) { Write-Host "  WOULD create dir: $p" }
    } else {
        New-Item -ItemType Directory -Force -Path $p | Out-Null
    }
}

# Sync-Dir: copy newer files from src->dst, and prune files in dst that aren't
# in src (the repo is source of truth). Use -NoPrune to keep local-only files.
function Sync-Dir {
    param($SrcDir, $DstDir, $Glob)
    if (-not (Test-Path $SrcDir)) { return }
    if (-not $DryRun) {
        New-Item -ItemType Directory -Force -Path $DstDir | Out-Null
    }

    Get-ChildItem (Join-Path $SrcDir $Glob) -ErrorAction SilentlyContinue | ForEach-Object {
        $dst = Join-Path $DstDir $_.Name
        if ($Force -or -not (Test-Path $dst) -or $_.LastWriteTime -gt (Get-Item $dst).LastWriteTime) {
            if ($DryRun) {
                Write-Host "    WOULD copy: $($_.Name) -> $dst"
            } else {
                Copy-Item $_.FullName $dst -Force
            }
        }
    }

    if (-not $NoPrune) {
        Get-ChildItem (Join-Path $DstDir $Glob) -ErrorAction SilentlyContinue | ForEach-Object {
            $src = Join-Path $SrcDir $_.Name
            if (-not (Test-Path $src)) {
                if ($DryRun) {
                    Write-Host "    WOULD prune stale: $($_.Name)"
                } else {
                    Remove-Item $_.FullName -Force
                    Write-Host "    Pruned stale: $($_.Name)"
                }
            }
        }
    }
}

# Agents
if (Test-Path "$ScriptDir\agents") {
    Sync-Dir "$ScriptDir\agents" (Join-Path $ClaudeDir "agents") "*.md"
    $count = (Get-ChildItem "$ScriptDir\agents\*.md").Count
    Write-Host "  Installed $count agents"
}

# Skills (copy skill folders, but symlink learned/)
if (Test-Path "$ScriptDir\skills") {
    Get-ChildItem "$ScriptDir\skills" -Directory | Where-Object { $_.Name -ne "learned" } | ForEach-Object {
        $skillDest = Join-Path $ClaudeDir "skills\$($_.Name)"
        if ($DryRun) {
            Write-Host "    WOULD install skill: $($_.Name)"
        } else {
            # Remove the destination first. Copy-Item -Recurse copies the source
            # *into* an existing directory rather than replacing it, which nested
            # a fresh copy one level deeper on every run (skills/foo/foo/foo/...).
            if (Test-Path $skillDest) { Remove-Item $skillDest -Recurse -Force }
            Copy-Item $_.FullName $skillDest -Recurse -Force
        }
    }
    Write-Host "  Installed skills"
}

# Learned skills -- junction so /learn saves to the repo and syncs across machines
$learnedTarget = Join-Path $ScriptDir "config\skills\learned"
$learnedLink = Join-Path $ClaudeDir "skills\learned"
if (Test-Path $learnedTarget) {
    if (Test-Path $learnedLink) {
        $item = Get-Item $learnedLink -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            # In PS5.1, .Target is a string (not array) -- Select-Object -First 1 works for both
            $existingTarget = $item.Target | Select-Object -First 1
            if ($existingTarget -eq $learnedTarget) {
                Write-Host "  Learned skills junction already exists"
            } else {
                Remove-Item $learnedLink -Force
                cmd /c mklink /J "$learnedLink" "$learnedTarget" | Out-Null
                Write-Host "  Updated learned skills junction -> $learnedTarget (was $existingTarget)"
            }
        } else {
            $backupPath = "${learnedLink}.bak"
            Move-Item $learnedLink $backupPath -Force
            cmd /c mklink /J "$learnedLink" "$learnedTarget" | Out-Null
            Write-Host "  Backed up learned/ to learned.bak/ and created junction -> $learnedTarget"
        }
    } else {
        cmd /c mklink /J "$learnedLink" "$learnedTarget" | Out-Null
        Write-Host "  Created learned skills junction -> $learnedTarget"
    }
} else {
    Write-Host "  Skipped learned skills (config\skills\learned\ not found - will be created on first /learn)"
}

# Rules
if (Test-Path "$ScriptDir\config\rules") {
    Sync-Dir "$ScriptDir\config\rules" (Join-Path $ClaudeDir "rules") "*.md"
    $count = (Get-ChildItem "$ScriptDir\config\rules\*.md").Count
    Write-Host "  Installed $count rules"
}

# Commands
if (Test-Path "$ScriptDir\config\commands") {
    Sync-Dir "$ScriptDir\config\commands" (Join-Path $ClaudeDir "commands") "*.md"
    $count = (Get-ChildItem "$ScriptDir\config\commands\*.md").Count
    Write-Host "  Installed $count commands"
}

# Contexts
if (Test-Path "$ScriptDir\config\contexts") {
    Sync-Dir "$ScriptDir\config\contexts" (Join-Path $ClaudeDir "contexts") "*.md"
    $count = (Get-ChildItem "$ScriptDir\config\contexts\*.md").Count
    Write-Host "  Installed $count contexts"
}

# Scripts/hooks (js + py)
if (Test-Path "$ScriptDir\config\scripts") {
    Sync-Dir "$ScriptDir\config\scripts\hooks" (Join-Path $ClaudeDir "scripts\hooks") "*.js"
    Sync-Dir "$ScriptDir\config\scripts\hooks" (Join-Path $ClaudeDir "scripts\hooks") "*.py"
    Sync-Dir "$ScriptDir\config\scripts\lib" (Join-Path $ClaudeDir "scripts\lib") "*.js"
    # Standalone scripts (health check, MCP tool-poisoning scanner, injection audit)
    foreach ($s in @("check-mcp-health.js", "scan-mcp-tools.js", "audit-tool-responses.js")) {
        if (Test-Path "$ScriptDir\config\scripts\$s") {
            Copy-Item "$ScriptDir\config\scripts\$s" (Join-Path $ClaudeDir "scripts\$s") -Force
        }
    }
    Write-Host "  Installed hook scripts"
}

# Data files (regex patterns, etc.)
if (Test-Path "$ScriptDir\config\data") {
    New-Item -ItemType Directory -Force -Path (Join-Path $ClaudeDir "data") | Out-Null
    Copy-Item "$ScriptDir\config\data\*" (Join-Path $ClaudeDir "data") -Force
    Write-Host "  Installed data files"
}

# Statusline
if (Test-Path "$ScriptDir\config\statusline.js") {
    Copy-Item "$ScriptDir\config\statusline.js" (Join-Path $ClaudeDir "statusline.js") -Force
    Write-Host "  Installed statusline.js"
}

# Settings -- surgical merge of canonical hooks + statusLine into local settings.json
# Preserves per-machine keys (model, enabledPlugins, voiceEnabled, extraKnownMarketplaces).
if ($DryRun) {
    & node "$ScriptDir\config\scripts\merge-hooks-settings.js" "$ScriptDir" "--dry-run" 2>&1 | Out-Host
} else {
    & node "$ScriptDir\config\scripts\merge-hooks-settings.js" "$ScriptDir" 2>&1 | Out-Host
}

# Symlink helper. Safety properties:
#   1. If symlink capability is not available, skip without touching $LinkPath.
#   2. Otherwise, create the symlink at a temp path FIRST; only after success
#      do we back up or remove the original. Atomic rename completes the swap.
function New-RepoSymlink {
    param($LinkPath, $TargetPath, $Label)
    if (-not (Test-Path $TargetPath)) {
        Write-Host "  Skipped $Label symlink (source missing: $TargetPath)"
        return
    }

    # SAFETY GATE: no capability -> do nothing destructive.
    if (-not $script:CanSymlink) {
        Write-Host "  Skipped $Label symlink (no symlink capability in this session)"
        return
    }

    if (-not $DryRun) {
        New-Item -ItemType Directory -Force -Path (Split-Path $LinkPath -Parent) | Out-Null
    }

    # If link already correctly in place, short-circuit.
    if (Test-Path $LinkPath) {
        $item = Get-Item $LinkPath -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            $existingTarget = $item.Target | Select-Object -First 1
            if ($existingTarget -eq $TargetPath) {
                Write-Host "  $Label symlink already in place"
                return
            }
        }
    }

    if ($DryRun) {
        Write-Host "  WOULD create $Label symlink -> $TargetPath"
        return
    }

    # Create symlink at a temp sibling path FIRST. Only proceed if it works.
    # Use cmd's mklink so Dev Mode (unprivileged-create flag) is honored.
    $tempLink = "$LinkPath.symlinktmp-$(Get-Date -Format 'yyyyMMddHHmmss')"
    $mklinkOut = cmd /c "mklink `"$tempLink`" `"$TargetPath`"" 2>&1
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $tempLink)) {
        Write-Host "  FAILED to create $Label symlink (temp probe): $(($mklinkOut | Out-String).Trim())"
        Write-Host "    Original file at $LinkPath was NOT touched."
        if (Test-Path $tempLink) { Remove-Item $tempLink -Force -ErrorAction SilentlyContinue }
        return
    }

    # Temp symlink exists. Now safe to deal with the original.
    if (Test-Path $LinkPath) {
        $item = Get-Item $LinkPath -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            Remove-Item $LinkPath -Force
        } else {
            # Regular file. ALWAYS back up (even if content matches repo) so
            # the audit trail is preserved and recovery is always possible.
            $backup = "$LinkPath.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
            Move-Item $LinkPath $backup -Force
            Write-Host "  Backed up local $Label to $(Split-Path $backup -Leaf)"
        }
    }

    # Final atomic swap.
    Move-Item $tempLink $LinkPath -Force
    Write-Host "  Created $Label symlink -> $TargetPath"
}

# DEV_ROOT is where your project repos live. Defaults to the parent of this repo
# (e.g. C:\Dev when this clone is at C:\Dev\claude-code-starter). Override with
# $env:DEV_ROOT to point dev-layer symlinks elsewhere.
$DevRoot = if ($env:DEV_ROOT) { $env:DEV_ROOT } else { Split-Path -Parent $ScriptDir }

# Global CLAUDE.md symlink
New-RepoSymlink `
    -LinkPath (Join-Path $ClaudeDir "CLAUDE.md") `
    -TargetPath (Join-Path $ScriptDir "config\CLAUDE.md") `
    -Label "global CLAUDE.md"

if (Test-Path $DevRoot) {
    # Dev-layer CLAUDE.md symlink
    New-RepoSymlink `
        -LinkPath (Join-Path $DevRoot "CLAUDE.md") `
        -TargetPath (Join-Path $ScriptDir "dev\CLAUDE.md") `
        -Label "Dev-layer CLAUDE.md"

    # Dev-layer rules. Symlink every *.md in dev\rules\ so adding a rule needs no
    # edit here. Rules carrying `paths:` frontmatter load only when Claude touches
    # matching files; rules without it load on every session under DEV_ROOT.
    $devRulesDir = Join-Path $DevRoot ".claude\rules"
    if (-not $DryRun -and -not (Test-Path $devRulesDir)) {
        New-Item -ItemType Directory -Force -Path $devRulesDir | Out-Null
    }
    Get-ChildItem (Join-Path $ScriptDir "dev\rules\*.md") | ForEach-Object {
        New-RepoSymlink `
            -LinkPath (Join-Path $devRulesDir $_.Name) `
            -TargetPath $_.FullName `
            -Label "Dev-layer rules/$($_.Name)"
    }

    # Prune stale rule symlinks: only those pointing into this repo's dev\rules\
    # whose target no longer exists. Leaves user-created files untouched.
    Get-ChildItem $devRulesDir -Force -ErrorAction SilentlyContinue | Where-Object {
        $_.Attributes -band [IO.FileAttributes]::ReparsePoint
    } | ForEach-Object {
        $linkTarget = $_.Target
        if ($linkTarget -and ($linkTarget -match '[\\/]dev[\\/]rules[\\/]') -and -not (Test-Path $linkTarget)) {
            if ($DryRun) {
                Write-Host "  WOULD prune stale Dev-layer rule symlink: $($_.Name)"
            } else {
                Remove-Item $_.FullName -Force
                Write-Host "  Pruned stale Dev-layer rule symlink: $($_.Name)"
            }
        }
    }
} else {
    Write-Host "  Skipped dev-layer symlinks (DEV_ROOT does not exist: $DevRoot)"
}

Write-Host ""
Write-Host "Done. Restart Claude Code to pick up changes."
Write-Host ""
Write-Host "Optional next steps:"
Write-Host "  - Set OBSIDIAN_VAULT env var if you use Obsidian for session-knowledge tracking"
Write-Host "  - Set CLAUDE_TIMEZONE env var (e.g., America/New_York) to override system timezone"
Write-Host "  - Set CLAUDE_DEV_ROOT env var if your projects live outside ~/Dev"
Write-Host "  - Add MCP servers: see examples\mcp-server-example.md"
Write-Host ""
Write-Host "Tip: Re-run with -Force to overwrite all files regardless of timestamps"
Write-Host "     Re-run with -NoPrune to keep files in ~\.claude\ that aren't in this repo"
Write-Host "     Re-run with -DryRun to preview changes without writing anything"
Write-Host "     Set `$env:DEV_ROOT to override the dev-layer symlink target (default: parent of this repo)"
