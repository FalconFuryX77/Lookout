using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace StartupSignal
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
                Application.Run(new SignalContext(startHidden));
            }
            catch (Exception ex)
            {
                try { File.AppendAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "startup-signal-error.log"), ex.ToString() + Environment.NewLine); }
                catch { }
                MessageBox.Show(ex.ToString(), "Startup Signal error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }

    internal sealed class SignalContext : ApplicationContext
    {
        private const string AppUrl = "http://127.0.0.1:4173/";
        private readonly string _appDir;
        private readonly Form _form;
        private readonly WebView2 _browser;
        private readonly NotifyIcon _tray;
        private Process _server;
        private bool _exiting;

        public SignalContext(bool startHidden)
        {
            _appDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            _form = new Form
            {
                Text = "Startup Signal",
                Icon = SystemIcons.Application,
                StartPosition = FormStartPosition.CenterScreen,
                Width = 1420,
                Height = 920,
                MinimumSize = new Size(720, 620),
                BackColor = Color.FromArgb(16, 26, 25),
                ShowInTaskbar = !startHidden
            };
            _browser = new WebView2 { Dock = DockStyle.Fill };
            _form.Controls.Add(_browser);
            _form.FormClosing += OnFormClosing;
            _form.Shown += async (sender, args) => await InitializeAsync();
            MainForm = _form;

            var menu = new ContextMenuStrip();
            menu.Items.Add("Open Startup Signal", null, (sender, args) => ShowWindow());
            menu.Items.Add("Scan now", null, (sender, args) => ScanNow());
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Exit Startup Signal", null, (sender, args) => ExitApp());
            _tray = new NotifyIcon
            {
                Icon = SystemIcons.Application,
                Text = "Startup Signal is scanning in the background",
                ContextMenuStrip = menu,
                Visible = true
            };
            _tray.DoubleClick += (sender, args) => ShowWindow();
            _form.Show();
            if (startHidden) _form.Hide();
        }

        private async Task InitializeAsync()
        {
            try
            {
                await StartScannerAsync();
                await _browser.EnsureCoreWebView2Async();
                _browser.CoreWebView2.Navigate(AppUrl);
            }
            catch (Exception ex)
            {
                MessageBox.Show("Startup Signal could not start the scanner.\r\n\r\n" + ex.Message, "Startup Signal", MessageBoxButtons.OK, MessageBoxIcon.Error);
                ExitApp();
            }
        }

        private async Task StartScannerAsync()
        {
            string node = FindNode();
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
            await Task.Delay(1500);
            if (_server.HasExited)
            {
                string details = String.Empty;
                try { details = File.ReadAllText(Path.Combine(_appDir, "startup-signal-desktop.log")); }
                catch { }
                if (details.IndexOf("EADDRINUSE", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    _server = null;
                    return;
                }
                throw new InvalidOperationException("The scanner stopped during startup. See startup-signal-desktop.log for details.");
            }
        }

        private static string FindNode()
        {
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
            throw new FileNotFoundException("Node.js 20 or newer was not found. Install Node.js and reopen Startup Signal.");
        }

        private void OnFormClosing(object sender, FormClosingEventArgs e)
        {
            if (_exiting) return;
            e.Cancel = true;
            _form.Hide();
            _tray.ShowBalloonTip(2500, "Startup Signal is still running", "The scanner is in the notification area. Click its icon to reopen the dashboard.", ToolTipIcon.Info);
        }

        private void ShowWindow()
        {
            _form.ShowInTaskbar = true;
            if (_form.WindowState == FormWindowState.Minimized) _form.WindowState = FormWindowState.Normal;
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
            try { File.AppendAllText(Path.Combine(_appDir, "startup-signal-desktop.log"), DateTime.Now.ToString("s") + " " + text + Environment.NewLine); }
            catch { }
        }
    }
}
