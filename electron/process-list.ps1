$ErrorActionPreference='SilentlyContinue'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$items=@(Get-Process | ForEach-Object {
 try { $file=$_.Path;if($file -and $file.EndsWith('.exe',[StringComparison]::OrdinalIgnoreCase)){
  [PSCustomObject]@{pid=$_.Id;name=$_.ProcessName;target=$file;title=$_.MainWindowTitle}
 }}catch{}
})
[Console]::WriteLine((ConvertTo-Json -InputObject $items -Depth 3 -Compress))
