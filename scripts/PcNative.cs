// PcNative.cs - Windows desktop primitives for dsh-pc-control (mouse / keyboard / windows / capture).
// Compiled once by the engine into a cached DLL; no third-party dependency.
// Everything here is ASCII on purpose: the engine reads JSON as UTF-8, the source stays encoding-proof.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class PcNative
{
    // ---------------------------------------------------------------- DPI
    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);

    public static string InitDpi()
    {
        // -4 == DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 : one physical-pixel space everywhere.
        try { SetThreadDpiAwarenessContext(new IntPtr(-4)); return "ok"; }
        catch (Exception ex) { return "warn " + ex.Message; }
    }

    // ---------------------------------------------------------------- cursor / mouse
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }

    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extra);

    const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    const uint MOUSEEVENTF_LEFTUP = 0x0004;
    const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    const uint MOUSEEVENTF_WHEEL = 0x0800;

    public static int[] Cursor()
    {
        POINT p; GetCursorPos(out p);
        return new int[] { p.X, p.Y };
    }

    public static bool Move(int x, int y) { return SetCursorPos(x, y); }

    static void Flags(string button, out uint down, out uint up)
    {
        switch ((button ?? "left").Trim().ToLowerInvariant())
        {
            case "right": down = MOUSEEVENTF_RIGHTDOWN; up = MOUSEEVENTF_RIGHTUP; return;
            case "middle": down = MOUSEEVENTF_MIDDLEDOWN; up = MOUSEEVENTF_MIDDLEUP; return;
            default: down = MOUSEEVENTF_LEFTDOWN; up = MOUSEEVENTF_LEFTUP; return;
        }
    }

    public static void Down(string button)
    {
        uint d, u; Flags(button, out d, out u);
        mouse_event(d, 0, 0, 0, UIntPtr.Zero);
    }

    public static void Up(string button)
    {
        uint d, u; Flags(button, out d, out u);
        mouse_event(u, 0, 0, 0, UIntPtr.Zero);
    }

    public static void Click(string button, int count)
    {
        int n = Math.Max(1, count);
        for (int i = 0; i < n; i++)
        {
            Down(button);
            Thread.Sleep(30);
            Up(button);
            if (i < n - 1) Thread.Sleep(40);
        }
    }

    public static void Wheel(int notches)
    {
        // One notch == 120. Positive scrolls up.
        mouse_event(MOUSEEVENTF_WHEEL, 0, 0, notches * 120, UIntPtr.Zero);
    }

    // ---------------------------------------------------------------- keyboard
    [DllImport("user32.dll")] static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr extra);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern short VkKeyScanEx(char ch, IntPtr layout);
    [DllImport("user32.dll")] static extern IntPtr GetKeyboardLayout(uint threadId);

    const uint KEYEVENTF_KEYUP = 0x0002;
    const uint KEYEVENTF_UNICODE = 0x0004;

    // SendInput with KEYEVENTF_UNICODE: the character reaches WM_CHAR directly, so an active
    // Chinese IME cannot rewrite "ok" into "ou ke" the way plain virtual-key taps can.
    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    // INPUT is a union of MOUSEINPUT/KEYBDINPUT/HARDWAREINPUT: 40 bytes on x64. Declaring the
    // real size keeps SendInput's cbSize check happy while addressing only the keyboard arm.
    [StructLayout(LayoutKind.Explicit, Size = 40)]
    struct INPUT
    {
        [FieldOffset(0)] public uint type;
        [FieldOffset(8)] public KEYBDINPUT ki;
    }

    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint n, INPUT[] inputs, int size);

    static bool SendUnicodeChar(char c)
    {
        INPUT down = new INPUT();
        down.type = 1;
        down.ki.wVk = 0;
        down.ki.wScan = (ushort)c;
        down.ki.dwFlags = KEYEVENTF_UNICODE;
        INPUT up = new INPUT();
        up.type = 1;
        up.ki.wVk = 0;
        up.ki.wScan = (ushort)c;
        up.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
        INPUT[] batch = new INPUT[] { down, up };
        return SendInput(2, batch, Marshal.SizeOf(typeof(INPUT))) == 2;
    }

    public static void KeyDownVk(int vk) { keybd_event((byte)vk, 0, 0, UIntPtr.Zero); }
    public static void KeyUpVk(int vk) { keybd_event((byte)vk, 0, KEYEVENTF_KEYUP, UIntPtr.Zero); }

    // Returns [virtualKey, shiftState]; virtualKey == -1 means the layout cannot type it.
    public static int[] VkForChar(char ch)
    {
        short scan = VkKeyScanEx(ch, GetKeyboardLayout(0));
        if (scan == -1) return new int[] { -1, 0 };
        return new int[] { scan & 0xFF, (scan >> 8) & 0xFF };
    }

    // Types any text (CJK included) as WM_CHAR input; newline and tab go out as real keys.
    public static bool TypeText(string text)
    {
        foreach (char c in text)
        {
            if (c == '\r') continue;
            if (c == '\n') { TapVk(0x0D, 0); Thread.Sleep(6); continue; }
            if (c == '\t') { TapVk(0x09, 0); Thread.Sleep(6); continue; }
            if (!SendUnicodeChar(c)) return false;
            Thread.Sleep(4);
        }
        return true;
    }

    // Unicode code point by scan code (KEYEVENTF_UNICODE needs a 16-bit scan; keybd_event takes a byte,
    // so CJK goes through the clipboard path in the engine instead of here).
    public static void TapVk(int vk, uint extraFlags)
    {
        keybd_event((byte)vk, 0, extraFlags, UIntPtr.Zero);
        keybd_event((byte)vk, 0, extraFlags | KEYEVENTF_KEYUP, UIntPtr.Zero);
    }

    // ---------------------------------------------------------------- windows
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int max);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint attach, uint attachTo, bool on);
    [DllImport("user32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    static readonly HashSet<string> SKIP_CLASSES = new HashSet<string>(new string[] { "Progman", "WorkerW", "Shell_TrayWnd", "Windows.UI.Core.CoreWindow" });

    public static int[] VirtualScreen()
    {
        return new int[]
        {
            GetSystemMetrics(76), // SM_XVIRTUALSCREEN
            GetSystemMetrics(77), // SM_YVIRTUALSCREEN
            GetSystemMetrics(78), // SM_CXVIRTUALSCREEN
            GetSystemMetrics(79)  // SM_CYVIRTUALSCREEN
        };
    }

    public static int[] Rect(IntPtr h)
    {
        RECT r; GetWindowRect(h, out r);
        return new int[] { r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top };
    }

    public static IntPtr Foreground() { return GetForegroundWindow(); }

    public static string TitleOf(IntPtr h)
    {
        if (h == IntPtr.Zero) return "";
        int len = GetWindowTextLength(h);
        if (len <= 0) return "";
        StringBuilder sb = new StringBuilder(len + 2);
        GetWindowText(h, sb, sb.Capacity);
        return sb.ToString();
    }

    public static long Ptr(IntPtr h) { return h.ToInt64(); }

    // One line per top-level window: hwnd \t pid \t min \t x \t y \t w \t h \t title \t visible
    // includeHidden also lists hidden / tray windows: an Electron client that was closed to the
    // notification area keeps its window and title, it is just not visible.
    public static string[] Windows() { return Windows(false); }

    public static string[] Windows(bool includeHidden)
    {
        List<string> lines = new List<string>();
        EnumWindows((h, l) =>
        {
            bool vis = IsWindowVisible(h);
            if (!vis && !includeHidden) return true;
            if (GetWindowTextLength(h) <= 0) return true;
            StringBuilder cls = new StringBuilder(256);
            GetClassName(h, cls, cls.Capacity);
            if (SKIP_CLASSES.Contains(cls.ToString())) return true;
            uint pid; GetWindowThreadProcessId(h, out pid);
            RECT r; GetWindowRect(h, out r);
            string title = TitleOf(h);
            lines.Add(string.Format("{0}\t{1}\t{2}\t{3}\t{4}\t{5}\t{6}\t{7}\t{8}",
                h.ToInt64(), pid, IsIconic(h) ? 1 : 0, r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top, title, vis ? 1 : 0));
            return true;
        }, IntPtr.Zero);
        return lines.ToArray();
    }

    public static bool Activate(IntPtr h)
    {
        if (h == IntPtr.Zero) return false;
        try
        {
            if (!IsWindowVisible(h)) ShowWindow(h, 5); // SW_SHOW: bring a tray/hidden window back
            if (IsIconic(h)) ShowWindow(h, 9); // SW_RESTORE
            uint fgPid = 0;
            uint targetPid = 0;
            uint fgThread = GetWindowThreadProcessId(GetForegroundWindow(), out fgPid);
            uint targetThread = GetWindowThreadProcessId(h, out targetPid);
            bool attached = false;
            if (fgThread != 0 && targetThread != 0 && fgThread != targetThread)
            {
                attached = AttachThreadInput(fgThread, targetThread, true);
            }
            bool ok = SetForegroundWindow(h);
            if (attached) AttachThreadInput(fgThread, targetThread, false);
            Thread.Sleep(60);
            return ok || Foreground() == h;
        }
        catch { return false; }
    }

    // ---------------------------------------------------------------- capture
    static void DrawGrid(Bitmap bmp, int srcW, int imageW, int originX, int originY)
    {
        double scale = srcW / (double)imageW;
        using (Graphics g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.None;
            using (Pen pen = new Pen(Color.FromArgb(110, 0, 170, 255), 1))
            using (Font font = new Font("Consolas", 8, FontStyle.Bold))
            using (Brush brush = new SolidBrush(Color.FromArgb(220, 0, 90, 160)))
            {
                int step = 100;
                for (int ix = step; ix < imageW; ix += step)
                {
                    g.DrawLine(pen, ix, 0, ix, bmp.Height);
                    int realX = originX + (int)Math.Round(ix * scale);
                    g.DrawString(realX.ToString(), font, brush, ix + 2, 2);
                }
                for (int iy = step; iy < bmp.Height; iy += step)
                {
                    g.DrawLine(pen, 0, iy, bmp.Width, iy);
                    int realY = originY + (int)Math.Round(iy * scale);
                    g.DrawString(realY.ToString(), font, brush, 2, iy + 1);
                }
            }
        }
    }

    public static string Capture(int x, int y, int w, int h, int targetWidth, string path, bool grid)
    {
        int[] vs = VirtualScreen();
        int vx = vs[0], vy = vs[1], vw = vs[2], vh = vs[3];
        int cx = Math.Max(x, vx), cy = Math.Max(y, vy);
        int cw = Math.Min(x + w, vx + vw) - cx;
        int ch = Math.Min(y + h, vy + vh) - cy;
        if (cw <= 0 || ch <= 0) throw new ArgumentException("capture rect is outside the virtual screen");

        using (Bitmap src = new Bitmap(cw, ch, PixelFormat.Format32bppArgb))
        {
            using (Graphics g = Graphics.FromImage(src))
            {
                g.CopyFromScreen(cx, cy, 0, 0, new Size(cw, ch), CopyPixelOperation.SourceCopy);
            }
            int tw = (targetWidth > 0 && targetWidth < cw) ? targetWidth : cw;
            int th = (int)Math.Round(ch * (tw / (double)cw));
            if (tw == cw)
            {
                if (grid) DrawGrid(src, cw, tw, cx, cy);
                src.Save(path, ImageFormat.Png);
                return string.Format("{0}\t{1}\t{2:0.###}", tw, th, 1.0);
            }
            using (Bitmap dst = new Bitmap(tw, th, PixelFormat.Format32bppArgb))
            {
                using (Graphics g = Graphics.FromImage(dst))
                {
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    g.DrawImage(src, new Rectangle(0, 0, tw, th), new Rectangle(0, 0, cw, ch), GraphicsUnit.Pixel);
                }
                if (grid) DrawGrid(dst, cw, tw, cx, cy);
                dst.Save(path, ImageFormat.Png);
            }
            return string.Format("{0}\t{1}\t{2:0.###}", tw, th, cw / (double)tw);
        }
    }
}
