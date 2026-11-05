using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

internal sealed partial class LocalServer
{
    private sealed class UserError : Exception { internal UserError(string message) : base(message) {} }
    private readonly object stateLock = new object();
    private readonly SemaphoreSlim mutation = new SemaphoreSlim(1);
    private readonly SemaphoreSlim upstreamGate = new SemaphoreSlim(1);
    private readonly SemaphoreSlim imageGate = new SemaphoreSlim(4);
    private readonly CancellationTokenSource lifetime = new CancellationTokenSource();
    private readonly HttpClient upstreamHttp = new HttpClient(new HttpClientHandler { AllowAutoRedirect=false });
    private readonly HttpClient imageHttp = new HttpClient(new HttpClientHandler { AllowAutoRedirect=false });
    private string apiKey="";
    private object catalog, credits, remote;
    private string checkedAt, checkError;
    private DateTime lastCall=DateTime.MinValue;
    private volatile bool cancel;
    private volatile bool jobRunning;
    private int jobDone, jobTotal;
    private string jobMessage="";
    private static string Text(object value) { return value as string; }
    private static string Now { get { return DateTime.UtcNow.ToString("o"); } }
    private static string VersionOf(object envelope) { return Text(Get(Get(envelope,"meta"),"dataVersion")); }
    private static string Hash(string value) { using(var sha=System.Security.Cryptography.SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(value))).Replace("-","").ToLowerInvariant(); }
    private static bool Id(object value) { return value is int && (int)value>0; }
    private void Enter() { if(!mutation.Wait(0)) throw new UserError("다른 다운로드 또는 키 저장이 진행 중입니다."); }
    private void Initialize()
    {
        ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
        upstreamHttp.Timeout=TimeSpan.FromSeconds(25);
        imageHttp.Timeout=TimeSpan.FromSeconds(10);
        ImportLegacy();
        catalog=Read("catalog.json"); credits=Read("credits.json");
        apiKey=Text(Get(Read("credentials.json"),"apiKey")) ?? "";
        if(!String.IsNullOrEmpty(apiKey)) ProtectKey(Path.Combine(Program.Data,"credentials.json"));
        if(String.IsNullOrEmpty(apiKey))
        {
            var imported=Environment.GetEnvironmentVariable("ARAMGG_API_KEY");
            var envFile=Path.Combine(Program.Root,".env");
            if(String.IsNullOrWhiteSpace(imported) && File.Exists(envFile))
                foreach(var line in File.ReadAllLines(envFile))
                {
                    var match=Regex.Match(line,@"^\s*(?:export\s+)?ARAMGG_API_KEY\s*=\s*(.*?)\s*$");
                    if(match.Success) { imported=match.Groups[1].Value.Trim().Trim('\"','\''); break; }
                }
            if(!String.IsNullOrWhiteSpace(imported) && Regex.IsMatch(imported.Trim(),@"^[\x21-\x7e]{1,512}$")) StoreKey(imported.Trim());
        }
    }
    private void ImportLegacy()
    {
        var source=Path.GetFullPath(Path.Combine(Program.Root,"cache"));
        var target=Path.GetFullPath(Program.Data);
        var marker=Path.Combine(target,".legacy-imported.json");
        if(source.Equals(target,StringComparison.OrdinalIgnoreCase) || File.Exists(marker) || !Directory.Exists(source)) return;
        CopyLegacy(source,target);
        Save(".legacy-imported.json",new {source=source,importedAt=Now});
    }
    private void CopyLegacy(string source,string target)
    {
        Directory.CreateDirectory(target);
        foreach(var entry in new DirectoryInfo(source).GetFileSystemInfos())
        {
            if((entry.Attributes & FileAttributes.ReparsePoint)!=0 || entry.Name=="instance.json" || entry.Name.EndsWith(".tmp") || entry.Name.StartsWith(".legacy-")) continue;
            var to=Path.Combine(target,entry.Name);
            if(entry is DirectoryInfo) CopyLegacy(entry.FullName,to);
            else if(!File.Exists(to)) File.Copy(entry.FullName,to,false);
        }
    }
    private void ProtectKey(string file)
    {
        var security=new FileSecurity();
        security.SetAccessRuleProtection(true,false);
        security.AddAccessRule(new FileSystemAccessRule(WindowsIdentity.GetCurrent().User,FileSystemRights.FullControl,AccessControlType.Allow));
        File.SetAccessControl(file,security);
    }
    private void StoreKey(string value)
    {
        lock(storageLock)
        {
            var target=Path.Combine(Program.Data,"credentials.json");
            var temporary=target+"."+Guid.NewGuid().ToString("N")+".tmp";
            try
            {
                using(File.Create(temporary)) {}
                ProtectKey(temporary);
                File.WriteAllText(temporary,json.Serialize(new {apiKey=value}),new UTF8Encoding(false));
                if(File.Exists(target)) File.Replace(temporary,target,null); else File.Move(temporary,target);
                ProtectKey(target);
            }
            finally {if(File.Exists(temporary))File.Delete(temporary);}
        }
        lock(stateLock) apiKey=value;
    }
    private object CreditView()
    {
        lock(stateLock)
        {
            var known=Text(Get(credits,"keyId"))==Hash(apiKey).Substring(0,24) && Text(Get(credits,"day"))==DateTime.UtcNow.ToString("yyyy-MM-dd");
            return new Dictionary<string,object>{{"remaining",known?Get(credits,"remaining"):200},{"estimated",!known || Equals(Get(credits,"estimated"),true)},{"checkedAt",known?Get(credits,"checkedAt"):null}};
        }
    }
    private int Remaining() { return Convert.ToInt32(Get(CreditView(),"remaining") ?? 200); }
    private void RecordCredits(string key,int remaining,bool estimated)
    {
        var record=new {remaining=Math.Max(0,remaining),estimated=estimated,day=DateTime.UtcNow.ToString("yyyy-MM-dd"),keyId=Hash(key).Substring(0,24),checkedAt=Now};
        Save("credits.json",record);
        lock(stateLock) credits=json.DeserializeObject(json.Serialize(record));
    }
    private async Task<byte[]> Bounded(HttpResponseMessage response,int maximum,CancellationToken cancellation)
    {
        if(response.Content.Headers.ContentLength>maximum) throw new UserError("응답 데이터가 너무 큽니다.");
        using(var stream=await response.Content.ReadAsStreamAsync())
        using(var output=new MemoryStream())
        {
            var buffer=new byte[16384]; int count;
            while((count=await stream.ReadAsync(buffer,0,buffer.Length,cancellation))>0)
            {
                if(output.Length+count>maximum) throw new UserError("응답 데이터가 너무 큽니다.");
                output.Write(buffer,0,count);
            }
            return output.ToArray();
        }
    }
    private string ApiBase()
    {
#if CSHARP_TEST
        Uri test;
        if(Uri.TryCreate(Environment.GetEnvironmentVariable("MAYHEM_TEST_API"),UriKind.Absolute,out test) && test.Scheme=="http" && test.Host=="127.0.0.1") return test.AbsoluteUri.TrimEnd('/')+"/";
        throw new UserError("검증용 API 주소가 필요합니다.");
#else
        return "https://data.dtodo.cn/api/v1/ko/";
#endif
    }
    private int Interval
    {
        get {
#if CSHARP_TEST
            return 30;
#else
            return 1100;
#endif
        }
    }
    private async Task<object> Upstream(string resource,int cost)
    {
        await upstreamGate.WaitAsync(lifetime.Token);
        try
        {
            string key; lock(stateLock) key=apiKey;
            if(cost>0 && String.IsNullOrEmpty(key)) throw new UserError("화면에서 API 키를 등록해 주세요.");
            if(cost>0 && Remaining()<cost) throw new UserError("오늘 할당량이 부족합니다. 기존 캐시를 사용합니다.");
            var wait=Interval-(DateTime.UtcNow-lastCall).TotalMilliseconds;
            if(wait>0) await Task.Delay((int)wait,lifetime.Token);
            if(cost>0 && cancel && jobRunning) throw new UserError("수집을 중단했습니다. 다시 누르면 이어받습니다.");
            lastCall=DateTime.UtcNow;
            // Reserve credits before sending: an interrupted response may still have cost credits upstream.
            if(cost>0) RecordCredits(key,Remaining()-cost,true);
            using(var timeout=CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token))
            using(var request=new HttpRequestMessage(HttpMethod.Get,ApiBase()+resource))
            {
                timeout.CancelAfter(TimeSpan.FromSeconds(25));
                if(cost>0) request.Headers.Authorization=new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer",key);
                HttpResponseMessage response;
                try { response=await upstreamHttp.SendAsync(request,HttpCompletionOption.ResponseHeadersRead,timeout.Token); }
                catch(HttpRequestException) { throw new UserError("데이터 서버에 연결할 수 없습니다. 기존 캐시는 유지됩니다."); }
                using(response)
                {
                    IEnumerable<string> values; int remaining;
                    if(cost>0 && response.Headers.TryGetValues("x-credits-remaining",out values) && Int32.TryParse(values.FirstOrDefault(),out remaining) && remaining>=0) RecordCredits(key,remaining,false);
                    if(response.StatusCode==HttpStatusCode.Unauthorized) throw new UserError("API 키 인증에 실패했습니다. 데이터 관리에서 API 키를 변경해 주세요.");
                    if((int)response.StatusCode==429) throw new UserError(Remaining()==0?"오늘 할당량을 소진했습니다. 한국 시간 오전 9시 이후 재개하세요.":"요청 속도가 제한되었습니다. 잠시 후 다시 시도하세요. 기존 캐시는 유지됩니다.");
                    if(!response.IsSuccessStatusCode) throw new UserError("데이터 요청 실패 ("+(int)response.StatusCode+")");
                    var bytes=await Bounded(response,32*1024*1024,timeout.Token);
                    try { return json.DeserializeObject(Encoding.UTF8.GetString(bytes)); }
                    catch { throw new UserError("데이터 응답 형식 오류. 기존 캐시는 유지됩니다."); }
                }
            }
        }
        finally { upstreamGate.Release(); }
    }
    private async Task<object> CheckRemote()
    {
        try
        {
            var value=await Upstream("config.json",0);
            if(String.IsNullOrWhiteSpace(Text(Get(value,"dataVersion")))) throw new UserError("버전 정보 형식 오류");
            lock(stateLock) { remote=value; checkedAt=Now; checkError=null; }
            return value;
        }
        catch(Exception e) { lock(stateLock) checkError=e is UserError?e.Message:"최신 버전을 확인하지 못했습니다. 저장된 데이터를 표시합니다."; throw; }
    }
    private static void AssertVersion(object value,string target) { if(VersionOf(value)!=target) throw new UserError("수집 중 데이터 버전이 변경되었습니다. 기존 캐시는 유지됩니다."); }
    private async Task VerifyCurrent(string target)
    {
        if(Text(Get(await CheckRemote(),"dataVersion"))!=target) throw new UserError("수집 중 버전이 변경되었습니다. 완료한 캐시는 보존했고 다시 갱신할 수 있습니다.");
        if(cancel && jobRunning) throw new UserError("수집을 중단했습니다. 완료한 캐시는 유지됩니다.");
    }
    private object SaveEnvelope(string file,object envelope)
    {
        Map(envelope)["cache"]=new Dictionary<string,object>{{"downloadedAt",Now}};
        Save(Path.Combine("versions",Uri.EscapeDataString(VersionOf(envelope) ?? "unknown"),file),envelope);
        Save(file,envelope);
        return envelope;
    }
    private async Task<bool> EnsureCatalog(string version)
    {
        if(VersionOf(catalog)==version) return false;
        var value=await Upstream("champions.json",1);
        AssertVersion(value,version);
        if(!(Get(value,"data") is object[]) || List(Get(value,"data")).Length==0 || List(Get(value,"data")).Any(c=>!Id(Get(c,"id")))) throw new UserError("챔피언 목록 형식 오류");
        await VerifyCurrent(version);
        var saved=SaveEnvelope("catalog.json",value);
        lock(stateLock) catalog=saved;
        return true;
    }
    private object CatalogView(object envelope,bool reused)
    {
        return new {version=VersionOf(envelope),downloadedAt=Get(Get(envelope,"cache"),"downloadedAt"),reused=reused,data=List(Get(envelope,"data")).Where(a=>Id(Get(a,"id"))).Select(a=>new {
            id=Get(a,"id"),name=Get(a,"name") ?? "증강 "+Get(a,"id"),iconUrl=Text(Get(a,"iconUrl")),rarityName=Text(Get(a,"rarityName")),rarityDisplayName=Text(Get(a,"rarityDisplayName")),description=Text(Get(a,"description")),tooltip=Text(Get(a,"tooltip")),
            topChampions=List(Get(a,"topChampions")).Where(c=>Id(Get(c,"id"))).GroupBy(c=>Get(c,"id")).Select(g=>g.First()).Select(c=>new {id=Get(c,"id"),name=Get(c,"name"),iconUrl=Text(Get(c,"iconUrl"))}).ToArray()
        }).ToArray()};
    }
    private object StatusView()
    {
        var credit=CreditView();
        lock(stateLock) return new {token=Info.token,hasKey=!String.IsNullOrEmpty(apiKey),credits=Get(credit,"remaining"),creditsEstimated=Get(credit,"estimated"),creditsCheckedAt=Get(credit,"checkedAt"),checkedAt=checkedAt,checkError=checkError,catalogDownloadedAt=Get(Get(catalog,"cache"),"downloadedAt"),catalogStatsDate=Get(Get(catalog,"meta"),"generatedAt"),catalogVersion=VersionOf(catalog),remoteVersion=Get(remote,"dataVersion"),job=new {running=jobRunning,done=jobDone,total=jobTotal,message=jobMessage}};
    }
    private static bool KnownApi(string method,string route)
    {
        if(method=="GET" || method=="HEAD") return new[]{"/api/status","/api/champions","/api/augment-descriptions","/api/settings"}.Contains(route) || Regex.IsMatch(route,@"^/api/champions/([1-9]\d*)$");
        return new[]{"/api/shutdown","/api/cancel","/api/settings","/api/credentials","/api/images/reset","/api/check","/api/catalog","/api/sync","/api/sync/plan","/api/augment-descriptions/download"}.Contains(route) || Regex.IsMatch(route,@"^/api/champions/([1-9]\d*)/download$");
    }
    private async Task<object> Api(string method,string route,object body)
    {
        if(method=="GET" || method=="HEAD")
        {
            if(route=="/api/status") return StatusView();
            if(route=="/api/champions") return Get(catalog,"data") ?? new object[0];
            if(route=="/api/augment-descriptions") return CatalogView(Read("augments.json"),false);
            if(route=="/api/settings") { var value=Read("settings.json"); return value==null?null:Sanitize(value); }
            var match=Regex.Match(route,@"^/api/champions/([1-9]\d*)$");
            if(match.Success) return Detail(Read("details/"+match.Groups[1].Value+".json"),Read("raw-details/"+match.Groups[1].Value+".json"));
            throw new UserError("알 수 없는 API");
        }
        if(route=="/api/shutdown") { cancel=true; lifetime.Cancel(); return new {ok=true}; }
        if(route=="/api/cancel") { cancel=true; return new {ok=true}; }
        if(route=="/api/settings") { var value=Sanitize(body); Save("settings.json",value); return value; }
        Enter();
        var background=false;
        try
        {
            if(route=="/api/credentials")
            {
                var value=Text(Get(body,"apiKey"));
                if(value==null || !Regex.IsMatch(value.Trim(),@"^[\x21-\x7e]{1,512}$")) throw new UserError("공백 없이 올바른 API 키를 입력해 주세요.");
                StoreKey(value.Trim()); return new {saved=true};
            }
            if(route=="/api/images/reset")
            {
                var acquired=0;
                try { for(;acquired<4;acquired++) await imageGate.WaitAsync(lifetime.Token); lock(storageLock) { var images=Path.Combine(Program.Data,"images"); if(Directory.Exists(images)) Directory.Delete(images,true); } }
                finally { if(acquired>0) imageGate.Release(acquired); }
                return new {ok=true};
            }
            if(route=="/api/check") return await CheckRemote();
            if(route=="/api/sync")
            {
                cancel=false;
                lock(stateLock) { jobRunning=true;jobDone=0;jobTotal=0;jobMessage="최신 버전 확인 중"; }
                background=true;
                Task.Run((Func<Task>)SyncAll);
                return new {ok=true};
            }
            var config=await CheckRemote(); var version=Text(Get(config,"dataVersion"));
            if(route=="/api/catalog") return new {ok=true,downloaded=await EnsureCatalog(version)};
            if(route=="/api/sync/plan")
            {
                if(VersionOf(catalog)!=version) return new {version=version,needsCatalog=true,cost=(object)null,remaining=Remaining(),message="목록을 먼저 자동 갱신합니다(최대 1 credit). 이후 필요한 증강만 수집하며 상세용 20 credits를 남깁니다."};
                var needed=List(Get(catalog,"data")).Count(c=>VersionOf(Read("details/"+Get(c,"id")+".json"))!=version && VersionOf(Read("raw-details/"+Get(c,"id")+".json"))!=version);
                return new {version=version,needed=needed,cost=needed+(needed>0 && VersionOf(Read("augments.json"))!=version?1:0),remaining=Remaining(),reserve=20};
            }
            if(route=="/api/augment-descriptions/download")
            {
                var existing=Read("augments.json");
                if(VersionOf(existing)==version && List(Get(existing,"data")).Any(a=>!String.IsNullOrEmpty(Text(Get(a,"description"))) || !String.IsNullOrEmpty(Text(Get(a,"tooltip"))))) return CatalogView(existing,true);
                var value=await AugmentDownload(version);
                return CatalogView(value,false);
            }
            var match=Regex.Match(route,@"^/api/champions/([1-9]\d*)/download$");
            if(match.Success)
            {
                var id=match.Groups[1].Value; int number;
                if(!Int32.TryParse(id,out number)) throw new UserError("잘못된 챔피언");
                var file="details/"+id+".json"; var existing=Read(file);
                if(VersionOf(existing)==version) { Map(existing)["reused"]=true; return existing; }
                var value=await Upstream("champions/"+id+".json",2); AssertVersion(value,version);
                if(!Equals(Get(Get(Get(value,"data"),"champion"),"id"),number) || !(Get(Get(value,"data"),"augments") is object[])) throw new UserError("상세 형식 오류");
                await VerifyCurrent(version);
                return SaveEnvelope(file,value);
            }
            throw new UserError("알 수 없는 API");
        }
        finally { if(!background) mutation.Release(); }
    }
    private async Task<object> AugmentDownload(string version)
    {
        var value=await Upstream("augments.json",1); AssertVersion(value,version);
        if(!(Get(value,"data") is object[]) || List(Get(value,"data")).Length==0 || List(Get(value,"data")).Any(a=>!Id(Get(a,"id")))) throw new UserError("증강 목록 형식 오류");
        await VerifyCurrent(version);
        return SaveEnvelope("augments.json",value);
    }
    private async Task SyncAll()
    {
        try
        {
            var version=Text(Get(await CheckRemote(),"dataVersion"));
            if(Remaining()<=20) throw new UserError("상세 조회용 20 credits를 남기고 중단했습니다. 다음 날 재개하세요.");
            await EnsureCatalog(version);
            var champions=List(Get(catalog,"data"));
            lock(stateLock) { jobTotal=champions.Length; jobMessage="증강 통계 동기화"; }
            var basis=Read("augments.json");
            foreach(var champion in champions)
            {
                if(cancel) break;
                var id=Get(champion,"id");
                if(VersionOf(Read("details/"+id+".json"))!=version && VersionOf(Read("raw-details/"+id+".json"))!=version)
                {
                    if(Remaining()<=20) { lock(stateLock) jobMessage="상세 조회용 20 credits를 남기고 중단했습니다. 다음 날 재개하세요."; break; }
                    if(VersionOf(basis)!=version) basis=await AugmentDownload(version);
                    if(Remaining()<=20) { lock(stateLock) jobMessage="상세 조회용 20 credits를 남기고 중단했습니다."; break; }
                    var payload=await Upstream("data/champion-augments/"+id+".json",1);
                    var data=RawDetail(payload,champion,List(Get(basis,"data")));
                    await VerifyCurrent(version);
                    var meta=new Dictionary<string,object>(Map(Get(catalog,"meta"))); meta["statsDate"]=Get(data,"statsDate");
                    SaveEnvelope("raw-details/"+id+".json",new Dictionary<string,object>{{"meta",meta},{"data",data}});
                }
                lock(stateLock) jobDone++;
            }
            lock(stateLock) { if(jobDone==jobTotal) jobMessage="전체 증강 캐시 완료"; else if(cancel) jobMessage="중단했습니다. 다시 누르면 이어받습니다."; }
        }
        catch(Exception e) { lock(stateLock) jobMessage=e is UserError?e.Message:e is OperationCanceledException?"수집을 중단했습니다. 완료한 캐시는 유지됩니다.":"수집에 실패했습니다. 기존 캐시는 유지됩니다."; }
        finally { lock(stateLock) jobRunning=false; mutation.Release(); }
    }
    private static object Number(object value)
    {
        if(value==null || Convert.ToString(value)=="") return null;
        double number;
        return Double.TryParse(Convert.ToString(value,CultureInfo.InvariantCulture),NumberStyles.Float,CultureInfo.InvariantCulture,out number) && !Double.IsNaN(number) && !Double.IsInfinity(number)?(object)number:null;
    }
    private object RawDetail(object payload,object champion,object[] augments)
    {
        var row=List(List(payload).FirstOrDefault());
        if(row.Length<2 || !(row[1] is string)) throw new UserError("원시 통계 형식이 변경되었습니다.");
        object stats;
        try { stats=json.DeserializeObject((string)row[1]); } catch { throw new UserError("원시 통계 형식 오류"); }
        if(!(Get(stats,"augments") is Dictionary<string,object>)) throw new UserError("증강 통계 형식 오류");
        var basis=augments.Where(a=>Id(Get(a,"id"))).GroupBy(a=>Convert.ToString(Get(a,"id"))).ToDictionary(g=>g.Key,g=>g.First());
        Func<string,object> augment=id=>basis.ContainsKey(id)?basis[id]:(object)new Dictionary<string,object>{{"id",Int32.Parse(id)},{"name","증강 "+id}};
        var date=row.Length>3?Text(row[3]):null;
        var list=new List<object>();
        foreach(var pair in Map(Get(stats,"augments")))
        {
            int id; if(!Int32.TryParse(pair.Key,out id) || id<=0) throw new UserError("증강 식별자 형식 오류");
            var a=new Dictionary<string,object>(Map(augment(pair.Key))); var v=pair.Value;
            a["id"]=id;
            a["stats"]=new {rank=Number(Get(v,"rank")),tier=Number(Get(v,"tier")),winRate=Number(Get(v,"win_rate")),pickRate=Number(Get(v,"pick_rate")),wins=Number(Get(v,"num_win_games")),games=Number(Get(v,"num_games")),winRateRegion=Get(v,"win_rate_region"),winRateDate=Get(v,"win_rate_date"),winRateSource=Get(v,"win_rate_source"),date=date,source=Get(stats,"source")};
            list.Add(a);
        }
        var trios=new List<object>();
        foreach(var pair in Map(Get(stats,"augment_trios")))
        {
            var ids=pair.Key.Split(':');
            if(ids.Any(id=>!Regex.IsMatch(id,@"^[1-9]\d*$"))) throw new UserError("증강 조합 형식 오류");
            var v=pair.Value;
            trios.Add(new {augmentIds=ids.Select(Int32.Parse).ToArray(),augments=ids.Select(augment).ToArray(),stats=new {wins=Number(Get(v,"num_win_games")),games=Number(Get(v,"num_games")),winRate=Number(Get(v,"win_rate")),pickRate=Number(Get(v,"pick_rate")),source=Get(v,"source"),region=Get(v,"region"),date=Get(v,"date"),gamePatch=Get(v,"game_patch")}});
        }
        return new Dictionary<string,object>{{"champion",champion},{"augments",list.ToArray()},{"statsDate",date},{"augmentTrios",trios.ToArray()},{"builds",new object[0]},{"rawOnly",true}};
    }
    private async Task FetchImage(Uri image,string digest)
    {
        await imageGate.WaitAsync(lifetime.Token);
        try
        {
            var file=Path.Combine(Program.Data,"images",digest);
            if(File.Exists(file)) return;
            using(var timeout=CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token))
            {
                timeout.CancelAfter(TimeSpan.FromSeconds(10));
                using(var response=await imageHttp.GetAsync(ImageAddress(image),HttpCompletionOption.ResponseHeadersRead,timeout.Token))
                {
                    var mime=response.Content.Headers.ContentType==null?"":response.Content.Headers.ContentType.MediaType;
                    if(!response.IsSuccessStatusCode || !new[]{"image/png","image/jpeg","image/webp"}.Contains(mime)) throw new UserError("이미지를 받지 못했습니다.");
                    var bytes=await Bounded(response,2000000,timeout.Token);
                    if(bytes.Length==0) throw new UserError("빈 이미지 응답");
                    lock(storageLock) { Directory.CreateDirectory(Path.GetDirectoryName(file)); var tmp=file+"."+Guid.NewGuid().ToString("N")+".tmp"; try {File.WriteAllBytes(tmp,bytes); if(File.Exists(file)) File.Replace(tmp,file,null); else File.Move(tmp,file);} finally {if(File.Exists(tmp))File.Delete(tmp);} }
                    Save("images/"+digest+".json",new {mime=mime,downloadedAt=Now});
                }
            }
        }
        finally { imageGate.Release(); }
    }
    private string ImageAddress(Uri image)
    {
#if CSHARP_TEST
        return ApiBase()+"test-image";
#else
        return image.AbsoluteUri;
#endif
    }
    private void StopBackend() { cancel=true; lifetime.Cancel(); }
}
