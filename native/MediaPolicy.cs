static class MediaPolicy {
    public static bool Primary(string source) => source.Contains("spotify",StringComparison.OrdinalIgnoreCase) || source.Contains("yandex",StringComparison.OrdinalIgnoreCase) || source.Contains("яндекс",StringComparison.OrdinalIgnoreCase);
    public static int Rank(string source,bool playing,string? currentSource) =>
        playing&&source==currentSource?5:playing&&Primary(source)?4:playing?3:source==currentSource?2:Primary(source)?1:0;
    public static string TrackKey(string source,string title,string artist,string album,int trackNumber) => string.Join('\u001f',source,title,artist,album,trackNumber);
}

record SessionCandidate(string Token,string Source,bool? Playing,long UpdatedMs,long ChangedAt,bool Current);
static class SessionPolicy {
    public static SessionCandidate? Choose(IEnumerable<SessionCandidate> input,string preferred) {
        var candidates=input.Where(c=>preferred=="auto"||c.Source==preferred).ToArray();
        if(candidates.Length==0)return null;
        string? currentSource=candidates.FirstOrDefault(c=>c.Current)?.Source;
        var group=candidates.GroupBy(c=>c.Source).OrderByDescending(g=>MediaPolicy.Rank(g.Key,g.Any(c=>c.Playing==true||c.Playing is null&&c.Current),currentSource)).First();
        // App IDs are not session identities: two Spotify sessions can have the same
        // name and even both report Playing. Compare the actual live observations.
        return group.OrderByDescending(c=>c.Playing==true?2:c.Playing is null?1:0)
            .ThenByDescending(c=>c.UpdatedMs).ThenByDescending(c=>c.ChangedAt).ThenByDescending(c=>c.Current).First();
    }
    public static string TrackKey(string baseKey,string token)=>baseKey+'\u001e'+token;
}
