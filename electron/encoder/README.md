# FFmpeg MP4 exporter (Windows x64)

This is an independent FFmpeg executable invoked as a child process. EclipseIsland source is MIT; FFmpeg and its included libraries retain their own licenses.

Binary: FFmpeg 6.1.1 essentials build by gyan.dev, obtained unchanged from ffmpeg-static release b6.1.1:
https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1

The complete upstream build report, library versions, source references and GPL v3 text are in win-x64/ffmpeg.README and win-x64/ffmpeg.LICENSE. FFmpeg source revision:
https://github.com/FFmpeg/FFmpeg/tree/e38092ef93

Build infrastructure and dependency sources:
https://github.com/GyanD/codexffmpeg
https://www.gyan.dev/ffmpeg/builds/
https://github.com/eugeneware/ffmpeg-static

The binary is included in this source archive so Windows users can build without downloading a recording utility. build.json records its SHA-256, checked by the installer build and before recording starts. There is no runtime executable download or PATH lookup.
