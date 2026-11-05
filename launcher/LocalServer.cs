// Loopback-only HTTP transport for the C# desktop server.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

internal sealed partial class LocalServer : IDisposable
{
    private JavaScriptSerializer json { get { return new JavaScriptSerializer { MaxJsonLength = 100 * 1024 * 1024 }; } }
    private readonly object storageLock = new object();
    private readonly SemaphoreSlim slots = new SemaphoreSlim(32);
    private readonly Action shutdown;
    private TcpListener listener;
    private volatile bool stopped;
    internal Instance Info;
    private string Origin { get { return "http://127.0.0.1:" + Info.port; } }
    internal LocalServer(Action shutdown) { this.shutdown = shutdown; }
    private static Dictionary<string, object> Map(object value) { return value as Dictionary<string, object> ?? new Dictionary<string, object>(); }
    private static object Get(object value, string key) { object found; return Map(value).TryGetValue(key, out found) ? found : null; }
    private static object[] List(object value) { return value as object[] ?? new object[0]; }
    private string DataFile(string relative) { return Path.Combine(Program.Data, relative); }
    private object Read(string relative)
    {
        lock (storageLock) { try { return json.DeserializeObject(File.ReadAllText(DataFile(relative))); } catch { return null; } }
    }
    private void Save(string relative, object value)
    {
        lock (storageLock)
        {
            Directory.CreateDirectory(Program.Data);
            var target = Path.Combine(Program.Data, relative);
            Directory.CreateDirectory(Path.GetDirectoryName(target));
            var temporary = target + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try { File.WriteAllText(temporary, json.Serialize(value), new UTF8Encoding(false)); if (File.Exists(target)) File.Replace(temporary, target, null); else File.Move(temporary, target); }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }
    }
    internal void Start()
    {
        if (!File.Exists(Path.Combine(Program.Root, "dist", "web", "index.html"))) throw new FileNotFoundException("화면 파일이 없습니다.");
        Directory.CreateDirectory(Program.Data);
        Initialize();
        var port = 4318;
        int configured;
        if (Int32.TryParse(Environment.GetEnvironmentVariable("PORT"), out configured) && configured >= 0 && configured < 65536) port = configured;
        for (var attempt = 0; ; attempt++)
        {
            listener = new TcpListener(IPAddress.Loopback, port);
            try { listener.Start(64); break; }
            catch (SocketException) { listener.Stop(); if (attempt >= 10 || port >= 65535) throw; port++; }
        }
        string token;
        using (var rng = RandomNumberGenerator.Create()) { var bytes = new byte[24]; rng.GetBytes(bytes); token = BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant(); }
        Info = new Instance { port = ((IPEndPoint)listener.LocalEndpoint).Port, token = token, pid = Process.GetCurrentProcess().Id };
        Save("instance.json", Info);
        Task.Run((Func<Task>)Accept);
        Program.Log("C# 내장 서버 준비 완료 " + Origin);
    }
    private async Task Accept()
    {
        while (!stopped)
        {
            try { var client = await listener.AcceptTcpClientAsync(); if (!slots.Wait(0)) { client.Close(); continue; } Handle(client); }
            catch (Exception e) { if (!stopped) Program.Log("로컬 연결 오류: " + e.GetType().Name); }
        }
    }
    private static async Task<int> ReadTimed(NetworkStream stream, byte[] bytes, int offset, int count)
    {
        var read = stream.ReadAsync(bytes, offset, count);
        if (await Task.WhenAny(read, Task.Delay(5000)) != read) throw new IOException("요청 시간 초과");
        return await read;
    }
    private async void Handle(TcpClient client)
    {
        bool stopAfterReply = false;
        try
        {
            using (client)
            using (var stream = client.GetStream())
            {
                var incoming = new byte[16384];
                var received=0; var headerEnd=-1;
                var requestDeadline=Task.Delay(10000);
                while(headerEnd<0 && received<incoming.Length)
                {
                    var read=stream.ReadAsync(incoming,received,incoming.Length-received);
                    if(await Task.WhenAny(read,requestDeadline)!=read) return;
                    var count=await read; if(count==0)return; received+=count;
                    for(var i=3;i<received;i++) if(incoming[i-3]==13 && incoming[i-2]==10 && incoming[i-1]==13 && incoming[i]==10) {headerEnd=i+1;break;}
                }
                if(headerEnd<0) { await Error(stream,431,"요청 헤더가 너무 큽니다.");return; }
                var lines = Encoding.ASCII.GetString(incoming,0,headerEnd).Split(new[] { "\r\n" }, StringSplitOptions.None);
                var request = lines[0].Split(' ');
                if (request.Length != 3 || !request[1].StartsWith("/") || request[1].StartsWith("//") || request[2] != "HTTP/1.1") { await Error(stream, 400, "잘못된 요청"); return; }
                var headers = new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
                foreach (var line in lines.Skip(1).Where(line => line.Length > 0)) { var colon = line.IndexOf(':'); if (colon < 1 || !System.Text.RegularExpressions.Regex.IsMatch(line.Substring(0,colon),@"^[A-Za-z0-9-]+$") || headers.ContainsKey(line.Substring(0,colon))) { await Error(stream,400,"잘못된 헤더"); return; } headers.Add(line.Substring(0,colon),line.Substring(colon+1).Trim()); }
                string host;
                if (!headers.TryGetValue("Host",out host) || host != "127.0.0.1:" + Info.port || headers.ContainsKey("Transfer-Encoding")) { await Error(stream,403,"허용되지 않은 요청"); return; }
                var method = request[0];
                if (method != "GET" && method != "HEAD" && method != "POST") { await Error(stream,405,"허용되지 않은 메서드"); return; }
                string origin;
                if (headers.TryGetValue("Origin",out origin) && origin != Origin) { await Error(stream,403,"외부 출처는 허용하지 않습니다."); return; }
                if (method == "POST")
                {
                    string token;
                    if (!headers.TryGetValue("x-session-token",out token) || token != Info.token || origin != Origin) { await Error(stream,403,"세션을 새로 열어주세요."); return; }
                }
                var length = 0;
                string lengthText;
                if (headers.TryGetValue("Content-Length",out lengthText) && (!Int32.TryParse(lengthText,out length) || length < 0 || length > 1024*1024)) { await Error(stream,413,"본문 크기 초과"); return; }
                var body = new byte[length];
                var buffered=received-headerEnd;
                if(buffered>length) {await Error(stream,400,"요청 본문 형식 오류");return;}
                Buffer.BlockCopy(incoming,headerEnd,body,0,buffered);
                for(var offset=buffered;offset<length;)
                {
                    var read=stream.ReadAsync(body,offset,length-offset);
                    if(await Task.WhenAny(read,requestDeadline)!=read)return;
                    var count=await read; if(count==0)return;offset+=count;
                }
                var uri = new Uri(Origin + request[1]);
                var route = uri.AbsolutePath;
                if (route.StartsWith("/api/") && route != "/api/image")
                {
                    if(!KnownApi(method,route)) {await Error(stream,404,"알 수 없는 API");return;}
                    object parsed = null;
                    if (method == "POST" && body.Length > 0)
                    {
                        string contentType;
                        if (!headers.TryGetValue("Content-Type",out contentType) || !contentType.Split(';')[0].Trim().Equals("application/json",StringComparison.OrdinalIgnoreCase)) { await Error(stream,415,"JSON 요청이 필요합니다."); return; }
                        bool invalid=false;
                        try { parsed = json.DeserializeObject(Encoding.UTF8.GetString(body)); } catch {invalid=true;}
                        if(invalid) {await Error(stream,400,"JSON 요청 형식 오류");return;}
                    }
                    object result = null;
                    string failure = null;
                    try { result = await Api(method,route,parsed); }
                    catch (Exception e) { failure = e is OperationCanceledException ? "요청이 중단되었습니다. 기존 캐시는 유지됩니다." : e is UserError ? e.Message : "요청 처리에 실패했습니다. 기존 캐시는 유지됩니다."; Program.Log("API 처리 실패: "+e.GetType().Name); }
                    if (failure != null) { await Error(stream,400,failure); return; }
                    if (method == "POST" && route == "/api/shutdown") stopAfterReply=true;
                    await Reply(stream,200,"application/json; charset=utf-8",Encoding.UTF8.GetBytes(json.Serialize(result)),method=="HEAD"); return;
                }
                if (route == "/api/image")
                {
                    var query = System.Web.HttpUtility.ParseQueryString(uri.Query);
                    Uri image;
                    if (!Uri.TryCreate(query["url"],UriKind.Absolute,out image) || image.Scheme!="https" || image.Host!="cdn.dtodo.cn" || image.Port!=443 || image.UserInfo!="" || !image.AbsolutePath.StartsWith("/hextech/")) { await Error(stream,403,"허용되지 않은 이미지"); return; }
                    string digest;
                    using(var sha=SHA256.Create()) digest=BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(image.AbsoluteUri))).Replace("-","").ToLowerInvariant();
                    var file=DataFile(Path.Combine("images",digest));
                    if (!File.Exists(file))
                    {
                        bool failed=false;
                        try {await FetchImage(image,digest);} catch {failed=true;}
                        if(failed) {await Error(stream,404,"이미지를 받지 못했습니다.");return;}
                    }
                    var bytes=File.ReadAllBytes(file);
                    var mime=bytes.Length>3 && bytes[0]==255?"image/jpeg":bytes.Length>3 && Encoding.ASCII.GetString(bytes,0,4)=="RIFF"?"image/webp":"image/png";
                    await Reply(stream,200,mime,bytes,method=="HEAD"); return;
                }
                else if (route.StartsWith("/api/")) { await Error(stream,404,"알 수 없는 API"); return; }
                else
                {
                    var web=Path.GetFullPath(Path.Combine(Program.Root,"dist","web"));
                    var decoded=Uri.UnescapeDataString(request[1].Split('?')[0]);
                    if(decoded.Contains("\\") || decoded.Contains(":") || decoded.IndexOf('\0')>=0 || decoded.Split('/').Any(part=>part=="..")) {await Error(stream,403,"허용되지 않은 경로");return;}
                    var file=Path.GetFullPath(Path.Combine(web,Uri.UnescapeDataString(route=="/"?"/index.html":route).TrimStart('/').Replace('/',Path.DirectorySeparatorChar)));
                    if (!file.StartsWith(web+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)) { await Error(stream,403,"허용되지 않은 경로"); return; }
                    if (!File.Exists(file)) file=Path.Combine(web,"index.html");
                    var bytes=File.ReadAllBytes(file);
                    var extension=Path.GetExtension(file).ToLowerInvariant();
                    var mime=extension==".html"?"text/html; charset=utf-8":extension==".js"?"application/javascript":extension==".css"?"text/css":extension==".svg"?"image/svg+xml":"application/octet-stream";
                    await Reply(stream,200,mime,bytes,method=="HEAD"); return;
                }
            }
        }
        catch (Exception e) { Program.Log("로컬 요청 오류: "+e.GetType().Name); client.Close(); }
        finally { slots.Release(); if (stopAfterReply) FinishShutdown(); }
    }
    private async void FinishShutdown()
    {
        await Task.Delay(100);
        try { Dispose(); } finally { shutdown(); }
    }
    private Task Error(NetworkStream stream,int code,string message) { return Reply(stream,code,"application/json; charset=utf-8",Encoding.UTF8.GetBytes(json.Serialize(new {error=message})),false); }
    private static async Task Reply(NetworkStream stream,int code,string type,byte[] body,bool head)
    {
        var header=Encoding.ASCII.GetBytes("HTTP/1.1 "+code+" Result\r\nContent-Type: "+type+"\r\nContent-Length: "+body.Length+"\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'\r\n\r\n");
        using(var timeout=new CancellationTokenSource(5000)) { await stream.WriteAsync(header,0,header.Length,timeout.Token); if(!head) await stream.WriteAsync(body,0,body.Length,timeout.Token); }
    }
    private static object Sanitize(object value)
    {
        Func<object,int?> id = x => x is int && (int)x>0?(int?)x:null;
        Func<object,int[]> ids = x => List(x).Select(id).Where(n=>n.HasValue).Select(n=>n.Value).Distinct().Take(200).ToArray();
        Func<string,string[],string> choice=(key,options)=>options.Contains(Get(value,key) as string)?(string)Get(value,key):options[0];
        return new {champion=id(Get(value,"champion")),theme=choice("theme",new[]{"dark","light"}),tab=choice("tab",new[]{"summary","augments","builds"}),favorites=ids(Get(value,"favorites")),recent=ids(Get(value,"recent")).Take(8).ToArray(),rarity=choice("rarity",new[]{"all","silver","gold","prismatic"}),sort=choice("sort",new[]{"rank","winRate"}),buildSort=choice("buildSort",new[]{"pickRate","winRate"})};
    }
    private static object Detail(object full,object raw)
    {
        if(full==null && raw==null) return new {missing=true};
        if(full==null) return raw;
        if(raw==null) return full;
        var a=Convert.ToString(Get(Get(full,"meta"),"dataVersion"));
        var b=Convert.ToString(Get(Get(raw,"meta"),"dataVersion"));
        var aParts=a.Split('.'); var bParts=b.Split('.');
        var comparison=0;
        for(var i=0;i<Math.Max(aParts.Length,bParts.Length);i++) { int x,y; Int32.TryParse(i<aParts.Length?aParts[i]:"0",out x); Int32.TryParse(i<bParts.Length?bParts[i]:"0",out y); comparison=x.CompareTo(y); if(comparison!=0) break; }
        if(comparison>=0) return full;
        if(List(Get(Get(full,"data"),"builds")).Length>0) { Map(Get(raw,"data"))["builds"]=Get(Get(full,"data"),"builds"); Map(raw)["buildMeta"]=Get(full,"meta"); Map(raw)["buildCache"]=Get(full,"cache"); Map(raw)["buildStale"]=true; }
        return raw;
    }
    public void Dispose()
    {
        if(stopped) return;
        stopped=true;
        StopBackend();
        if(listener!=null) listener.Stop();
        lock(storageLock) { if(Info != null && Get(Read("instance.json"),"token") as string==Info.token) File.Delete(Path.Combine(Program.Data,"instance.json")); }
    }
}
