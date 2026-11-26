param([string]$Ids)
$ErrorActionPreference='SilentlyContinue'
Add-Type -Path (Join-Path $PSScriptRoot 'transfers-visibility.cs')
$api=New-Object TransferWindowApi
$mask=New-Object TransferWindowMask -ArgumentList $api
$targets=@($Ids.Split(','))+@([TransferWindowApi]::OwnedWindows())
foreach($text in $targets){
 if($text -notmatch '^\d{1,20}$'){continue}
 try { $mask.Restore([long]$text) | Out-Null } catch {}
}
