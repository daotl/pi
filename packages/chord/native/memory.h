#ifndef CHORD_NATIVE_MEMORY_H
#define CHORD_NATIVE_MEMORY_H
#include <stddef.h>

// Compilers may lower zero-initialized Windows structs to these calls even in
// freestanding builds. Volatile accesses prevent recursive intrinsic lowering.
void* memset(void* destination, int value, size_t count) {
    volatile unsigned char* bytes = destination;
    for (size_t i = 0; i < count; i++) bytes[i] = (unsigned char)value;
    return destination;
}
void* memcpy(void* destination, const void* source, size_t count) {
    volatile unsigned char* out = destination;
    const volatile unsigned char* in = source;
    for (size_t i = 0; i < count; i++) out[i] = in[i];
    return destination;
}
#endif
