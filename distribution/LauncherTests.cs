using System;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Security.Cryptography;
namespace EclipseIslandSetup {
 static class LauncherTests {
  static void Check(bool value,string name){if(!value)throw new Exception(name);Console.WriteLine("PASS "+name);}
  static void Reject(Action action,string name){try{action();}catch{Console.WriteLine("PASS "+name);return;}throw new Exception(name);}
  static void Main(){
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
