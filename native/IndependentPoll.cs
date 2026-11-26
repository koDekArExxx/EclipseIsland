using System.Collections.Concurrent;
using System.Diagnostics;

// Exactly one outstanding call per lane, on its own persistent OS thread.
// A timeout does not enqueue another uninterruptible COM call on the thread pool.
sealed class IndependentPoll<T> : IDisposable {
    readonly BlockingCollection<(Func<Task<T>> read,TaskCompletionSource<T> completion)> work=new(1);
    readonly Func<long> clock;
    Thread? thread;
    Task<T>? pending;
    long generation,started,next;
    public IndependentPoll(Func<long>? clock=null) {this.clock=clock??(()=>Environment.TickCount64);}
    public long PendingMs => pending is null?0:Math.Max(0,clock()-started);
    public long LastReadMs {get;private set;}
    public long StartedCount {get;private set;}
    public bool Busy => pending is not null;
    public bool Completed => pending?.IsCompleted==true;
    public void RequestNow(){next=0;}
    public bool Start(Func<Task<T>> read,long revision,int intervalMs) {
        if(pending is not null || clock()<next)return false;
        if(thread is null) {
            thread=new Thread(()=>{
                foreach(var item in work.GetConsumingEnumerable()) {
                    try{item.completion.TrySetResult(item.read().GetAwaiter().GetResult());}
                    catch(Exception error){item.completion.TrySetException(error);}
                }
            }){IsBackground=true,Name="Eclipse media lane"};
            thread.Start();
        }
        var completion=new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        generation=revision;started=clock();next=started+intervalMs;pending=completion.Task;StartedCount++;
        work.Add((read,completion));return true;
    }
    public bool Take(long currentRevision,out T value,out Exception? error) {
        value=default!;error=null;
        if(pending is null || !pending.IsCompleted)return false;
        var completed=pending;pending=null;LastReadMs=Math.Max(0,clock()-started);
        try{value=completed.GetAwaiter().GetResult();}catch(Exception failure){error=failure;}
        // Observe exceptions even when a session changed; never publish the old result.
        if(generation!=currentRevision){error=null;value=default!;return false;}
        return true;
    }
    public void Dispose(){work.CompleteAdding();}
}

static class MediaCancellation {
    public static void Cancel(CancellationTokenSource? source) {
        if(source is null)return;
        // WinRT cancellation callbacks can themselves enter COM. Never run them
        // synchronously on the metadata publication loop.
        var cancellation=source.CancelAsync();
        if(!cancellation.IsCompletedSuccessfully)_=Observe(cancellation);
    }
    static async Task Observe(Task cancellation){try{await cancellation;}catch{}}
}
