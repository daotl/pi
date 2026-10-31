// A trusted execPath adapter for child_process.fork. Forward libuv's inherited
// CRT descriptor table unchanged: the target is a genuine Node fork IPC peer.
// Layout evidence: Node v22.19.0 deps/uv/src/win/process-stdio.c,
// CHILD_STDIO_SIZE / CHILD_STDIO_HANDLE. Unknown table layouts fail closed.
// https://github.com/nodejs/node/blob/v22.19.0/deps/uv/src/win/process-stdio.c
#include <windows.h>
#include <stdint.h>
#include "memory.h"

#ifndef PROC_THREAD_ATTRIBUTE_JOB_LIST
#define PROC_THREAD_ATTRIBUTE_JOB_LIST ProcThreadAttributeValue(13, FALSE, TRUE, FALSE)
#endif

typedef struct { DWORD pid; DWORD error; } launch_result;

static void append(WCHAR* target, const WCHAR* value) {
    while (*target) target++;
    while ((*target++ = *value++)) {}
}

static WCHAR* skip_argument(WCHAR* cursor) {
    BOOL quoted = FALSE;
    while (*cursor) {
        if (*cursor == L'"') quoted = !quoted;
        else if (!quoted && (*cursor == L' ' || *cursor == L'\t')) break;
        cursor++;
    }
    while (*cursor == L' ' || *cursor == L'\t') cursor++;
    return cursor;
}

static unsigned int inherited_handles(const STARTUPINFOW* startup, HANDLE* output) {
    unsigned int used = 0;
    if (!startup->lpReserved2 || startup->cbReserved2 < sizeof(int)) return 0;
    unsigned int count = *(unsigned int*)startup->lpReserved2;
    SIZE_T required = sizeof(int) + count + (SIZE_T)count * sizeof(HANDLE);
    if (count < 4 || count > 255 || required != startup->cbReserved2) return 0;
    BYTE* handles = startup->lpReserved2 + sizeof(int) + count;
    for (unsigned int i = 0; i < count; i++) {
        HANDLE handle = 0;
        BYTE* bytes = (BYTE*)&handle;
        for (SIZE_T j = 0; j < sizeof(handle); j++) bytes[j] = handles[i * sizeof(handle) + j];
        if (!handle || handle == INVALID_HANDLE_VALUE) continue;
        DWORD flags = 0;
        if (!GetHandleInformation(handle, &flags) || !(flags & HANDLE_FLAG_INHERIT)) return 0;
        BOOL duplicate = FALSE;
        for (unsigned int j = 0; j < used; j++) if (output[j] == handle) duplicate = TRUE;
        if (!duplicate) output[used++] = handle;
    }
    return used;
}

void WINAPI chord_main(void) {
    WCHAR name[160] = {0};
    DWORD length = GetEnvironmentVariableW(L"CHORD2_WINDOWS_JOB", name, 120);
    if (!length || length >= 120) ExitProcess(125);
    HANDLE job = OpenJobObjectW(JOB_OBJECT_ASSIGN_PROCESS, FALSE, name);
    append(name, L"-mapping");
    HANDLE mapping = OpenFileMappingW(FILE_MAP_WRITE, FALSE, name);
    launch_result* result = mapping ? MapViewOfFile(mapping, FILE_MAP_WRITE, 0, 0, sizeof(*result)) : 0;
    name[length] = 0;
    append(name, L"-ready");
    HANDLE ready = OpenEventW(EVENT_MODIFY_STATE, FALSE, name);
    if (!job || !result || !ready) ExitProcess(125);
    SetEnvironmentVariableW(L"CHORD2_WINDOWS_JOB", 0);

    STARTUPINFOEXW startup = {0};
    STARTUPINFOW inherited = {0};
    GetStartupInfoW(&inherited);
    startup.StartupInfo = inherited;
    startup.StartupInfo.cb = sizeof(startup);
    startup.StartupInfo.dwFlags |= STARTF_USESTDHANDLES;
    HANDLE handles[255] = {0};
    unsigned int handle_count = inherited_handles(&inherited, handles);
    SIZE_T attribute_size = 0;
    InitializeProcThreadAttributeList(0, 2, 0, &attribute_size);
    startup.lpAttributeList = HeapAlloc(GetProcessHeap(), 0, attribute_size);
    PROCESS_INFORMATION process = {0};
    BOOL initialized = startup.lpAttributeList && InitializeProcThreadAttributeList(startup.lpAttributeList, 2, 0, &attribute_size);
    BOOL created = initialized && handle_count &&
        UpdateProcThreadAttribute(startup.lpAttributeList, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, handles, handle_count * sizeof(HANDLE), 0, 0) &&
        UpdateProcThreadAttribute(startup.lpAttributeList, 0, PROC_THREAD_ATTRIBUTE_JOB_LIST, &job, sizeof(job), 0, 0) &&
        // fork already configured the launcher's environment and cwd. NULL keeps
        // that exact environment (minus the private Job name) and working directory.
        CreateProcessW(0, skip_argument(GetCommandLineW()), 0, 0, TRUE,
            EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
            0, 0, &startup.StartupInfo, &process);
    result->pid = created ? process.dwProcessId : 0;
    result->error = created ? 0 : GetLastError();
    if (initialized) DeleteProcThreadAttributeList(startup.lpAttributeList);
    if (startup.lpAttributeList) HeapFree(GetProcessHeap(), 0, startup.lpAttributeList);
    // The parent must be the ONLY Job owner before any target instruction runs.
    CloseHandle(job);
    UnmapViewOfFile(result);
    CloseHandle(mapping);
    SetEvent(ready);
    CloseHandle(ready);
    if (!created) ExitProcess(125);

    // libuv cleared inheritance on launcher startup only when it is Node. This
    // executable never does, so all inherited stdio/IPC handles reach the target.
    // Drop our copies after handoff, otherwise IPC EOF and output EOF are delayed.
    for (unsigned int i = 0; i < handle_count; i++) CloseHandle(handles[i]);
    if (ResumeThread(process.hThread) == (DWORD)-1) TerminateProcess(process.hProcess, 125);
    CloseHandle(process.hThread);
    WaitForSingleObject(process.hProcess, INFINITE);
    DWORD code = 125;
    GetExitCodeProcess(process.hProcess, &code);
    CloseHandle(process.hProcess);
    ExitProcess(code);
}
