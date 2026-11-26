; A single EXE with a persistent per-version runtime. No installer pages or admin rights.
!include "common.nsh"
!include "FileFunc.nsh"
!include "extractAppPackage.nsh"
CRCCheck off
WindowIcon Off
AutoCloseWindow True
RequestExecutionLevel user
Icon "${PROJECT_DIR}\src\eclipse.ico"
Page instfiles
Var BootstrapLock
Var QuietStart
Var CacheHash
Function .onInit
  !insertmacro check64BitAndSetRegView
  StrCpy $QuietStart 0
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "--autostart" $R1
  ${IfNot} ${Errors}
    StrCpy $QuietStart 1
    SetSilent silent
  ${EndIf}
FunctionEnd
Function .onGUIInit
  HideWindow
  InitPluginsDir
  File /oname=$PLUGINSDIR\splash.bmp "${PROJECT_DIR}\build\splash.bmp"
  BgImage::SetBg $PLUGINSDIR\splash.bmp
  BgImage::Redraw
FunctionEnd
Function ReleaseLock
  ${If} $BootstrapLock != 0
    System::Call 'kernel32::ReleaseMutex(p $BootstrapLock)'
    System::Call 'kernel32::CloseHandle(p $BootstrapLock)'
    StrCpy $BootstrapLock 0
  ${EndIf}
FunctionEnd
Function .onGUIEnd
  BgImage::Destroy
  Call ReleaseLock
FunctionEnd
Section
  HideWindow
  InitPluginsDir
  ; Serialize extraction only. A second click can reach Electron's single-instance handler.
  System::Call 'kernel32::CreateMutex(p 0, i 0, t "Local\EclipseIsland.RuntimeBootstrap") p.r0'
  StrCpy $BootstrapLock $0
  ${If} $BootstrapLock == 0
    Goto failed
  ${EndIf}
  System::Call 'kernel32::WaitForSingleObject(p $BootstrapLock, i 120000) i.r0'
  ${If} $0 != 0
  ${AndIf} $0 != 128
    Goto failed
  ${EndIf}
  !ifdef APP_ARM64
    StrCpy $CacheHash "${APP_ARM64_HASH}"
    StrCpy $3 $CacheHash 12
    StrCpy $INSTDIR "$LOCALAPPDATA\EclipseIsland\Runtime\${VERSION}-arm64-$3"
  !else
    StrCpy $CacheHash "${APP_64_HASH}"
    StrCpy $3 $CacheHash 12
    StrCpy $INSTDIR "$LOCALAPPDATA\EclipseIsland\Runtime\${VERSION}-x64-$3"
  !endif
  ClearErrors
  FileOpen $1 "$INSTDIR\runtime.ready" r
  ${IfNot} ${Errors}
    FileRead $1 $2
    FileClose $1
    ${If} $2 == $CacheHash
      IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 unpack
      IfFileExists "$INSTDIR\resources\app.asar" launch unpack
    ${EndIf}
  ${EndIf}
unpack:
  ; Delete only this version's incomplete cache; preferences live elsewhere.
  RMDir /r "$INSTDIR"
  ClearErrors
  SetOutPath "$INSTDIR"
  ${If} ${Errors}
    Goto failed
  ${EndIf}
  !insertmacro extractEmbeddedAppPackage
  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 failed
  IfFileExists "$INSTDIR\resources\app.asar" 0 failed
  ClearErrors
  FileOpen $1 "$INSTDIR\runtime.ready" w
  ${If} ${Errors}
    Goto failed
  ${EndIf}
  FileWrite $1 $CacheHash
  FileClose $1
launch:
  Call ReleaseLock
  System::Call 'kernel32::SetEnvironmentVariable(t "PORTABLE_EXECUTABLE_DIR", t "$EXEDIR")'
  System::Call 'kernel32::SetEnvironmentVariable(t "PORTABLE_EXECUTABLE_FILE", t "$EXEPATH")'
  System::Call 'kernel32::SetEnvironmentVariable(t "PORTABLE_EXECUTABLE_APP_FILENAME", t "${APP_FILENAME}")'
  ${StdUtils.GetAllParameters} $R0 0
  BgImage::Destroy
  ClearErrors
  ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" $R0' $0
  ${If} ${Errors}
    Goto failed
  ${EndIf}
  ${If} $0 != 0
    Delete "$INSTDIR\runtime.ready"
  ${EndIf}
  SetErrorLevel $0
  ; Keep the validated runtime for the next launch. Never unpack it again on normal startup.
  Goto done
failed:
  Call ReleaseLock
  BgImage::Destroy
  MessageBox MB_OK|MB_ICONEXCLAMATION "EclipseIsland could not prepare its runtime. Close EclipseIsland and try again."
  SetErrorLevel 1
done:
SectionEnd
