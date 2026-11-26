using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Threading;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
// Creation callbacks can provisionally cloak an Explorer progress surface for
// at most 750 ms. Full replacement still needs UIA and renderer acknowledgement.
public sealed class TransferScanSignal {
 public Action<long> Created,Shown;
 readonly AutoResetEvent changed=new AutoResetEvent(false);
 volatile bool closed;
 uint threadId;
 Thread thread;
 delegate void WinEventProc(IntPtr hook,uint kind,IntPtr hwnd,int objectId,int childId,uint sourceThread,uint time);
 WinEventProc callback;
 [StructLayout(LayoutKind.Sequential)] struct Point {public int X,Y;}
 [StructLayout(LayoutKind.Sequential)] struct Message {public IntPtr Hwnd;public uint Id;public UIntPtr WParam;public IntPtr LParam;public uint Time;public Point Position;public uint Private;}
 [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint first,uint last,IntPtr module,WinEventProc proc,uint process,uint thread,uint flags);
 [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
 [DllImport("user32.dll")] static extern bool PeekMessage(out Message message,IntPtr hwnd,uint first,uint last,uint remove);
 [DllImport("user32.dll")] static extern int GetMessage(out Message message,IntPtr hwnd,uint first,uint last);
 [DllImport("user32.dll")] static extern bool PostThreadMessage(uint thread,uint message,UIntPtr wParam,IntPtr lParam);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd,StringBuilder text,int count);
 [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
 public void Notify(){changed.Set();}
 public bool Wait(int milliseconds){return changed.WaitOne(milliseconds);}
 public void Start(){
  if(thread!=null)return;
  thread=new Thread(()=>{
   IntPtr hook=IntPtr.Zero;
   try{
    Message initial;PeekMessage(out initial,IntPtr.Zero,0,0,0);threadId=GetCurrentThreadId();
    callback=(h,kind,hwnd,obj,child,source,time)=>{if(hwnd==IntPtr.Zero||obj!=0||child!=0)return;var name=new StringBuilder(128);GetClassName(hwnd,name,name.Capacity);if(name.ToString()=="OperationStatusWindow"){try{if(kind==0x8000&&Created!=null)Created(hwnd.ToInt64());if(kind==0x8002&&Shown!=null)Shown(hwnd.ToInt64());}catch{}Notify();}};
    hook=SetWinEventHook(0x8000,0x8003,IntPtr.Zero,callback,0,0,2);
    if(hook==IntPtr.Zero)return; // Timed scans remain available if hooks fail.
    Message message;while(!closed&&GetMessage(out message,IntPtr.Zero,0,0)>0){}
   }catch{}finally{if(hook!=IntPtr.Zero)UnhookWinEvent(hook);}
  });thread.IsBackground=true;thread.Start();
 }
 public void Stop(){closed=true;Notify();if(threadId!=0)PostThreadMessage(threadId,0x12,UIntPtr.Zero,IntPtr.Zero);}
}
public sealed class TransferHoldPolicy {
 readonly Func<long> now;
 readonly Dictionary<long,long> pending=new Dictionary<long,long>(),closing=new Dictionary<long,long>();
 readonly HashSet<long> confirmed=new HashSet<long>();
 public TransferHoldPolicy(Func<long> clock){now=clock;}
 public void Stage(long id){if(!pending.ContainsKey(id))pending[id]=now()+750;}
 public bool Pending(long id){long until;return pending.TryGetValue(id,out until)&&now()<until;}
 public void Confirm(long id){confirmed.Add(id);pending.Remove(id);}
 public bool BeginClose(long id){if(!confirmed.Contains(id))return false;if(!closing.ContainsKey(id))closing[id]=now()+1500;return Closing(id);}
 public bool Closing(long id){long until;return closing.TryGetValue(id,out until)&&now()<until;}
 public void Remove(long id){pending.Remove(id);closing.Remove(id);confirmed.Remove(id);}
}
public interface ITransferWindowApi {
 bool SavePlacement(long id); bool Offscreen(long id); bool RestorePlacement(long id); void ClearPlacement(long id); string Failure();
 bool Known(long id); bool Visible(long id); int Cloaked(long id); int Marker(long id);
 bool Mark(long id,int kind); void Unmark(long id); bool Cloak(long id,bool value);
 long Style(long id); bool Style(long id,long value); bool Alpha(long id,byte value);
}
public sealed class TransferWindowMask {
 readonly ITransferWindowApi api;
 public TransferWindowMask(ITransferWindowApi api){this.api=api;}
 public bool Stage(long id){
  if(!api.Known(id)||api.Marker(id)!=0||api.Cloaked(id)!=0)return false;
  if(!api.Mark(id,1))return false;
  if(api.Cloak(id,true)&&api.Cloaked(id)>0)return true;
  if(api.Cloak(id,false))api.Unmark(id);return false;
 }
 public bool Hide(long id,bool preferLayered){
  if(!api.Known(id)||!api.Visible(id))return false;
  int owned=api.Marker(id);
  if(owned==3){if(!preferLayered)return api.Offscreen(id);if(!Restore(id))return false;owned=0;}
  if(owned==1){
   if(!preferLayered){
    // Move while still cloaked, then release the cloak: no visible transition.
    if(api.SavePlacement(id)){
     if(api.Offscreen(id)&&api.Mark(id,3)){
      if(api.Cloak(id,false))return true;
      api.Mark(id,1);
     }
     if(!api.RestorePlacement(id))return false;api.ClearPlacement(id);
    }
    return api.Cloak(id,true);
   }
   if(!Restore(id))return false;
  }
  if(owned==2)return api.Alpha(id,0);
  if(api.Cloaked(id)>0)return false;
  if(!preferLayered&&api.SavePlacement(id)){
   if(api.Mark(id,3)){
    if(api.Offscreen(id))return true;
    if(!api.RestorePlacement(id))return false;api.Unmark(id);
   }
   api.ClearPlacement(id);
  }
  if(!preferLayered&&api.Mark(id,1)){
   bool changed=api.Cloak(id,true);if(changed&&api.Cloaked(id)>0)return true;
   if(changed&&!api.Cloak(id,false))return false;api.Unmark(id);
  }
  // Keep UIA live. Only add a layer if we can restore the original state.
  long style=api.Style(id);if((style&0x80000)!=0)return false;
  if(!api.Mark(id,2))return false;
  if(api.Style(id,style|0x80000)&&api.Alpha(id,0))return true;
  if(api.Style(id,style))api.Unmark(id);return false;
 }
 public int Mode(long id){return api.Marker(id);}
 public string Failure(){return api.Failure();}
 public bool Restore(long id){
  if(!api.Known(id))return true;
  int marker=api.Marker(id);
  if(marker==3){if(!api.RestorePlacement(id))return false;api.ClearPlacement(id);api.Unmark(id);return true;}
  if(marker==1){if(!api.Cloak(id,false))return false;api.Unmark(id);return true;}
  if(marker==2){api.Alpha(id,255);if(!api.Style(id,api.Style(id)&~0x80000L))return false;api.Unmark(id);}
  return true;
 }
}
public sealed class TransferWindowApi:ITransferWindowApi {
 public delegate bool EnumProc(IntPtr hwnd,IntPtr data);
 [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback,IntPtr data);
 public static long[] OwnedWindows(){var found=new List<long>();EnumWindows((h,d)=>{if(GetProp(h,Property)!=IntPtr.Zero)found.Add(h.ToInt64());return true;},IntPtr.Zero);return found.ToArray();}
 string failure="";
 const string Property="EclipseIsland.TransferReplacement.071";
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder text,int count);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint process);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool SetProp(IntPtr h,string name,IntPtr value);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetProp(IntPtr h,string name);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr RemoveProp(IntPtr h,string name);
 [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h,int attribute,ref int value,int size);
 [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h,int attribute,out int value,int size);
 [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr64(IntPtr h,int index);
 [DllImport("user32.dll",EntryPoint="GetWindowLongW")] static extern int GetWindowLong32(IntPtr h,int index);
 [DllImport("user32.dll",EntryPoint="SetWindowLongPtrW",SetLastError=true)] static extern IntPtr SetWindowLongPtr64(IntPtr h,int index,IntPtr value);
 [DllImport("user32.dll",EntryPoint="SetWindowLongW",SetLastError=true)] static extern int SetWindowLong32(IntPtr h,int index,int value);
 [DllImport("kernel32.dll")] static extern void SetLastError(uint value);
 [DllImport("user32.dll",SetLastError=true)] static extern bool SetLayeredWindowAttributes(IntPtr h,uint color,byte alpha,uint flags);
 [StructLayout(LayoutKind.Sequential)] struct Rect {public int left,top,right,bottom;}
 [DllImport("user32.dll",SetLastError=true)] static extern bool GetWindowRect(IntPtr h,out Rect rect);
 [DllImport("user32.dll",SetLastError=true)] static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int width,int height,uint flags);
 [DllImport("user32.dll")] static extern IntPtr GetLastActivePopup(IntPtr h);
 [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h,uint command);
 [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
 bool Error(string stage){failure=stage+":"+Marshal.GetLastWin32Error();return false;}
 public string Failure(){return failure;}
 public bool SavePlacement(long id){
  Rect rect;if(!GetWindowRect(new IntPtr(id),out rect)||rect.right<=rect.left||rect.bottom<=rect.top)return Error("GetWindowRect");
  var h=new IntPtr(id);bool ok=SetProp(h,Property+".x",new IntPtr(rect.left))&&SetProp(h,Property+".y",new IntPtr(rect.top))&&SetProp(h,Property+".w",new IntPtr(rect.right-rect.left))&&SetProp(h,Property+".h",new IntPtr(rect.bottom-rect.top));
  if(!ok){Error("SavePlacement");ClearPlacement(id);}return ok;
 }
 bool Outside(Rect r,int x,int y,int right,int bottom){return r.left>=right||r.top>=bottom||r.right<=x||r.bottom<=y;}
 public bool Offscreen(long id){
  int x=GetSystemMetrics(76),y=GetSystemMetrics(77),width=GetSystemMetrics(78),height=GetSystemMetrics(79);
  if(width<=0||height<=0){failure="VirtualScreenUnavailable";return false;}int right=x+width,bottom=y+height;Rect rect;
  if(GetWindowRect(new IntPtr(id),out rect)&&Outside(rect,x,y,right,bottom)){failure="";return true;}
  if(!SetWindowPos(new IntPtr(id),IntPtr.Zero,right+256,bottom+256,0,0,0x0001|0x0004|0x0010|0x0200|0x4000))return Error("SetWindowPos");
  for(int attempt=0;attempt<15;attempt++){if(!GetWindowRect(new IntPtr(id),out rect))return Error("VerifyPosition");if(Outside(rect,x,y,right,bottom)){failure="";return true;}Thread.Sleep(10);}
  failure="WindowRemainedOnscreen";return false;
 }
 public bool RestorePlacement(long id){
  var h=new IntPtr(id);int x=GetProp(h,Property+".x").ToInt32(),y=GetProp(h,Property+".y").ToInt32(),width=GetProp(h,Property+".w").ToInt32(),height=GetProp(h,Property+".h").ToInt32();
  if(width<=0||height<=0){failure="SavedPlacementMissing";return false;}
  int left=GetSystemMetrics(76),top=GetSystemMetrics(77),screenWidth=GetSystemMetrics(78),screenHeight=GetSystemMetrics(79);
  if(screenWidth>0&&screenHeight>0&&(x>=left+screenWidth||x+width<=left||y>=top+screenHeight||y+height<=top)){x=Math.Max(left,Math.Min(x,left+screenWidth-width));y=Math.Max(top,Math.Min(y,top+screenHeight-height));}
  if(!SetWindowPos(h,IntPtr.Zero,x,y,width,height,0x0004|0x0010|0x0200|0x4000))return Error("RestorePosition");
  // A dialog opened relative to the relocated owner must also remain reachable.
  var popup=GetLastActivePopup(h);uint ownerPid,popupPid;GetWindowThreadProcessId(h,out ownerPid);GetWindowThreadProcessId(popup,out popupPid);Rect r;
  if(popup!=IntPtr.Zero&&popup!=h&&GetWindow(popup,4)==h&&ownerPid==popupPid&&IsWindowVisible(popup)&&GetWindowRect(popup,out r)){
   int vx=GetSystemMetrics(76),vy=GetSystemMetrics(77),right=vx+GetSystemMetrics(78),bottom=vy+GetSystemMetrics(79);
   if(Outside(r,vx,vy,right,bottom))SetWindowPos(popup,IntPtr.Zero,Math.Max(vx,Math.Min(x+32,right-(r.right-r.left))),Math.Max(vy,Math.Min(y+32,bottom-(r.bottom-r.top))),0,0,0x0001|0x0004|0x0010|0x0200|0x4000);
  }
  return true;
 }
 public void ClearPlacement(long id){foreach(string suffix in new[]{".x",".y",".w",".h"})RemoveProp(new IntPtr(id),Property+suffix);}
 public bool Known(long id){try{var h=new IntPtr(id);var text=new StringBuilder(256);if(GetClassName(h,text,256)==0||text.ToString()!="OperationStatusWindow")return false;uint pid;GetWindowThreadProcessId(h,out pid);using(var p=Process.GetProcessById((int)pid))return p.ProcessName.Equals("explorer",StringComparison.OrdinalIgnoreCase);}catch{return false;}}
 public bool Visible(long id){return IsWindowVisible(new IntPtr(id));}
 public int Cloaked(long id){int value;return DwmGetWindowAttribute(new IntPtr(id),14,out value,4)==0?value:-1;}
 public int Marker(long id){return GetProp(new IntPtr(id),Property).ToInt32();}
 public bool Mark(long id,int kind){return SetProp(new IntPtr(id),Property,new IntPtr(kind));}
 public void Unmark(long id){RemoveProp(new IntPtr(id),Property);}
 public bool Cloak(long id,bool value){int flag=value?1:0;return DwmSetWindowAttribute(new IntPtr(id),13,ref flag,4)==0;}
 public long Style(long id){return IntPtr.Size==8?GetWindowLongPtr64(new IntPtr(id),-20).ToInt64():GetWindowLong32(new IntPtr(id),-20);}
 public bool Style(long id,long value){SetLastError(0);long result=IntPtr.Size==8?SetWindowLongPtr64(new IntPtr(id),-20,new IntPtr(value)).ToInt64():SetWindowLong32(new IntPtr(id),-20,(int)value);return result!=0||Marshal.GetLastWin32Error()==0;}
 public bool Alpha(long id,byte value){return SetLayeredWindowAttributes(new IntPtr(id),0,value,2);}
}

public static class TransferButtonNames {
 public static bool CanReplace(int progressBars,int cancelButtons,string text){return cancelButtons==1&&(progressBars>0||Regex.IsMatch(text??"",@"(?i)подготовк|обнаруж|копир|перемещ|удален|удалени|delet|copy|mov(e|ing)|prepar|discover|recycl|items|элем"));}
 public static bool IsPause(string name,string id){return Regex.IsMatch((name??" ").Trim(),@"(?i)^(?:pause\b|resume\b|приостанов\w*|пауза\b|возобнов\w*|продолжить\b)")||Regex.IsMatch(id??"",@"(?i)^(?:Pause|PauseButton|ResumeButton)$");}
 public static bool IsCancel(string name,string id){return Regex.IsMatch((name??" ").Trim(),@"(?i)^(?:cancel\b|stop\b|отмен\w*|прервать\b|остановить\b)")||Regex.IsMatch(id??"",@"(?i)^(?:Cancel|CancelButton|StopButton)$");}
 public static bool IsResume(string name,string id){return Regex.IsMatch((name??" ").Trim(),@"(?i)^(?:resume\b|возобнов\w*|продолжить\b)")||Regex.IsMatch(id??"",@"(?i)^ResumeButton$");}
}
