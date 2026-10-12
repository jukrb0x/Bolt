@echo off
bun "%BOLT_FAKE_RECORD%" "%~f0" %*
if errorlevel 1 exit /b %ERRORLEVEL%
call "%~dp0..\..\Binaries\DotNET\UnrealBuildTool.cmd" %*
exit /b %ERRORLEVEL%
