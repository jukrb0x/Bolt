@echo off
set "BOLT_FAKE_QUIET=1"
bun "%BOLT_FAKE_RECORD%" "%~f0" %*
if /I "%~1"=="TortoiseProc.exe" (
  echo %~dp0TortoiseProc.cmd
  exit /b 0
)
where.exe %*
exit /b %ERRORLEVEL%
