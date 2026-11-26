$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$csc=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$out=Join-Path $root 'release-online/LauncherTests.exe'
& $csc /nologo /target:exe /main:EclipseIslandSetup.LauncherTests "/out:$out" /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll (Join-Path $PSScriptRoot 'Bootstrapper.cs') (Join-Path $PSScriptRoot 'LauncherTests.cs') (Join-Path $root 'release-online/BuildConfig.cs')
if($LASTEXITCODE -ne 0){throw 'Launcher tests did not compile'}
& $out
if($LASTEXITCODE -ne 0){throw 'Launcher tests failed'}
