using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("Mayhem Pocket")]
[assembly: System.Reflection.AssemblyDescription("Mayhem Pocket 로컬 서버 및 트레이 실행기")]

internal static class Program
{
    internal static readonly string Root = AppDomain.CurrentDomain.BaseDirectory;
    internal static readonly string Logs = Path.Combine(Root, "logs");
    internal static int Result;
    private static readonly object LogLock = new object();
    internal static bool Quiet { get { return Environment.GetEnvironmentVariable("MAYHEM_POCKET_NO_BROWSER") == "1"; } }

    [STAThread]
    private static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        string identity;
        using (var sha = SHA256.Create())
            identity = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(Root.TrimEnd('\\').ToUpperInvariant()))).Replace("-", "");
        using (var signal = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\MayhemPocket.Open." + identity))
        using (var stopSignal = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\MayhemPocket.Stop." + identity))
        {
            bool owner;
            using (var mutex = new Mutex(true, @"Local\MayhemPocket.Instance." + identity, out owner))
            {
                var stopOnly = Array.IndexOf(args, "--stop") >= 0;
                if (!owner) { if (stopOnly) stopSignal.Set(); else signal.Set(); return 0; }
                try
                {
                    if (stopOnly) return 0;
                    using (var context = new TrayServer(signal, stopSignal)) Application.Run(context);
                    return Result;
                }
                catch (Exception e) { Report("실행기를 시작하지 못했습니다.", e); return 1; }
                finally { mutex.ReleaseMutex(); }
            }
        }
    }

    internal static void Log(string message)
    {
        lock (LogLock)
        {
            try
            {
                Directory.CreateDirectory(Logs);
                var file = Path.Combine(Logs, "launcher.log");
                if (File.Exists(file) && new FileInfo(file).Length > 2 * 1024 * 1024)
                {
                    var previous = file + ".1";
                    if (File.Exists(previous)) File.Delete(previous);
                    File.Move(file, previous);
                }
                File.AppendAllText(file, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss ") + message + Environment.NewLine, Encoding.UTF8);
            }
            catch { /* A read-only folder must not prevent reporting the original error. */ }
        }
    }

    internal static void Report(string message, Exception error)
    {
        Log(message + " " + error.GetType().Name + ": " + error.Message);
        if (!Quiet) MessageBox.Show(message + "\n\n폴더 위치와 파일을 확인하세요. 자세한 내용: logs\\launcher.log", "Mayhem Pocket", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
}

internal sealed class Instance
{
    public int port { get; set; }
    public string token { get; set; }
    public int pid { get; set; }
}

internal sealed class Status
{
    public string token { get; set; }
}

internal sealed class TrayServer : ApplicationContext
{
    private readonly EventWaitHandle openSignal;
    private readonly EventWaitHandle stopSignal;
    private readonly NotifyIcon tray;
    private readonly ContextMenuStrip menu;
    private readonly ToolStripMenuItem stateItem;
    private readonly ToolStripMenuItem openItem;
    private readonly ToolStripMenuItem stopItem;
    private readonly System.Windows.Forms.Timer timer;
    private readonly HttpClient http;
    private readonly Icon startingIcon;
    private readonly Icon runningIcon;
    private readonly JavaScriptSerializer json = new JavaScriptSerializer();
    private Process server;
    private OwnedJob job;
    private Instance instance;
    private bool starting = true;
    private bool stopping;
    private bool monitoring;
    private bool pendingOpen;
    private bool closed;
    private int failures;
    private DateTime lastPoll = DateTime.MinValue;
    private bool pendingStop;

    internal TrayServer(EventWaitHandle signal, EventWaitHandle stop)
    {
        openSignal = signal;
        stopSignal = stop;
        http = new HttpClient(new HttpClientHandler { UseProxy = false });
        http.Timeout = TimeSpan.FromSeconds(2);
        startingIcon = MakeIcon(Color.FromArgb(132, 128, 145));
        runningIcon = MakeIcon(Color.FromArgb(125, 82, 195));
        menu = new ContextMenuStrip();
        stateItem = new ToolStripMenuItem("서버 시작 중…") { Enabled = false };
        openItem = new ToolStripMenuItem("화면 열기") { Enabled = false };
        openItem.Click += delegate { OpenBrowser(); };
        var logsItem = new ToolStripMenuItem("로그 폴더 열기");
        logsItem.Click += delegate
        {
            try { Directory.CreateDirectory(Program.Logs); Process.Start(new ProcessStartInfo(Program.Logs) { UseShellExecute = true }); }
            catch (Exception e) { Program.Report("로그 폴더를 열지 못했습니다.", e); }
        };
        stopItem = new ToolStripMenuItem("서버 종료") { Enabled = false };
        stopItem.Click += async delegate { await StopServer(); };
        menu.Items.AddRange(new ToolStripItem[] { stateItem, new ToolStripSeparator(), openItem, logsItem, new ToolStripSeparator(), stopItem });
        tray = new NotifyIcon { Text = "Mayhem Pocket · 시작 중", Icon = startingIcon, ContextMenuStrip = menu, Visible = true };
        tray.DoubleClick += delegate { if (starting) pendingOpen = true; else OpenBrowser(); };
        timer = new System.Windows.Forms.Timer { Interval = 100 };
        timer.Tick += Tick;
        timer.Start();
    }

    private async void Tick(object sender, EventArgs args)
    {
        if (closed) return;
        if (openSignal.WaitOne(0)) pendingOpen = true;
        if (stopSignal.WaitOne(0)) pendingStop = true;
        if (starting)
        {
            // Run initialization only after the WinForms message loop has installed its synchronization context.
            if (monitoring) return;
            monitoring = true;
            try { await StartServer(); }
            catch (Exception e) { Program.Result = 1; Program.Report("로컬 서버를 시작하지 못했습니다.", e); ExitThread(); }
            finally { starting = false; monitoring = false; }
            return;
        }
        if (stopping || monitoring) return;
        if (pendingStop) { pendingStop = false; await StopServer(); return; }
        if (pendingOpen) { pendingOpen = false; OpenBrowser(); }
        if (DateTime.UtcNow - lastPoll < TimeSpan.FromSeconds(2)) return;
        lastPoll = DateTime.UtcNow;
        monitoring = true;
        try
        {
            if (server != null && server.HasExited)
            {
                if (server.ExitCode != 0) Program.Report("서버가 예상하지 못하게 종료되었습니다.", new Exception("서버 종료 코드 " + server.ExitCode));
                ExitThread();
                return;
            }
            if (await Matches(instance))
            {
                failures = 0;
                SetRunning();
            }
            else
            {
                failures++;
                tray.Icon = startingIcon;
                tray.Text = "Mayhem Pocket · 서버 연결 확인 중";
                stateItem.Text = "서버 연결 확인 중…";
                openItem.Enabled = false;
                if (failures >= 3)
                {
                    // A web shutdown removes instance.json. Never leave a stale running tray icon behind.
                    if (!File.Exists(Path.Combine(Program.Root, "cache", "instance.json"))) ExitThread();
                    else
                    {
                        Program.Report("서버 연결이 끊어졌습니다. 다시 실행해 주세요.", new Exception("상태 확인 실패"));
                        ExitThread();
                    }
                }
            }
        }
        catch (Exception e) { Program.Log("상태 확인: " + e.Message); }
        finally { monitoring = false; }
    }

    private async Task StartServer()
    {
        var node = Path.Combine(Program.Root, "runtime", "node.exe");
        var entry = Path.Combine(Program.Root, "app", "server", "index.js");
        if (!File.Exists(node) || !File.Exists(entry)) throw new FileNotFoundException("압축을 모두 푼 실행용 ZIP이 필요합니다.");
        var env = Path.Combine(Program.Root, ".env");
        if (!File.Exists(env)) File.Copy(Path.Combine(Program.Root, ".env.example"), env, false);
        Directory.CreateDirectory(Program.Logs);
        instance = ReadInstance();
        if (!await Matches(instance))
        {
            job = new OwnedJob();
            var info = new ProcessStartInfo(node, "\"" + entry + "\"")
            {
                WorkingDirectory = Program.Root,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8
            };
            server = new Process { StartInfo = info };
            server.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) Program.Log(e.Data); };
            server.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) Program.Log(e.Data); };
            if (!server.Start()) throw new Exception("Node 서버 프로세스를 시작하지 못했습니다.");
            try { job.Assign(server); }
            catch { if (!server.HasExited) server.Kill(); throw; }
            server.BeginOutputReadLine();
            server.BeginErrorReadLine();
            var ready = false;
            var deadline = DateTime.UtcNow.AddSeconds(40);
            while (DateTime.UtcNow < deadline)
            {
                if (server.HasExited) throw new Exception("서버가 시작 중 종료되었습니다. 코드 " + server.ExitCode);
                instance = ReadInstance();
                if (instance != null && instance.pid == server.Id && await Matches(instance)) { ready = true; break; }
                await Task.Delay(150);
            }
            if (!ready) throw new TimeoutException("서버 시작 제한 시간을 초과했습니다.");
        }
        SetRunning();
        stopItem.Enabled = true;
        pendingOpen = false;
        OpenBrowser();
        Program.Log("트레이 실행기 준비 완료");
    }

    private void SetRunning()
    {
        tray.Icon = runningIcon;
        tray.Text = "Mayhem Pocket · 서버 실행 중";
        stateItem.Text = "서버 실행 중";
        openItem.Enabled = true;
    }

    private Instance ReadInstance()
    {
        try
        {
            var value = json.Deserialize<Instance>(File.ReadAllText(Path.Combine(Program.Root, "cache", "instance.json")));
            return value != null && value.port > 0 && value.port <= 65535 && !String.IsNullOrEmpty(value.token) ? value : null;
        }
        catch { return null; }
    }

    private async Task<bool> Matches(Instance candidate)
    {
        if (candidate == null) return false;
        try
        {
            var payload = await http.GetStringAsync(Origin(candidate) + "/api/status");
            return json.Deserialize<Status>(payload).token == candidate.token;
        }
        catch { return false; }
    }

    private static string Origin(Instance value) { return "http://127.0.0.1:" + value.port; }

    private void OpenBrowser()
    {
        if (instance == null || stopping || closed) return;
        if (Program.Quiet) { Program.Log("테스트 모드: 브라우저 열기 요청 확인"); return; }
        try { Process.Start(new ProcessStartInfo(Origin(instance)) { UseShellExecute = true }); }
        catch (Exception e) { Program.Report("브라우저를 열지 못했습니다. 트레이에서 다시 시도하세요.", e); }
    }

    private async Task StopServer()
    {
        if (stopping) return;
        stopping = true;
        stopItem.Enabled = false;
        openItem.Enabled = false;
        stateItem.Text = "서버 종료 중…";
        try
        {
            if (await Matches(instance))
            {
                using (var request = new HttpRequestMessage(HttpMethod.Post, Origin(instance) + "/api/shutdown"))
                {
                    request.Headers.Add("x-session-token", instance.token);
                    request.Headers.Add("Origin", Origin(instance));
                    using (var response = await http.SendAsync(request)) response.EnsureSuccessStatusCode();
                }
            }
            for (var i = 0; i < 30; i++)
            {
                if ((server != null && server.HasExited) || !await Matches(instance)) { ExitThread(); return; }
                await Task.Delay(100);
            }
            if (server != null) { Program.Log("종료 응답 지연: 소유한 서버 프로세스 정리"); ExitThread(); return; }
            throw new Exception("기존 서버의 종료를 확인할 수 없습니다.");
        }
        catch (Exception e)
        {
            if (server != null) { Program.Log("종료 실패: 소유한 서버 프로세스 정리. " + e.Message); ExitThread(); return; }
            Program.Report("서버를 종료하지 못했습니다. 트레이에서 다시 시도하세요.", e);
            stopping = false;
            stopItem.Enabled = true;
        }
    }

    protected override void ExitThreadCore()
    {
        if (closed) return;
        closed = true;
        timer.Stop();
        tray.Visible = false;
        if (job != null) { job.Dispose(); job = null; }
        base.ExitThreadCore();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            timer.Dispose();
            tray.Dispose();
            menu.Dispose();
            startingIcon.Dispose();
            runningIcon.Dispose();
            http.Dispose();
            if (job != null) job.Dispose();
            if (server != null) server.Dispose();
        }
        base.Dispose(disposing);
    }

    private static Icon MakeIcon(Color color)
    {
        using (var bitmap = new Bitmap(32, 32))
        {
            using (var graphics = Graphics.FromImage(bitmap))
            using (var brush = new SolidBrush(color))
            using (var font = new Font("Segoe UI", 18, FontStyle.Bold, GraphicsUnit.Pixel))
            {
                graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                graphics.FillEllipse(brush, 1, 1, 30, 30);
                graphics.DrawString("P", font, Brushes.White, 9, 5);
            }
            var handle = bitmap.GetHicon();
            try { using (var icon = Icon.FromHandle(handle)) return (Icon)icon.Clone(); }
            finally { DestroyIcon(handle); }
        }
    }
    [DllImport("user32.dll")] private static extern bool DestroyIcon(IntPtr handle);
}

// Only the Node process started by this launcher is assigned. Closing/crashing the
// launcher closes the job handle and prevents an orphan server from staying alive.
internal sealed class OwnedJob : IDisposable
{
    private IntPtr handle;
    internal OwnedJob()
    {
        handle = CreateJobObject(IntPtr.Zero, null);
        if (handle == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
        var limits = new ExtendedLimits();
        limits.BasicLimitInformation.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if (!SetInformationJobObject(handle, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))))
        {
            var error = Marshal.GetLastWin32Error();
            Dispose();
            throw new System.ComponentModel.Win32Exception(error);
        }
    }
    internal void Assign(Process process)
    {
        if (!AssignProcessToJobObject(handle, process.Handle)) throw new System.ComponentModel.Win32Exception();
    }
    public void Dispose() { if (handle != IntPtr.Zero) { CloseHandle(handle); handle = IntPtr.Zero; } }
    [StructLayout(LayoutKind.Sequential)] private struct BasicLimits
    {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)] private struct IoCounters
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }
    [StructLayout(LayoutKind.Sequential)] private struct ExtendedLimits
    {
        public BasicLimits BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimits limits, uint length);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr value);
}
