param([switch]$ControlOnly)
# Windows PowerShell 5.1: event-driven metadata, nonblocking WinRT tasks and cover art.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.Threading;
public static class IslandInput {
    private static readonly ConcurrentQueue<string> Lines = new ConcurrentQueue<string>();
    public static volatile bool Closed;
    public static readonly AutoResetEvent Wake = new AutoResetEvent(false);
    public static void Start() {
        var reader = new Thread(() => {
            try { string line; while ((line = Console.ReadLine()) != null) { Lines.Enqueue(line); Wake.Set(); } }
            finally { Closed = true; Wake.Set(); }
        });
        reader.IsBackground = true;
        reader.Start();
    }
    public static string Read() { string line; return Lines.TryDequeue(out line) ? line : null; }
}
'@
$ManagerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
$PropertiesType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime]
$StreamType = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType=WindowsRuntime]
$ReaderType = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType=WindowsRuntime]
$AsTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and
    $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function New-WinRTTask($Operation, [Type]$ResultType) {
    return ,($AsTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation)))
}
function Send-Json($Value) { [Console]::WriteLine(($Value | ConvertTo-Json -Depth 5 -Compress)) }
function Close-Art($Art) {
    if ($null -ne $Art) {
        try { if ($null -ne $Art.reader) { $Art.reader.Dispose() } } catch {}
        try { if ($null -ne $Art.stream) { $Art.stream.Dispose() } } catch {}
    }
}
try {
    $InitTask = New-WinRTTask ($ManagerType::RequestAsync()) $ManagerType
    if (-not $InitTask.Wait(8000)) { throw 'Media initialization timed out' }
    $Manager = $InitTask.Result
} catch { Send-Json @{type='media';available=$false;active=$false;reason='Windows media initialization failed'}; exit 1 }
[IslandInput]::Start()
$Session = $null
$SessionSource=''
$LastHeartbeat=[DateTime]::MinValue
$PreferredSource='auto'
$SourcesJSON=''
$Snapshot = @{type='media';available=$true;active=$false}
$Revision = 0
$MetadataDirty = $true
$MetadataEvents = $false
$MetadataJob = $null
$ArtJob = $null
$Commands = New-Object System.Collections.ArrayList
$LastState = [DateTime]::MinValue
$LastMetadata = [DateTime]::MinValue
$LastSessionCheck = [DateTime]::MinValue
$FastUntil = [DateTime]::MinValue
$LastArtAttempt = [DateTime]::MinValue
$ArtAttempts=0
$ArtRefreshUntil=[DateTime]::MinValue
if (-not $ControlOnly) { try { Register-ObjectEvent -InputObject $Manager -EventName CurrentSessionChanged -SourceIdentifier 'Island.Current' | Out-Null } catch {} }
try {
    while ($true) {
        $Now = [DateTime]::UtcNow
        # Event handlers are queued by PowerShell. No script executes on a COM callback thread.
        foreach ($Event in @(Get-Event -ErrorAction SilentlyContinue | Where-Object {$_.SourceIdentifier -like 'Island.*'})) {
            if ($Event.SourceIdentifier -eq 'Island.Metadata') { $MetadataDirty=$true; $FastUntil=$Now.AddSeconds(2) }
            if ($Event.SourceIdentifier -eq 'Island.Current') { $LastSessionCheck=[DateTime]::MinValue }
            $LastState=[DateTime]::MinValue
            Remove-Event -EventIdentifier $Event.EventIdentifier -ErrorAction SilentlyContinue
        }
        if (($Now-$LastHeartbeat).TotalSeconds -ge 2) { Send-Json @{type='heartbeat'}; $LastHeartbeat=$Now }
        if (-not $ControlOnly -and ($Now-$LastSessionCheck).TotalMilliseconds -ge 1500) {
            $Current=$Session
            try {
                $All=@($Manager.GetSessions())
                $Current=$Manager.GetCurrentSession()
                # Never synchronously query every background player: a stalled session used to
                # block the command and artwork loop. Windows chooses auto; explicit selection pins it.
                if($PreferredSource -ne 'auto') {
                    $Current=@($All | Where-Object { $_.SourceAppUserModelId -eq $PreferredSource }) | Select-Object -First 1
                }
                $CurrentSource=if($null -ne $Current){[string]$Current.SourceAppUserModelId}else{''}
                $Sources=@($All | ForEach-Object { @{id=[string]$_.SourceAppUserModelId;playing=($_.SourceAppUserModelId -eq $CurrentSource -and $Snapshot.playing)} } | Sort-Object { $_.id } -Unique)
                $JSON=ConvertTo-Json -InputObject $Sources -Compress -Depth 3
                if($JSON -ne $SourcesJSON){Send-Json @{type='sessions';items=$Sources};$SourcesJSON=$JSON}
            } catch {}
            $CurrentSource=if($null -ne $Current){[string]$Current.SourceAppUserModelId}else{''}
            # WinRT can return a fresh RCW for the same session on every enumeration.
            # Object.ReferenceEquals restarted pending metadata and images indefinitely.
            if ($CurrentSource -ne $SessionSource -or ($null -eq $Current) -ne ($null -eq $Session)) {
                foreach ($Id in @('Island.Metadata','Island.Playback','Island.Timeline')) { Unregister-Event -SourceIdentifier $Id -ErrorAction SilentlyContinue }
                $Session=$Current; $SessionSource=$CurrentSource; $Revision++; $MetadataDirty=$true; $MetadataJob=$null; $MetadataEvents=$false
                Close-Art $ArtJob; $ArtJob=$null
                $Snapshot=@{type='media';available=$true;active=($null -ne $Session);source=$SessionSource;trackKey='';title='';artist='';artworkStatus='loading'}
                $LastArtAttempt=[DateTime]::MinValue; $ArtAttempts=0
                if ($null -ne $Session) {
                    foreach ($Pair in @(@('MediaPropertiesChanged','Island.Metadata'),@('PlaybackInfoChanged','Island.Playback'),@('TimelinePropertiesChanged','Island.Timeline'))) {
                        try { Register-ObjectEvent -InputObject $Session -EventName $Pair[0] -SourceIdentifier $Pair[1] | Out-Null; if($Pair[1] -eq 'Island.Metadata'){$MetadataEvents=$true} } catch {}
                    }
                }
                $LastState=[DateTime]::MinValue
            }
            $LastSessionCheck=$Now
        }
        # Commands are started immediately. Waiting for metadata or a slow image never blocks clicks.
        $Line=if ($Commands.Count -eq 0) { [IslandInput]::Read() } else { $null }
        if ($null -eq $Line -and [IslandInput]::Closed -and $Commands.Count -eq 0) { break }
        while ($null -ne $Line) {
            $Command=$null
            try {
                $Command=$Line | ConvertFrom-Json
                if($Command.action -eq 'source'){
                    if([string]$Command.source -and ([string]$Command.source).Length -le 200){$PreferredSource=[string]$Command.source;$LastSessionCheck=[DateTime]::MinValue;$FastUntil=$Now.AddSeconds(1)}
                    $Line=[IslandInput]::Read();continue
                }
                if($Command.action -eq 'refresh'){
                    $FastUntil=$Now.AddSeconds(3);$LastMetadata=[DateTime]::MinValue;$LastArtAttempt=[DateTime]::MinValue;$ArtAttempts=0
                    if (-not $Command.metadataOnly) { $MetadataDirty=$true }
                    Send-Json @{type='reply';id=$Command.id;ok=$true}
                    $Line=[IslandInput]::Read();continue
                }
                $Target=if ($ControlOnly -and -not $Command.sessionSource) { $Manager.GetCurrentSession() } else { $Session }
                if($Command.sessionSource -and ($null -eq $Target -or $Target.SourceAppUserModelId -ne $Command.sessionSource)){
                    $Target=@($Manager.GetSessions()) | Where-Object {$_.SourceAppUserModelId -eq $Command.sessionSource} | Select-Object -First 1
                }
                if ($null -eq $Target) { throw 'No active media session' }
                $Operation=switch ($Command.action) {
                    'toggle' { $Target.TryTogglePlayPauseAsync() }
                    'next' { $Target.TrySkipNextAsync() }
                    'previous' { $Target.TrySkipPreviousAsync() }
                    'seek' {
                        $Seconds=[double]$Command.seconds
                        if ([double]::IsNaN($Seconds) -or [double]::IsInfinity($Seconds) -or $Seconds -lt 0 -or $Seconds -gt 604800) { throw 'Invalid seek position' }
                        $Target.TryChangePlaybackPositionAsync([long]($Seconds*10000000))
                    }
                    default { throw 'Unknown command' }
                }
                $Task=New-WinRTTask $Operation ([bool])
                [void]$Commands.Add(@{task=$Task;id=$Command.id;started=$Now;action=$Command.action})
                $FastUntil=$Now.AddSeconds(3);$MetadataDirty=$true
            } catch { Send-Json @{type='reply';id=$Command.id;ok=$false;error=$_.Exception.Message} }
            $Line=if ($Commands.Count -eq 0) { [IslandInput]::Read() } else { $null }
        }
        for ($Index=$Commands.Count-1;$Index -ge 0;$Index--) {
            $Pending=$Commands[$Index]
            if ($Pending.task.IsCompleted -or ($Now-$Pending.started).TotalSeconds -ge 4) {
                $Ok=$false
                try { if ($Pending.task.IsCompleted) { $Ok=[bool]$Pending.task.Result } } catch {}
                Send-Json @{type='reply';id=$Pending.id;ok=$Ok}
                # A timed-out operation may still execute. Do not overlap it or retry a skip.
                if ($ControlOnly -and -not $Pending.task.IsCompleted) { exit 2 }
                $Commands.RemoveAt($Index)
                $MetadataDirty=$true; $LastState=[DateTime]::MinValue
            }
        }
        if ($ControlOnly) {
            [void][IslandInput]::Wake.WaitOne($(if ($Commands.Count -gt 0) { 20 } else { 100 }))
            continue
        }
        $MetadataInterval=if ($Now -lt $FastUntil) { 80 } elseif ($Snapshot.playing) { 300 } else { 1200 }
        if ($null -ne $Session -and $null -eq $MetadataJob -and ($MetadataDirty -or ($Now-$LastMetadata).TotalMilliseconds -ge $MetadataInterval)) {
            try {
                $Task=New-WinRTTask ($Session.TryGetMediaPropertiesAsync()) $PropertiesType
                $MetadataJob=@{task=$Task;revision=$Revision;started=$Now;refreshArt=$MetadataDirty}
                $MetadataDirty=$false; $LastMetadata=$Now
            } catch { $LastMetadata=$Now }
        }
        if ($null -ne $MetadataJob -and ($MetadataJob.task.IsCompleted -or ($Now-$MetadataJob.started).TotalSeconds -ge 4)) {
            if(-not $MetadataJob.task.IsCompleted){Send-Json @{type='health';status='metadata-timeout'}}
            try {
                if ($MetadataJob.revision -eq $Revision -and $MetadataJob.task.IsCompleted) {
                    $Properties=$MetadataJob.task.Result
                    $Key=[string]::Join([string][char]31,@($Session.SourceAppUserModelId,$Properties.Title,$Properties.Artist,$Properties.AlbumTitle))
                    $Changed=$Key -ne $Snapshot.trackKey
                    $Snapshot.title=$Properties.Title; $Snapshot.artist=$Properties.Artist; $Snapshot.source=$Session.SourceAppUserModelId
                    $Snapshot.trackKey=$Key
                    Send-Json @{type='health';status='metadata-ready'}
                    if($Changed){$Snapshot.position=0;$Snapshot.duration=0;$ArtAttempts=0;$LastArtAttempt=[DateTime]::MinValue;$ArtRefreshUntil=$Now.AddSeconds(3)}
                    $ArtRetrySeconds=if($ArtAttempts -lt 5){0.3}else{8}
                    if ($Changed -or ($MetadataJob.refreshArt -and $null -eq $ArtJob -and ($Now-$LastArtAttempt).TotalMilliseconds -ge 300) -or ($Now -lt $ArtRefreshUntil -and $null -eq $ArtJob -and ($Now-$LastArtAttempt).TotalMilliseconds -ge 500) -or ($Snapshot.artworkStatus -eq 'missing' -and ($Now-$LastArtAttempt).TotalSeconds -ge $ArtRetrySeconds)) {
                        $LastArtAttempt=$Now;$ArtAttempts++
                        Close-Art $ArtJob; $ArtJob=$null
                        $Snapshot.artworkStatus='missing'
                        if ($null -ne $Properties.Thumbnail) {
                            $Task=New-WinRTTask ($Properties.Thumbnail.OpenReadAsync()) $StreamType
                            $ArtJob=@{task=$Task;stage='open';key=$Key;started=$Now;reader=$null;stream=$null}
                            $Snapshot.artworkStatus='loading'
                        }
                    }
                    if($Changed){Send-Json $Snapshot;$LastState=[DateTime]::MinValue}
                }
            } catch {}
            $MetadataJob=$null
        }
        # Publish track identity and buttons before attempting to decode artwork.
        if (($Now-$LastState).TotalMilliseconds -ge $(if($Now -lt $FastUntil){150}else{750})) {
            try {
                if ($null -eq $Session) { Send-Json @{type='media';available=$true;active=$false} }
                else {
                    $Playback=$Session.GetPlaybackInfo()
                    $Timeline=$null;try{$Timeline=$Session.GetTimelineProperties()}catch{}
                    $Playing=$Playback.PlaybackStatus.ToString() -eq 'Playing'
                    $Position=if($null -ne $Timeline){$Timeline.Position.TotalSeconds}else{0}
                    if ($Playing -and $null -ne $Timeline) { $Position += [Math]::Max(0,([DateTimeOffset]::UtcNow-$Timeline.LastUpdatedTime).TotalSeconds)*$(if ($null -ne $Playback.PlaybackRate) {[double]$Playback.PlaybackRate} else {1}) }
                    $Duration=if($null -ne $Timeline){[Math]::Max(0,$Timeline.EndTime.TotalSeconds)}else{0}
                    $Snapshot.playing=$Playing; $Snapshot.duration=$Duration
                    $Snapshot.position=[Math]::Min([Math]::Max(0,$Position),$Duration)
                    $Snapshot.canToggle=[bool]$Playback.Controls.IsPlayPauseToggleEnabled
                    $Snapshot.canNext=[bool]$Playback.Controls.IsNextEnabled; $Snapshot.canPrevious=[bool]$Playback.Controls.IsPreviousEnabled
                    $Snapshot.canSeek=[bool]$Playback.Controls.IsPlaybackPositionEnabled
                    Send-Json $Snapshot
                }
            } catch { Send-Json @{type='media';available=$false;active=$false;reason='Cannot read Windows media session'} }
            $LastState=$Now
        }
        if ($null -ne $ArtJob) {
            if ($ArtJob.key -ne $Snapshot.trackKey -or ($Now-$ArtJob.started).TotalSeconds -ge 5) {
                if ($ArtJob.key -eq $Snapshot.trackKey) { Send-Json @{type='artwork';trackKey=$ArtJob.key;artwork=$null}; $Snapshot.artworkStatus='missing' }
                Close-Art $ArtJob; $ArtJob=$null
            } elseif ($ArtJob.task.IsCompleted) {
                try {
                    if ($ArtJob.stage -eq 'open') {
                        $Stream=$ArtJob.task.Result; $ArtJob.stream=$Stream
                        $Size=[long]$Stream.Size
                        if ($Size -le 0 -or $Size -gt 8388608) { throw 'Artwork too large or empty' }
                        $Mime=[string]$Stream.ContentType
                        if ($Mime -eq 'image/jpg') { $Mime='image/jpeg' }
                        $Reader=$ReaderType::new($Stream.GetInputStreamAt(0))
                        $ArtJob.reader=$Reader; $ArtJob.size=[uint32]$Size; $ArtJob.mime=$Mime
                        $ArtJob.task=New-WinRTTask ($Reader.LoadAsync([uint32]$Size)) ([uint32]); $ArtJob.stage='read'
                    } else {
                        if ([uint32]$ArtJob.task.Result -ne $ArtJob.size) { throw 'Incomplete artwork' }
                        $Bytes=New-Object byte[] $ArtJob.size; $ArtJob.reader.ReadBytes($Bytes)
                        # Some players return an empty/incorrect MIME type. Use the actual file signature.
                        $Mime=$null
                        if ($Bytes.Length -ge 8 -and $Bytes[0] -eq 137 -and $Bytes[1] -eq 80 -and $Bytes[2] -eq 78 -and $Bytes[3] -eq 71) { $Mime='image/png' }
                        elseif ($Bytes.Length -ge 3 -and $Bytes[0] -eq 255 -and $Bytes[1] -eq 216 -and $Bytes[2] -eq 255) { $Mime='image/jpeg' }
                        elseif ($Bytes.Length -ge 6 -and [Text.Encoding]::ASCII.GetString($Bytes,0,3) -eq 'GIF') { $Mime='image/gif' }
                        elseif ($Bytes.Length -ge 12 -and [Text.Encoding]::ASCII.GetString($Bytes,0,4) -eq 'RIFF' -and [Text.Encoding]::ASCII.GetString($Bytes,8,4) -eq 'WEBP') { $Mime='image/webp' }
                        elseif ($Bytes.Length -ge 2 -and $Bytes[0] -eq 66 -and $Bytes[1] -eq 77) { $Mime='image/bmp' }
                        if ($null -eq $Mime) { throw 'Unsupported artwork type' }
                        $ArtJob.mime=$Mime
                        $Data='data:'+$ArtJob.mime+';base64,'+[Convert]::ToBase64String($Bytes)
                        Send-Json @{type='artwork';trackKey=$ArtJob.key;artwork=$Data}
                        $Snapshot.artworkStatus='ready'; Close-Art $ArtJob; $ArtJob=$null
                    }
                } catch {
                    Send-Json @{type='artwork';trackKey=$ArtJob.key;artwork=$null}
                    $Snapshot.artworkStatus='missing'; Close-Art $ArtJob; $ArtJob=$null
                }
            }
        }
        # Sleep efficiently at idle, but wake immediately when a button command arrives on stdin.
        $WaitMs=if ($Commands.Count -gt 0 -or $null -ne $MetadataJob -or $null -ne $ArtJob -or $Now -lt $FastUntil) { 50 } else { 200 }
        [void][IslandInput]::Wake.WaitOne($WaitMs)
    }
} finally {
    Close-Art $ArtJob
    foreach ($Id in @('Island.Current','Island.Metadata','Island.Playback','Island.Timeline')) { Unregister-Event -SourceIdentifier $Id -ErrorAction SilentlyContinue }
}
