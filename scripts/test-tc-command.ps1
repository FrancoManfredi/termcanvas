# TEST TermCanvas: comandos personalizados de opencode (full-auto).
#
# Corré el script y pasó todo solo. Editá las dos variables de abajo para
# cambiar qué se prueba:
#
#   $command     -> tc-args | tc-file | tc-shell | tc-agent | tc-subtask
#                   | tc-model | tc-json
#   $commandArgs -> argumentos para $ARGUMENTS / $1..$n (dejar "" si no)
#
# DOS VIAS AUTOMATICAS (el script elige solo):
#   - Comando SIN opciones especiales en el frontmatter (tc-args, tc-file,
#     tc-shell, tc-json): expande el template manualmente (frontmatter fuera,
#     $ARGUMENTS, !shell, @archivos) y lo manda por `--prompt` + `--auto`
#     (TUI visible, igual que TermCanvas hoy).
#   - Comando CON agent/model/subtask en el frontmatter (tc-agent,
#     tc-subtask, tc-model): esas opciones SOLO las aplica opencode al
#     expandir el comando nativamente, asi que se lanza con
#     `opencode run --command` (headless, sin TUI). Es la unica forma de
#     verificar que el frontmatter se respeta.

[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# -- EDITAR ACA ----------------------------------------------------------
$command = "tc-json"
$commandArgs = "hola mundo 42"
# -------------------------------------------------------------------------

$repo = "C:\Users\Estudiante UCU\OneDrive\Escritorio\education-games"
$commandFile = "$repo\.opencode\commands\$command.md"
$configJson = "$repo\.opencode\opencode.jsonc"

function Get-TemplateAndFrontmatter {
  param([string]$Path)
  # El comando puede definirse en .md o en opencode.jsonc: si el archivo no
  # existe, devolver $null para que el caller pruebe la otra fuente.
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
  if ($Path -like "*.jsonc" -or $Path -like "*.json") {
    $config = $raw | ConvertFrom-Json
    $cmd = $config.command.$command
    if (-not $cmd) { return $null }
    $fmLines = @()
    if ($cmd.agent) { $fmLines += "agent: $($cmd.agent)" }
    if ($cmd.model) { $fmLines += "model: $($cmd.model)" }
    if ($cmd.subtask) { $fmLines += "subtask: $($cmd.subtask)" }
    return @{
      template = [string]$cmd.template
      frontmatter = ($fmLines -join "`n")
    }
  }
  # Markdown: separar frontmatter (--- ... ---) del template
  $match = [regex]::Match($raw, '(?m)^\s*---\s*$(.*?)^\s*---\s*$', [System.Text.RegularExpressions.RegexOptions]::Singleline)
  $frontmatter = if ($match.Success) { $match.Groups[1].Value } else { "" }
  $template = if ($match.Success) {
    $raw.Substring($match.Index + $match.Length)
  } else {
    $raw
  }
  return @{ template = $template; frontmatter = $frontmatter }
}

$def = Get-TemplateAndFrontmatter -Path $commandFile
if (-not $def -and (Test-Path -LiteralPath $configJson)) {
  Write-Host "Comando $command no esta como .md; buscando en opencode.jsonc..." -ForegroundColor Yellow
  $def = Get-TemplateAndFrontmatter -Path $configJson
}
if (-not $def) {
  Write-Host "ERROR: no existe el comando $command (.md ni opencode.jsonc)" -ForegroundColor Red
  exit 1
}

# Opciones del frontmatter que SOLO respeta la expansion nativa de opencode.
# Se extraen los valores y se comparan por codigo (el lookahead negativo de
# regex en .NET con \r\n es fragil).
$hasModel = $def.frontmatter -match '(?m)^\s*model\s*:'
$hasSubtask = $def.frontmatter -match '(?m)^\s*subtask\s*:'
$agentMatch = [regex]::Match($def.frontmatter, '(?m)^\s*agent\s*:\s*(\S+)')
$agentVal = if ($agentMatch.Success) { $agentMatch.Groups[1].Value.Trim() } else { "" }
$hasNonDefaultAgent = $agentVal.Length -gt 0 -and $agentVal -ne "build"

if ($hasModel -or $hasSubtask -or $hasNonDefaultAgent) {
  # VIA NATIVA: el frontmatter lo aplica opencode al expandir el comando.
  Push-Location $repo
  try {
    Write-Host "Frontmatter con opciones especiales (model/subtask/agent) detectado." -ForegroundColor Yellow
    Write-Host "La via --prompt descarta el frontmatter; usando opencode run --command (nativo, headless)." -ForegroundColor Yellow
    Write-Host "=== opencode run --command $command $commandArgs --auto ===" -ForegroundColor Cyan
    opencode run --command $command --auto $commandArgs
  } finally {
    Pop-Location
  }
  exit 0
}

# VIA PROMPT: expansion manual + TUI visible (igual que TermCanvas hoy)
Push-Location $repo
try {
  Write-Host "=== Expandiendo template del comando /$command ===" -ForegroundColor Cyan

  $template = $def.template

  # $ARGUMENTS -> todos los args juntos
  $template = $template.Replace('$ARGUMENTS', $commandArgs)

  # $1..$9 -> argumentos individuales (split por espacios)
  $parts = $commandArgs -split '\s+'
  for ($i = 1; $i -le 9; $i++) {
    $token = "$" + $i
    $value = if ($i -le $parts.Length) { $parts[$i - 1] } else { "" }
    $template = $template.Replace($token, $value)
  }

  # !`comando` -> shell output (corre en el root del proyecto)
  $shellRe = [regex]'!`([^`]+)`'
  $template = $shellRe.Replace($template, {
    param($m)
    $cmd = $m.Groups[1].Value.Trim()
    Write-Host "   -> shell output: $cmd" -ForegroundColor DarkGray
    # cmd /c captura stdout con la codepage OEM y rompe los acentos UTF-8;
    # Start-Process con StandardOutputEncoding UTF-8 garantiza bytes ok.
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "cmd.exe"
    $psi.Arguments = "/c $cmd"
    $psi.WorkingDirectory = $repo
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
    $proc = [System.Diagnostics.Process]::Start($psi)
    $out = $proc.StandardOutput.ReadToEnd()
    $err = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()
    if ($out.Trim().Length -eq 0 -and $err.Trim().Length -gt 0) {
      return "(error del comando: $($err.Trim()))"
    }
    return $out.Trim()
  })

  # @archivo -> inyecta el contenido del archivo
  $fileRe = [regex]'@([\w./\\-]+\.\w+)'
  $template = $fileRe.Replace($template, {
    param($m)
    $f = $m.Groups[1].Value
    $full = Join-Path $repo $f
    if (Test-Path -LiteralPath $full) {
      Write-Host "   -> file reference: $f" -ForegroundColor DarkGray
      return Get-Content -LiteralPath $full -Raw -Encoding UTF8
    }
    return $m.Value
  })

  # PS 5.1 rompe el quoting de args nativos con comillas internas; escapar
  # " -> \" para que opencode reciba el prompt entero.
  $promptArg = $template.Replace('"', '\"')

  Write-Host "=== Abriendo opencode con el prompt expandido (--auto) ===" -ForegroundColor Green
  Write-Host "Comando: /$command  |  Args: '$commandArgs'" -ForegroundColor DarkGray
  opencode --prompt $promptArg --auto
} finally {
  Pop-Location
}
