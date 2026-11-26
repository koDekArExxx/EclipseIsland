param([Parameter(Mandatory=$true)][string]$Repository,[string]$Output='release-online')
$ErrorActionPreference='Stop'
if($Repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'){throw 'Repository must be OWNER/REPO'}
$root=Split-Path $PSScriptRoot -Parent
$out=Join-Path $root $Output
New-Item -ItemType Directory -Force -Path $out | Out-Null
$config='namespace EclipseIslandSetup { public static class BuildConfig { public const string Repository="'+$Repository+'"; public const string FeedUrl="https://github.com/'+$Repository+'/releases/latest/download/update-manifest.json"; } }'
$generated=Join-Path $out 'BuildConfig.cs'
[IO.File]::WriteAllText($generated,$config,[Text.UTF8Encoding]::new($false))
$csc=Join-Path ([Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()) 'csc.exe'
if(-not (Test-Path $csc)){$csc=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'}
$exe=Join-Path $out 'EclipseIsland-Setup.exe'
& $csc /nologo /optimize+ /target:winexe /platform:anycpu "/out:$exe" /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:Accessibility.dll /r:System.Web.Extensions.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll "/win32icon:$root\src\eclipse.ico" "/win32manifest:$PSScriptRoot\Bootstrapper.manifest" (Join-Path $PSScriptRoot 'Bootstrapper.cs') $generated
if($LASTEXITCODE -ne 0){throw 'Launcher compilation failed'}
Write-Host "Setup size: $((Get-Item $exe).Length) bytes"
