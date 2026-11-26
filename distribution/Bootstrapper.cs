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
 public sealed class SetupForm:Form {
  readonly Label status=new Label(),detail=new Label();readonly ProgressBar bar=new ProgressBar();readonly Button retry=new Button();readonly CheckBox shortcut=new CheckBox();bool running;readonly string[] args;
  public SetupForm(string[] args){this.args=args;Text="EclipseIsland";ClientSize=new Size(480,255);FormBorderStyle=FormBorderStyle.FixedSingle;MaximizeBox=false;StartPosition=FormStartPosition.CenterScreen;BackColor=Color.FromArgb(20,17,28);ForeColor=Color.FromArgb(236,228,249);Font=new Font("Segoe UI",10);AutoScaleMode=AutoScaleMode.Dpi;
   var logo=new Label{Text="EclipseIsland",Font=new Font("Segoe UI",23,FontStyle.Bold),ForeColor=Color.FromArgb(199,171,255),Location=new Point(28,22),AutoSize=true};Controls.Add(logo);
   status.SetBounds(30,84,420,28);status.Text="Проверяем обновления…";Controls.Add(status);detail.SetBounds(30,116,420,35);detail.Font=new Font("Segoe UI",9);detail.ForeColor=Color.FromArgb(171,159,189);Controls.Add(detail);bar.SetBounds(30,163,420,8);bar.Style=ProgressBarStyle.Marquee;Controls.Add(bar);
   shortcut.SetBounds(30,192,285,25);shortcut.Text="Ярлык на рабочем столе";shortcut.Checked=true;shortcut.Visible=!Core.Installed(Core.LoadState().version);Controls.Add(shortcut);retry.SetBounds(330,189,120,32);retry.Text="Повторить";retry.Visible=false;retry.Click+=async(s,e)=>await Run();Controls.Add(retry);Shown+=async(s,e)=>await Run();}
  void UpdateText(string text,string note=""){if(IsDisposed)return;status.Text=text;detail.Text=note;}
  void Progress(long current,long total){if(IsDisposed)return;if(total>0){bar.Style=ProgressBarStyle.Continuous;bar.Value=(int)Math.Min(100,current*100/total);detail.Text=(current/1048576.0).ToString("0.0")+" / "+(total/1048576.0).ToString("0.0")+" МБ";}}
  async Task Launch(InstallState state){
   UpdateText("Запускаем EclipseIsland…");try{var process=Core.StartApp(state.version,args);await Task.Delay(1200);if(process!=null&&process.HasExited&&process.ExitCode!=0)throw new Exception("Приложение завершилось с ошибкой");state.goodVersion=state.version;Core.SaveState(state);Core.CleanupVersions(state);Close();}
   catch{if(!Core.Installed(state.previous))throw;UpdateText("Возвращаем рабочую версию…");var rollback=new InstallState{version=state.previous,previous=state.version,goodVersion=state.previous};Core.StartApp(rollback.version,args);Core.SaveState(rollback);Core.CleanupVersions(rollback);Close();}
  }
  async Task Run(){if(running)return;running=true;retry.Visible=false;bar.Style=ProgressBarStyle.Marquee;string temp=null,stage=null;Exception failure=null;var previous=Core.LoadState();try{
    Directory.CreateDirectory(Core.Root);string myself=Process.GetCurrentProcess().MainModule.FileName;if(!myself.Equals(Core.Launcher,StringComparison.OrdinalIgnoreCase)){File.Copy(myself,Core.Launcher,true);Core.Shortcuts(shortcut.Checked);}
    foreach(var old in Directory.GetFiles(Core.Root,"*.zip.part"))try{File.Delete(old);}catch{}
    foreach(var old in Directory.GetDirectories(Core.Root,"staging-*"))try{Directory.Delete(old,true);}catch{}
    Core.RegisterProduct(previous.version);UpdateText("Проверяем обновления…");temp=Path.Combine(Core.Root,Guid.NewGuid().ToString("N")+".json");Manifest manifest=null;
    try{await Core.Download(BuildConfig.FeedUrl,temp,262144,8000,(a,b)=>{});manifest=Core.Json.Deserialize<Manifest>(File.ReadAllText(temp));Core.ValidateManifest(manifest);}catch{if(!Core.Installed(previous.version))throw;}finally{if(temp!=null&&File.Exists(temp))File.Delete(temp);temp=null;}
    if(manifest==null){UpdateText("Нет связи с сервером обновлений","Запускаем уже установленную версию");await Launch(previous);return;}
    string active=Core.RunningApp();if(active!=null){if(Core.Installed(previous.version)&&active.StartsWith(Path.Combine(Core.Root,"versions"),StringComparison.OrdinalIgnoreCase)){await Launch(previous);return;}throw new Exception("Закройте старый EclipseIsland через трей и нажмите «Повторить»");}
    if(Core.Installed(previous.version)&&Core.ParseVersion(manifest.version)<=Core.ParseVersion(previous.version)){await Launch(previous);return;}
    string destination=Path.Combine(Core.Root,"versions",manifest.version);
    if(!Core.Installed(manifest.version)){
     UpdateText("Скачиваем EclipseIsland "+manifest.version);temp=Path.Combine(Core.Root,Guid.NewGuid().ToString("N")+".zip.part");await Core.Download(manifest.url,temp,manifest.size,600000,Progress);UpdateText("Проверяем скачанные файлы…");bar.Style=ProgressBarStyle.Marquee;await Task.Run(()=>Core.Verify(temp,manifest));
     stage=Path.Combine(Core.Root,"staging-"+Guid.NewGuid().ToString("N"));UpdateText("Устанавливаем обновление…");await Task.Run(()=>Core.Extract(temp,stage,manifest.version));if(Directory.Exists(destination))Directory.Delete(destination,true);Directory.CreateDirectory(Path.GetDirectoryName(destination));Directory.Move(stage,destination);stage=null;
    }
    var next=new InstallState{version=manifest.version,previous=previous.goodVersion??previous.version};Core.SaveState(next);Core.RegisterProduct(next.version);await Launch(next);
   }catch(Exception e){failure=e;}finally{if(temp!=null)try{File.Delete(temp);}catch{}if(stage!=null)try{Directory.Delete(stage,true);}catch{}running=false;}
   if(failure!=null){if(Core.Installed(previous.goodVersion)){try{var fallback=new InstallState{version=previous.goodVersion,goodVersion=previous.goodVersion};Core.SaveState(fallback);UpdateText("Не удалось обновиться — запускаем установленную версию");await Launch(fallback);return;}catch{}}UpdateText("Не удалось завершить запуск",failure.Message);bar.Style=ProgressBarStyle.Continuous;bar.Value=0;retry.Visible=true;}}

 }
 static class Program {[STAThread]static void Main(string[] args){ServicePointManager.SecurityProtocol=SecurityProtocolType.Tls12;Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);try{using(var gate=new Mutex(false,@"Local\EclipseIsland.Updater")){bool owned;try{owned=gate.WaitOne(args.Contains("--remove-installation")?5000:0);}catch(AbandonedMutexException){owned=true;}if(!owned){MessageBox.Show("Проверка обновлений уже запущена.","EclipseIsland");return;}try{if(args.Contains("--uninstall")){Core.Uninstall();return;}if(args.Contains("--remove-installation")){string temp=Path.GetFullPath(Path.GetTempPath());if(!Process.GetCurrentProcess().MainModule.FileName.StartsWith(temp,StringComparison.OrdinalIgnoreCase))throw new Exception("Удаление запускается только вспомогательным процессом");Core.RemoveInstallation();return;}Application.Run(new SetupForm(args));}finally{gate.ReleaseMutex();}}}catch(Exception error){MessageBox.Show(error.Message,"EclipseIsland");}}}
}
