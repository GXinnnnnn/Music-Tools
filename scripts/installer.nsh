; Music Tools per-user installer. Payload and delete lists are generated from the portable inventory.
Unicode true
RequestExecutionLevel user
ManifestDPIAware true
SetCompressor /SOLID lzma
SetCompressorDictSize 64
CRCCheck on
SetDatablockOptimize on
Name "Music Tools"
OutFile "${MT_OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\Music Tools"
InstallDirRegKey HKCU "Software\Music Tools" "InstallLocation"
BrandingText "Music Tools ${MT_VERSION}"
VIProductVersion "${MT_WINDOWS_VERSION}"
VIAddVersionKey /LANG=1033 "ProductName" "Music Tools"
VIAddVersionKey /LANG=1033 "FileDescription" "Music Tools Windows x64 Setup"
VIAddVersionKey /LANG=1033 "FileVersion" "${MT_VERSION}"
VIAddVersionKey /LANG=1033 "ProductVersion" "${MT_VERSION}"
VIAddVersionKey /LANG=1033 "LegalCopyright" "Music Tools contributors"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "FileFunc.nsh"
!define MUI_ICON "${MT_ICON}"
!define MUI_UNICON "${MT_ICON}"
!define MUI_ABORTWARNING
!define MUI_DIRECTORYPAGE_VERIFYONLEAVE
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "SimpChinese"

Var SearchHandle
Var SearchName
Var InstallPathUnsafe

Function .onInit
  SetShellVarContext current
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "Music Tools requires 64-bit Windows."
    SetErrorLevel 1
    Abort
  ${EndIf}
FunctionEnd

; An empty folder or a prior marked installation is safe. Portable folders and arbitrary
; populated directories are rejected, including during silent installation (/D=...).
Function ValidateInstallDirectory
  StrCpy $InstallPathUnsafe 0
  ${If} $INSTDIR == ""
    StrCpy $InstallPathUnsafe 1
    Return
  ${EndIf}
  IfFileExists "$INSTDIR\resources\installed-mode" validDirectory
  FindFirst $SearchHandle $SearchName "$INSTDIR\*"
  directoryLoop:
    StrCmp $SearchName "" directoryDone
    StrCmp $SearchName "." directoryNext
    StrCmp $SearchName ".." directoryNext
    StrCpy $InstallPathUnsafe 1
    Goto directoryDone
  directoryNext:
    FindNext $SearchHandle $SearchName
    Goto directoryLoop
  directoryDone:
    FindClose $SearchHandle
  validDirectory:
FunctionEnd

Function .onVerifyInstDir
  Call ValidateInstallDirectory
  ${If} $InstallPathUnsafe == 1
    Abort
  ${EndIf}
FunctionEnd

; This is the sole place the installed-mode marker is created. Never ship it in portable.
!macro MT_CustomInstall
  FileOpen $0 "$INSTDIR\resources\installed-mode" w
  IfErrors installFailed
  FileWrite $0 "Music Tools installed$\r$\n"
  FileClose $0
!macroend

Section "Music Tools" MainSection
  SetShellVarContext current
  Call ValidateInstallDirectory
  ${If} $InstallPathUnsafe == 1
    IfSilent +2
      MessageBox MB_ICONSTOP "Choose an empty folder or an existing installed Music Tools folder. Portable folders and user files are protected."
    SetErrorLevel 2
    Abort
  ${EndIf}
  SetOutPath "$INSTDIR"
  !insertmacro MT_InstallPayload
  !insertmacro MT_CustomInstall
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\Music Tools"
  CreateShortcut "$SMPROGRAMS\Music Tools\Music Tools.lnk" "$INSTDIR\Music Tools.exe" "" "$INSTDIR\Music Tools.exe" 0
  CreateShortcut "$SMPROGRAMS\Music Tools\Uninstall Music Tools.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\Music Tools.lnk" "$INSTDIR\Music Tools.exe" "" "$INSTDIR\Music Tools.exe" 0
  WriteRegStr HKCU "Software\Music Tools" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Music Tools" "DisplayName" "Music Tools"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Music Tools" "DisplayVersion" "${MT_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Music Tools" "Publisher" "Music Tools contributors"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Music Tools" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Music Tools" "DisplayIcon" "$INSTDIR\Music Tools.exe,0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Music Tools" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Music Tools" "QuietUninstallString" '$\"$INSTDIR\Uninstall.exe$\" /S'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Music Tools" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Music Tools" "NoRepair" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Music Tools" "EstimatedSize" ${MT_SIZE_KIB}
  Goto installDone
  installFailed:
    IfSilent +2
      MessageBox MB_ICONSTOP "Installation failed. Close Music Tools and try again."
    SetErrorLevel 3
    Abort
  installDone:
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  ; Refuse to remove anything unless this directory was installed by our custom hook.
  IfFileExists "$INSTDIR\resources\installed-mode" +3
    SetErrorLevel 4
    Abort
  !insertmacro MT_UninstallPayload
  Delete "$INSTDIR\resources\installed-mode"
  Delete "$INSTDIR\Uninstall.exe"
  Delete "$DESKTOP\Music Tools.lnk"
  Delete "$SMPROGRAMS\Music Tools\Music Tools.lnk"
  Delete "$SMPROGRAMS\Music Tools\Uninstall Music Tools.lnk"
  RMDir "$SMPROGRAMS\Music Tools"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Music Tools"
  DeleteRegKey HKCU "Software\Music Tools"
  ; Empty-directory removal only: added audio, portable data and per-user app data survive.
  !insertmacro MT_RemoveEmptyDirectories
  RMDir "$INSTDIR\resources"
  RMDir "$INSTDIR"
  Goto uninstallDone
  uninstallFailed:
    IfSilent +2
      MessageBox MB_ICONSTOP "Uninstall could not remove a program file. Close Music Tools and run uninstall again. Your data is preserved."
    SetErrorLevel 5
    Abort
  uninstallDone:
SectionEnd
