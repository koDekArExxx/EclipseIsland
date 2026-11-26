; Standard electron-builder assisted installer. Keep preferences when uninstalling.
!macro customUnInstall
  ; This is the named autorun entry created by electron/autostart.cjs.
  ${IfNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "EclipseIsland"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "EclipseIsland"
  ${EndIf}
!macroend
