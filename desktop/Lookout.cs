using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Lookout
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            try
            {
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                bool startHidden = Array.Exists(Environment.GetCommandLineArgs(), arg => String.Equals(arg, "--background", StringComparison.OrdinalIgnoreCase));
                Application.Run(new LookoutContext(startHidden));
            }
            catch (Exception ex)
            {
                try { File.AppendAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "lookout-error.log"), ex.ToString() + Environment.NewLine); }
                catch { }
                MessageBox.Show(ex.ToString(), "Lookout error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }

    internal sealed class LookoutContext : ApplicationContext
    {
        // The exe carries lookout.ico (built with /win32icon); reuse it for the window and the tray.
        private static readonly Icon AppIcon = LoadIcon();
        private static Icon LoadIcon()
        {
            try { return Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application; }
            catch { return SystemIcons.Application; }
        }
        private const string AppUrl = "http://127.0.0.1:4173/";
        private readonly string _appDir;
        private readonly Form _form;
        private readonly WebView2 _browser;
        private readonly NotifyIcon _tray;
        private Process _server;
        private bool _exiting;

        public LookoutContext(bool startHidden)
        {
            _appDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            _form = new Form
            {
                Text = "Lookout",
                Icon = AppIcon,
                StartPosition = FormStartPosition.CenterScreen,
                Width = 1420,
                Height = 920,
                MinimumSize = new Size(720, 620),
                WindowState = FormWindowState.Maximized, // always opens filling the screen
                BackColor = Color.FromArgb(9, 9, 11),
                ShowInTaskbar = !startHidden
            };
            _browser = new WebView2 { Dock = DockStyle.Fill };
            _form.Controls.Add(_browser);
            _form.FormClosing += OnFormClosing;
            _form.Shown += async (sender, args) => await InitializeAsync();
            MainForm = _form;

            var menu = new ContextMenuStrip();
            menu.Items.Add("Open Lookout", null, (sender, args) => ShowWindow());
            menu.Items.Add("Scan now", null, (sender, args) => ScanNow());
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Exit Lookout", null, (sender, args) => ExitApp());
            _tray = new NotifyIcon
            {
                Icon = AppIcon,
                Text = "Lookout is scanning in the background",
                ContextMenuStrip = menu,
                Visible = true
            };
            _tray.DoubleClick += (sender, args) => ShowWindow();
            _form.Show();
            if (startHidden) _form.Hide();
        }

        private const string LoadingHtml = "<!doctype html><html><body style=\"margin:0;height:100vh;display:grid;place-items:center;background:#09090b;color:#a1a1aa;font:14px 'Segoe UI',sans-serif\"><div style=\"text-align:center\"><div style=\"width:28px;height:28px;margin:0 auto 14px;border:2px solid #26262b;border-top-color:#c6f432;border-radius:50%;animation:s 0.8s linear infinite\"></div>Starting Lookout&hellip;<style>@keyframes s{to{transform:rotate(360deg)}}</style></div></body></html>";

        private async Task InitializeAsync()
        {
            try
            {
                await _browser.EnsureCoreWebView2Async();
                // Links never open a second Lookout window: listings, company pages and email go to the
                // default browser and mail app. Only Lookout's own pages stay in this window.
                _browser.CoreWebView2.NewWindowRequested += (sender, e) =>
                {
                    e.Handled = true;
                    OpenOutside(e.Uri);
                };
                _browser.CoreWebView2.NavigationStarting += (sender, e) =>
                {
                    if (!IsOutsideLink(e.Uri)) return;
                    e.Cancel = true;
                    OpenOutside(e.Uri);
                };
                _browser.CoreWebView2.NavigateToString(LoadingHtml);
                // Reuse a scanner that is already running (second launch, or started elsewhere).
                if (!await IsServerReadyAsync())
                {
                    StartScanner();
                    await WaitForServerAsync(TimeSpan.FromSeconds(90));
                }
                _browser.CoreWebView2.Navigate(AppUrl);
            }
            catch (Exception ex)
            {
                MessageBox.Show("Lookout could not start the scanner.\r\n\r\n" + ex.Message, "Lookout", MessageBoxButtons.OK, MessageBoxIcon.Error);
                ExitApp();
            }
        }

        // A web or mail link that is not one of Lookout's own pages.
        private static bool IsOutsideLink(string uri)
        {
            Uri u;
            if (!Uri.TryCreate(uri, UriKind.Absolute, out u)) return false;
            if (u.Scheme == Uri.UriSchemeMailto) return true;
            if (u.Scheme != Uri.UriSchemeHttp && u.Scheme != Uri.UriSchemeHttps) return false; // the loading screen, about:blank
            bool local = u.IsLoopback && u.Port == 4173;
            return !local;
        }

        private void OpenOutside(string uri)
        {
            Uri u;
            if (!Uri.TryCreate(uri, UriKind.Absolute, out u)) return;
            if (u.Scheme != Uri.UriSchemeHttp && u.Scheme != Uri.UriSchemeHttps && u.Scheme != Uri.UriSchemeMailto) return;
            if (!IsOutsideLink(uri)) { _browser.CoreWebView2.Navigate(uri); return; } // one of Lookout's own pages: keep it here
            try { Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true }); } // as the page wrote it, so a mail's subject and body stay intact
            catch (Exception ex) { Log("Could not open " + u.Host + ": " + ex.Message); }
        }

        private static async Task<bool> IsServerReadyAsync()
        {
            try
            {
                var request = (HttpWebRequest)WebRequest.Create(AppUrl + "api/meta");
                request.Timeout = 2000;
                request.Proxy = null;
                using (var response = (HttpWebResponse)await Task.Run(() => request.GetResponse()))
                    return response.StatusCode == HttpStatusCode.OK;
            }
            catch { return false; }
        }

        // The scanner loads its saved jobs before it listens (a few seconds on a big database), so poll until it answers.
        private async Task WaitForServerAsync(TimeSpan timeout)
        {
            var deadline = DateTime.UtcNow + timeout;
            while (DateTime.UtcNow < deadline)
            {
                if (await IsServerReadyAsync()) return;
                if (_server != null && _server.HasExited)
                {
                    if (await IsServerReadyAsync()) { _server = null; return; } // another instance won the port
                    throw new InvalidOperationException("The scanner stopped during startup. See lookout-desktop.log in the Lookout folder for details.");
                }
                await Task.Delay(400);
            }
            throw new TimeoutException("The scanner did not respond within " + (int)timeout.TotalSeconds + " seconds. See lookout-desktop.log for details.");
        }

        private void StartScanner()
        {
            string node = FindNode(_appDir);
            try { var log = new FileInfo(Path.Combine(_appDir, "lookout-desktop.log")); if (log.Exists && log.Length > 1000000) log.Delete(); } catch { }
            var start = new ProcessStartInfo
            {
                FileName = node,
                Arguments = "\"" + Path.Combine(_appDir, "server.mjs") + "\"",
                WorkingDirectory = _appDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            _server = new Process { StartInfo = start, EnableRaisingEvents = true };
            _server.OutputDataReceived += (sender, args) => { if (!String.IsNullOrEmpty(args.Data)) Log(args.Data); };
            _server.ErrorDataReceived += (sender, args) => { if (!String.IsNullOrEmpty(args.Data)) Log(args.Data); };
            if (!_server.Start()) throw new InvalidOperationException("Node.js could not be started.");
            _server.BeginOutputReadLine();
            _server.BeginErrorReadLine();
        }

        private static string FindNode(string appDir)
        {
            // The copy of Node.js that ships with Lookout comes first: the app then needs nothing installed, and a
            // future Node.js that changes something cannot break it.
            string bundled = Path.Combine(appDir, "runtime", "node.exe");
            if (File.Exists(bundled)) return bundled;
            string[] candidates = {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe")
            };
            foreach (string candidate in candidates) if (File.Exists(candidate)) return candidate;
            foreach (string folder in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator))
            {
                try { string candidate = Path.Combine(folder.Trim(), "node.exe"); if (File.Exists(candidate)) return candidate; }
                catch { }
            }
            throw new FileNotFoundException("Node.js was not found. The runtime folder that comes with Lookout is missing; download Lookout again, or install Node.js 22 or newer and reopen it.");
        }

        private void OnFormClosing(object sender, FormClosingEventArgs e)
        {
            if (_exiting) return;
            e.Cancel = true;
            _form.Hide();
            _tray.ShowBalloonTip(2500, "Lookout is still running", "The scanner is in the notification area. Click its icon to reopen the dashboard.", ToolTipIcon.Info);
        }

        private void ShowWindow()
        {
            _form.ShowInTaskbar = true;
            _form.WindowState = FormWindowState.Maximized; // reopened from the tray: full screen again
            _form.Show();
            _form.Activate();
        }

        private async void ScanNow()
        {
            try
            {
                var request = (HttpWebRequest)WebRequest.Create(AppUrl + "api/scan");
                request.Method = "POST";
                request.Timeout = 120000;
                using (var response = (HttpWebResponse)await Task.Run(() => request.GetResponse())) { }
            }
            catch (Exception ex)
            {
                _tray.ShowBalloonTip(3000, "Scan could not start", ex.Message, ToolTipIcon.Error);
            }
        }

        private void ExitApp()
        {
            if (_exiting) return;
            _exiting = true;
            _tray.Visible = false;
            _tray.Dispose();
            try { if (_server != null && !_server.HasExited) _server.Kill(); }
            catch { }
            _form.Close();
            ExitThread();
        }

        private void Log(string text)
        {
            try { File.AppendAllText(Path.Combine(_appDir, "lookout-desktop.log"), DateTime.Now.ToString("s") + " " + text + Environment.NewLine); }
            catch { }
        }
    }
}
