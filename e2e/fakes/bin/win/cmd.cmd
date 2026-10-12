@echo off
bun "%~dp0..\..\cmd.ts" "%~f0" %*
exit /b %ERRORLEVEL%
