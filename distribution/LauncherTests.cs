using System;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Security.Cryptography;
using System.Drawing;
using System.Windows.Forms;
using System.Runtime.InteropServices;
namespace EclipseIslandSetup {
 static class LauncherTests {
  static void Check(bool value,string name){if(!value)throw new Exception(name);Console.WriteLine("PASS "+name);}
  static void Reject(Action action,string name){try{action();}catch{Console.WriteLine("PASS "+name);return;}throw new Exception(name);}
  [DllImport("user32.dll")]static extern int GetWindowLong(IntPtr window,int index);
  static void CheckControls(){
   var theme=new SetupTheme();using(var button=new SetupButton(theme){Glyph="close",Size=new Size(28,28)}){
    int clicks=0;button.Click+=(s,e)=>clicks++;button.PerformClick();button.Enabled=false;button.PerformClick();Check(clicks==1,"custom button invokes once and ignores disabled activation");button.Enabled=true;
    foreach(bool hover in new[]{false,true})foreach(bool pressed in new[]{false,true})using(var bitmap=new Bitmap(28,28)){
     using(var graphics=Graphics.FromImage(bitmap))button.PaintButton(graphics,hover,pressed);
     Color corner=bitmap.GetPixel(0,0);Check(corner.R>0&&corner.G>0&&corner.B>0&&corner.R<80&&corner.G<80&&corner.B<90,"button paints an opaque themed background without black/white native squares");
     Color background=bitmap.GetPixel(4,14);int marks=0;for(int y=8;y<21;y++)for(int x=8;x<21;x++){Color c=bitmap.GetPixel(x,y);if(Math.Abs(c.R-background.R)+Math.Abs(c.G-background.G)+Math.Abs(c.B-background.B)>90)marks++;}Check(marks>=8,"close glyph remains visible in every pointer state");
    }
   }
   using(var check=new SetupCheck(theme)){check.AccessibilityObject.DoDefaultAction();Check(check.Checked,"custom checkbox supports accessible activation");check.Enabled=false;check.AccessibilityObject.DoDefaultAction();Check(check.Checked,"disabled checkbox does not change state");}
   if(!SystemInformation.UserInteractive){Console.WriteLine("SKIP native window previews: no interactive desktop");return;}
   using(var form=new SetupForm(new[]{"--preview"})){
    form.Show();Application.DoEvents();int style=GetWindowLong(form.Handle,-16);Check((style&0x00040000)!=0&&(style&0x00C00000)==0,"real frame retained without a native caption over the custom buttons");Check(form.Width-form.ClientSize.Width==2&&form.Height-form.ClientSize.Height==2,"custom client leaves exactly one native border pixel on every edge");
    Check(Math.Abs(form.ClientSize.Width/560f-form.ClientSize.Height/410f)<.02f,"DPI layout keeps the content aspect ratio");
    string directory=Path.Combine(Environment.CurrentDirectory,"release-online","ui-check");Directory.CreateDirectory(directory);
    foreach(string state in new[]{"check","download","error"}){form.PreviewState(state);Application.DoEvents();using(var bitmap=new Bitmap(form.Width,form.Height)){form.DrawToBitmap(bitmap,new Rectangle(Point.Empty,bitmap.Size));bitmap.Save(Path.Combine(directory,"setup-"+state+".png"),System.Drawing.Imaging.ImageFormat.Png);}}
    form.Close();
   }
  }
  [STAThread]static void Main(){
   Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);CheckControls();
   var theme=SetupTheme.FromSettings(new System.Collections.Generic.Dictionary<string,object>{{"accent","blue"},{"surfaceColor","#15121f"},{"reducedMotion",true},{"loaderRenderer","frosted"}});
   Check(theme.Accent.R==179&&theme.Accent.G==214&&theme.Accent.B==255&&theme.Surface.R==21,"launcher follows the application palette");
   Check(theme.ReducedMotion&&theme.Renderer=="frosted","launcher follows loader and reduced-motion preferences");
   var invalid=SetupTheme.FromSettings(new System.Collections.Generic.Dictionary<string,object>{{"surfaceColor","invalid"},{"textColor",5},{"accent","unknown"},{"reducedMotion","wrong type"}});
   Check(invalid.Surface.R==18&&invalid.Accent.R==189&&!invalid.ReducedMotion,"malformed theme settings retain safe defaults");
   Check(Core.ParseVersion("0.9.1")>Core.ParseVersion("0.9.0"),"version ordering");Reject(()=>Core.ParseVersion("../bad"),"invalid versions rejected");
   Reject(()=>Core.ValidateUrl(new Uri("http://github.com/test/file")),"TLS required");Reject(()=>Core.ValidateUrl(new Uri("https://evil.example/test")),"foreign hosts rejected");
   string root=Path.Combine(Path.GetTempPath(),"EclipseLauncherTest-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);
   try{
    string zip=Path.Combine(root,"valid.zip");using(var file=ZipFile.Open(zip,ZipArchiveMode.Create)){
     using(var writer=new StreamWriter(file.CreateEntry("bundle.json").Open()))writer.Write("{\"version\":\"0.9.0\",\"platform\":\"win32\",\"arch\":\"x64\"}");
     using(var writer=new StreamWriter(file.CreateEntry("EclipseIsland.exe").Open()))writer.Write("test executable placeholder");
    }
    var manifest=new Manifest{schema=1,version="0.9.0",launcherVersion=1,url="https://github.com/"+BuildConfig.Repository+"/releases/download/v0.9.0/EclipseIsland-app.zip",size=new FileInfo(zip).Length};
    using(var hash=SHA256.Create())using(var input=File.OpenRead(zip))manifest.sha256=BitConverter.ToString(hash.ComputeHash(input)).Replace("-","").ToLowerInvariant();Core.Verify(zip,manifest);Check(true,"payload hash verified");manifest.sha256=new string('0',64);Reject(()=>Core.Verify(zip,manifest),"corrupt payload rejected");
    var output=Path.Combine(root,"valid");Core.Extract(zip,output,"0.9.0");Check(File.Exists(Path.Combine(output,".complete")),"complete marker written after validation");
    string bad=Path.Combine(root,"bad.zip");using(var file=ZipFile.Open(bad,ZipArchiveMode.Create))using(var writer=new StreamWriter(file.CreateEntry("../escape.exe").Open()))writer.Write("bad");Reject(()=>Core.Extract(bad,Path.Combine(root,"bad"),"0.9.0"),"zip traversal rejected");Check(!File.Exists(Path.Combine(root,"escape.exe")),"zip cannot write outside staging");
    Reject(()=>Core.Extract(zip,Path.Combine(root,"wrong-version"),"0.9.1"),"bundle version mismatch rejected");
   }finally{Directory.Delete(root,true);}
  }
 }
}
