$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$visibilitySource=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'transfers-visibility.cs') -Raw -Encoding UTF8
$monitorSource=@'
public static class IslandTransfers {
 public delegate bool EnumProc(IntPtr hwnd, IntPtr data);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, IntPtr data);
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h,StringBuilder text,int count);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint process);
 [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h,int command);
 [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h,uint command);
 [DllImport("user32.dll")] public static extern IntPtr GetLastActivePopup(IntPtr h);
 static readonly TransferScanSignal Scan=new TransferScanSignal();
 public static bool Wait(int milliseconds){return Scan.Wait(milliseconds);}
 public static void Stop(){Scan.Stop();}
 public static readonly ConcurrentQueue<string> Commands=new ConcurrentQueue<string>();
 public static readonly ConcurrentDictionary<long,uint> Hidden=new ConcurrentDictionary<long,uint>();
 static volatile HashSet<long> acknowledged=new HashSet<long>();
 public static volatile bool Closed=false;
 static readonly object Gate=new object();
 static readonly TransferHoldPolicy Holds=new TransferHoldPolicy(()=>Stopwatch.GetTimestamp()*1000/Stopwatch.Frequency);
 static readonly TransferWindowMask Mask=new TransferWindowMask(new TransferWindowApi());
 static readonly ConcurrentDictionary<long,bool> Layered=new ConcurrentDictionary<long,bool>();
 static long leasedAt=0;static volatile bool allowed=false;
 public static bool Allowed {get{return allowed&&!Closed&&(Stopwatch.GetTimestamp()-Interlocked.Read(ref leasedAt))/(double)Stopwatch.Frequency<2.5;}}
 public static string Class(IntPtr h){var s=new StringBuilder(256);GetClassName(h,s,s.Capacity);return s.ToString();}
 public static uint ProcessId(IntPtr h){uint p;GetWindowThreadProcessId(h,out p);return p;}
 public static long[] Windows(){var result=new List<long>();EnumWindows((h,d)=>{if(Class(h)=="OperationStatusWindow")result.Add(h.ToInt64());return true;},IntPtr.Zero);return result.ToArray();}
 public static void Restore(long value){lock(Gate){uint p;if(Hidden.TryGetValue(value,out p)){var h=new IntPtr(value);if(!IsWindow(h)||Class(h)!="OperationStatusWindow"||ProcessId(h)!=p||Mask.Restore(value)){Hidden.TryRemove(value,out p);Holds.Remove(value);}}}}
 public static bool Pending(long value){lock(Gate){return Holds.Pending(value);}}
 public static bool Closing(long value){lock(Gate){return Holds.Closing(value);}}
 public static bool BeginClose(long value){lock(Gate){return Holds.BeginClose(value);}}
 public static void Stage(long value){lock(Gate){if(!Allowed||Hidden.ContainsKey(value))return;uint pid=ProcessId(new IntPtr(value));if(Mask.Stage(value)){Hidden[value]=pid;Holds.Stage(value);}else if(Mask.Mode(value)!=0){Hidden[value]=pid;Restore(value);}}}
 public static void PrepareVisible(long value){lock(Gate){if(Allowed&&Hidden.ContainsKey(value)&&Holds.Pending(value))Mask.Hide(value,false);}}
 public static void Guard(long value){lock(Gate){if(!Allowed||(!acknowledged.Contains(value)&&!Holds.Pending(value)&&!Holds.Closing(value)))Restore(value);}}
 public static int MaskMode(long value){return Mask.Mode(value);}
 public static string MaskFailure(){return Mask.Failure();}
 public static void RestoreAll(){foreach(var h in Hidden.Keys)Restore(h);}
 public static void PreferLayered(long value){Restore(value);Layered[value]=true;}
 public static void Hide(long value){lock(Gate){
  if(!Allowed||!acknowledged.Contains(value))return;
  var h=new IntPtr(value);
  // A creation cloak must survive until the owner actually shows the surface.
  if(!IsWindowVisible(h)&&Holds.Pending(value))return;
  uint pid=ProcessId(h);Hidden[value]=pid;
  if(Mask.Hide(value,Layered.ContainsKey(value))){Holds.Confirm(value);}
  else if(Mask.Restore(value)){Hidden.TryRemove(value,out pid);Holds.Remove(value);}
 }}
 public static void Start(){
  Scan.Created=Stage;Scan.Shown=PrepareVisible;Scan.Start();
  var input=new Thread(()=>{try{string line;while((line=Console.ReadLine())!=null){try{if(line.StartsWith("LEASE ",StringComparison.Ordinal)){var parts=line.Split(' ');allowed=parts.Length>1&&parts[1]=="1";var next=new HashSet<long>();if(parts.Length>2)foreach(var text in parts[2].Split(',')){long value;if(long.TryParse(text,out value))next.Add(value);}acknowledged=next;Interlocked.Exchange(ref leasedAt,Stopwatch.GetTimestamp());if(!allowed)RestoreAll();}else Commands.Enqueue(line);Scan.Notify();}catch{}}}finally{Closed=true;Scan.Stop();RestoreAll();}});input.IsBackground=true;input.Start();
  var guard=new Thread(()=>{while(!Closed){if(!Allowed)RestoreAll();else foreach(var value in Hidden.Keys)Guard(value);Thread.Sleep(200);}RestoreAll();});guard.IsBackground=true;guard.Start();
 }
}
'@
Add-Type -TypeDefinition ($visibilitySource + "`n" + $monitorSource)
[IslandTransfers]::Start()
$manual = @{}
$buttons = @{}
$lastItems = @{}
function Emit($value) { [Console]::WriteLine(($value | ConvertTo-Json -Depth 6 -Compress)) }
$activeBefore=0
$lastEmit=[System.Diagnostics.Stopwatch]::StartNew()
try {
 while (-not [IslandTransfers]::Closed) {
  $line = $null
  while ([IslandTransfers]::Commands.TryDequeue([ref]$line)) {
   try {
    $command = $line | ConvertFrom-Json
    $id = [string]$command.id
    if ($id -notmatch '^\d{1,20}$' -or [IslandTransfers]::Class([IntPtr][long]$id) -ne 'OperationStatusWindow') { continue }
    if ($command.action -eq 'show') { $manual[$id]=$true;[IslandTransfers]::Restore([long]$id);[IslandTransfers]::ShowWindowAsync([IntPtr][long]$id,9) | Out-Null;try { ([System.Windows.Automation.AutomationElement]::FromHandle([IntPtr][long]$id)).SetFocus() } catch {} }
    elseif (($command.action -eq 'pause' -or $command.action -eq 'cancel') -and $buttons.ContainsKey($id)) {
     if($command.action -eq 'cancel'){[IslandTransfers]::BeginClose([long]$id) | Out-Null}
     $target = $buttons[$id][$command.action]
     if ($null -ne $target) { $pattern=$null;if($target.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)){$pattern.Invoke()}elseif($target.TryGetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern,[ref]$pattern)){$pattern.DoDefaultAction()}else{throw 'ControlUnavailable'} }
    }
   } catch { if ($id -match '^\d+$' -and -not [IslandTransfers]::Closing([long]$id)) {[IslandTransfers]::PreferLayered([long]$id);[IslandTransfers]::Restore([long]$id)};Emit @{type='diagnostic';error='ControlUnavailable'} }
  }
  $items = @()
  foreach ($value in [IslandTransfers]::Windows()) {
   $id = [string]$value
   try {
    $handle = [IntPtr]$value
    if ((Get-Process -Id ([IslandTransfers]::ProcessId($handle)) -ErrorAction Stop).ProcessName -ne 'explorer') { continue }
    if (-not [IslandTransfers]::IsWindowVisible($handle) -and -not [IslandTransfers]::Hidden.ContainsKey($value)) { continue }
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
    $nodes = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
    $texts = @();$progressCount=0;$percent=$null;$pause=$null;$cancel=$null;$paused=$false;$progress=$false;$cancelCount=0;$pauseCount=0
    for ($i=0;$i -lt [Math]::Min($nodes.Count,180);$i++) {
     $node=$nodes[$i];$name=$node.Current.Name
     if ($node.Current.ControlType -eq [System.Windows.Automation.ControlType]::Text -and $name) { $texts += $name }
     if ($node.Current.ControlType -eq [System.Windows.Automation.ControlType]::ProgressBar) {
      $progress=$true;$progressCount++
      $range=$null
      if ($node.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern,[ref]$range)) {
       $r=$range.Current
       if ($r.Maximum -gt $r.Minimum) { $percent=[Math]::Round([Math]::Max(0,[Math]::Min(100,100*($r.Value-$r.Minimum)/($r.Maximum-$r.Minimum))),1) }
      }
     }
     if ($node.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $node.Current.IsEnabled) {
      $invoke=$null
      if (-not $node.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$invoke)) { $legacy=$null;if(-not $node.TryGetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern,[ref]$legacy) -or -not $legacy.Current.DefaultAction){continue} }
      $automationId=$node.Current.AutomationId
      if ([TransferButtonNames]::IsPause($name,$automationId)) { $pause=$node;$pauseCount++;$paused=[TransferButtonNames]::IsResume($name,$automationId) }
      elseif ([TransferButtonNames]::IsCancel($name,$automationId)) { $cancel=$node;$cancelCount++ }
     }
    }
    $title=$root.Current.Name
    $details=($texts | Select-Object -Unique) -join ' · '
    if ($details.Length -gt 1600) { $details=$details.Substring(0,1600) }
    $combined=$title+' '+$details
    if($combined -match '(?i)подготовк|обнаружено|preparing|discovering'){$percent=$null}
    $nativeOnly=$cancelCount -gt 1
    if($pauseCount -gt 1){$pause=$null}
    $recognized=[TransferButtonNames]::CanReplace($progressCount,$cancelCount,$combined)
    if($nativeOnly){$percent=$null;$pause=$null;$cancel=$null}
    $sensitive=$combined -match '(?i)access denied|отказано|ошибк|replace|заменить|already exists|уже существует|retry|повторить|требуется разрешение|administrator|администратор'
    $popup=[IslandTransfers]::GetLastActivePopup($handle)
    if (-not [IslandTransfers]::IsWindowEnabled($handle)){$sensitive=$true}
    if ($popup -ne $handle -and $popup -ne [IntPtr]::Zero -and [IslandTransfers]::IsWindow($popup) -and [IslandTransfers]::IsWindowVisible($popup) -and [IslandTransfers]::GetWindow($popup,4) -eq $handle -and [IslandTransfers]::Class($popup) -ne 'tooltips_class32') { $sensitive=$true }
    $closing=[IslandTransfers]::Closing($value)
    if(-not $recognized -or $null -eq $cancel){if(-not [IslandTransfers]::Pending($value)){$closing=[IslandTransfers]::BeginClose($value)}}
    if ($sensitive -or $nativeOnly -or $manual.ContainsKey($id)) { [IslandTransfers]::Restore($value);$closing=$false }
    elseif ($closing -or [IslandTransfers]::Pending($value)) { if($recognized -and $null -ne $cancel){[IslandTransfers]::Hide($value)} }
    elseif (-not $recognized -or $null -eq $cancel) { [IslandTransfers]::Restore($value) }
    elseif ([IslandTransfers]::Allowed) { [IslandTransfers]::Hide($value) }
    $kind='copy';if ($combined -match '(?i)удален|удалени|delet|recycl') {$kind='delete'} elseif ($combined -match '(?i)перемещ|mov(e|ing)') {$kind='move'}
    $buttons[$id]=@{pause=$pause;cancel=$cancel}
    $reason=if($manual.ContainsKey($id)){'manual'}elseif($sensitive){'confirmation'}elseif($nativeOnly){'ambiguous-controls'}elseif($null -eq $cancel){'no-cancel'}elseif(-not $recognized){'unrecognized'}else{'eligible'}
    $item = @{closing=$closing;maskMode=[IslandTransfers]::MaskMode($value);maskError=[IslandTransfers]::MaskFailure();reason=$reason;id=$id;title=$title;details=$details;percent=$percent;kind=$kind;paused=$paused;canPause=($null -ne $pause);canCancel=($null -ne $cancel);hidden=[IslandTransfers]::Hidden.ContainsKey($value);attention=$sensitive;nativeOnly=$nativeOnly}
    if($closing){$item.title='Завершение операции…';$item.canPause=$false;$item.canCancel=$false;$item.reason='closing'}
    $lastItems[$id]=$item;$items += $item
   } catch {
    if([IslandTransfers]::IsWindow([IntPtr]$value) -and [IslandTransfers]::BeginClose($value) -and $lastItems.ContainsKey($id)){
     $item=$lastItems[$id].Clone();$item.closing=$true;$item.canPause=$false;$item.canCancel=$false;$item.title='Завершение операции…';$item.reason='closing';$items += $item
    } elseif (-not [IslandTransfers]::Pending($value)) {[IslandTransfers]::Restore($value)}
   }
  }
  $active = @($items | ForEach-Object {$_.id})
  foreach ($id in @($buttons.Keys)) { if ($active -notcontains $id) { $buttons.Remove($id);$manual.Remove($id);$lastItems.Remove($id);[IslandTransfers]::Restore([long]$id) } }
  if($items.Count -gt 0 -or $activeBefore -gt 0 -or $lastEmit.ElapsedMilliseconds -ge 750){Emit @{type='transfers';items=@($items | Select-Object -First 12)};$lastEmit.Restart()}
  $activeBefore=$items.Count
  # Native window events and renderer leases interrupt this fallback wait.
  [IslandTransfers]::Wait(250) | Out-Null
 }
} catch { Emit @{type='diagnostic';error=$_.Exception.GetType().Name} }
finally { [IslandTransfers]::Stop();[IslandTransfers]::RestoreAll() }
