using System;
class FakeApi:ITransferWindowApi {
 public bool known=true,visible=true,canCloak=true,canMark=true,canAlpha=true,canMove=true;public bool offscreen=false,placement=false;public int cloaked=0,marker=0;public long style=0;public byte alpha=255;
 public bool SavePlacement(long id){placement=true;return true;}public bool Offscreen(long id){if(!canMove)return false;offscreen=true;return true;}public bool RestorePlacement(long id){offscreen=false;return true;}public void ClearPlacement(long id){placement=false;}public string Failure(){return "";}
 public bool Known(long id){return known;}public bool Visible(long id){return visible;}public int Cloaked(long id){return cloaked;}public int Marker(long id){return marker;}
 public bool Mark(long id,int kind){if(!canMark)return false;marker=kind;return true;}public void Unmark(long id){marker=0;}public bool Cloak(long id,bool value){if(!canCloak)return false;cloaked=value?1:0;return true;}
 public long Style(long id){return style;}public bool Style(long id,long value){style=value;return true;}public bool Alpha(long id,byte value){if(!canAlpha)return false;alpha=value;return true;}
}
class Program {
 static void Check(bool v,string s){if(!v)throw new Exception(s);Console.WriteLine("PASS "+s);}
 static void Main(){
  Check(TransferButtonNames.IsCancel("Остановить операцию", ""),"Russian Windows stop-operation button is a cancel action");
  Check(!TransferButtonNames.IsCancel("Приостановить операцию", "")&&TransferButtonNames.IsPause("Приостановить операцию", ""),"pause cannot be mistaken for cancel");
  Check(TransferButtonNames.IsPause("Пауза", "")&&TransferButtonNames.IsResume("Продолжить", ""),"Russian pause and resume names are recognized");
  Check(TransferButtonNames.IsCancel("", "CancelButton")&&TransferButtonNames.IsPause("", "PauseButton"),"stable automation IDs can identify unlabeled buttons");
  Check(TransferButtonNames.CanReplace(2,1,"Подготовка к удалению"),"multiple progress indicators with one cancel action are replaceable");
  Check(TransferButtonNames.CanReplace(0,1,"Обнаружено: 49 791 элементов"),"preparation can be replaced before a progress provider appears");
  Check(!TransferButtonNames.CanReplace(2,2,"Копирование"),"ambiguous per-operation cancel buttons stay accessible in Windows");
  var signal=new TransferScanSignal();signal.Notify();Check(signal.Wait(0),"new-window signal wakes the scanner immediately");Check(!signal.Wait(0),"wake signals coalesce without a busy loop");signal.Stop();Check(signal.Wait(0),"shutdown releases a waiting scanner");
  long now=0;var lifetime=new TransferHoldPolicy(()=>now);lifetime.Stage(9);Check(lifetime.Pending(9)&&!lifetime.BeginClose(9),"unconfirmed staging cannot turn into a closing hold");now=600;lifetime.Stage(9);now=750;Check(!lifetime.Pending(9),"provisional masking expires and repeated events cannot extend it");lifetime.Confirm(9);Check(lifetime.BeginClose(9),"confirmed cancellation retains its mask");now=2249;Check(lifetime.BeginClose(9),"disappearing controls do not reveal a closing operation");now=2250;Check(!lifetime.BeginClose(9),"closing hold is bounded and cannot be renewed");lifetime.Remove(9);Check(!lifetime.BeginClose(9),"restoration clears ownership of the closing hold");
  var early=new FakeApi();early.visible=false;var staged=new TransferWindowMask(early);Check(staged.Stage(2)&&early.cloaked==1,"creation can be cloaked before WS_VISIBLE");early.visible=true;Check(staged.Hide(2,false)&&early.offscreen&&early.cloaked==0&&early.marker==3,"staged cloak promotes to offscreen placement");Check(staged.Restore(2)&&!early.offscreen&&early.cloaked==0,"promoted staging restores original placement");early.known=false;Check(!staged.Stage(2),"early masking never applies to unrelated window classes or processes");
  var moving=new FakeApi();var mover=new TransferWindowMask(moving);Check(mover.Hide(1,false)&&moving.offscreen&&moving.marker==3&&moving.visible,"verified placement removes native pixels without hiding its provider");Check(mover.Restore(1)&&!moving.offscreen&&!moving.placement&&moving.marker==0,"watchdog returns the original placement");
  var a=new FakeApi();a.canMove=false;var m=new TransferWindowMask(a);
  Check(m.Hide(1,false)&&a.cloaked==1&&a.visible,"visual masking preserves provider visibility");Check(m.Hide(1,false)&&a.marker==1,"successive observations keep replacement active");Check(m.Restore(1)&&a.cloaked==0&&a.marker==0,"watchdog restores cloaked windows");
  a.canCloak=false;a.style=0x80;Check(m.Hide(1,false)&&a.marker==2&&a.alpha==0&&a.visible,"unsupported cloaking uses zero-alpha");Check(m.Restore(1)&&a.alpha==255&&a.style==0x80&&a.marker==0,"alpha restoration preserves other styles");
  a.canCloak=true;Check(m.Hide(1,false)&&m.Hide(1,true)&&a.cloaked==0&&a.marker==2,"provider failure can switch to the alpha path");m.Restore(1);
  a.cloaked=2;Check(!m.Hide(1,false)&&a.cloaked==2&&a.marker==0,"shell-cloaked windows are untouched");a.cloaked=0;a.known=false;Check(!m.Hide(1,false)&&a.marker==0,"unrelated windows are untouched");
  a.known=true;a.canMark=false;Check(!m.Hide(1,false)&&a.marker==0&&a.alpha==255,"a recoverable marker is required");a.canMark=true;a.canCloak=false;a.canAlpha=false;a.style=0x80;Check(!m.Hide(1,false)&&a.marker==0&&a.style==0x80,"failed masking rolls back changes");
  a.canAlpha=true;a.style=0x80080;Check(!m.Hide(1,false)&&a.style==0x80080,"existing layering is preserved");Check(m.Restore(1)&&a.style==0x80080,"recovery ignores windows without our marker");
 }
}
