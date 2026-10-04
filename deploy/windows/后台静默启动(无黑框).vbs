Set WshShell = CreateObject("WScript.Shell")
Dim fso: Set fso = CreateObject("Scripting.FileSystemObject")
Dim scriptDir: scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
Dim projectRoot: projectRoot = fso.GetParentFolderName(fso.GetParentFolderName(scriptDir))
WshShell.CurrentDirectory = projectRoot

Dim pythonExe

If fso.FileExists(".venv\Scripts\python.exe") Then
    pythonExe = ".venv\Scripts\python.exe"
Else
    pythonExe = "python"
End If

' 0 = 隐藏黑框窗口运行
WshShell.Run """" & pythonExe & """ app.py", 0, False

WScript.Echo "Service BOM 服务已在后台静默启动！" & vbCrLf & "浏览器将自动打开，您可以把此文件快捷方式放入开机自启文件夹 (shell:startup)。"
