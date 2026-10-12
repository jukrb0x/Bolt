@echo off
bun "%BOLT_FAKE_RECORD%" "%~f0" %*
exit /b %ERRORLEVEL%
