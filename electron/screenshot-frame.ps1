param(
    [Parameter(Mandatory=$true)][int]$X,
    [Parameter(Mandatory=$true)][int]$Y,
    [Parameter(Mandatory=$true)][int]$Width,
    [Parameter(Mandatory=$true)][int]$Height,
    [Parameter(Mandatory=$true)][ValidateSet(0,1)][int]$IncludeCursor,
    [Parameter(Mandatory=$true)][string]$OutputFile
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class EclipseScreenshot {
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int x, y; }
    [StructLayout(LayoutKind.Sequential)] struct CURSORINFO {
        public int size, flags; public IntPtr cursor; public POINT position;
    }
    [StructLayout(LayoutKind.Sequential)] struct ICONINFO {
        [MarshalAs(UnmanagedType.Bool)] public bool icon;
        public int hotspotX, hotspotY; public IntPtr mask, color;
    }
    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr GetDC(IntPtr window);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr window, IntPtr dc);
    [DllImport("gdi32.dll", SetLastError=true)] static extern bool BitBlt(IntPtr dst, int dx, int dy, int w, int h, IntPtr src, int sx, int sy, uint rop);
    [DllImport("user32.dll", SetLastError=true)] static extern bool GetCursorInfo(ref CURSORINFO info);
    [DllImport("user32.dll", SetLastError=true)] static extern bool GetIconInfo(IntPtr icon, out ICONINFO info);
    [DllImport("user32.dll", SetLastError=true)] static extern bool DrawIconEx(IntPtr dc, int x, int y, IntPtr icon, int w, int h, uint step, IntPtr brush, uint flags);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);

    public static void Capture(int x, int y, int width, int height, bool includeCursor, string output) {
        // Per-monitor DPI aware: coordinates supplied by Electron are physical pixels.
        IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
        if (previous == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            using (Bitmap bitmap = new Bitmap(width, height, PixelFormat.Format24bppRgb)) {
                using (Graphics graphics = Graphics.FromImage(bitmap)) {
                    IntPtr source = GetDC(IntPtr.Zero);
                    if (source == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
                    try {
                        IntPtr dest = graphics.GetHdc();
                        try {
                            // SRCCOPY | CAPTUREBLT includes layered windows, not the hardware cursor.
                            if (!BitBlt(dest, 0, 0, width, height, source, x, y, 0x40CC0020))
                                throw new Win32Exception(Marshal.GetLastWin32Error());
                            if (includeCursor) {
                                CURSORINFO cursor = new CURSORINFO();
                                cursor.size = Marshal.SizeOf(typeof(CURSORINFO));
                                if (GetCursorInfo(ref cursor) && (cursor.flags & 1) != 0 && (cursor.flags & 2) == 0 && cursor.cursor != IntPtr.Zero) {
                                    ICONINFO info;
                                    if (GetIconInfo(cursor.cursor, out info)) {
                                        try {
                                            DrawIconEx(dest, cursor.position.x - x - info.hotspotX, cursor.position.y - y - info.hotspotY, cursor.cursor, 0, 0, 0, IntPtr.Zero, 3);
                                        } finally {
                                            if (info.mask != IntPtr.Zero) DeleteObject(info.mask);
                                            if (info.color != IntPtr.Zero) DeleteObject(info.color);
                                        }
                                    }
                                }
                            }
                        } finally { graphics.ReleaseHdc(dest); }
                    } finally { ReleaseDC(IntPtr.Zero, source); }
                }
                bitmap.Save(output, ImageFormat.Png);
            }
        } finally { SetThreadDpiAwarenessContext(previous); }
    }
}
'@
[EclipseScreenshot]::Capture($X, $Y, $Width, $Height, ($IncludeCursor -eq 1), $OutputFile)
