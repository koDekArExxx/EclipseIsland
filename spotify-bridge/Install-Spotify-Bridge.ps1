param([switch]$Remove, [switch]$Auto, [switch]$Force)
$ErrorActionPreference = 'Stop'
$LogDirectory = Join-Path $env:APPDATA 'EclipseIsland'
New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
$LogFile = Join-Path $LogDirectory 'spotify-setup.log'
$Recording = $false
$StatusFile = Join-Path $LogDirectory 'spotify-setup-state.json'
$MarkerFile = Join-Path $LogDirectory 'spotify-setup-installed.json'
function Set-SetupState {
    param([string]$Status, [string]$Message)
    $StateJson = @{status=$Status; message=$Message; logFile=$LogFile; failedCommand=$script:FailedCommand} | ConvertTo-Json -Compress
    $Temporary = $StatusFile + '.tmp'
    [System.IO.File]::WriteAllText($Temporary, $StateJson, (New-Object System.Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $Temporary -Destination $StatusFile -Force
}
function Get-InstallFingerprint {
    $ConfigHash = (Get-FileHash -LiteralPath $ConfigFile -Algorithm SHA256).Hash
    $ExtensionHash = (Get-FileHash -LiteralPath $ExtensionFile -Algorithm SHA256).Hash
    $SpotifyStamp = ''
    $ConfigData = Get-Content -Raw -LiteralPath $ConfigFile
    if ($ConfigData -match '(?m)^\s*spotify_path\s*=\s*(.+?)\s*$') {
        $SpotifyPath = $Matches[1].Trim().Trim('"')
        foreach ($Relative in @('Spotify.exe', 'Apps\xpui.spa', 'Apps\xpui\index.html')) {
            $File = Join-Path $SpotifyPath $Relative
            if (Test-Path -LiteralPath $File -PathType Leaf) {
                $Info = Get-Item -LiteralPath $File
                $SpotifyStamp += $Relative + ':' + $Info.Length + ':' + $Info.LastWriteTimeUtc.Ticks + ';'
            }
        }
    }
    return @{config=$ConfigHash; extension=$ExtensionHash; spotify=$SpotifyStamp}
}
function Refresh-Path {
    $env:Path = $env:Path + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
}
function Find-Spice {
    $Found = Get-Command spicetify -CommandType Application -ErrorAction SilentlyContinue
    if ($Found) { return $Found }
    foreach ($Known in @((Join-Path $env:LOCALAPPDATA 'EclipseIsland\Tools\Spicetify\spicetify.exe'), (Join-Path $env:LOCALAPPDATA 'spicetify\spicetify.exe'))) {
        if (Test-Path -LiteralPath $Known -PathType Leaf) { return (Get-Command $Known -CommandType Application) }
    }
    return $null
}
function Install-OfficialSpicetify {
    Set-SetupState 'installing' 'Скачиваем Spicetify с официальной страницы выпуска…'
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $Release = Invoke-RestMethod -Uri 'https://api.github.com/repos/spicetify/cli/releases/latest' -Headers @{'User-Agent'='EclipseIsland-Setup'} -TimeoutSec 60
    $Architecture = 'x64'
    if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { $Architecture = 'arm64' }
    $Asset = @($Release.assets | Where-Object { $_.name -match ('^spicetify-[0-9.]+-windows-' + $Architecture + '\.zip$') }) | Select-Object -First 1
    if (-not $Asset -or $Asset.digest -notmatch '^sha256:[a-fA-F0-9]{64}$' -or $Asset.browser_download_url -notmatch '^https://github\.com/spicetify/cli/releases/download/') {
        throw 'Official Spicetify release or checksum was not found.'
    }
    $Work = Join-Path ([System.IO.Path]::GetTempPath()) ('EclipseIsland-Spicetify-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $Work | Out-Null
    try {
        $Archive = Join-Path $Work 'spicetify.zip'
        Invoke-WebRequest -UseBasicParsing -Uri $Asset.browser_download_url -OutFile $Archive -TimeoutSec 180
        $ExpectedHash = $Asset.digest.Substring(7)
        if ((Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash -ine $ExpectedHash) { throw 'Spicetify download checksum does not match. Installation stopped.' }
        $Destination = Join-Path $env:LOCALAPPDATA 'EclipseIsland\Tools\Spicetify'
        Expand-Archive -LiteralPath $Archive -DestinationPath $Destination -Force
        if (-not (Test-Path -LiteralPath (Join-Path $Destination 'spicetify.exe'))) { throw 'The downloaded release has no spicetify.exe.' }
    } finally { Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue }
}
function Invoke-Spice {
    param([string[]]$Arguments)
    $PreviousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $Output = @(& $script:Spice.Source @Arguments 2>&1)
        $Code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $PreviousPreference }
    foreach ($Line in $Output) { Write-Host ([string]$Line) }
    if ($Code -ne 0) {
        $script:FailedCommand = 'spicetify ' + ($Arguments -join ' ')
        $Detail = (($Output | Select-Object -Last 4 | ForEach-Object { [string]$_ }) -join ' ')
        $Detail = $Detail -replace '\x1B\[[0-9;]*[A-Za-z]', '' -replace '[a-fA-F0-9]{64}', '[redacted]'
        if ($Detail.Length -gt 1200) { $Detail = $Detail.Substring(0,1200) }
        throw ($script:FailedCommand + ' (exit ' + $Code + '): ' + $Detail)
    }
}
try {
    Start-Transcript -Path $LogFile -Force | Out-Null
    $Recording = $true
    Set-SetupState 'checking' 'Проверяем Spotify и расширение…'
    if ($Auto -and -not $Force) {
        $HasSpotify = (Test-Path -LiteralPath (Join-Path $env:APPDATA 'Spotify\Spotify.exe')) -or
                      (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\Spotify.exe')) -or
                      [bool](Get-Process -Name Spotify -ErrorAction SilentlyContinue)
        if (-not $HasSpotify) {
            $HasSpotify = [bool](Get-AppxPackage -Name 'SpotifyAB.SpotifyMusic' -ErrorAction SilentlyContinue)
        }
        if (-not $HasSpotify) {
            Set-SetupState 'absent' 'Spotify не найден. Когда установите его, нажмите «Настроить Spotify».'
            Stop-Transcript | Out-Null
            exit 0
        }
    }
    Write-Host 'EclipseIsland — подключение Spotify' 
    Write-Host 'Spotify перезапустится. Оставь EclipseIsland запущенным.'
    if (-not $Remove) {
        $TokenFile = Join-Path $LogDirectory 'spotify-bridge.json'
        if (-not (Test-Path -LiteralPath $TokenFile)) { throw 'Start EclipseIsland, keep it running, then retry setup in Music settings.' }
        $Token = (Get-Content -Raw -LiteralPath $TokenFile | ConvertFrom-Json).token
        if ($Token -isnot [string] -or $Token -cnotmatch '^[a-f0-9]{64}$') { throw 'Invalid local connection key. Restart EclipseIsland and run setup again.' }
        $Client = New-Object System.Net.Sockets.TcpClient
        try {
            $Attempt = $Client.ConnectAsync('127.0.0.1', 43119)
            if (-not $Attempt.Wait(2000) -or -not $Client.Connected) { throw 'Not listening' }
        } catch { throw 'EclipseIsland bridge is not running on port 43119. Open EclipseIsland and try again.' }
        finally { $Client.Dispose() }
        $Template = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'eclipse-island.js')
        if (-not $Template.Contains('__ECLIPSE_PAIR_TOKEN__')) { throw 'Extension template missing. Reinstall EclipseIsland: extension template is missing.' }
    }
    Refresh-Path
    $Spice = Find-Spice
    if (-not $Spice) {
        if ($Remove) { throw 'Spicetify was not found.' }
        Write-Host '[1/4] Устанавливаю Spicetify через winget...'
        $Winget = Get-Command winget -CommandType Application -ErrorAction SilentlyContinue
        Set-SetupState 'installing' 'Устанавливаем Spicetify… Это может занять несколько минут.'
        if ($Winget) {
            if ($Auto) {
                & $Winget.Source install --id Spicetify.Spicetify --exact --source winget --silent --accept-source-agreements --accept-package-agreements --disable-interactivity
            } else {
                & $Winget.Source install --id Spicetify.Spicetify --exact --source winget
            }
            Refresh-Path
            $Spice = Find-Spice
        }
        if (-not $Spice) {
            Install-OfficialSpicetify
            $Spice = Find-Spice
        }
        if (-not $Spice) { throw 'Spicetify was not found after installation. See the log above.' }
    } else { Write-Host '[1/4] Spicetify найден.' }
    Invoke-Spice -Arguments @('--version')
    Invoke-Spice -Arguments @('config')
    $ConfigOutput = @(& $Spice.Source -c)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot locate the Spicetify configuration.' }
    $ConfigFile = $null
    foreach ($Line in $ConfigOutput) {
        $Candidate = ([string]$Line -replace '\x1B\[[0-9;]*[A-Za-z]', '').Trim().Trim('"')
        if ($Candidate.EndsWith('.ini') -and (Test-Path -LiteralPath $Candidate -PathType Leaf)) { $ConfigFile = $Candidate }
    }
    if (-not $ConfigFile) { throw 'Spicetify did not return a valid configuration path. Run spicetify -c to inspect it.' }
    $ExtensionDirectory = Join-Path (Split-Path -Parent $ConfigFile) 'Extensions'
    $ExtensionFile = Join-Path $ExtensionDirectory 'eclipse-island.js'
    if ($Remove) {
        Invoke-Spice -Arguments @('config', 'extensions', 'eclipse-island.js-')
        Invoke-Spice -Arguments @('apply')
        Remove-Item -LiteralPath $ExtensionFile -ErrorAction SilentlyContinue
        Write-Host 'EclipseIsland extension removed.'
    } else {
        # Reuse the completed installation only while config, private pairing,
        # extension code and Spotify installation still match.
        if ($Auto -and -not $Force -and (Test-Path -LiteralPath $ExtensionFile) -and (Test-Path -LiteralPath $MarkerFile)) {
            try {
                $Saved = Get-Content -Raw -LiteralPath $MarkerFile | ConvertFrom-Json
                $Current = Get-InstallFingerprint
                $Expected = $Template.Replace('__ECLIPSE_PAIR_TOKEN__', $Token)
                $Installed = [System.IO.File]::ReadAllText($ExtensionFile)
                if ($Installed -ceq $Expected -and $Saved.config -eq $Current.config -and $Saved.extension -eq $Current.extension -and $Saved.spotify -eq $Current.spotify) {
                    Set-SetupState 'installed' 'Расширение установлено. Ожидаем подключения Spotify…'
                    Stop-Transcript | Out-Null
                    exit 0
                }
            } catch { Write-Host 'Installation changed; applying extension again.' }
        }
        Set-SetupState 'installing' 'Подключаем расширение Spotify…'
        Write-Host '[2/4] Привязываю расширение к твоему EclipseIsland...'
        New-Item -ItemType Directory -Path $ExtensionDirectory -Force | Out-Null
        $Contents = $Template.Replace('__ECLIPSE_PAIR_TOKEN__', $Token)
        [System.IO.File]::WriteAllText($ExtensionFile, $Contents, (New-Object System.Text.UTF8Encoding($false)))
        Write-Host '[3/4] Включаю API плеера и расширение...'
        Invoke-Spice -Arguments @('config', 'expose_apis', '1')
        Invoke-Spice -Arguments @('config', 'extensions', 'eclipse-island.js')
        $ConfigText = Get-Content -Raw -LiteralPath $ConfigFile
        if ($ConfigText -notmatch '(?m)^\s*expose_apis\s*=\s*1\s*$' -or $ConfigText -notmatch '(?m)^\s*extensions\s*=.*\beclipse-island\.js(?:\||\s|$)') {
            throw 'The extension or API setting was not saved. See Spicetify output above.'
        }
        Write-Host '[4/4] Применяю расширение и перезапускаю Spotify...'
        Set-SetupState 'applying' 'Применяем расширение. Spotify сейчас перезапустится…'
        # Try apply first for an existing backup; create a backup only if needed.
        try { Invoke-Spice -Arguments @('apply') }
        catch {
            Write-Host 'Apply failed; trying backup and apply. Original failure is in this log.'
            Invoke-Spice -Arguments @('backup', 'apply')
        }
        $script:FailedCommand = $null
        $Fingerprint = Get-InstallFingerprint
        [System.IO.File]::WriteAllText($MarkerFile, ($Fingerprint | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding($false)))
        Set-SetupState 'installed' 'Расширение установлено. Ожидаем подключения Spotify…' 
        Write-Host ''
        Write-Host 'Расширение установлено. Само соединение установщик ещё не проверил.' -ForegroundColor Green
        Write-Host 'Включи трек в Spotify. В EclipseIsland открой «Музыка» и проверь прямую связь.'
        Write-Host 'В диагностике должно быть: direct.connected = true, backend = direct-spotify.'
        Write-Host 'Если осталось false — пришли лог по адресу ниже вместе с диагностикой.'
        Write-Host 'После обновления Spotify при потере связи запусти установщик снова.'
    }
    Write-Host "Лог установки: $LogFile"
    if ($Recording) { Stop-Transcript | Out-Null }
    exit 0
} catch {
    Write-Host ''
    Set-SetupState 'error' ('Ошибка настройки Spotify: ' + $_.Exception.Message)
    Write-Host ('ОШИБКА УСТАНОВКИ: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host "Пришли этот лог: $LogFile"
    if ($Recording) { Stop-Transcript | Out-Null }
    exit 1
}
