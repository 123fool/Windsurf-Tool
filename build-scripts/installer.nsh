; 自定义 NSIS 安装脚本
; 用于保护用户数据不被安装程序清空

!macro customInit
  ; 在安装前备份用户数据
  SetShellVarContext current
  StrCpy $0 "$APPDATA\windsurf-tool"
  
  ; 检查是否存在用户数据
  IfFileExists "$0\accounts.json" 0 +3
    ; 创建备份
    CreateDirectory "$TEMP\windsurf-tool-backup"
    CopyFiles /SILENT "$0\*.*" "$TEMP\windsurf-tool-backup"
!macroend

!macro customInstall
  ; 安装后恢复用户数据
  SetShellVarContext current
  StrCpy $0 "$APPDATA\windsurf-tool"
  
  ; 如果有备份，恢复它
  IfFileExists "$TEMP\windsurf-tool-backup\accounts.json" 0 +4
    CreateDirectory "$0"
    CopyFiles /SILENT "$TEMP\windsurf-tool-backup\*.*" "$0"
    RMDir /r "$TEMP\windsurf-tool-backup"
!macroend

!macro customUnInit
  ; 卸载时不删除用户数据
  ; 这个宏确保用户数据被保留
!macroend
