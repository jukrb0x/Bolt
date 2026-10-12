/* Forward this .exe to `bun $BOLT_FAKE_RECORD <full path> <args...>`.
 * cmd.exe will not run a script that is named .exe, and the handler asks
 * for the .exe path. Build with x86_64-w64-mingw32-gcc -Os -s.
 */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>

int main(int argc, char **argv) {
  const char *record = getenv("BOLT_FAKE_RECORD");
  char self[MAX_PATH];
  char cmd[32768];
  STARTUPINFOA si;
  PROCESS_INFORMATION pi;
  DWORD code = 1;
  int used;
  int i;

  if (!record) return 2;
  if (GetModuleFileNameA(NULL, self, MAX_PATH) == 0) return 2;

  used = snprintf(cmd, sizeof cmd, "bun \"%s\" \"%s\"", record, self);
  if (used < 0 || used >= (int)sizeof cmd) return 2;
  for (i = 1; i < argc; i++) {
    int n = snprintf(cmd + used, sizeof cmd - (size_t)used, " \"%s\"", argv[i]);
    if (n < 0 || used + n >= (int)sizeof cmd) return 2;
    used += n;
  }

  ZeroMemory(&si, sizeof si);
  si.cb = sizeof si;
  si.dwFlags = STARTF_USESTDHANDLES;
  si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
  si.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
  si.hStdError = GetStdHandle(STD_ERROR_HANDLE);
  ZeroMemory(&pi, sizeof pi);
  if (!CreateProcessA(NULL, cmd, NULL, NULL, TRUE, 0, NULL, NULL, &si, &pi)) return 1;
  WaitForSingleObject(pi.hProcess, INFINITE);
  GetExitCodeProcess(pi.hProcess, &code);
  CloseHandle(pi.hProcess);
  CloseHandle(pi.hThread);
  return (int)code;
}
