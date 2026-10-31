// Chord-owned stable N-API addon; resolve symbols from Node without runtime headers.
#include <windows.h>
#include <stdint.h>
#include <stddef.h>
#include "memory.h"

// Explicit freestanding entry works with MSVC, GNU ld, and LLVM lld alike.
BOOL WINAPI chord_dll_main(HINSTANCE instance, DWORD reason, LPVOID reserved) {
    (void)instance;
    (void)reason;
    (void)reserved;
    return TRUE;
}

typedef void* napi_env;
typedef void* napi_value;
typedef void* napi_callback_info;
typedef napi_value (__cdecl *callback)(napi_env, napi_callback_info);
typedef void (__cdecl *finalizer)(napi_env, void*, void*);
typedef int (__cdecl *get_info_fn)(napi_env, napi_callback_info, size_t*, napi_value*, napi_value*, void**);
typedef int (__cdecl *get_external_fn)(napi_env, napi_value, void**);
typedef int (__cdecl *get_uint_fn)(napi_env, napi_value, uint32_t*);
typedef int (__cdecl *get_string_fn)(napi_env, napi_value, WCHAR*, size_t, size_t*);
typedef int (__cdecl *create_uint_fn)(napi_env, uint32_t, napi_value*);
typedef int (__cdecl *create_external_fn)(napi_env, void*, finalizer, void*, napi_value*);
typedef int (__cdecl *create_function_fn)(napi_env, const char*, size_t, callback, void*, napi_value*);
typedef int (__cdecl *set_property_fn)(napi_env, napi_value, const char*, napi_value);
typedef int (__cdecl *throw_error_fn)(napi_env, const char*, const char*);
typedef int (__cdecl *get_undefined_fn)(napi_env, napi_value*);
typedef struct { DWORD pid; DWORD error; } launch_result;
typedef struct { HANDLE handle; HANDLE mapping; HANDLE ready; launch_result* result; } chord_job;

static void* resolve_symbol(const char* name) {
    HMODULE module = GetModuleHandleW(0);
    void* result = module ? (void*)GetProcAddress(module, name) : 0;
    if (result) return result;
    module = GetModuleHandleW(L"node.dll");
    return module ? (void*)GetProcAddress(module, name) : 0;
}
static const char* required_names[] = {
    "napi_get_undefined", "napi_throw_error", "napi_get_cb_info", "napi_get_value_external",
    "napi_get_value_uint32", "napi_get_value_string_utf16", "napi_create_uint32",
    "napi_create_external", "napi_create_function", "napi_set_named_property"
};
static void* required_symbols[10];
static void* symbol(const char* name) {
    for (unsigned int i = 0; i < 10; i++) {
        const char* left = required_names[i];
        const char* right = name;
        while (*left && *left == *right) { left++; right++; }
        if (*left == *right) return required_symbols[i];
    }
    return 0;
}
static napi_value undefined_value(napi_env env) {
    napi_value value = 0;
    ((get_undefined_fn)symbol("napi_get_undefined"))(env, &value);
    return value;
}
static napi_value fail(napi_env env, const char* message) {
    ((throw_error_fn)symbol("napi_throw_error"))(env, "CHORD_WINDOWS_JOB", message);
    return undefined_value(env);
}
static void close_launch(chord_job* job) {
    if (job->result) UnmapViewOfFile(job->result);
    if (job->mapping) CloseHandle(job->mapping);
    if (job->ready) CloseHandle(job->ready);
    job->result = 0;
    job->mapping = 0;
    job->ready = 0;
}
static void __cdecl finalize(napi_env env, void* data, void* hint) {
    (void)env;
    (void)hint;
    chord_job* job = data;
    close_launch(job);
    if (job->handle) CloseHandle(job->handle);
    HeapFree(GetProcessHeap(), 0, job);
}
static chord_job* argument(napi_env env, napi_callback_info info, uint32_t* pid) {
    size_t argc = pid ? 2 : 1;
    napi_value args[2] = {0, 0};
    chord_job* job = 0;
    if (((get_info_fn)symbol("napi_get_cb_info"))(env, info, &argc, args, 0, 0) != 0 ||
        argc < (pid ? 2u : 1u) ||
        ((get_external_fn)symbol("napi_get_value_external"))(env, args[0], (void**)&job) != 0 ||
        !job || !job->handle ||
        (pid && ((get_uint_fn)symbol("napi_get_value_uint32"))(env, args[1], pid) != 0)) {
        fail(env, "Invalid or closed Windows Job");
        return 0;
    }
    return job;
}
static void suffix(WCHAR* name, size_t length, const WCHAR* value) {
    do { name[length++] = *value; } while (*value++);
}
static napi_value __cdecl create(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value value = 0;
    WCHAR name[160] = {0};
    size_t length = 0;
    if (((get_info_fn)symbol("napi_get_cb_info"))(env, info, &argc, &value, 0, 0) != 0 || argc != 1 ||
        ((get_string_fn)symbol("napi_get_value_string_utf16"))(env, value, name, 120, &length) != 0 ||
        !length || length >= 119) return fail(env, "Invalid Windows Job launch name");
    chord_job* job = HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(*job));
    if (!job) return fail(env, "Could not allocate Windows Job");
    // NULL security attributes: none of these parent handles can be inherited.
    job->handle = CreateJobObjectW(0, name);
    DWORD existing = GetLastError();
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = {0};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if (!job->handle || existing == ERROR_ALREADY_EXISTS ||
        !SetHandleInformation(job->handle, HANDLE_FLAG_INHERIT, 0) ||
        !SetInformationJobObject(job->handle, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) {
        finalize(env, job, 0);
        return fail(env, "Could not create private kill-on-close Windows Job");
    }
    suffix(name, length, L"-mapping");
    job->mapping = CreateFileMappingW(INVALID_HANDLE_VALUE, 0, PAGE_READWRITE, 0, sizeof(launch_result), name);
    existing = GetLastError();
    if (job->mapping && existing != ERROR_ALREADY_EXISTS)
        job->result = MapViewOfFile(job->mapping, FILE_MAP_READ | FILE_MAP_WRITE, 0, 0, sizeof(launch_result));
    suffix(name, length, L"-ready");
    job->ready = CreateEventW(0, TRUE, FALSE, name);
    existing = GetLastError();
    if (!job->result || !job->ready || existing == ERROR_ALREADY_EXISTS) {
        finalize(env, job, 0);
        return fail(env, "Could not create private Windows launch handoff");
    }
    napi_value result = 0;
    if (((create_external_fn)symbol("napi_create_external"))(env, job, finalize, 0, &result) != 0) {
        finalize(env, job, 0);
        return fail(env, "Could not retain Windows Job");
    }
    return result;
}
static napi_value __cdecl launched(napi_env env, napi_callback_info info) {
    uint32_t pid = 0;
    chord_job* job = argument(env, info, &pid);
    if (!job) return undefined_value(env);
    HANDLE launcher = OpenProcess(SYNCHRONIZE | PROCESS_TERMINATE, FALSE, pid);
    if (!launcher) {
        TerminateJobObject(job->handle, 125);
        close_launch(job);
        return fail(env, "Could not open Windows launcher");
    }
    HANDLE handles[2] = {job->ready, launcher};
    DWORD waited = WaitForMultipleObjects(2, handles, FALSE, 30000);
    DWORD target = waited == WAIT_OBJECT_0 && job->result->error == 0 ? job->result->pid : 0;
    if (!target) {
        TerminateJobObject(job->handle, 125);
        TerminateProcess(launcher, 125);
        WaitForSingleObject(launcher, INFINITE);
        JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting = {0};
        while (QueryInformationJobObject(job->handle, JobObjectBasicAccountingInformation, &accounting, sizeof(accounting), 0) && accounting.ActiveProcesses != 0) {
            Sleep(1);
        }
    }
    CloseHandle(launcher);
    close_launch(job);
    if (!target) return fail(env, "Atomic Windows launch failed before application startup");
    napi_value result = 0;
    ((create_uint_fn)symbol("napi_create_uint32"))(env, target, &result);
    return result;
}
static napi_value __cdecl terminate(napi_env env, napi_callback_info info) {
    chord_job* job = argument(env, info, 0);
    if (!job) return undefined_value(env);
    if (!TerminateJobObject(job->handle, 1)) return fail(env, "Could not terminate Windows Job");
    return undefined_value(env);
}
static napi_value __cdecl active(napi_env env, napi_callback_info info) {
    chord_job* job = argument(env, info, 0);
    if (!job) return undefined_value(env);
    JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting = {0};
    if (!QueryInformationJobObject(job->handle, JobObjectBasicAccountingInformation, &accounting, sizeof(accounting), 0))
        return fail(env, "Could not query Windows Job active processes");
    napi_value result = 0;
    ((create_uint_fn)symbol("napi_create_uint32"))(env, accounting.ActiveProcesses, &result);
    return result;
}
static napi_value __cdecl close_job(napi_env env, napi_callback_info info) {
    chord_job* job = argument(env, info, 0);
    if (!job) return undefined_value(env);
    if (!CloseHandle(job->handle)) return fail(env, "Could not close Windows Job");
    job->handle = 0;
    close_launch(job);
    return undefined_value(env);
}
static void export_function(napi_env env, napi_value exports, const char* name, callback fn) {
    napi_value value = 0;
    ((create_function_fn)symbol("napi_create_function"))(env, name, (size_t)-1, fn, 0, &value);
    ((set_property_fn)symbol("napi_set_named_property"))(env, exports, name, value);
}
__declspec(dllexport) napi_value __cdecl napi_register_module_v1(napi_env env, napi_value exports) {
    for (unsigned int i = 0; i < 10; i++) {
        required_symbols[i] = resolve_symbol(required_names[i]);
        if (!required_symbols[i]) {
            throw_error_fn throw_error = (throw_error_fn)resolve_symbol("napi_throw_error");
            if (throw_error) throw_error(env, "CHORD_WINDOWS_JOB", "Required stable N-API function is unavailable");
            return exports;
        }
    }
    export_function(env, exports, "create", create);
    export_function(env, exports, "launched", launched);
    export_function(env, exports, "terminate", terminate);
    export_function(env, exports, "active", active);
    export_function(env, exports, "close", close_job);
    return exports;
}
