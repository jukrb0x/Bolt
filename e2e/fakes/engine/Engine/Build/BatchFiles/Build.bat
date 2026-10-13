@echo off
bun "%BOLT_FAKE_RECORD%" "%~f0" %*
if errorlevel 1 exit /b %ERRORLEVEL%
rem UE5 keeps UnrealBuildTool in its own folder. UE4 has it directly in DotNET.
set "BOLT_FAKE_UBT=%~dp0..\..\Binaries\DotNET\UnrealBuildTool\UnrealBuildTool.cmd"
if not exist "%BOLT_FAKE_UBT%" set "BOLT_FAKE_UBT=%~dp0..\..\Binaries\DotNET\UnrealBuildTool.cmd"
call "%BOLT_FAKE_UBT%" %*
exit /b %ERRORLEVEL%
