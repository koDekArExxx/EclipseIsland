using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Windows.Graphics.Imaging;
using Windows.Media.Control;
using Windows.Storage.Streams;
using Session = Windows.Media.Control.GlobalSystemMediaTransportControlsSession;
using Manager = Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager;
using Properties = Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties;

record Command(int id, string action, double? seconds = null, string? sessionSource = null, string? source = null, bool metadataOnly = false, string? sessionTrackKey = null);

static class Program {
    static readonly object OutputLock = new();
    static readonly CancellationTokenSource Shutdown = new();
    static readonly SemaphoreSlim Wake = new(0, 1);
    static readonly Channel<Command> Commands = Channel.CreateBounded<Command>(64);
    static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };
    static string PreferredSource = "auto";
    static long ArtRevision;
    static long SelectionRevision;
    static long RefreshRevision;
    static long LastMetadataEventAt;
    static long ActiveIdentity,NextSessionNumber;
    static readonly string InstanceToken=Guid.NewGuid().ToString("N")[..8];
    static readonly ConcurrentDictionary<long,string> SessionNames=new();
    static readonly ConcurrentDictionary<long,long> SessionEvents=new();
    static long SessionIdentity(Session session){
        var pointer=((WinRT.IWinRTObject)session).NativeObject.GetRef();
        try{
            var iid=new Guid("00000000-0000-0000-C000-000000000046");
            Marshal.ThrowExceptionForHR(Marshal.QueryInterface(pointer,in iid,out var identity));
            try{return identity.ToInt64();}finally{Marshal.Release(identity);}
        }finally{Marshal.Release(pointer);}
    }
    static SessionEntry Entry(Session session){
        long identity=SessionIdentity(session);
        return new SessionEntry(session,session.SourceAppUserModelId,identity,SessionNames.GetOrAdd(identity,_=>InstanceToken+"s"+Interlocked.Increment(ref NextSessionNumber)));
    }
    static void Send(object value) { lock (OutputLock) Console.WriteLine(JsonSerializer.Serialize(value)); }
    static void Signal() { try { Wake.Release(); } catch (SemaphoreFullException) {} }
    static void Report(string stage, Exception error) {
        // Only API stage/type/HRESULT cross the process boundary, never player URLs or tokens.
        Send(new {type="diagnostic", stage, error=error.GetType().Name, code=error.HResult});
    }
    static async Task<T> Deadline<T>(Func<Task<T>> operation, int ms = 2500) {
        return await Task.Run(operation).WaitAsync(TimeSpan.FromMilliseconds(ms), Shutdown.Token);
    }
    static async Task Main(string[] args) {
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        bool controlOnly = args.Contains("-ControlOnly");
        Task input = Task.Factory.StartNew(()=>ReadInput(controlOnly),CancellationToken.None,TaskCreationOptions.LongRunning,TaskScheduler.Default).Unwrap();
        Task heartbeat = Heartbeat();
        try {
            var manager = await Deadline(async () => await Manager.RequestAsync(), 8000);
            Send(new {type="health",status="native-ready",version=typeof(Program).Assembly.GetName().Version?.ToString()});
            if(controlOnly) await ControlLoop(manager);
            else await MediaLoop(manager);
        } catch(OperationCanceledException) {} catch(Exception error) {
            Report("initialize", error);
            Send(new {type="media", available=false, active=false, reason="Не удалось подключиться к медиасессиям Windows"});
        } finally { Shutdown.Cancel(); }
    }
    static async Task ReadInput(bool controlOnly) {
        try {
            while(await Console.In.ReadLineAsync(Shutdown.Token) is string line) {
                Command? command;
                try { command=JsonSerializer.Deserialize<Command>(line,JsonOptions); } catch {continue;}
                if(command is null) continue;
                if(!controlOnly && command.action=="source") {
                    if(!string.IsNullOrWhiteSpace(command.source) && command.source.Length<=200) {
                        Volatile.Write(ref PreferredSource,command.source); Signal();
                    }
                } else if(!controlOnly && command.action=="refresh") {
                    Interlocked.Increment(ref ArtRevision); Interlocked.Increment(ref RefreshRevision); Signal();
                    Send(new {type="reply",id=command.id,ok=true});
                } else await Commands.Writer.WriteAsync(command,Shutdown.Token);
            }
        } catch(OperationCanceledException) {} finally {
            Commands.Writer.TryComplete(); Shutdown.Cancel(); Signal();
        }
    }
    static async Task Heartbeat() {
        try { while(!Shutdown.IsCancellationRequested) {Send(new {type="heartbeat"});await Task.Delay(2000,Shutdown.Token);} }
        catch(OperationCanceledException) {}
    }
    static async Task ControlLoop(Manager manager) {
        await foreach(var command in Commands.Reader.ReadAllAsync(Shutdown.Token)) {
            try {
                Session? target;
                if(string.IsNullOrEmpty(command.sessionSource))target=await Deadline(()=>Task.FromResult(manager.GetCurrentSession()),1200);
                else {
                    var list=await Deadline(()=>Task.FromResult(ReadSessions(manager)),1200);
                    var candidates=list.all.Append(list.current).Where(e=>e is not null && e.id==command.sessionSource).Select(e=>e!).DistinctBy(e=>e.token).ToArray();
                    target=candidates.FirstOrDefault()?.session;
                    if(candidates.Length>1){
                        var options=await Task.WhenAll(candidates.Select(async entry=>{
                            SessionProbe? probe=null;try{probe=await Deadline(()=>ReadProbe(entry.session,false),500);}catch(Exception error) when(error is not OperationCanceledException){Report("resolve-command",error);}
                            return new SessionCandidate(entry.token,entry.id,probe?.playing,probe?.updated??0,0,entry.token==list.current?.token);
                        }));
                        var chosen=SessionPolicy.Choose(options,command.sessionSource);
                        target=candidates.FirstOrDefault(e=>e.token==chosen?.Token)?.session;
                    }
                }
                if(target is null) throw new InvalidOperationException("Session unavailable");
                bool ok=await Deadline(async ()=>command.action switch {
                    "next" => await target.TrySkipNextAsync(),
                    "previous" => await target.TrySkipPreviousAsync(),
                    "toggle" => await target.TryTogglePlayPauseAsync(),
                    "seek" when command.seconds is double seconds && double.IsFinite(seconds) && seconds>=0 && seconds<=604800 => await target.TryChangePlaybackPositionAsync((long)(seconds*10_000_000)),
                    _ => false
                },4000);
                Send(new {type="reply",id=command.id,ok});
            } catch(TimeoutException error) {
                Report("command",error);Send(new {type="reply",id=command.id,ok=false});
                return; // Do not overlap or replay a timed-out skip.
            } catch(OperationCanceledException) {return;}
            catch(Exception error) {Report("command",error);Send(new {type="reply",id=command.id,ok=false});}
        }
    }
    static void MetadataChanged(Session sender, MediaPropertiesChangedEventArgs args) {
        try{
            long identity=SessionIdentity(sender),now=Environment.TickCount64;SessionEvents[identity]=now;
            if(identity==Interlocked.Read(ref ActiveIdentity)){Interlocked.Increment(ref ArtRevision);Interlocked.Exchange(ref LastMetadataEventAt,now);}
        }catch(Exception error){Report("session-event",error);}
        Interlocked.Increment(ref SelectionRevision);Signal();
    }
    static void PlaybackChanged(Session sender, PlaybackInfoChangedEventArgs args) { Signal(); }
    static void TimelineChanged(Session sender, TimelinePropertiesChangedEventArgs args) { Signal(); }
    static void Unsubscribe(Session? session) {
        if(session is null)return;
        try {session.MediaPropertiesChanged-=MetadataChanged;session.PlaybackInfoChanged-=PlaybackChanged;session.TimelinePropertiesChanged-=TimelineChanged;} catch {}
    }
    record SessionEntry(Session session,string id,long identity,string token);
    record SessionProbe(bool playing,long updated,string? trackHash);
    record SessionList(SessionEntry[] all,SessionEntry? current);
    record TrackSnapshot(Properties media,string key,string title,string artist);
    record PlaybackSnapshot(bool playing,bool canToggle,bool canNext,bool canPrevious,bool canSeek,double rate);
    record TimelineSnapshot(double duration,double position,DateTimeOffset updated);
    static SessionList ReadSessions(Manager manager) {
        var all=new List<SessionEntry>();
        foreach(var session in manager.GetSessions()){try{all.Add(Entry(session));}catch(Exception error){Report("enumerate-session",error);}}
        SessionEntry? current=null;
        try{var session=manager.GetCurrentSession();if(session is not null)current=Entry(session);}catch(Exception error){Report("current-session",error);}
        return new SessionList(all.ToArray(),current);
    }
    static async Task<TrackSnapshot> ReadTrack(Session session,string source,string token) {
        var p=await session.TryGetMediaPropertiesAsync();
        string title=p.Title,artist=p.Artist;
        return new TrackSnapshot(p,SessionPolicy.TrackKey(MediaPolicy.TrackKey(source,title,artist,p.AlbumTitle,p.TrackNumber),token),title,artist);
    }
    static async Task<SessionProbe> ReadProbe(Session session,bool inspectTrack){
        bool playing=session.GetPlaybackInfo().PlaybackStatus==GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
        long updated=0;try{updated=session.GetTimelineProperties().LastUpdatedTime.ToUnixTimeMilliseconds();}catch{}
        string? trackHash=null;
        if(inspectTrack){try{var p=await session.TryGetMediaPropertiesAsync();var plain=MediaPolicy.TrackKey(session.SourceAppUserModelId,p.Title,p.Artist,p.AlbumTitle,p.TrackNumber);
            trackHash=Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(plain)))[..12];}catch{}}
        return new SessionProbe(playing,updated,trackHash);
    }
    static PlaybackSnapshot ReadPlayback(Session session) {
        var p=session.GetPlaybackInfo();var c=p.Controls;
        return new PlaybackSnapshot(p.PlaybackStatus==GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing,
            c.IsPlayPauseToggleEnabled,c.IsNextEnabled,c.IsPreviousEnabled,c.IsPlaybackPositionEnabled,p.PlaybackRate??1);
    }
    static TimelineSnapshot ReadTimeline(Session session) {
        var t=session.GetTimelineProperties();
        return new TimelineSnapshot(Math.Max(0,(t.EndTime-t.StartTime).TotalSeconds),Math.Max(0,t.Position.TotalSeconds),t.LastUpdatedTime);
    }
    static async Task MediaLoop(Manager manager) {
        using var selection=new IndependentPoll<SessionList>();
        using var subscriptions=new IndependentPoll<bool>();
        var subscribed=new Dictionary<string,Session>();
        using var metadata=new IndependentPoll<TrackSnapshot>();
        using var playback=new IndependentPoll<PlaybackSnapshot>();
        using var timeline=new IndependentPoll<TimelineSnapshot>();
        Session? session=null;
        SessionList? catalog=null;
        var probes=new Dictionary<string,IndependentPoll<SessionProbe>>();
        var observations=new Dictionary<string,SessionProbe>();
        string source="",sessionToken="",key="",title="",artist="",lastCatalog="",lastPreferred="";
        long generation=0,selectionRevision=-1,refreshRevision=-1,artRevision=-1,eventRevision=0;
        long fastUntil=0,lastMetrics=0,nextArt=0,artRefreshUntil=0,artStarted=0;
        CancellationTokenSource? artCancel=null;
        Task<bool>? artwork=null;
        Properties? currentProperties=null;
        bool coverReady=false,playing=false;
        double playbackRate=1;
        int failures=0;
        manager.CurrentSessionChanged+=(_,_)=>{Interlocked.Increment(ref SelectionRevision);Signal();};
        manager.SessionsChanged+=(_,_)=>{Interlocked.Increment(ref SelectionRevision);Signal();};
        void SessionChanged(SessionEntry? entry,string preferred) {
            var selected=entry?.session;string selectedSource=entry?.id??"";
            if((entry?.token??"")!=sessionToken) {
                generation++;key="";title="";artist="";currentProperties=null;
                MediaCancellation.Cancel(artCancel);artwork=null;coverReady=false;source=selectedSource;sessionToken=entry?.token??"";Interlocked.Exchange(ref ActiveIdentity,entry?.identity??0);
                metadata.RequestNow();playback.RequestNow();timeline.RequestNow();
            }
            if(!ReferenceEquals(session,selected)){session=selected;subscriptions.RequestNow();}
            lastPreferred=preferred;
            if(session is null)Send(new {type="media",available=true,active=false});
        }
        void Choose(string preferred) {
            if(catalog is null)return;
            var entries=catalog.all.Append(catalog.current).Where(e=>e is not null).Select(e=>e!).DistinctBy(e=>e.token).ToArray();
            var candidates=entries.Select(e=>new SessionCandidate(e.token,e.id,observations.TryGetValue(e.token,out var observed)?observed.playing:null,
                observations.TryGetValue(e.token,out var timeline)?timeline.updated:0,SessionEvents.GetValueOrDefault(e.identity),e.token==catalog.current?.token)).ToArray();
            var chosen=SessionPolicy.Choose(candidates,preferred);
            SessionChanged(entries.FirstOrDefault(e=>e.token==chosen?.Token),preferred);
            var items=candidates.GroupBy(e=>e.Source).Select(g=>new {id=g.Key,playing=g.Any(e=>e.Playing==true)}).ToArray();
            var json=JsonSerializer.Serialize(items);
            if(json!=lastCatalog){Send(new {type="sessions",items});lastCatalog=json;}
        }
        void Fields(object extra) {
            // Use the current identity at publication, not the identity captured by a
            // slow playback/timeline read before a track change.
            var packet=new Dictionary<string,object?> { ["type"]="media",["available"]=true,["active"]=true,["trackKey"]=key,["source"]=source,["title"]=title,["artist"]=artist };
            foreach(var field in JsonSerializer.SerializeToElement(extra).EnumerateObject())packet[field.Name]=field.Value.Clone();
            Send(packet);
        }
        try {
            while(!Shutdown.IsCancellationRequested) {
                long now=Environment.TickCount64;
                var preferred=Volatile.Read(ref PreferredSource);
                long newSelection=Interlocked.Read(ref SelectionRevision),newRefresh=Interlocked.Read(ref RefreshRevision),newEvent=Interlocked.Read(ref ArtRevision);
                if(selectionRevision!=newSelection || preferred!=lastPreferred){selectionRevision=newSelection;selection.RequestNow();if(catalog is not null)Choose(preferred);}
                if(refreshRevision!=newRefresh || eventRevision!=newEvent) {
                    refreshRevision=newRefresh;eventRevision=newEvent;selection.RequestNow();metadata.RequestNow();playback.RequestNow();timeline.RequestNow();fastUntil=now+3000;
                }
                if(selection.Take(0,out var sessions,out var selectionError)) {
                    if(selectionError is not null)Report("sessions",selectionError);
                    else {catalog=sessions;Choose(preferred);}
                }
                selection.Start(()=>Task.FromResult(ReadSessions(manager)),0,750);
                // Background probes have one in-flight call each. A hung player neither
                // grows a queue of abandoned tasks nor occupies the metadata lane.
                if(catalog is not null) {
                    bool changed=false;
                    var entries=catalog.all.Append(catalog.current).Where(e=>e is not null).Select(e=>e!).DistinctBy(e=>e.token).ToArray();
                    var activeTokens=entries.Select(e=>e.token).ToHashSet();
                    foreach(var stale in probes.Keys.Where(token=>!activeTokens.Contains(token)).ToArray()){
                        var probe=probes[stale];probe.Take(0,out _,out _);
                        if(!probe.Busy){probe.Dispose();probes.Remove(stale);observations.Remove(stale);}
                    }
                    foreach(var candidate in entries.Take(32)) {
                        string token=candidate.token;
                        if(!probes.TryGetValue(token,out var probe)){if(probes.Count>=32)continue;probe=new IndependentPoll<SessionProbe>();probes[token]=probe;}
                        if(probe.Take(0,out var result,out var probeError) && probeError is null){
                            changed|=!observations.TryGetValue(token,out var old)||old!=result;observations[token]=result;
                        }
                        bool inspectTrack=candidate.id.Contains("spotify",StringComparison.OrdinalIgnoreCase)||entries.Count(e=>e.id==candidate.id)>1;
                        probe.Start(()=>ReadProbe(candidate.session,inspectTrack),0,350);
                    }
                    if(changed)Choose(preferred);
                }
                subscriptions.Take(0,out _,out var subscriptionError);
                if(subscriptionError is not null)Report("subscribe",subscriptionError);
                var desiredSubscriptions=catalog?.all.Append(catalog.current).Where(e=>e is not null).Select(e=>e!).DistinctBy(e=>e.token).ToArray()??[];
                subscriptions.Start(()=>{
                    var desired=desiredSubscriptions.ToDictionary(e=>e.token);
                    foreach(var token in subscribed.Keys.Where(token=>!desired.ContainsKey(token)).ToArray()){Unsubscribe(subscribed[token]);subscribed.Remove(token);}
                    foreach(var entry in desiredSubscriptions){
                        if(subscribed.ContainsKey(entry.token))continue;
                        var target=entry.session;target.MediaPropertiesChanged+=MetadataChanged;target.PlaybackInfoChanged+=PlaybackChanged;target.TimelinePropertiesChanged+=TimelineChanged;
                        subscribed[entry.token]=target;
                    }
                    return Task.FromResult(true);
                },0,500);
                if(session is not null) {
                    var selected=session;
                    if(metadata.Take(generation,out var properties,out var error)) {
                        if(error is not null) {
                            Report("metadata",error);Fields(new {metadataError="Плеер не отдал данные трека"});
                            if(++failures>=3)return;
                        } else {
                            currentProperties=properties.media;failures=0;
                            string nextKey=properties.key;
                            bool changed=nextKey!=key;
                            if(changed){MediaCancellation.Cancel(artCancel);artwork=null;key=nextKey;coverReady=false;nextArt=0;artRefreshUntil=now+4000;}
                            title=properties.title;artist=properties.artist;
                            var fields=new Dictionary<string,object?>{["metadataError"]="",["artworkStatus"]=coverReady?"ready":artwork is {IsCompletedSuccessfully:true} && !artwork.Result?"missing":"loading"};
                            if(changed){fields["position"]=0;fields["duration"]=0;}
                            Fields(fields);
                            Send(new {type="health",status="metadata-ready"});
                        }
                    }
                    // None of these starts wait for another lane or for their own results.
                    string readSource=source,readToken=sessionToken;
                    metadata.Start(()=>ReadTrack(selected,readSource,readToken),generation,now<fastUntil?80:180);
                    if(playback.Take(generation,out var info,out var playbackError)) {
                        if(playbackError is not null)Report("playback",playbackError);
                        else {
                            playing=info.playing;playbackRate=info.rate;
                            if(observations.TryGetValue(sessionToken,out var observed))observations[sessionToken]=observed with {playing=playing};
                            Fields(new {playing,info.canToggle,info.canNext,info.canPrevious,info.canSeek});
                        }
                    }
                    playback.Start(()=>Task.FromResult(ReadPlayback(selected)),generation,250);
                    if(timeline.Take(generation,out var position,out var timelineError)) {
                        if(timelineError is not null)Report("timeline",timelineError);
                        else {
                            double duration=position.duration;
                            double seconds=position.position;
                            if(playing)seconds+=Math.Clamp((DateTimeOffset.UtcNow-position.updated).TotalSeconds,0,3)*playbackRate;
                            Fields(new {duration,position=duration>0?Math.Min(seconds,duration):seconds});
                        }
                    }
                    timeline.Start(()=>Task.FromResult(ReadTimeline(selected)),generation,350);
                    if(artwork is {IsCompletedSuccessfully:true} && artwork.Result)coverReady=true;
                    if(currentProperties is not null && (artwork is null || artwork.IsCompleted || artCancel?.IsCancellationRequested==true) && now>=nextArt && (!coverReady || artRevision!=newEvent || now<artRefreshUntil)) {
                        MediaCancellation.Cancel(artCancel);artCancel=new CancellationTokenSource();var cancel=artCancel;var artProperties=currentProperties;string artKey=key;
                        nextArt=now+500;artRevision=newEvent;artStarted=now;
                        artwork=Task.Factory.StartNew(()=>ReadArtwork(artProperties,artKey,cancel.Token),CancellationToken.None,TaskCreationOptions.LongRunning,TaskScheduler.Default).Unwrap();
                    }
                    // Metadata has its own progress deadline, independent of heartbeat,
                    // playback and image activity. Recycle only this process if COM stalls.
                    if(metadata.PendingMs>2200){Report("metadata-stall",new TimeoutException());return;}
                }
                if(selection.PendingMs>2200){Report("sessions-stall",new TimeoutException());return;}
                if(now-lastMetrics>=2000) {
                    var diagnosticEntries=catalog?.all.Append(catalog.current).Where(e=>e is not null).Select(e=>e!).DistinctBy(e=>e.token).ToArray()??[];
                    Send(new {type="metrics",metadataReadMs=metadata.LastReadMs,metadataPendingMs=metadata.PendingMs,playbackPendingMs=playback.PendingMs,timelinePendingMs=timeline.PendingMs,
                        selectionPendingMs=selection.PendingMs,artworkPendingMs=artwork is {IsCompleted:false}?now-artStarted:0,
                        eventAgeMs=Interlocked.Read(ref LastMetadataEventAt)>0?now-Interlocked.Read(ref LastMetadataEventAt):0,
                        sessionCount=diagnosticEntries.Length,sourceSessionCount=diagnosticEntries.Count(e=>e.id==source)});
                    Send(new {type="session-diagnostics",selected=sessionToken,items=diagnosticEntries.Select(e=>new {token=e.token,source=e.id,current=e.token==catalog?.current?.token,
                        playing=observations.TryGetValue(e.token,out var observed)?(bool?)observed.playing:null,
                        timelineUpdatedMs=observations.TryGetValue(e.token,out var timeline)?timeline.updated:0,
                        metadataEventAgeMs=SessionEvents.TryGetValue(e.identity,out long at)?now-at:(long?)null,trackHash=observations.TryGetValue(e.token,out var track)?track.trackHash:null}).ToArray()});
                    lastMetrics=now;
                }
                await Wake.WaitAsync(40,Shutdown.Token);
            }
        } finally {MediaCancellation.Cancel(artCancel);foreach(var probe in probes.Values)probe.Dispose();}
    }
    static async Task<bool> ReadArtwork(Properties properties,string key,CancellationToken cancellation) {
        try {
            if(properties.Thumbnail is null) {Send(new {type="artwork",trackKey=key,artwork=(string?)null});return false;}
            using var timeout=CancellationTokenSource.CreateLinkedTokenSource(cancellation,Shutdown.Token);
            timeout.CancelAfter(4000);var token=timeout.Token;
            using var stream=await properties.Thumbnail.OpenReadAsync().AsTask(token);
            if(stream.Size==0 || stream.Size>16*1024*1024)throw new InvalidDataException("Invalid thumbnail size");
            var decoder=await BitmapDecoder.CreateAsync(stream).AsTask(token);
            double scale=Math.Min(1,512d/Math.Max(decoder.PixelWidth,decoder.PixelHeight));
            uint width=Math.Max(1,(uint)(decoder.PixelWidth*scale)),height=Math.Max(1,(uint)(decoder.PixelHeight*scale));
            var pixels=await decoder.GetPixelDataAsync(BitmapPixelFormat.Bgra8,BitmapAlphaMode.Premultiplied,
                new BitmapTransform {ScaledWidth=width,ScaledHeight=height},ExifOrientationMode.IgnoreExifOrientation,ColorManagementMode.ColorManageToSRgb).AsTask(token);
            using var output=new InMemoryRandomAccessStream();
            var encoder=await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId,output).AsTask(token);
            encoder.SetPixelData(BitmapPixelFormat.Bgra8,BitmapAlphaMode.Premultiplied,width,height,96,96,pixels.DetachPixelData());
            await encoder.FlushAsync().AsTask(token);
            using var reader=new DataReader(output.GetInputStreamAt(0));
            uint loaded=await reader.LoadAsync((uint)output.Size).AsTask(token);
            if(loaded!=output.Size)throw new InvalidDataException("Incomplete cover");
            byte[] bytes=new byte[loaded];reader.ReadBytes(bytes);
            token.ThrowIfCancellationRequested();
            Send(new {type="artwork",trackKey=key,artwork="data:image/png;base64,"+Convert.ToBase64String(bytes)});
            return true;
        } catch(OperationCanceledException error) {
            if(!cancellation.IsCancellationRequested && !Shutdown.IsCancellationRequested){Report("artwork-timeout",error);Send(new {type="artwork",trackKey=key,artwork=(string?)null});}
            return false;
        }
        catch(Exception error) {if(!cancellation.IsCancellationRequested){Report("artwork",error);Send(new {type="artwork",trackKey=key,artwork=(string?)null});}return false;}
    }
}
