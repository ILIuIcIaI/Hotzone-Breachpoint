// Hotzone Breachpoint – schlanker Windows-Launcher.
// Zeigt das Spiel in einem eigenen Fenster ueber die in Windows enthaltene WebView2-Laufzeit
// und liefert die Spieldateien ueber einen lokalen Mini-Server (nur 127.0.0.1) aus.
// Kompiliert mit dem in Windows enthaltenen C#-Compiler (.NET Framework 4), keine weiteren Abhaengigkeiten.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: System.Reflection.AssemblyTitle("Hotzone Breachpoint")]
[assembly: System.Reflection.AssemblyProduct("Hotzone Breachpoint")]
[assembly: System.Reflection.AssemblyDescription("Hotzone Breachpoint")]
[assembly: System.Reflection.AssemblyVersion("0.1.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("0.1.0.0")]

namespace HotzoneBreachpoint
{
    // ---------- WebView2 COM-Schnittstellen (nur die benoetigten Methoden, Reihenfolge = vtable) ----------
    [ComImport, Guid("4e8a3389-c9d8-4bd2-b6b5-124fee6cc14d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IEnvCompleted { [PreserveSig] int Invoke(int hr, IntPtr env); }

    [ComImport, Guid("6c4819f3-c9b7-4260-8127-c9f5bde7f68c"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IControllerCompleted { [PreserveSig] int Invoke(int hr, IntPtr controller); }

    [ComImport, Guid("b96d755e-0319-4e92-a296-23436f46a1fc"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface ICoreWebView2Environment
    {
        [PreserveSig] int CreateCoreWebView2Controller(IntPtr parentWindow, IControllerCompleted handler);
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int left, top, right, bottom; }

    [ComImport, Guid("4d00c0d1-9434-4eb6-8078-8697a560334f"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface ICoreWebView2Controller
    {
        [PreserveSig] int get_IsVisible(out int v);
        [PreserveSig] int put_IsVisible(int v);
        [PreserveSig] int get_Bounds(out RECT r);
        [PreserveSig] int put_Bounds(RECT r);
        [PreserveSig] int s5(); [PreserveSig] int s6(); [PreserveSig] int s7(); [PreserveSig] int s8(); [PreserveSig] int s9();
        [PreserveSig] int MoveFocus(int reason);
        [PreserveSig] int s11(); [PreserveSig] int s12(); [PreserveSig] int s13(); [PreserveSig] int s14(); [PreserveSig] int s15();
        [PreserveSig] int s16(); [PreserveSig] int s17(); [PreserveSig] int s18(); [PreserveSig] int s19(); [PreserveSig] int s20();
        [PreserveSig] int NotifyParentWindowPositionChanged();
        [PreserveSig] int Close();
        [PreserveSig] int get_CoreWebView2(out IntPtr webview);
    }

    [ComImport, Guid("76eceacb-0462-4d94-ac83-423a6793775e"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface ICoreWebView2
    {
        [PreserveSig] int get_Settings(out IntPtr settings);
        [PreserveSig] int get_Source(out IntPtr uri);
        [PreserveSig] int Navigate([MarshalAs(UnmanagedType.LPWStr)] string uri);
    }

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate int CreateEnvFn([MarshalAs(UnmanagedType.U1)] bool checkRunningInstance, int runtimeType,
        [MarshalAs(UnmanagedType.LPWStr)] string userDataFolder, IntPtr options, IEnvCompleted handler);

    static class Native
    {
        [DllImport("kernel32", CharSet = CharSet.Unicode, SetLastError = true)] public static extern IntPtr LoadLibraryW(string path);
        [DllImport("kernel32", CharSet = CharSet.Ansi)] public static extern IntPtr GetProcAddress(IntPtr mod, string name);
    }

    [ComVisible(true), ClassInterface(ClassInterfaceType.None)]
    public class EnvHandler : IEnvCompleted
    {
        readonly GameForm form;
        public EnvHandler(GameForm f) { form = f; }
        public int Invoke(int hr, IntPtr env) { form.OnEnvironment(hr, env); return 0; }
    }

    [ComVisible(true), ClassInterface(ClassInterfaceType.None)]
    public class ControllerHandler : IControllerCompleted
    {
        readonly GameForm form;
        public ControllerHandler(GameForm f) { form = f; }
        public int Invoke(int hr, IntPtr controller) { form.OnController(hr, controller); return 0; }
    }

    // ---------- Lokaler Dateiserver ----------
    class MiniServer
    {
        readonly string root;
        readonly TcpListener listener;
        public int Port;
        public volatile string ShotFile;
        public volatile bool ShotDone;
        static readonly Dictionary<string, string> Mime = new Dictionary<string, string> {
            { ".html", "text/html; charset=utf-8" }, { ".js", "text/javascript; charset=utf-8" }, { ".css", "text/css" },
            { ".json", "application/json" }, { ".png", "image/png" }, { ".jpg", "image/jpeg" }, { ".svg", "image/svg+xml" }, { ".ico", "image/x-icon" },
        };
        public MiniServer(string rootDir)
        {
            root = Path.GetFullPath(rootDir);
            listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            Port = ((IPEndPoint)listener.LocalEndpoint).Port;
            var t = new Thread(Loop); t.IsBackground = true; t.Start();
        }
        void Loop()
        {
            while (true)
            {
                TcpClient c;
                try { c = listener.AcceptTcpClient(); } catch { return; }
                ThreadPool.QueueUserWorkItem(_ => Handle(c));
            }
        }
        void Handle(TcpClient c)
        {
            try
            {
                using (c)
                using (var s = c.GetStream())
                {
                    var buf = new byte[8192]; int n = 0;
                    while (n < buf.Length)
                    {
                        int r = s.Read(buf, n, buf.Length - n); if (r <= 0) break; n += r;
                        if (Encoding.ASCII.GetString(buf, 0, n).Contains("\r\n\r\n")) break;
                    }
                    string req = Encoding.ASCII.GetString(buf, 0, n);
                    if (ShotFile != null && req.StartsWith("POST /__shot"))
                    {
                        // Selbsttest-Bild (Base64-JPEG im Rumpf)
                        int hEnd = req.IndexOf("\r\n\r\n") + 4;
                        int len = 0;
                        foreach (var line in req.Substring(0, hEnd).Split('\n'))
                            if (line.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase)) len = int.Parse(line.Substring(15).Trim());
                        var ms = new MemoryStream(); ms.Write(buf, hEnd, n - hEnd);
                        while (ms.Length < len) { int r = s.Read(buf, 0, buf.Length); if (r <= 0) break; ms.Write(buf, 0, r); }
                        string b64 = Encoding.ASCII.GetString(ms.ToArray());
                        File.WriteAllBytes(ShotFile, Convert.FromBase64String(b64.Substring(b64.IndexOf(',') + 1)));
                        var ok = Encoding.ASCII.GetBytes("HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n");
                        s.Write(ok, 0, ok.Length);
                        ShotDone = true;
                        return;
                    }
                    string[] parts = req.Split(' ');
                    string path = parts.Length > 1 ? parts[1] : "/";
                    int q = path.IndexOf('?'); if (q >= 0) path = path.Substring(0, q);
                    path = Uri.UnescapeDataString(path);
                    if (path == "/") path = "/index.html";
                    string file = Path.GetFullPath(Path.Combine(root, path.TrimStart('/').Replace('/', Path.DirectorySeparatorChar)));
                    byte[] body; string status = "200 OK", type = "application/octet-stream";
                    if (!file.StartsWith(root, StringComparison.OrdinalIgnoreCase) || !File.Exists(file)) { status = "404 Not Found"; body = new byte[0]; }
                    else
                    {
                        body = File.ReadAllBytes(file);
                        string ext = Path.GetExtension(file).ToLowerInvariant();
                        if (Mime.ContainsKey(ext)) type = Mime[ext];
                    }
                    string head = "HTTP/1.1 " + status + "\r\nContent-Type: " + type + "\r\nContent-Length: " + body.Length + "\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n";
                    var hb = Encoding.ASCII.GetBytes(head);
                    s.Write(hb, 0, hb.Length); s.Write(body, 0, body.Length);
                }
            }
            catch { }
        }
    }

    // ---------- Fenster ----------
    public class GameForm : Form
    {
        ICoreWebView2Controller controller;
        ICoreWebView2 webview;
        readonly string url;
        readonly string runtimeDll;
        readonly string dataDir;
        // Handler am Leben halten
        EnvHandler envHandler; ControllerHandler ctlHandler;

        public GameForm(string url, string runtimeDll, string dataDir)
        {
            this.url = url; this.runtimeDll = runtimeDll; this.dataDir = dataDir;
            Text = "Hotzone Breachpoint";
            BackColor = Color.FromArgb(5, 7, 10);
            ClientSize = new Size(1600, 900);
            StartPosition = FormStartPosition.CenterScreen;
            WindowState = FormWindowState.Maximized;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            Load += (s, e) => StartWebView();
            Resize += (s, e) => SyncBounds();
            Move += (s, e) => { if (controller != null) controller.NotifyParentWindowPositionChanged(); };
            Activated += (s, e) => { if (controller != null) controller.MoveFocus(0); };
        }

        void StartWebView()
        {
            IntPtr mod = Native.LoadLibraryW(runtimeDll);
            if (mod == IntPtr.Zero) { Fail("Die WebView2-Laufzeit konnte nicht geladen werden."); return; }
            IntPtr fn = Native.GetProcAddress(mod, "CreateWebViewEnvironmentWithOptionsInternal");
            if (fn == IntPtr.Zero) { Fail("Die installierte WebView2-Laufzeit ist nicht kompatibel."); return; }
            var create = (CreateEnvFn)Marshal.GetDelegateForFunctionPointer(fn, typeof(CreateEnvFn));
            envHandler = new EnvHandler(this);
            int hr = create(true, 0, dataDir, IntPtr.Zero, envHandler);
            if (hr < 0) Fail("WebView2 konnte nicht gestartet werden (Fehler 0x" + hr.ToString("X8") + ").");
        }

        public void OnEnvironment(int hr, IntPtr envPtr)
        {
            if (hr < 0 || envPtr == IntPtr.Zero) { Fail("WebView2-Umgebung fehlgeschlagen (0x" + hr.ToString("X8") + ")."); return; }
            var env = (ICoreWebView2Environment)Marshal.GetObjectForIUnknown(envPtr);
            ctlHandler = new ControllerHandler(this);
            env.CreateCoreWebView2Controller(Handle, ctlHandler);
        }

        public void OnController(int hr, IntPtr ctlPtr)
        {
            if (hr < 0 || ctlPtr == IntPtr.Zero) { Fail("WebView2-Fenster fehlgeschlagen (0x" + hr.ToString("X8") + ")."); return; }
            controller = (ICoreWebView2Controller)Marshal.GetObjectForIUnknown(ctlPtr);
            IntPtr wv;
            controller.get_CoreWebView2(out wv);
            webview = (ICoreWebView2)Marshal.GetObjectForIUnknown(wv);
            SyncBounds();
            controller.put_IsVisible(1);
            webview.Navigate(url);
            controller.MoveFocus(0);
        }

        void SyncBounds()
        {
            if (controller == null) return;
            var r = new RECT { left = 0, top = 0, right = ClientSize.Width, bottom = ClientSize.Height };
            controller.put_Bounds(r);
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (controller != null) { try { controller.Close(); } catch { } }
            base.OnFormClosing(e);
        }

        void Fail(string msg)
        {
            MessageBox.Show(msg + "\n\nBitte die Microsoft-Edge-WebView2-Laufzeit installieren (bei Windows 11 bereits enthalten):\nhttps://developer.microsoft.com/microsoft-edge/webview2/",
                "Hotzone Breachpoint", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    static class Program
    {
        static string FindRuntime()
        {
            var bases = new List<string>();
            string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            bases.Add(Path.Combine(pf86, @"Microsoft\EdgeWebView\Application"));
            bases.Add(Path.Combine(pf, @"Microsoft\EdgeWebView\Application"));
            bases.Add(Path.Combine(local, @"Microsoft\EdgeWebView\Application"));
            string arch = Environment.Is64BitProcess ? "x64" : "x86";
            string best = null; Version bestV = null;
            foreach (var b in bases)
            {
                if (!Directory.Exists(b)) continue;
                foreach (var d in Directory.GetDirectories(b))
                {
                    Version v;
                    if (!Version.TryParse(Path.GetFileName(d), out v)) continue;
                    string dll = Path.Combine(d, @"EBWebView\" + arch + @"\EmbeddedBrowserWebView.dll");
                    if (File.Exists(dll) && (bestV == null || v > bestV)) { bestV = v; best = dll; }
                }
            }
            return best;
        }

        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            string exeDir = AppDomain.CurrentDomain.BaseDirectory;
            string gameDir = Path.Combine(exeDir, "game");
            if (!File.Exists(Path.Combine(gameDir, "index.html")))
            {
                MessageBox.Show("Spieldateien nicht gefunden. Bitte das ZIP vollständig entpacken (Ordner \"game\" muss neben der .exe liegen).", "Hotzone Breachpoint", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            string runtime = FindRuntime();
            if (runtime == null)
            {
                MessageBox.Show("Die Microsoft-Edge-WebView2-Laufzeit wurde nicht gefunden.\nBei Windows 11 ist sie enthalten; für Windows 10 gibt es sie kostenlos bei Microsoft:\nhttps://developer.microsoft.com/microsoft-edge/webview2/", "Hotzone Breachpoint", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            var server = new MiniServer(gameDir);
            string dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "HotzoneBreachpoint");
            Directory.CreateDirectory(dataDir);
            string url = "http://127.0.0.1:" + server.Port + "/index.html";
            string selftest = Environment.GetEnvironmentVariable("HB_SELFTEST");
            var form = new GameForm(url, runtime, dataDir);
            if (!string.IsNullOrEmpty(selftest))
            {
                // Selbsttest: das Spiel schickt selbst ein Bild seines Canvas (nur Spielinhalt), danach beenden
                form.WindowState = FormWindowState.Normal;
                server.ShotFile = selftest;
                url += "?selftest=1";
                form = new GameForm(url, runtime, dataDir);
                var t = new System.Windows.Forms.Timer(); t.Interval = 500;
                int ticks = 0;
                var f2 = form;
                t.Tick += (s, e) => { ticks++; if (server.ShotDone || ticks > 80) { t.Stop(); f2.Close(); } };
                form.Shown += (s, e) => t.Start();
            }
            Application.Run(form);
        }
    }
}
