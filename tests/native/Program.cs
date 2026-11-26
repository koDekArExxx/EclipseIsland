static string Pick((string id,bool playing)[] sessions,string? current) => sessions.OrderByDescending(s=>MediaPolicy.Rank(s.id,s.playing,current)).First().id;
static void Check(bool condition,string name){if(!condition)throw new Exception(name);Console.WriteLine("PASS "+name);}
Check(Pick([("Spotify.exe",false),("chrome.exe",true)],"Spotify.exe")=="chrome.exe","playing browser wins over paused desktop Spotify");
Check(Pick([("Spotify.exe",true),("YandexMusic.exe",true),("vlc.exe",true)],"vlc.exe")=="vlc.exe","current playing source wins when several players are playing");
Check(Pick([("Spotify.exe",false),("YandexMusic.exe",true)],null)=="YandexMusic.exe","Yandex playback can take over paused Spotify");
Check(Pick([("arbitrary-player.exe",true),("Spotify.exe",false)],null)=="arbitrary-player.exe","unknown players remain supported");
Check(MediaPolicy.TrackKey("Spotify.exe","Same","Artist","Album",1)!=MediaPolicy.TrackKey("Spotify.exe","Same","Artist","Album",2),"track number distinguishes same-title tracks");
Check(MediaPolicy.TrackKey("Spotify.exe","Song","Artist","Album",1)!=MediaPolicy.TrackKey("chrome.exe","Song","Artist","Album",1),"source change invalidates artwork identity");

// Reproduce a 30-second playback stall without sleeping for 30 seconds. The same
// production lanes used by MediaLoop must keep fetching the next track and may
// have only one pending call, no matter how often they are polled.
long clock=1;
using(var playback=new IndependentPoll<string>(()=>clock))
using(var metadata=new IndependentPoll<string>(()=>clock)) {
 var stalled=new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
 playback.Start(()=>stalled.Task,0,100);
 for(int i=1;i<=5;i++) {
  clock+=6000;
  Check(!playback.Start(()=>Task.FromResult("duplicate"),0,100),"stalled playback does not enqueue another COM call "+i);
  metadata.RequestNow();metadata.Start(()=>Task.FromResult("track-"+i),0,100);
  string result="";Exception? error=null;
  bool received=SpinWait.SpinUntil(()=>metadata.Take(0,out result,out error),2000);
  Check(received && result=="track-"+i && error is null,"track updates independently during 30-second playback stall "+i);
 }
 Check(playback.StartedCount==1 && playback.PendingMs==30000,"30-second timeout retains exactly one outstanding call");
 stalled.SetResult("old playback");
 SpinWait.SpinUntil(()=>playback.Take(0,out _,out _),2000);
}
using(var lane=new IndependentPoll<string>()) {
 var old=new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
 lane.Start(()=>old.Task,1,0);old.SetResult("old source");
 Check(SpinWait.SpinUntil(()=>lane.Completed,2000),"old read completes before the session-change check");
 Check(!lane.Take(2,out _,out _),"late metadata from a previous source is discarded");
 lane.RequestNow();Check(lane.Start(()=>Task.FromResult("new source"),2,0),"new source can start after discarding the old result");
 string value="";
 Check(SpinWait.SpinUntil(()=>lane.Take(2,out value,out _),2000)&&value=="new source","replacement source publishes fresh data");
}
using(var lane=new IndependentPoll<string>()) {
 lane.Start(()=>Task.FromException<string>(new InvalidOperationException()),0,0);
 Exception? error=null;
 Check(SpinWait.SpinUntil(()=>lane.Take(0,out _,out error),2000)&&error is InvalidOperationException,"failed reads are observed rather than leaving a stuck lane");
}

using(var cancellation=new CancellationTokenSource())
using(var release=new ManualResetEventSlim(false)) {
 using var registration=cancellation.Token.Register(()=>release.Wait());
 try {
  var watch=System.Diagnostics.Stopwatch.StartNew();
  MediaCancellation.Cancel(cancellation);
  Check(watch.ElapsedMilliseconds<1000 && cancellation.IsCancellationRequested,"cancelling an old cover does not synchronously wait for its COM callback");
 }finally{release.Set();}
}

var duplicateSpotify=new[]{
 new SessionCandidate("old","Spotify.exe",true,1000,100,true),
 new SessionCandidate("new","Spotify.exe",true,30000,0,false)
};
Check(SessionPolicy.Choose(duplicateSpotify,"auto")?.Token=="new","new live Spotify session wins over the stale Windows current session");
Check(SessionPolicy.Choose(duplicateSpotify,"Spotify.exe")?.Token=="new","pinning Spotify still chooses its live session rather than the first matching app ID");
Check(SessionPolicy.Choose(new[]{duplicateSpotify[0] with{Playing=false,UpdatedMs=90000},duplicateSpotify[1]},"auto")?.Token=="new","paused stale session cannot win through a newer timeline timestamp");
Check(SessionPolicy.Choose(new[]{duplicateSpotify[1],new SessionCandidate("vlc","vlc.exe",true,90000,0,true)},"auto")?.Token=="vlc","active Windows app preference is preserved across different players");
Check(SessionPolicy.Choose(new[]{duplicateSpotify[1],new SessionCandidate("vlc","vlc.exe",true,90000,0,true)},"Spotify.exe")?.Token=="new","explicit app choice is respected with several playing apps");
var baseKey=MediaPolicy.TrackKey("Spotify.exe","Track","Artist","Album",1);
Check(SessionPolicy.TrackKey(baseKey,"old")!=SessionPolicy.TrackKey(baseKey,"new"),"session replacement invalidates artwork even with identical media tags");

