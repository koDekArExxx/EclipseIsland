using System;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Text;
using System.Linq;
using System.Diagnostics;
using System.Drawing;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Security.Cryptography;
using System.Web.Script.Serialization;
using System.Collections.Generic;
using System.Reflection;
using Microsoft.Win32;
[assembly:AssemblyVersion("1.0.0.0")]
namespace EclipseIslandSetup {
 public sealed class Manifest {public int schema;public string version;public string url;public string sha256;public long size;public int launcherVersion;}
 public sealed class InstallState {public string version;public string previous;public string goodVersion;}
 public sealed class BundleInfo {public string version;public string platform;public string arch;}
 public static class Core {
  public static readonly string Root=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"EclipseIsland");
  public static readonly string Launcher=Path.Combine(Root,"EclipseIsland.exe");
  public static readonly JavaScriptSerializer Json=new JavaScriptSerializer{MaxJsonLength=262144};
  public static Version ParseVersion(string text){if(text==null||!System.Text.RegularExpressions.Regex.IsMatch(text,@"^\d{1,5}\.\d{1,5}\.\d{1,5}$"))throw new Exception("Некорректная версия обновления");return new Version(text);}
  public static string AppFile(string version){ParseVersion(version);return Path.Combine(Root,"versions",version,"EclipseIsland.exe");}
  public static bool Installed(string version){try{return File.Exists(AppFile(version))&&File.Exists(Path.Combine(Path.GetDirectoryName(AppFile(version)),".complete"));}catch{return false;}}
  public static void ValidateUrl(Uri url){if(url.Scheme!="https"||!(url.Host.Equals("github.com",StringComparison.OrdinalIgnoreCase)||url.Host.EndsWith(".githubusercontent.com",StringComparison.OrdinalIgnoreCase)||url.Host.Equals("release-assets.githubusercontent.com",StringComparison.OrdinalIgnoreCase)))throw new Exception("Недопустимый адрес обновления");}
  public static async Task Download(string address,string file,long maximum,int timeout,Action<long,long> progress){
   Uri url=new Uri(address);for(int redirect=0;redirect<8;redirect++){
    ValidateUrl(url);var request=(HttpWebRequest)WebRequest.Create(url);request.AllowAutoRedirect=false;request.UserAgent="EclipseIsland-Launcher/1";request.Timeout=timeout;request.ReadWriteTimeout=timeout;
    using(var cancel=new CancellationTokenSource(timeout))using(cancel.Token.Register(()=>request.Abort())){
     HttpWebResponse response;try{response=(HttpWebResponse)await request.GetResponseAsync();}catch(WebException e){throw new Exception("Сеть недоступна: "+e.Status);}
     using(response){int code=(int)response.StatusCode;if(code>=300&&code<400){var next=response.Headers["Location"];if(String.IsNullOrWhiteSpace(next))throw new Exception("Пустое перенаправление");url=new Uri(url,next);continue;}if(code!=200)throw new Exception("Ошибка загрузки: HTTP "+code);
      if(response.ContentLength>maximum)throw new Exception("Файл обновления слишком большой");
      using(var input=response.GetResponseStream())using(var output=new FileStream(file,FileMode.CreateNew,FileAccess.Write,FileShare.None,65536,true)){
       var buffer=new byte[65536];long total=0;int count;while((count=await input.ReadAsync(buffer,0,buffer.Length,cancel.Token))>0){total+=count;if(total>maximum)throw new Exception("Превышен размер обновления");await output.WriteAsync(buffer,0,count,cancel.Token);progress(total,response.ContentLength);}
      }return;
     }
    }
   }throw new Exception("Слишком много перенаправлений");
  }
  public static void ValidateManifest(Manifest m){if(m==null||m.schema!=1||m.launcherVersion>1)throw new Exception("Обновите установщик EclipseIsland");ParseVersion(m.version);if(m.size<1000||m.size>1073741824L||m.sha256==null||!System.Text.RegularExpressions.Regex.IsMatch(m.sha256,@"^[a-f0-9]{64}$"))throw new Exception("Некорректный список обновления");var uri=new Uri(m.url);ValidateUrl(uri);if(uri.Host!="github.com"||!uri.AbsolutePath.StartsWith("/"+BuildConfig.Repository+"/releases/download/",StringComparison.OrdinalIgnoreCase))throw new Exception("Обновление из другого репозитория");}
  public static void Verify(string file,Manifest m){if(new FileInfo(file).Length!=m.size)throw new Exception("Обновление загружено не полностью");using(var hash=SHA256.Create())using(var stream=File.OpenRead(file)){var actual=BitConverter.ToString(hash.ComputeHash(stream)).Replace("-","").ToLowerInvariant();if(actual!=m.sha256)throw new Exception("Контрольная сумма обновления не совпала");}}
  public static void Extract(string archive,string target,string version){
   Directory.CreateDirectory(target);string prefix=Path.GetFullPath(target)+Path.DirectorySeparatorChar;long total=0;int count=0;
   using(var zip=ZipFile.OpenRead(archive))foreach(var entry in zip.Entries){
    if(++count>6000||entry.FullName.IndexOf(':')>=0||((entry.ExternalAttributes>>16)&0xf000)==0xa000)throw new Exception("Некорректный архив обновления");
    total+=entry.Length;if(total>4294967296L)throw new Exception("Распакованное обновление слишком большое");
    string file=Path.GetFullPath(Path.Combine(target,entry.FullName.Replace('/',Path.DirectorySeparatorChar)));
    if(!file.StartsWith(prefix,StringComparison.OrdinalIgnoreCase))throw new Exception("Некорректный путь в обновлении");
    if(entry.FullName.EndsWith("/")){Directory.CreateDirectory(file);continue;}Directory.CreateDirectory(Path.GetDirectoryName(file));using(var source=entry.Open())using(var output=new FileStream(file,FileMode.CreateNew))source.CopyTo(output);
   }
   var info=Json.Deserialize<BundleInfo>(File.ReadAllText(Path.Combine(target,"bundle.json")));if(info.version!=version||info.platform!="win32"||info.arch!="x64"||!File.Exists(Path.Combine(target,"EclipseIsland.exe")))throw new Exception("Версия или платформа архива не совпала");
   File.WriteAllText(Path.Combine(target,".complete"),version,Encoding.UTF8);
  }
  public static InstallState LoadState(){try{var state=Json.Deserialize<InstallState>(File.ReadAllText(Path.Combine(Root,"state.json")));if(Installed(state.version))return state;}catch{}return new InstallState();}
  public static void SaveState(InstallState state){string file=Path.Combine(Root,"state.json"),temp=file+".tmp";File.WriteAllText(temp,Json.Serialize(state),Encoding.UTF8);if(File.Exists(file))File.Replace(temp,file,null);else File.Move(temp,file);}
  public static void Shortcuts(bool desktop){string programs=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs),"EclipseIsland");Directory.CreateDirectory(programs);MakeLink(Path.Combine(programs,"EclipseIsland.lnk"));if(desktop)MakeLink(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),"EclipseIsland.lnk"));}
  static void MakeLink(string file){object shell=null,link=null;try{shell=Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));link=shell.GetType().InvokeMember("CreateShortcut",BindingFlags.InvokeMethod,null,shell,new object[]{file});var type=link.GetType();type.InvokeMember("TargetPath",BindingFlags.SetProperty,null,link,new object[]{Launcher});type.InvokeMember("WorkingDirectory",BindingFlags.SetProperty,null,link,new object[]{Root});type.InvokeMember("IconLocation",BindingFlags.SetProperty,null,link,new object[]{Launcher+",0"});type.InvokeMember("Save",BindingFlags.InvokeMethod,null,link,null);}finally{if(link!=null)System.Runtime.InteropServices.Marshal.FinalReleaseComObject(link);if(shell!=null)System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell);}}
  public static void RegisterProduct(string version){using(var key=Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\EclipseIsland")){key.SetValue("DisplayName","EclipseIsland");key.SetValue("DisplayVersion",version??"Installer");key.SetValue("Publisher","EclipseIsland");key.SetValue("InstallLocation",Root);key.SetValue("DisplayIcon",Launcher);key.SetValue("UninstallString","\""+Launcher+"\" --uninstall");key.SetValue("NoModify",1);key.SetValue("NoRepair",1);}}
  public static void Uninstall(){if(RunningApp()!=null){MessageBox.Show("Сначала закройте EclipseIsland через трей, затем повторите удаление.","EclipseIsland");return;}string temp=Path.Combine(Path.GetTempPath(),"EclipseIsland-Uninstall-"+Guid.NewGuid().ToString("N")+".exe");File.Copy(Process.GetCurrentProcess().MainModule.FileName,temp);Process.Start(new ProcessStartInfo(temp,"--remove-installation"){UseShellExecute=false});}
  public static void RemoveInstallation(){for(int n=0;n<20;n++){try{if(Directory.Exists(Root))Directory.Delete(Root,true);break;}catch{Thread.Sleep(250);if(n==19)throw;}}var programs=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs),"EclipseIsland");if(Directory.Exists(programs))Directory.Delete(programs,true);string desktop=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),"EclipseIsland.lnk");if(File.Exists(desktop))File.Delete(desktop);Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\EclipseIsland",false);using(var key=Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run",true)){var value=key==null?null:key.GetValue("EclipseIsland") as string;if(value!=null&&value.IndexOf(Launcher,StringComparison.OrdinalIgnoreCase)>=0)key.DeleteValue("EclipseIsland",false);}}
  public static void CleanupVersions(InstallState state){string versions=Path.Combine(Root,"versions");if(!Directory.Exists(versions))return;foreach(string dir in Directory.GetDirectories(versions))if(Path.GetFileName(dir)!=state.version&&Path.GetFileName(dir)!=state.previous)try{Directory.Delete(dir,true);}catch{}}
  public static Process StartApp(string version,string[] args){var start=new ProcessStartInfo(AppFile(version));start.WorkingDirectory=Path.GetDirectoryName(start.FileName);start.UseShellExecute=false;start.Arguments=String.Join(" ",args.Where(a=>a=="--autostart").ToArray());start.EnvironmentVariables["ECLIPSE_LAUNCHER_PATH"]=Launcher;start.EnvironmentVariables["ECLIPSE_COMPONENTS_DIR"]=Path.Combine(Root,"components");return Process.Start(start);}
  public static string RunningApp(){foreach(var p in Process.GetProcessesByName("EclipseIsland")){try{if(p.Id==Process.GetCurrentProcess().Id)continue;string file=p.MainModule.FileName;if(!file.Equals(Launcher,StringComparison.OrdinalIgnoreCase))return file;}catch{}}return null;}
 }
 public sealed class SetupTheme {
  public Color Surface=Color.FromArgb(18,13,29),Text=Color.FromArgb(240,235,250),Accent=Color.FromArgb(189,162,255);
  public bool ReducedMotion;public string Renderer="modern";
  public static Color Mix(Color a,Color b,float amount){return Color.FromArgb((int)(a.R+(b.R-a.R)*amount),(int)(a.G+(b.G-a.G)*amount),(int)(a.B+(b.B-a.B)*amount));}
  public static SetupTheme Load(){var theme=new SetupTheme();try{string file=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),"EclipseIsland","settings.json");if(new FileInfo(file).Length>262144)return theme;var data=Core.Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(file));return FromSettings(data);}catch{return theme;}}
  public static SetupTheme FromSettings(Dictionary<string,object> data){var t=new SetupTheme();object value;
   if(data==null)return t;if(data.TryGetValue("surfaceColor",out value))t.Surface=ReadColor(value,t.Surface);if(data.TryGetValue("textColor",out value))t.Text=ReadColor(value,t.Text);
   string accent=data.TryGetValue("accent",out value)?value as string:null;var palettes=new Dictionary<string,string>{{"mint","#bcebc5"},{"violet","#bda2ff"},{"blue","#b3d6ff"},{"peach","#f2ccb2"},{"rose","#f5a1ca"},{"amber","#efcb7b"}};
   if(accent=="custom"&&data.TryGetValue("customAccent",out value))t.Accent=ReadColor(value,t.Accent);else if(accent!=null&&palettes.ContainsKey(accent))t.Accent=ReadColor(palettes[accent],t.Accent);
   if(data.TryGetValue("reducedMotion",out value)&&value is bool)t.ReducedMotion=(bool)value;if(data.TryGetValue("loaderRenderer",out value)&&new[]{"modern","liquid","frosted"}.Contains(value as string))t.Renderer=(string)value;return t;
  }
  static Color ReadColor(object value,Color fallback){string s=value as string;if(s==null||!System.Text.RegularExpressions.Regex.IsMatch(s,"^#[a-fA-F0-9]{6}$"))return fallback;return ColorTranslator.FromHtml(s);}
 }
 public static class SetupDrawing {
  public static void ChildBackdrop(Graphics g,Control control,SetupTheme theme){
   var parent=control.Parent;Rectangle area=parent==null?new Rectangle(0,0,560,410):new Rectangle(-control.Left,-control.Top,Math.Max(1,parent.ClientSize.Width),Math.Max(1,parent.ClientSize.Height));
   using(var brush=new System.Drawing.Drawing2D.LinearGradientBrush(area,SetupTheme.Mix(theme.Surface,theme.Accent,.055f),theme.Surface,45f))g.FillRectangle(brush,control.ClientRectangle);
  }
  public static System.Drawing.Drawing2D.GraphicsPath Round(RectangleF r,float radius){var p=new System.Drawing.Drawing2D.GraphicsPath();float d=Math.Min(radius*2,Math.Min(r.Width,r.Height));p.AddArc(r.X,r.Y,d,d,180,90);p.AddArc(r.Right-d,r.Y,d,d,270,90);p.AddArc(r.Right-d,r.Bottom-d,d,d,0,90);p.AddArc(r.X,r.Bottom-d,d,d,90,90);p.CloseFigure();return p;}
  public static void Text(Graphics g,string text,float size,Color color,RectangleF rect,bool bold=false){using(var font=new Font("Segoe UI",size,bold?FontStyle.Bold:FontStyle.Regular,GraphicsUnit.Pixel))using(var brush=new SolidBrush(color))using(var format=new StringFormat{Trimming=StringTrimming.EllipsisCharacter,FormatFlags=StringFormatFlags.LineLimit})g.DrawString(text,font,brush,rect,format);}
 }
 public sealed class SetupSurface:Control {
  public readonly SetupTheme Theme;public string Heading="Проверяем обновления…",Detail="Ищем последнюю версию EclipseIsland",Phase="ПРОВЕРКА ОБНОВЛЕНИЙ";public int Step;public bool Failed,Indeterminate=true;public float Target;
  float shown;readonly Stopwatch clock=Stopwatch.StartNew();long lastTick;readonly System.Windows.Forms.Timer animation=new System.Windows.Forms.Timer();
  public SetupSurface(SetupTheme theme){Theme=theme;SetStyle(ControlStyles.UserPaint|ControlStyles.AllPaintingInWmPaint|ControlStyles.OptimizedDoubleBuffer|ControlStyles.ResizeRedraw,true);BackColor=theme.Surface;AccessibleRole=AccessibleRole.Pane;animation.Interval=16;animation.Tick+=(s,e)=>{long now=clock.ElapsedMilliseconds;float dt=Math.Min(100,now-lastTick);lastTick=now;shown+=(Target-shown)*(1-(float)Math.Exp(-dt/90));Invalidate(Scaled(new Rectangle(36,258,488,27)));if(!Indeterminate&&Math.Abs(shown-Target)<.05f){shown=Target;animation.Stop();}};}
  Rectangle Scaled(Rectangle r){float s=ClientSize.Width/560f;return Rectangle.Ceiling(new RectangleF(r.X*s,r.Y*s,r.Width*s,r.Height*s));}
  public void Changed(){AccessibleName=Heading;AccessibleDescription=Detail;Invalidate();if(Theme.ReducedMotion){shown=Target;animation.Stop();}else if(Visible&&!Failed&&(!IsHandleCreated||FindForm()==null||FindForm().WindowState!=FormWindowState.Minimized)){lastTick=clock.ElapsedMilliseconds;animation.Start();}else animation.Stop();}
  protected override void OnVisibleChanged(EventArgs e){base.OnVisibleChanged(e);Changed();}
  protected override void Dispose(bool disposing){if(disposing)animation.Dispose();base.Dispose(disposing);}
  protected override void OnPaint(PaintEventArgs e){var g=e.Graphics;g.SmoothingMode=System.Drawing.Drawing2D.SmoothingMode.AntiAlias;g.TextRenderingHint=System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;g.ScaleTransform(ClientSize.Width/560f,ClientSize.Width/560f);PaintSurface(g);}
  public void PaintSurface(Graphics g){var t=Theme;Color muted=SetupTheme.Mix(t.Surface,t.Text,.58f),line=SetupTheme.Mix(t.Surface,t.Text,.11f),accent=Failed?Color.FromArgb(255,158,172):t.Accent;
   g.Clear(t.Surface);using(var glow=new System.Drawing.Drawing2D.LinearGradientBrush(new Rectangle(0,0,560,410),SetupTheme.Mix(t.Surface,t.Accent,.055f),t.Surface,45f))g.FillRectangle(glow,0,0,560,410);
   // The real DWM frame owns the outer border and rounded corners.
   using(var tile=SetupDrawing.Round(new RectangleF(28,28,48,48),15)){
    using(var fill=new System.Drawing.Drawing2D.LinearGradientBrush(new Rectangle(28,28,48,48),SetupTheme.Mix(t.Surface,t.Accent,.16f),SetupTheme.Mix(t.Surface,t.Accent,.04f),90f))g.FillPath(fill,tile);using(var pen=new Pen(Color.FromArgb(65,t.Accent)))g.DrawPath(pen,tile);
   }
   PointF[] star={new PointF(52,38),new PointF(56,48),new PointF(66,52),new PointF(56,56),new PointF(52,66),new PointF(48,56),new PointF(38,52),new PointF(48,48)};using(var pen=new Pen(t.Accent,2.4f)){pen.LineJoin=System.Drawing.Drawing2D.LineJoin.Round;g.DrawPolygon(pen,star);}
   SetupDrawing.Text(g,"EclipseIsland",23,t.Text,new RectangleF(90,30,340,32),true);SetupDrawing.Text(g,"Установка и обновления",12,muted,new RectangleF(91,63,335,20));
   Rectangle card=new Rectangle(24,108,512,188);using(var shape=SetupDrawing.Round(card,20)){
    using(var fill=new System.Drawing.Drawing2D.LinearGradientBrush(card,SetupTheme.Mix(t.Surface,t.Text,t.Renderer=="frosted"?.065f:.035f),SetupTheme.Mix(t.Surface,t.Text,.014f),110f))g.FillPath(fill,shape);
    using(var pen=new Pen(SetupTheme.Mix(line,t.Accent,.12f)))g.DrawPath(pen,shape);
   }
   SetupDrawing.Text(g,Phase,10,accent,new RectangleF(44,131,410,20),true);SetupDrawing.Text(g,Heading,22,t.Text,new RectangleF(42,160,474,57),true);SetupDrawing.Text(g,Detail,12,muted,new RectangleF(44,224,472,35));
   RectangleF track=new RectangleF(44,273,472,5);using(var shape=SetupDrawing.Round(track,2.5f))using(var brush=new SolidBrush(SetupTheme.Mix(t.Surface,t.Text,.10f)))g.FillPath(brush,shape);
   if(!Failed){float width=Indeterminate?118:Math.Max(0,472*shown/100);float x=Indeterminate?44+(float)((Math.Sin(clock.Elapsed.TotalSeconds*1.7-Math.PI/2)+1)/2)*(472-width):44;if(Theme.ReducedMotion&&Indeterminate)x=44;
    if(width>.1f)using(var shape=SetupDrawing.Round(new RectangleF(x,273,width,5),2.5f))using(var brush=new System.Drawing.Drawing2D.LinearGradientBrush(new RectangleF(x,273,Math.Max(1,width),5),accent,SetupTheme.Mix(accent,t.Text,.30f),0f))g.FillPath(brush,shape);
   }
   string[] labels={"Проверка","Загрузка","Запуск"};for(int i=0;i<3;i++){float x=56+i*182;bool active=i<=Step;Color color=active?accent:muted;using(var brush=new SolidBrush(active?Color.FromArgb(38,accent):Color.FromArgb(18,t.Text)))g.FillEllipse(brush,x,319,20,20);if(i<Step){using(var pen=new Pen(color,1.5f)){g.DrawLines(pen,new[]{new PointF(x+5,329),new PointF(x+9,333),new PointF(x+15,325)});}}else{using(var brush=new SolidBrush(color))g.FillEllipse(brush,x+7,326,6,6);}SetupDrawing.Text(g,labels[i],11,color,new RectangleF(x+28,321,110,21));}
   using(var pen=new Pen(line))g.DrawLine(pen,28,355,532,355);
   if(!Failed)SetupDrawing.Text(g,"EclipseIsland · Windows",10,muted,new RectangleF(390,375,150,20));
  }
 }
 public sealed class SetupButton:Control,IButtonControl {
  readonly SetupTheme theme;readonly bool primary;bool hover,pressed,isDefault;public string Glyph;
  public SetupButton(SetupTheme t,bool primary=false){theme=t;this.primary=primary;SetStyle(ControlStyles.UserPaint|ControlStyles.AllPaintingInWmPaint|ControlStyles.OptimizedDoubleBuffer|ControlStyles.ResizeRedraw|ControlStyles.Selectable|ControlStyles.StandardClick,true);BackColor=t.Surface;Cursor=Cursors.Hand;TabStop=true;AccessibleRole=AccessibleRole.PushButton;}
  public DialogResult DialogResult{get;set;}
  public void NotifyDefault(bool value){isDefault=value;Invalidate();}
  public void PerformClick(){if(Enabled&&Visible){OnClick(EventArgs.Empty);var form=FindForm();if(form!=null&&DialogResult!=DialogResult.None)form.DialogResult=DialogResult;}}
  protected override void OnPaintBackground(PaintEventArgs e){}
  protected override void OnMouseEnter(EventArgs e){hover=true;Invalidate();base.OnMouseEnter(e);}protected override void OnMouseLeave(EventArgs e){hover=false;Invalidate();base.OnMouseLeave(e);}
  protected override void OnMouseDown(MouseEventArgs e){if(e.Button==MouseButtons.Left){Focus();pressed=true;Invalidate();}base.OnMouseDown(e);}protected override void OnMouseUp(MouseEventArgs e){pressed=false;Invalidate();base.OnMouseUp(e);}
  protected override void OnLostFocus(EventArgs e){pressed=false;Invalidate();base.OnLostFocus(e);}protected override void OnGotFocus(EventArgs e){Invalidate();base.OnGotFocus(e);}
  protected override void OnEnabledChanged(EventArgs e){pressed=false;Invalidate();base.OnEnabledChanged(e);}
  protected override bool IsInputKey(Keys key){return key==Keys.Space||key==Keys.Enter||base.IsInputKey(key);}
  protected override void OnKeyDown(KeyEventArgs e){if(e.KeyCode==Keys.Space){pressed=true;Invalidate();e.Handled=true;e.SuppressKeyPress=true;}else if(e.KeyCode==Keys.Enter){PerformClick();e.Handled=true;e.SuppressKeyPress=true;}base.OnKeyDown(e);}
  protected override void OnKeyUp(KeyEventArgs e){if(e.KeyCode==Keys.Space){bool click=pressed;pressed=false;Invalidate();if(click)PerformClick();e.Handled=true;e.SuppressKeyPress=true;}base.OnKeyUp(e);}
  protected override AccessibleObject CreateAccessibilityInstance(){return new ButtonAccessibility(this);}
  sealed class ButtonAccessibility:ControlAccessibleObject{readonly SetupButton button;public ButtonAccessibility(SetupButton button):base(button){this.button=button;}public override string DefaultAction{get{return "Нажать";}}public override void DoDefaultAction(){button.PerformClick();}}
  protected override void OnPaint(PaintEventArgs e){PaintButton(e.Graphics,hover,pressed);}
  public void PaintButton(Graphics g,bool hot,bool down){
   SetupDrawing.ChildBackdrop(g,this,theme);g.SmoothingMode=System.Drawing.Drawing2D.SmoothingMode.AntiAlias;g.TextRenderingHint=System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
   float scale=Height/(primary?32f:28f);RectangleF rect=new RectangleF(.75f,.75f,Width-1.5f,Height-1.5f);
   using(var shape=SetupDrawing.Round(rect,Math.Min(10*scale,Height/3f))){Color fill=primary?SetupTheme.Mix(theme.Accent,theme.Text,down?.20f:hot?.10f:0):Color.FromArgb(down?40:hot?22:0,theme.Text);using(var brush=new SolidBrush(fill))g.FillPath(brush,shape);if(Focused||isDefault)using(var pen=new Pen(Color.FromArgb(Focused?150:60,theme.Accent),Math.Max(1,scale)))g.DrawPath(pen,shape);}
   Color ink=Enabled?(primary?theme.Surface:theme.Text):SetupTheme.Mix(theme.Surface,theme.Text,.35f);
   if(Glyph=="close"||Glyph=="minimize"){
    float cx=Width/2f,cy=Height/2f,r=4*scale;using(var pen=new Pen(ink,Math.Max(1.4f,1.4f*scale))){pen.StartCap=pen.EndCap=System.Drawing.Drawing2D.LineCap.Round;if(Glyph=="close"){g.DrawLine(pen,cx-r,cy-r,cx+r,cy+r);g.DrawLine(pen,cx+r,cy-r,cx-r,cy+r);}else g.DrawLine(pen,cx-r,cy+1*scale,cx+r,cy+1*scale);}
   }else using(var font=new Font("Segoe UI",Font.Size,primary?FontStyle.Bold:FontStyle.Regular))using(var brush=new SolidBrush(ink))using(var format=new StringFormat{Alignment=StringAlignment.Center,LineAlignment=StringAlignment.Center})g.DrawString(Text,font,brush,rect,format);
  }
 }
 public sealed class SetupCheck:Control {
  readonly SetupTheme theme;bool value,keyPressed;public bool Checked{get{return value;}set{this.value=value;Invalidate();if(IsHandleCreated)AccessibilityNotifyClients(AccessibleEvents.StateChange,-1);}}
  public SetupCheck(SetupTheme t){theme=t;SetStyle(ControlStyles.UserPaint|ControlStyles.AllPaintingInWmPaint|ControlStyles.OptimizedDoubleBuffer|ControlStyles.ResizeRedraw|ControlStyles.Selectable|ControlStyles.StandardClick,true);BackColor=t.Surface;Cursor=Cursors.Hand;TabStop=true;AccessibleRole=AccessibleRole.CheckButton;}
  protected override void OnPaintBackground(PaintEventArgs e){}
  protected override void OnClick(EventArgs e){if(Enabled)Checked=!Checked;base.OnClick(e);}
  protected override void OnGotFocus(EventArgs e){Invalidate();base.OnGotFocus(e);}protected override void OnLostFocus(EventArgs e){keyPressed=false;Invalidate();base.OnLostFocus(e);}
  protected override bool IsInputKey(Keys key){return key==Keys.Space||base.IsInputKey(key);}
  protected override void OnKeyDown(KeyEventArgs e){if(e.KeyCode==Keys.Space){keyPressed=true;e.Handled=true;e.SuppressKeyPress=true;}base.OnKeyDown(e);}
  protected override void OnKeyUp(KeyEventArgs e){if(e.KeyCode==Keys.Space){bool click=keyPressed;keyPressed=false;if(click)OnClick(EventArgs.Empty);e.Handled=true;e.SuppressKeyPress=true;}base.OnKeyUp(e);}
  protected override AccessibleObject CreateAccessibilityInstance(){return new CheckAccessibility(this);}
  sealed class CheckAccessibility:ControlAccessibleObject{readonly SetupCheck check;public CheckAccessibility(SetupCheck check):base(check){this.check=check;}public override string DefaultAction{get{return "Переключить";}}public override AccessibleStates State{get{return base.State|(check.Checked?AccessibleStates.Checked:AccessibleStates.None);}}public override void DoDefaultAction(){if(check.Enabled)check.OnClick(EventArgs.Empty);}}
  protected override void OnPaint(PaintEventArgs e){var g=e.Graphics;SetupDrawing.ChildBackdrop(g,this,theme);g.SmoothingMode=System.Drawing.Drawing2D.SmoothingMode.AntiAlias;float s=Height/26f;using(var shape=SetupDrawing.Round(new RectangleF(1,5*s,15*s,15*s),4*s)){using(var brush=new SolidBrush(Checked?theme.Accent:SetupTheme.Mix(theme.Surface,theme.Text,.08f)))g.FillPath(brush,shape);using(var pen=new Pen(Focused?theme.Accent:SetupTheme.Mix(theme.Surface,theme.Text,.22f)))g.DrawPath(pen,shape);}if(Checked)using(var pen=new Pen(theme.Surface,1.6f*s))g.DrawLines(pen,new[]{new PointF(5*s,12*s),new PointF(8*s,15*s),new PointF(13*s,9*s)});using(var brush=new SolidBrush(SetupTheme.Mix(theme.Surface,theme.Text,.65f)))g.DrawString(Text,Font,brush,22*s,5*s);}
 }
 public sealed class SetupForm:Form {
  readonly SetupSurface surface;readonly SetupButton retry,closeButton,minimizeButton;readonly SetupCheck shortcut;bool running;readonly string[] args;long lastProgress;
  [System.Runtime.InteropServices.DllImport("dwmapi.dll")]static extern int DwmSetWindowAttribute(IntPtr hwnd,int attribute,ref int value,int size);
  [System.Runtime.InteropServices.DllImport("user32.dll")]static extern bool ReleaseCapture();
  [System.Runtime.InteropServices.DllImport("user32.dll")]static extern IntPtr SendMessage(IntPtr hwnd,int message,IntPtr wParam,IntPtr lParam);
  [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]struct FrameRect{public int Left,Top,Right,Bottom;}
  [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]struct FrameMargins{public int Left,Right,Top,Bottom;}
  [System.Runtime.InteropServices.DllImport("dwmapi.dll")]static extern int DwmExtendFrameIntoClientArea(IntPtr hwnd,ref FrameMargins margins);
  [System.Runtime.InteropServices.DllImport("user32.dll")]static extern bool SetWindowPos(IntPtr hwnd,IntPtr after,int x,int y,int width,int height,uint flags);
  [System.Runtime.InteropServices.DllImport("user32.dll")]static extern uint GetDpiForWindow(IntPtr hwnd);
  // Retain a real frame for DWM. A painted rounded outline on a frameless HWND
  // cannot clip its rectangular corners or provide the native antialiased edge.
  protected override CreateParams CreateParams{get{var value=base.CreateParams;value.Style|=0x00040000|0x000A0000;value.Style&=~(0x00C00000|0x00010000);value.Style&=0x7fffffff;return value;}}
  void ApplyFrame(){if(!IsHandleCreated)return;try{int dark=1,round=2,render=2;DwmSetWindowAttribute(Handle,20,ref dark,4);DwmSetWindowAttribute(Handle,2,ref render,4);DwmSetWindowAttribute(Handle,33,ref round,4);Color line=SetupTheme.Mix(BackColor,ForeColor,.11f);int color=line.R|(line.G<<8)|(line.B<<16);DwmSetWindowAttribute(Handle,34,ref color,4);var margins=new FrameMargins{Left=1,Right=1,Top=1,Bottom=1};DwmExtendFrameIntoClientArea(Handle,ref margins);}catch{}}
  protected override void OnHandleCreated(EventArgs e){base.OnHandleCreated(e);ApplyFrame();}
  protected override void OnActivated(EventArgs e){base.OnActivated(e);ApplyFrame();}
  protected override void OnLoad(EventArgs e){base.OnLoad(e);LayoutAtDpi();CenterToScreen();}
  void LayoutAtDpi(){if(surface==null||!IsHandleCreated)return;uint dpi=96;try{dpi=GetDpiForWindow(Handle);}catch{}if(dpi==0)dpi=96;float scale=dpi/96f;
   SetWindowPos(Handle,IntPtr.Zero,0,0,(int)Math.Round(560*scale)+2,(int)Math.Round(410*scale)+2,0x0036);
   closeButton.SetBounds((int)Math.Round(510*scale),(int)Math.Round(24*scale),(int)Math.Round(28*scale),(int)Math.Round(28*scale));
   minimizeButton.SetBounds((int)Math.Round(476*scale),(int)Math.Round(24*scale),(int)Math.Round(28*scale),(int)Math.Round(28*scale));
   shortcut.SetBounds((int)Math.Round(28*scale),(int)Math.Round(368*scale),(int)Math.Round(280*scale),(int)Math.Round(26*scale));
   retry.SetBounds((int)Math.Round(386*scale),(int)Math.Round(365*scale),(int)Math.Round(150*scale),(int)Math.Round(32*scale));ApplyFrame();surface.Invalidate();
  }
  protected override void WndProc(ref Message message){
   if(message.Msg==0x0083&&message.LParam!=IntPtr.Zero){var rect=(FrameRect)System.Runtime.InteropServices.Marshal.PtrToStructure(message.LParam,typeof(FrameRect));if(rect.Right-rect.Left>2){rect.Left++;rect.Right--;}if(rect.Bottom-rect.Top>2){rect.Top++;rect.Bottom--;}System.Runtime.InteropServices.Marshal.StructureToPtr(rect,message.LParam,false);message.Result=IntPtr.Zero;return;}
   base.WndProc(ref message);
   if(message.Msg==0x0084){long hit=message.Result.ToInt64();if(hit>=10&&hit<=17)message.Result=new IntPtr(18);}
   else if(message.Msg==0x02E0)LayoutAtDpi();else if(message.Msg==0x031E)ApplyFrame();
  }
  public SetupForm(string[] args){this.args=args;var theme=SetupTheme.Load();SuspendLayout();Text="EclipseIsland";AutoScaleDimensions=new SizeF(96,96);AutoScaleMode=AutoScaleMode.Dpi;ClientSize=new Size(560,410);FormBorderStyle=FormBorderStyle.None;MaximizeBox=false;StartPosition=FormStartPosition.CenterScreen;BackColor=theme.Surface;ForeColor=theme.Text;Font=new Font("Segoe UI",9);try{Icon=Icon.ExtractAssociatedIcon(Application.ExecutablePath);}catch{}
   surface=new SetupSurface(theme){Dock=DockStyle.Fill};Controls.Add(surface);surface.MouseDown+=(s,e)=>{if(e.Button==MouseButtons.Left&&e.Y<100*surface.Width/560f){ReleaseCapture();SendMessage(Handle,0xA1,new IntPtr(2),IntPtr.Zero);}};
   var close=closeButton=new SetupButton(theme){Glyph="close",AccessibleName="Закрыть",TabIndex=3};close.SetBounds(510,24,28,28);close.Click+=(s,e)=>Close();surface.Controls.Add(close);
   var minimize=minimizeButton=new SetupButton(theme){Glyph="minimize",AccessibleName="Свернуть",TabIndex=2};minimize.SetBounds(476,24,28,28);minimize.Click+=(s,e)=>{WindowState=FormWindowState.Minimized;surface.Changed();};surface.Controls.Add(minimize);Resize+=(s,e)=>surface.Changed();
   shortcut=new SetupCheck(theme){Text="Ярлык на рабочем столе",Checked=true,Visible=!Core.Installed(Core.LoadState().version),TabIndex=0};shortcut.SetBounds(28,368,280,26);surface.Controls.Add(shortcut);
   retry=new SetupButton(theme,true){Text="Повторить",Visible=false,TabIndex=1};retry.SetBounds(386,365,150,32);retry.Click+=async(s,e)=>await Run();surface.Controls.Add(retry);AcceptButton=retry;
   Shown+=async(s,e)=>{LayoutAtDpi();if(!args.Contains("--preview"))await Run();};ResumeLayout(false);
  }
  public void PreviewState(string kind){if(!args.Contains("--preview"))throw new InvalidOperationException("Preview only");surface.Theme.ReducedMotion=true;shortcut.Visible=kind=="check";retry.Visible=kind=="error";
   Stage(kind=="error"?"НЕ УДАЛОСЬ ПРОДОЛЖИТЬ":kind=="download"?"ЗАГРУЗКА ПРИЛОЖЕНИЯ":"ПРОВЕРКА ОБНОВЛЕНИЙ",kind=="download"?1:0);
   UpdateText(kind=="error"?"Не удалось скачать обновление":kind=="download"?"Скачиваем EclipseIsland 1.0.1":"Проверяем обновления…",kind=="error"?"Проверьте подключение и повторите попытку":kind=="download"?"48,0 / 179,9 МБ   ·   26%":"Ищем последнюю версию EclipseIsland");
   surface.Indeterminate=kind=="check";surface.Target=kind=="download"?26:0;surface.Failed=kind=="error";surface.Changed();
  }
  void UpdateText(string text,string note=""){if(IsDisposed)return;surface.Heading=text;surface.Detail=note;surface.Failed=false;surface.Indeterminate=true;surface.Changed();}
  void Stage(string phase,int step){surface.Phase=phase;surface.Step=step;surface.Target=0;surface.Changed();}
  void Progress(long current,long total){if(IsDisposed)return;if(total>0){long now=Stopwatch.GetTimestamp();if(current<total&&lastProgress!=0&&(now-lastProgress)*1000/Stopwatch.Frequency<60)return;lastProgress=now;surface.Indeterminate=false;surface.Target=(float)Math.Min(100,current*100.0/total);surface.Detail=(current/1048576.0).ToString("0.0")+" / "+(total/1048576.0).ToString("0.0")+" МБ   ·   "+Math.Floor(surface.Target)+"%";surface.Changed();}}
  async Task Launch(InstallState state){
   Stage("ВСЁ ГОТОВО",2);UpdateText("Запускаем EclipseIsland…","Ваш островок уже рядом");try{var process=Core.StartApp(state.version,args);await Task.Delay(1200);if(process!=null&&process.HasExited&&process.ExitCode!=0)throw new Exception("Приложение завершилось с ошибкой");state.goodVersion=state.version;Core.SaveState(state);Core.CleanupVersions(state);Close();}
   catch{if(!Core.Installed(state.previous))throw;UpdateText("Возвращаем рабочую версию…");var rollback=new InstallState{version=state.previous,previous=state.version,goodVersion=state.previous};Core.StartApp(rollback.version,args);Core.SaveState(rollback);Core.CleanupVersions(rollback);Close();}
  }
  async Task Run(){if(running)return;running=true;retry.Visible=false;lastProgress=0;Stage("ПРОВЕРКА ОБНОВЛЕНИЙ",0);surface.Failed=false;surface.Indeterminate=true;string temp=null,stage=null;Exception failure=null;var previous=Core.LoadState();try{
    Directory.CreateDirectory(Core.Root);string myself=Process.GetCurrentProcess().MainModule.FileName;if(!myself.Equals(Core.Launcher,StringComparison.OrdinalIgnoreCase)){File.Copy(myself,Core.Launcher,true);Core.Shortcuts(shortcut.Checked);}
    foreach(var old in Directory.GetFiles(Core.Root,"*.zip.part"))try{File.Delete(old);}catch{}
    foreach(var old in Directory.GetDirectories(Core.Root,"staging-*"))try{Directory.Delete(old,true);}catch{}
    Core.RegisterProduct(previous.version);UpdateText("Проверяем обновления…","Ищем последнюю версию EclipseIsland");temp=Path.Combine(Core.Root,Guid.NewGuid().ToString("N")+".json");Manifest manifest=null;
    try{await Core.Download(BuildConfig.FeedUrl,temp,262144,8000,(a,b)=>{});manifest=Core.Json.Deserialize<Manifest>(File.ReadAllText(temp));Core.ValidateManifest(manifest);}catch{if(!Core.Installed(previous.version))throw;}finally{if(temp!=null&&File.Exists(temp))File.Delete(temp);temp=null;}
    if(manifest==null){UpdateText("Нет связи с сервером обновлений","Запускаем уже установленную версию");await Launch(previous);return;}
    string active=Core.RunningApp();if(active!=null){if(Core.Installed(previous.version)&&active.StartsWith(Path.Combine(Core.Root,"versions"),StringComparison.OrdinalIgnoreCase)){await Launch(previous);return;}throw new Exception("Закройте старый EclipseIsland через трей и нажмите «Повторить»");}
    if(Core.Installed(previous.version)&&Core.ParseVersion(manifest.version)<=Core.ParseVersion(previous.version)){await Launch(previous);return;}
    string destination=Path.Combine(Core.Root,"versions",manifest.version);
    if(!Core.Installed(manifest.version)){
     Stage("ЗАГРУЗКА ПРИЛОЖЕНИЯ",1);UpdateText("Скачиваем EclipseIsland "+manifest.version,"Подготавливаем загрузку…");temp=Path.Combine(Core.Root,Guid.NewGuid().ToString("N")+".zip.part");await Core.Download(manifest.url,temp,manifest.size,600000,Progress);Stage("ПРОВЕРКА ФАЙЛОВ",1);UpdateText("Проверяем скачанные файлы…","Сверяем контрольную сумму загрузки");await Task.Run(()=>Core.Verify(temp,manifest));
     stage=Path.Combine(Core.Root,"staging-"+Guid.NewGuid().ToString("N"));Stage("УСТАНОВКА ОБНОВЛЕНИЯ",1);UpdateText("Устанавливаем обновление…","Сохраняем настройки и предыдущую версию");await Task.Run(()=>Core.Extract(temp,stage,manifest.version));if(Directory.Exists(destination))Directory.Delete(destination,true);Directory.CreateDirectory(Path.GetDirectoryName(destination));Directory.Move(stage,destination);stage=null;
    }
    var next=new InstallState{version=manifest.version,previous=previous.goodVersion??previous.version};Core.SaveState(next);Core.RegisterProduct(next.version);await Launch(next);
   }catch(Exception e){failure=e;}finally{if(temp!=null)try{File.Delete(temp);}catch{}if(stage!=null)try{Directory.Delete(stage,true);}catch{}running=false;}
   if(failure!=null){if(Core.Installed(previous.goodVersion)){try{var fallback=new InstallState{version=previous.goodVersion,goodVersion=previous.goodVersion};Core.SaveState(fallback);UpdateText("Не удалось обновиться — запускаем установленную версию");await Launch(fallback);return;}catch{}}UpdateText("Не удалось завершить запуск",failure.Message);surface.Phase="НЕ УДАЛОСЬ ПРОДОЛЖИТЬ";surface.Failed=true;surface.Target=0;surface.Changed();retry.Visible=true;}}

 }
 static class Program {[STAThread]static void Main(string[] args){ServicePointManager.SecurityProtocol=SecurityProtocolType.Tls12;Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);try{using(var gate=new Mutex(false,@"Local\EclipseIsland.Updater")){bool owned;try{owned=gate.WaitOne(args.Contains("--remove-installation")?5000:0);}catch(AbandonedMutexException){owned=true;}if(!owned){MessageBox.Show("Проверка обновлений уже запущена.","EclipseIsland");return;}try{if(args.Contains("--uninstall")){Core.Uninstall();return;}if(args.Contains("--remove-installation")){string temp=Path.GetFullPath(Path.GetTempPath());if(!Process.GetCurrentProcess().MainModule.FileName.StartsWith(temp,StringComparison.OrdinalIgnoreCase))throw new Exception("Удаление запускается только вспомогательным процессом");Core.RemoveInstallation();return;}Application.Run(new SetupForm(args));}finally{gate.ReleaseMutex();}}}catch(Exception error){MessageBox.Show(error.Message,"EclipseIsland");}}}
}
