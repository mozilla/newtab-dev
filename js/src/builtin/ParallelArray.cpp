/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*-
 * vim: set ts=8 sw=4 et tw=99 ft=cpp:
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "builtin/ParallelArray.h"
#include "builtin/ParallelArray-inl.h"

#include "jsapi.h"
#include "jsobj.h"
#include "jsarray.h"
#include "jsprf.h"

#include "gc/Marking.h"
#include "vm/GlobalObject.h"
#include "vm/Stack.h"
#include "vm/StringBuffer.h"

#include "jsobjinlines.h"
#include "jsarrayinlines.h"

using namespace js;
using namespace js::types;

//
// Utilities
//

typedef ParallelArrayObject::IndexVector IndexVector;
typedef ParallelArrayObject::IndexInfo IndexInfo;

bool
ParallelArrayObject::IndexInfo::isInitialized()
{
    return (dimensions.length() > 0 &&
            indices.capacity() >= dimensions.length() &&
            partialProducts.length() == dimensions.length());
}

static inline JSObject *
NewDenseArrayWithType(JSContext *cx, uint32_t length, HandleObject source = NullPtr())
{
    RootedObject buffer(cx);
    if (source)
        buffer = NewDenseCopiedArray(cx, length, source->getDenseArrayElements());
    else
        buffer = NewDenseAllocatedArray(cx, length);

    if (!buffer)
        return NULL;

    if (!source)
        buffer->ensureDenseArrayInitializedLength(cx, length, 0);

    RootedTypeObject newtype(cx, GetTypeCallerInitObject(cx, JSProto_Array));
    if (!newtype)
        return NULL;
    buffer->setType(newtype);

    return *buffer.address();
}

// Check if obj is a parallel array, and if so, cast to pa and initialize
// the IndexInfo accordingly.
//
// This function is designed to be used in conjunction with
// GetElementFromArrayLikeObject; see below.
static bool
MaybeGetParallelArrayObjectAndLength(JSContext *cx, HandleObject obj,
                                     MutableHandle<ParallelArrayObject *> pa,
                                     IndexInfo *iv, uint32_t *length)
{
    if (ParallelArrayObject::is(obj)) {
        pa.set(ParallelArrayObject::as(obj));
        if (!pa->isOneDimensional() && !iv->initialize(cx, pa, 1))
            return false;
        *length = pa->outermostDimension();
    } else if (!js_GetLengthProperty(cx, obj, length)) {
        return false;
    }

    return true;
}

// Store the i-th element of the array-like object obj into vp.
//
// If pa is not null, then pa is obj casted to a ParallelArrayObject
// and iv is initialized according to the dimensions of pa. In this case,
// we get the element using the ParallelArrayObject.
//
// Otherwise we do what is done in GetElement in jsarray.cpp.
static bool
GetElementFromArrayLikeObject(JSContext *cx, HandleObject obj, HandleParallelArrayObject pa,
                              IndexInfo &iv, uint32_t i, MutableHandleValue vp)
{
    // Are we indexing a parallel array object?
    if (pa) {
        // If the array is one dimensional, we can skip using the IndexInfo.
        if (pa->isOneDimensional() && pa->getElementFromOnlyDimension(cx, i, vp))
            return true;

        JS_ASSERT(iv.isInitialized());
        JS_ASSERT(iv.indices.length() == 1);
        iv.indices[0] = i;
        if (pa->getParallelArrayElement(cx, iv, vp))
            return true;
    }

    if (obj->isDenseArray() && i < obj->getDenseArrayInitializedLength()) {
        vp.set(obj->getDenseArrayElement(i));
        if (!vp.isMagic(JS_ARRAY_HOLE))
            return true;
    }

    if (obj->isArguments()) {
        if (obj->asArguments().maybeGetElement(static_cast<uint32_t>(i), vp))
            return true;
    }

    bool present;
    if (!obj->getElementIfPresent(cx, obj, i, vp, &present))
        return false;
    if (!present)
        vp.setUndefined();

    return true;
}

// Copy an array like object obj into an IndexVector, indices, using
// ToUint32.
static inline bool
ArrayLikeToIndexVector(JSContext *cx, HandleObject obj, IndexVector &indices)
{
    IndexInfo iv(cx);
    RootedParallelArrayObject pa(cx);
    uint32_t length;

    if (!MaybeGetParallelArrayObjectAndLength(cx, obj, &pa, &iv, &length))
        return false;

    if (!indices.resize(length))
        return false;

    RootedValue elem(cx);
    for (uint32_t i = 0; i < length; i++) {
        if (!GetElementFromArrayLikeObject(cx, obj, pa, iv, i, &elem) ||
            !ToUint32(cx, elem, &indices[i]))
        {
            return false;
        }
    }

    return true;
}

template <bool impl(JSContext *, CallArgs)>
static inline
JSBool NonGenericMethod(JSContext *cx, unsigned argc, Value *vp)
{
    CallArgs args = CallArgsFromVp(argc, vp);
    return CallNonGenericMethod(cx, ParallelArrayObject::is, impl, args);
}

//
// Operations Overview
//
// The different execution modes implement different versions of a set of
// operations with the same signatures, detailed below.
//
// build
// -----
// The comprehension form. Build a parallel array from a dimension vector and
// using elementalFun, writing the results into buffer. The dimension vector
// and its partial products are kept in iv. The function elementalFun is passed
// indices as multiple arguments.
//
// bool build(JSContext *cx,
//            IndexInfo &iv,
//            HandleObject elementalFun,
//            HandleObject buffer)
//
// map
// ---
// Map elementalFun over the elements of the outermost dimension of source,
// writing the results into buffer. The buffer must be as long as the
// outermost dimension of the source. The elementalFun is passed
// (element, index, collection) as arguments, in that order.
//
// bool map(JSContext *cx,
//          HandleParallelArrayObject source,
//          HandleObject elementalFun,
//          HandleObject buffer)
//
// reduce
// ------
// Reduce source in the outermost dimension using elementalFun. If vp is not
// null, then the final value of the reduction is stored into vp. If buffer is
// not null, then buffer[i] is the final value of calling reduce on the
// subarray from [0,i]. The elementalFun is passed 2 values to be
// reduced. There is no specified order in which the elements of the array are
// reduced. If elementalFun is not commutative and associative, there is no
// guarantee that the final value is deterministic.
//
// bool reduce(JSContext *cx,
//             HandleParallelArrayObject source,
//             HandleObject elementalFun,
//             HandleObject buffer,
//             MutableHandleValue vp)
//
// scatter
// -------
// Reassign elements in source in the outermost dimension according to a
// scatter vector, targets, writing results into buffer. The targets object
// should be array-like. The element source[i] is reassigned to the index
// targets[i]. If multiple elements map to the same target index, the
// conflictFun is used to resolve the resolution. If nothing maps to i for
// some i, defaultValue is used for that index. Note that buffer can be longer
// than the source, in which case all the remaining holes are filled with
// defaultValue.
//
// bool scatter(JSContext *cx,
//              HandleParallelArrayObject source,
//              HandleObject targets,
//              const Value &defaultValue,
//              HandleObject conflictFun,
//              HandleObject buffer)
//
// filter
// ------
// Filter the source in the outermost dimension using an array of truthy
// values, filters, writing the results into buffer. All elements with index i
// in outermost dimension such that filters[i] is not truthy are removed.
//
// bool filter(JSContext *cx,
//             HandleParallelArrayObject source,
//             HandleObject filters,
//             HandleObject buffer)
//

ParallelArrayObject::SequentialMode ParallelArrayObject::sequential;
ParallelArrayObject::ParallelMode ParallelArrayObject::parallel;
ParallelArrayObject::FallbackMode ParallelArrayObject::fallback;

ParallelArrayObject::ExecutionStatus
ParallelArrayObject::SequentialMode::build(JSContext *cx, IndexInfo &iv,
                                           HandleObject elementalFun, HandleObject buffer)
{
    JS_ASSERT(iv.isInitialized());

    uint32_t length = iv.scalarLengthOfDimensions();

    InvokeArgsGuard args;
    if (!cx->stack.pushInvokeArgs(cx, iv.dimensions.length(), &args))
        return ExecutionFailed;

    for (uint32_t i = 0; i < length; i++) {
        args.setCallee(ObjectValue(*elementalFun));
        args.setThis(UndefinedValue());

        // Compute and set indices.
        iv.fromScalar(i);
        for (size_t j = 0; j < iv.indices.length(); j++)
            args[j].setNumber(iv.indices[j]);

        if (!Invoke(cx, args))
            return ExecutionFailed;

        buffer->setDenseArrayElementWithType(cx, i, args.rval());
    }

    return ExecutionSucceeded;
}

ParallelArrayObject::ExecutionStatus
ParallelArrayObject::SequentialMode::map(JSContext *cx, HandleParallelArrayObject source,
                                         HandleObject elementalFun, HandleObject buffer)
{
    JS_ASSERT(is(source));
    JS_ASSERT(source->outermostDimension() == buffer->getDenseArrayInitializedLength());
    JS_ASSERT(buffer->isDenseArray());

    uint32_t length = source->outermostDimension();

    IndexInfo iv(cx);
    if (!source->isOneDimensional() && !iv.initialize(cx, source, 1))
        return ExecutionFailed;

    InvokeArgsGuard args;
    if (!cx->stack.pushInvokeArgs(cx, 3, &args))
        return ExecutionFailed;

    RootedValue elem(cx);
    for (uint32_t i = 0; i < length; i++) {
        args.setCallee(ObjectValue(*elementalFun));
        args.setThis(UndefinedValue());

        if (source->isOneDimensional()) {
            if (!source->getElementFromOnlyDimension(cx, i, &elem))
                return ExecutionFailed;
        } else {
            iv.indices[0] = i;
            if (!source->getParallelArrayElement(cx, iv, &elem))
                return ExecutionFailed;
        }

        // The arguments are in eic(h) order.
        args[0] = elem;
        args[1].setNumber(i);
        args[2].setObject(*source);

        if (!Invoke(cx, args))
            return ExecutionFailed;

        buffer->setDenseArrayElementWithType(cx, i, args.rval());
    }

    return ExecutionSucceeded;
}

ParallelArrayObject::ExecutionStatus
ParallelArrayObject::SequentialMode::reduce(JSContext *cx, HandleParallelArrayObject source,
                                            HandleObject elementalFun, HandleObject buffer,
                                            MutableHandleValue vp)
{
    JS_ASSERT(is(source));
    JS_ASSERT_IF(buffer, buffer->isDenseArray());
    JS_ASSERT_IF(buffer, buffer->getDenseArrayInitializedLength() >= 1);

    uint32_t length = source->outermostDimension();

    // The accumulator: the objet petit a.
    //
    // "A VM's accumulator register is Objet petit a: the unattainable object
    // of desire that sets in motion the symbolic movement of interpretation."
    //     -- PLT Žižek
    RootedValue acc(cx);
    IndexInfo iv(cx);

    if (source->isOneDimensional()) {
        if (!source->getElementFromOnlyDimension(cx, 0, &acc))
            return ExecutionFailed;
    } else {
        if (!iv.initialize(cx, source, 1))
            return ExecutionFailed;
        iv.indices[0] = 0;
        if (!source->getParallelArrayElement(cx, iv, &acc))
            return ExecutionFailed;
    }

    if (buffer)
        buffer->setDenseArrayElementWithType(cx, 0, acc);

    InvokeArgsGuard args;
    if (!cx->stack.pushInvokeArgs(cx, 2, &args))
        return ExecutionFailed;

    RootedValue elem(cx);
    for (uint32_t i = 1; i < length; i++) {
        args.setCallee(ObjectValue(*elementalFun));
        args.setThis(UndefinedValue());

        if (source->isOneDimensional()) {
            if (!source->getElementFromOnlyDimension(cx, i, &elem))
                return ExecutionFailed;
        } else {
            iv.indices[0] = i;
            if (!source->getParallelArrayElement(cx, iv, &elem))
                return ExecutionFailed;
        }

        // Set the two arguments to the elemental function.
        args[0] = acc;
        args[1] = elem;

        if (!Invoke(cx, args))
            return ExecutionFailed;

        // Update the accumulator.
        acc = args.rval();
        if (buffer)
            buffer->setDenseArrayElementWithType(cx, i, args.rval());
    }

    vp.set(acc);

    return ExecutionSucceeded;
}

ParallelArrayObject::ExecutionStatus
ParallelArrayObject::SequentialMode::scatter(JSContext *cx, HandleParallelArrayObject source,
                                             HandleObject targets, const Value &defaultValue,
                                             HandleObject conflictFun, HandleObject buffer)
{
    JS_ASSERT(buffer->isDenseArray());

    uint32_t length = buffer->getDenseArrayInitializedLength();

    IndexInfo iv(cx);
    if (!source->isOneDimensional() && !iv.initialize(cx, source, 1))
        return ExecutionFailed;

    // Index vector and parallel array pointer for targets, in case targets is
    // a ParallelArray object. If not, these are uninitialized.
    IndexInfo tiv(cx);
    RootedParallelArrayObject targetsPA(cx);

    // The length of the scatter vector.
    uint32_t targetsLength;

    if (!MaybeGetParallelArrayObjectAndLength(cx, targets, &targetsPA, &tiv, &targetsLength))
        return ExecutionFailed;

    // Iterate over the scatter vector.
    RootedValue elem(cx);
    RootedValue telem(cx);
    RootedValue targetElem(cx);
    for (uint32_t i = 0; i < targetsLength; i++) {
        uint32_t targetIndex;

        if (!GetElementFromArrayLikeObject(cx, targets, targetsPA, tiv, i, &telem) ||
            !ToUint32(cx, telem, &targetIndex))
        {
            return ExecutionFailed;
        }

        if (targetIndex >= length) {
            JS_ReportErrorNumber(cx, js_GetErrorMessage, NULL,
                                 JSMSG_PAR_ARRAY_SCATTER_BOUNDS);
            return ExecutionFailed;
        }

        if (source->isOneDimensional()) {
            if (!source->getElementFromOnlyDimension(cx, i, &elem))
                return ExecutionFailed;
        } else {
            iv.indices[0] = i;
            if (!source->getParallelArrayElement(cx, iv, &elem))
                return ExecutionFailed;
        }

        targetElem = buffer->getDenseArrayElement(targetIndex);

        // We initialized the dense buffer with holes. If the target element
        // in the source array is not a hole, that means we have set it
        // already and we have a conflict.
        if (!targetElem.isMagic(JS_ARRAY_HOLE)) {
            if (conflictFun) {
                InvokeArgsGuard args;
                if (!cx->stack.pushInvokeArgs(cx, 2, &args))
                    return ExecutionFailed;

                args.setCallee(ObjectValue(*conflictFun));
                args.setThis(UndefinedValue());
                args[0] = elem;
                args[1] = targetElem;

                if (!Invoke(cx, args))
                    return ExecutionFailed;

                elem = args.rval();
            } else {
                JS_ReportErrorNumber(cx, js_GetErrorMessage, NULL,
                                     JSMSG_PAR_ARRAY_SCATTER_CONFLICT);
                return ExecutionFailed;
            }
        }

        buffer->setDenseArrayElementWithType(cx, targetIndex, elem);
    }

    // Fill holes.
    for (uint32_t i = 0; i < length; i++) {
        if (buffer->getDenseArrayElement(i).isMagic(JS_ARRAY_HOLE))
            buffer->setDenseArrayElementWithType(cx, i, defaultValue);
    }

    return ExecutionSucceeded;
}

ParallelArrayObject::ExecutionStatus
ParallelArrayObject::SequentialMode::filter(JSContext *cx, HandleParallelArrayObject source,
                                            HandleObject filters, HandleObject buffer)
{
    JS_ASSERT(buffer->isDenseArray());

    IndexInfo iv(cx);
    if (!source->isOneDimensional() && !iv.initialize(cx, source, 1))
        return ExecutionFailed;

    // Index vector and parallel array pointer for filters, in case filters is
    // a ParallelArray object. If not, these are uninitialized.
    IndexInfo fiv(cx);
    RootedParallelArrayObject filtersPA(cx);

    // The length of the filter array.
    uint32_t filtersLength;

    if (!MaybeGetParallelArrayObjectAndLength(cx, filters, &filtersPA, &fiv, &filtersLength))
        return ExecutionFailed;

    RootedValue elem(cx);
    RootedValue felem(cx);
    for (uint32_t i = 0, pos = 0; i < filtersLength; i++) {
        if (!GetElementFromArrayLikeObject(cx, filters, filtersPA, fiv, i, &felem))
            return ExecutionFailed;

        // Skip if the filter element isn't truthy.
        if (!ToBoolean(felem))
            continue;

        if (source->isOneDimensional()) {
            if (!source->getElementFromOnlyDimension(cx, i, &elem))
                return ExecutionFailed;
        } else {
            iv.indices[0] = i;
            if (!source->getParallelArrayElement(cx, iv, &elem))
                return ExecutionFailed;
        }

        // Set the element on the buffer. If we couldn't stay dense, fail.
        JSObject::EnsureDenseResult result = JSObject::ED_SPARSE;
        result = buffer->ensureDenseArrayElements(cx, pos, 1);
        if (result != JSObject::ED_OK)
            return ExecutionFailed;
        if (i >= buffer->getArrayLength())
            buffer->setDenseArrayLength(pos + 1);
        buffer->setDenseArrayElementWithType(cx, pos, elem);

        // We didn't filter this element out, so bump the position.
        pos++;
    }

    return ExecutionSucceeded;
}

ParallelArrayObject::ExecutionStatus
ParallelArrayObject::ParallelMode::build(JSContext *cx, IndexInfo &iv,
                                         HandleObject elementalFun, HandleObject buffer)
{
    return ExecutionFailed;
}

ParallelArrayObject::ExecutionStatus
ParallelArrayObject::ParallelMode::map(JSContext *cx, HandleParallelArrayObject source,
                                       HandleObject elementalFun, HandleObject buffer)
{
    return ExecutionFailed;
}

ParallelArrayObject::ExecutionStatus
ParallelArrayObject::ParallelMode::reduce(JSContext *cx, HandleParallelArrayObject source,
                                          HandleObject elementalFun, HandleObject buffer,
                                          MutableHandleValue vp)
{
    return ExecutionFailed;
}

ParallelArrayObject::ExecutionStatus
ParallelArrayObject::ParallelMode::scatter(JSContext *cx, HandleParallelArrayObject source,
                                           HandleObject targetsObj, const Value &defaultValue,
                                           HandleObject conflictFun, HandleObject buffer)
{
    return ExecutionFailed;
}

ParallelArrayObject::ExecutionStatus
ParallelArrayObject::ParallelMode::filter(JSContext *cx, HandleParallelArrayObject source,
                                          HandleObject filtersObj, HandleObject buffer)
{
    return ExecutionFailed;
}

ParallelArrayObject::ExecutionStatus
ParallelArrayObject::FallbackMode::build(JSContext *cx, IndexInfo &iv,
                                         HandleObject elementalFun, HandleObject buffer)
{
    if (parallel.build(cx, iv, elementalFun, buffer) ||
        sequential.build(cx, iv, elementalFun, buffer))
    {
        return ExecutionSucceeded;
    }
    return ExecutionFailed;
}

ParallelArrayObject::ExecutionStatus
ParallelArrayObject::FallbackMode::map(JSContext *cx, HandleParallelArrayObject source,
                                       HandleObject elementalFun, HandleObject buffer)
{
    if (parallel.map(cx, source, elementalFun, buffer) ||
        sequential.map(cx, source, elementalFun, buffer))
    {
        return ExecutionSucceeded;
    }
    return ExecutionFailed;
}

ParallelArrayObject::ExecutionStatus
ParallelArrayObject::FallbackMode::reduce(JSContext *cx, HandleParallelArrayObject source,
                                          HandleObject elementalFun, HandleObject buffer,
                                          MutableHandleValue vp)
{
    if (parallel.reduce(cx, source, elementalFun, buffer, vp) ||
        sequential.reduce(cx, source, elementalFun, buffer, vp))
    {
        return ExecutionSucceeded;
    }
    return ExecutionFailed;
}

ParallelArrayObject::ExecutionStatus
ParallelArrayObject::FallbackMode::scatter(JSContext *cx, HandleParallelArrayObject source,
                                           HandleObject targetsObj, const Value &defaultValue,
                                           HandleObject conflictFun, HandleObject buffer)
{
    if (parallel.scatter(cx, source, targetsObj, defaultValue, conflictFun, buffer) ||
        sequential.scatter(cx, source, targetsObj, defaultValue, conflictFun, buffer))
    {
        return ExecutionSucceeded;
    }
    return ExecutionFailed;
}

ParallelArrayObject::ExecutionStatus
ParallelArrayObject::FallbackMode::filter(JSContext *cx, HandleParallelArrayObject source,
                                          HandleObject filtersObj, HandleObject buffer)
{
    if (parallel.filter(cx, source, filtersObj, buffer) ||
        sequential.filter(cx, source, filtersObj, buffer))
    {
        return ExecutionSucceeded;
    }
    return ExecutionFailed;
}

#ifdef DEBUG

const char *
ParallelArrayObject::ExecutionStatusToString(ExecutionStatus ss)
{
    switch (ss) {
      case ExecutionFailed:
        return "failure";
      case ExecutionCompiled:
        return "compilation";
      case ExecutionSucceeded:
        return "success";
    }
    return "(unknown status)";
}

bool
ParallelArrayObject::DebugOptions::init(JSContext *cx, const Value &v)
{
    if (!v.isObject())
        return false;

    RootedObject obj(cx, &v.toObject());
    RootedId id(cx);
    RootedValue propv(cx);
    JSString *propStr;
    JSBool match = false;

    id = AtomToId(Atomize(cx, "mode", strlen("mode")));
    if (!obj->getGeneric(cx, id, &propv))
        return false;

    propStr = ToString(cx, propv);
    if (!JS_StringEqualsAscii(cx, propStr, "par", &match))
        return false;
    if (match) {
        mode = &parallel;
    } else {
        if (!JS_StringEqualsAscii(cx, propStr, "seq", &match))
            return false;
        if (match)
            mode = &sequential;
        else
            return false;
    }

    id = AtomToId(Atomize(cx, "expect", strlen("expect")));
    if (!obj->getGeneric(cx, id, &propv))
        return false;

    propStr = ToString(cx, propv);
    if (!JS_StringEqualsAscii(cx, propStr, "fail", &match))
        return false;
    if (match) {
        expect = ExecutionFailed;
    } else {
        if (!JS_StringEqualsAscii(cx, propStr, "bail", &match))
            return false;
        if (match) {
            expect = ExecutionCompiled;
        } else {
            if (!JS_StringEqualsAscii(cx, propStr, "success", &match))
                return false;
            if (match)
                expect = ExecutionSucceeded;
            else
                return false;
        }
    }

    return true;
}

bool
ParallelArrayObject::DebugOptions::check(JSContext *cx, ExecutionStatus actual)
{
    if (expect != actual) {
        JS_ReportError(cx, "expected %s for %s execution, got %s",
                       ExecutionStatusToString(expect),
                       mode->toString(),
                       ExecutionStatusToString(actual));
        return false;
    }

    return true;
}

#endif // DEBUG

//
// ParallelArrayObject
//

JSFunctionSpec ParallelArrayObject::methods[] = {
    JS_FN("map",                 NonGenericMethod<map>,            1, 0),
    JS_FN("reduce",              NonGenericMethod<reduce>,         1, 0),
    JS_FN("scan",                NonGenericMethod<scan>,           1, 0),
    JS_FN("scatter",             NonGenericMethod<scatter>,        1, 0),
    JS_FN("filter",              NonGenericMethod<filter>,         1, 0),
    JS_FN("flatten",             NonGenericMethod<flatten>,        0, 0),
    JS_FN("partition",           NonGenericMethod<partition>,      1, 0),
    JS_FN("get",                 NonGenericMethod<get>,            1, 0),
    JS_FN(js_toString_str,       NonGenericMethod<toString>,       0, 0),
    JS_FN(js_toLocaleString_str, NonGenericMethod<toLocaleString>, 0, 0),
    JS_FS_END
};

Class ParallelArrayObject::protoClass = {
    "ParallelArray",
    JSCLASS_HAS_CACHED_PROTO(JSProto_ParallelArray),
    JS_PropertyStub,         // addProperty
    JS_PropertyStub,         // delProperty
    JS_PropertyStub,         // getProperty
    JS_StrictPropertyStub,   // setProperty
    JS_EnumerateStub,
    JS_ResolveStub,
    JS_ConvertStub
};

Class ParallelArrayObject::class_ = {
    "ParallelArray",
    Class::NON_NATIVE |
    JSCLASS_HAS_RESERVED_SLOTS(RESERVED_SLOTS) |
    JSCLASS_HAS_CACHED_PROTO(JSProto_ParallelArray),
    JS_PropertyStub,         // addProperty
    JS_PropertyStub,         // delProperty
    JS_PropertyStub,         // getProperty
    JS_StrictPropertyStub,   // setProperty
    JS_EnumerateStub,
    JS_ResolveStub,
    JS_ConvertStub,
    NULL,                    // finalize
    NULL,                    // checkAccess
    NULL,                    // call
    NULL,                    // construct
    NULL,                    // hasInstance
    mark,                    // trace
    JS_NULL_CLASS_EXT,
    {
        lookupGeneric,
        lookupProperty,
        lookupElement,
        lookupSpecial,
        defineGeneric,
        defineProperty,
        defineElement,
        defineSpecial,
        getGeneric,
        getProperty,
        getElement,
        NULL,                // getElementIfPresent
        getSpecial,
        setGeneric,
        setProperty,
        setElement,
        setSpecial,
        getGenericAttributes,
        getPropertyAttributes,
        getElementAttributes,
        getSpecialAttributes,
        setGenericAttributes,
        setPropertyAttributes,
        setElementAttributes,
        setSpecialAttributes,
        deleteProperty,
        deleteElement,
        deleteSpecial,
        enumerate,
        NULL,                // typeof
        NULL,                // thisObject
        NULL,                // clear
    }
};

JSObject *
ParallelArrayObject::initClass(JSContext *cx, JSObject *obj)
{
    JS_ASSERT(obj->isNative());

    Rooted<GlobalObject *> global(cx, &obj->asGlobal());

    RootedObject proto(cx, global->createBlankPrototype(cx, &protoClass));
    if (!proto)
        return NULL;

    JSProtoKey key = JSProto_ParallelArray;
    JSAtom *atom = CLASS_NAME(cx, ParallelArray);
    RootedFunction ctor(cx, global->createConstructor(cx, construct, atom, 0));
    if (!ctor ||
        !LinkConstructorAndPrototype(cx, ctor, proto) ||
        !DefinePropertiesAndBrand(cx, proto, NULL, methods) ||
        !DefineConstructorAndPrototype(cx, global, key, ctor, proto))
    {
        return NULL;
    }

    // Define the length and shape properties.
    RootedId lengthId(cx, AtomToId(cx->runtime->atomState.lengthAtom));
    RootedId shapeId(cx, AtomToId(cx->runtime->atomState.shapeAtom));
    unsigned flags = JSPROP_PERMANENT | JSPROP_READONLY | JSPROP_SHARED | JSPROP_GETTER;

    JSObject *scriptedLength = js_NewFunction(cx, NULL, NonGenericMethod<lengthGetter>,
                                              0, 0, global, NULL);
    JSObject *scriptedShape = js_NewFunction(cx, NULL, NonGenericMethod<dimensionsGetter>,
                                             0, 0, global, NULL);

    RootedValue value(cx, UndefinedValue());
    if (!scriptedLength || !scriptedShape ||
        !DefineNativeProperty(cx, proto, lengthId, value,
                              JS_DATA_TO_FUNC_PTR(PropertyOp, scriptedLength), NULL,
                              flags, 0, 0) ||
        !DefineNativeProperty(cx, proto, shapeId, value,
                              JS_DATA_TO_FUNC_PTR(PropertyOp, scriptedShape), NULL,
                              flags, 0, 0))
    {
        return NULL;
    }

    return proto;
}

bool
ParallelArrayObject::getElementFromOnlyDimension(JSContext *cx, uint32_t index, MutableHandleValue vp)
{
    JS_ASSERT(isOneDimensional());

    uint32_t base = bufferOffset();
    uint32_t end = base + outermostDimension();

    if (base + index >= end)
        vp.setUndefined();
    else
        vp.set(buffer()->getDenseArrayElement(base + index));

    return true;
}

bool
ParallelArrayObject::getParallelArrayElement(JSContext *cx, IndexInfo &iv, MutableHandleValue vp)
{
    JS_ASSERT(iv.isInitialized());

    // How many indices we have determine what dimension we are indexing. For
    // example, if we have 2 indices [n,m], we are indexing something on the
    // 2nd dimension.
    uint32_t d = iv.indices.length();
    uint32_t ndims = iv.dimensions.length();
    JS_ASSERT(d <= ndims);

    uint32_t base = bufferOffset();
    uint32_t end = base + iv.scalarLengthOfDimensions();

    // If we are provided an index vector with every dimension specified, we
    // are indexing a leaf. Leaves are always value, so just return them.
    if (d == ndims) {
        uint32_t index = base + iv.toScalar();
        if (index >= end)
            vp.setUndefined();
        else
            vp.set(buffer()->getDenseArrayElement(index));
        return true;
    }

    // If we aren't indexing a leaf value, we should return a new
    // ParallelArray of lesser dimensionality. Here we create a new 'view' on
    // the underlying buffer, though whether a ParallelArray is a view or a
    // copy is not observable by the user.
    uint32_t rowLength = iv.partialProducts[d - 1];
    uint32_t offset = base + iv.toScalar();
    if (offset + rowLength > end) {
        vp.setUndefined();
        return true;
    }

    RootedObject buf(cx, buffer());
    IndexVector newDims(cx);
    return (newDims.append(iv.dimensions.begin() + d, iv.dimensions.end()) &&
            create(cx, buf, offset, newDims, vp));
}

bool
ParallelArrayObject::getParallelArrayElement(JSContext *cx, uint32_t index, MutableHandleValue vp)
{
    IndexInfo iv(cx);
    // Manually initialize to avoid re-rooting 'this', as this code could be
    // called from inside a loop.
    if (!getDimensions(cx, iv.dimensions) || !iv.initialize(1))
        return false;
    iv.indices[0] = index;
    return getParallelArrayElement(cx, iv, vp);
}

bool
ParallelArrayObject::create(JSContext *cx, MutableHandleValue vp)
{
    IndexVector dims(cx);
    if (!dims.append(0))
        return false;
    return create(cx, NullPtr(), 0, dims, vp);
}

bool
ParallelArrayObject::create(JSContext *cx, HandleObject buffer, MutableHandleValue vp)
{
    IndexVector dims(cx);
    if (!dims.append(buffer->getArrayLength()))
        return false;
    return create(cx, buffer, 0, dims, vp);
}

bool
ParallelArrayObject::create(JSContext *cx, HandleObject buffer, uint32_t offset,
                            const IndexVector &dims, MutableHandleValue vp)
{
    JS_ASSERT_IF(buffer, buffer->isDenseArray());

    RootedObject result(cx, NewBuiltinClassInstance(cx, &class_));
    if (!result)
        return false;

    // Propagate element types.
    if (buffer && cx->typeInferenceEnabled()) {
        AutoEnterTypeInference enter(cx);
        TypeSet *bufferTypes = buffer->getType(cx)->getProperty(cx, JSID_VOID, false);
        TypeSet *resultTypes = result->getType(cx)->getProperty(cx, JSID_VOID, true);
        bufferTypes->addSubset(cx, resultTypes);
    }

    // Store the dimension vector into a dense array for better GC / layout.
    RootedObject dimArray(cx, NewDenseArrayWithType(cx, dims.length()));
    if (!dimArray)
        return false;

    for (uint32_t i = 0; i < dims.length(); i++)
        dimArray->setDenseArrayElementWithType(cx, i, Int32Value(static_cast<int32_t>(dims[i])));

    result->setSlot(SLOT_DIMENSIONS, ObjectValue(*dimArray));

    // Store the buffer and offset.
    if (buffer) {
        result->setSlot(SLOT_BUFFER, ObjectValue(*buffer));
        result->setSlot(SLOT_BUFFER_OFFSET, Int32Value(static_cast<int32_t>(offset)));
    } else {
        result->setSlot(SLOT_BUFFER, UndefinedValue());
        result->setSlot(SLOT_BUFFER_OFFSET, Int32Value(0));
    }

    // This is usually args.rval() from build or construct.
    vp.setObject(*result);

    return true;
}

JSBool
ParallelArrayObject::construct(JSContext *cx, unsigned argc, Value *vp)
{
    CallArgs args = CallArgsFromVp(argc, vp);

    // Trivial case: create an empty ParallelArray object.
    if (args.length() < 1)
        return create(cx, args.rval());

    // First case: initialize using an array value.
    if (args.length() == 1) {
        if (!args[0].isObject()) {
            JS_ReportErrorNumber(cx, js_GetErrorMessage, NULL, JSMSG_PAR_ARRAY_BAD_ARG, "");
            return false;
        }

        RootedObject source(cx, &(args[0].toObject()));

        // When using an array value we can only make one dimensional arrays.
        IndexVector dims(cx);
        uint32_t length;
        if (!dims.resize(1) || !js_GetLengthProperty(cx, source, &length))
            return false;
        dims[0] = length;

        RootedObject buffer(cx);

        // If the source is already a dense array, just copy it over
        // wholesale. Else copy it pointwise.
        if (source->isDenseArray()) {
            buffer = NewDenseArrayWithType(cx, length, source);
            if (!buffer)
                return false;
        } else {
            buffer = NewDenseArrayWithType(cx, length);
            if (!buffer)
                return false;

            RootedValue elem(cx);
            for (uint32_t i = 0; i < length; i++) {
                if (!source->getElement(cx, i, &elem))
                    return false;
                buffer->setDenseArrayElementWithType(cx, i, elem);
            }
        }

        return create(cx, buffer, 0, dims, args.rval());
    }

    // Second case: initialize using a length/dimensions vector and kernel.
    //
    // If the length is an integer, we build a 1-dimensional parallel
    // array using the kernel.
    //
    // If the length is an array-like object of sizes, the i-th value in the
    // dimension array is the size of the i-th dimension.
    IndexInfo iv(cx);
    if (args[0].isObject()) {
        RootedObject dimObj(cx, &(args[0].toObject()));
        if (!ArrayLikeToIndexVector(cx, dimObj, iv.dimensions))
            return false;
    } else {
        if (!iv.dimensions.resize(1) || !ToUint32(cx, args[0], &iv.dimensions[0]))
            return false;
    }
    if (!iv.initialize(0))
        return false;

    // Extract second argument, the elemental function.
    RootedObject elementalFun(cx, ValueToCallable(cx, &args[1]));
    if (!elementalFun)
        return false;

    // How long the flattened array will be.
    uint32_t length = iv.scalarLengthOfDimensions();

    // Create backing store.
    RootedObject buffer(cx, NewDenseArrayWithType(cx, length));
    if (!buffer)
        return false;

#ifdef DEBUG
    if (args.length() > 1) {
        DebugOptions options;
        if (options.init(cx, args[1])) {
            if (!options.check(cx, options.mode->build(cx, iv, elementalFun, buffer)))
                return false;
            return create(cx, buffer, 0, iv.dimensions, args.rval());
        }
    }
#endif

    if (fallback.build(cx, iv, elementalFun, buffer) != ExecutionSucceeded)
        return false;

    return create(cx, buffer, 0, iv.dimensions, args.rval());
}

bool
ParallelArrayObject::map(JSContext *cx, CallArgs args)
{
    if (args.length() < 1) {
        JS_ReportErrorNumber(cx, js_GetErrorMessage, NULL, JSMSG_MORE_ARGS_NEEDED,
                             "ParallelArray.prototype.map", "0", "s");
        return false;
    }

    RootedParallelArrayObject obj(cx, as(&args.thisv().toObject()));

    uint32_t outer = obj->outermostDimension();
    RootedObject buffer(cx, NewDenseArrayWithType(cx, outer));
    if (!buffer)
        return false;

    RootedObject elementalFun(cx, ValueToCallable(cx, &args[0]));
    if (!elementalFun)
        return false;

#ifdef DEBUG
    if (args.length() > 1) {
        DebugOptions options;
        if (options.init(cx, args[1])) {
            if (!options.check(cx, options.mode->map(cx, obj, elementalFun, buffer)))
                return false;
            return create(cx, buffer, args.rval());
        }
    }
#endif

    if (fallback.map(cx, obj, elementalFun, buffer) != ExecutionSucceeded)
        return false;

    return create(cx, buffer, args.rval());
}

bool
ParallelArrayObject::reduce(JSContext *cx, CallArgs args)
{
    if (args.length() < 1) {
        JS_ReportErrorNumber(cx, js_GetErrorMessage, NULL, JSMSG_MORE_ARGS_NEEDED,
                             "ParallelArray.prototype.reduce", "0", "s");
        return false;
    }

    RootedParallelArrayObject obj(cx, as(&args.thisv().toObject()));
    uint32_t outer = obj->outermostDimension();

    // Throw if the array is empty.
    if (outer == 0) {
        JS_ReportErrorNumber(cx, js_GetErrorMessage, NULL, JSMSG_PAR_ARRAY_REDUCE_EMPTY);
        return false;
    }

    RootedObject elementalFun(cx, ValueToCallable(cx, &args[0]));
    if (!elementalFun)
        return false;

#ifdef DEBUG
    if (args.length() > 1) {
        DebugOptions options;
        if (options.init(cx, args[1])) {
            return options.check(cx, options.mode->reduce(cx, obj, elementalFun, NullPtr(),
                                                          args.rval()));
        }
    }
#endif

    // Call reduce with a null destination buffer to not store intermediates.
    return fallback.reduce(cx, obj, elementalFun, NullPtr(), args.rval()) == ExecutionSucceeded;
}

bool
ParallelArrayObject::scan(JSContext *cx, CallArgs args)
{
    if (args.length() < 1) {
        JS_ReportErrorNumber(cx, js_GetErrorMessage, NULL, JSMSG_MORE_ARGS_NEEDED,
                             "ParallelArray.prototype.scan", "0", "s");
        return false;
    }

    RootedParallelArrayObject obj(cx, as(&args.thisv().toObject()));

    uint32_t outer = obj->outermostDimension();

    // Throw if the array is empty.
    if (outer == 0) {
        JS_ReportErrorNumber(cx, js_GetErrorMessage, NULL, JSMSG_PAR_ARRAY_REDUCE_EMPTY);
        return false;
    }

    RootedObject buffer(cx, NewDenseArrayWithType(cx, outer));
    if (!buffer)
        return false;

    RootedObject elementalFun(cx, ValueToCallable(cx, &args[0]));
    if (!elementalFun)
        return false;

    // Call reduce with a dummy out value to be discarded and a buffer to
    // store intermediates.
    RootedValue dummy(cx);

#ifdef DEBUG
    if (args.length() > 1) {
        DebugOptions options;
        if (options.init(cx, args[1])) {
            if (!options.check(cx, options.mode->reduce(cx, obj, elementalFun, buffer, &dummy)))
                return false;
            return create(cx, buffer, args.rval());
        }
    }
#endif

    if (fallback.reduce(cx, obj, elementalFun, buffer, &dummy) != ExecutionSucceeded)
        return false;

    return create(cx, buffer, args.rval());
}

bool
ParallelArrayObject::scatter(JSContext *cx, CallArgs args)
{
    if (args.length() < 1) {
        JS_ReportErrorNumber(cx, js_GetErrorMessage, NULL, JSMSG_MORE_ARGS_NEEDED,
                             "ParallelArray.prototype.scatter", "0", "s");
        return false;
    }

    if (!args[0].isObject()) {
        JS_ReportErrorNumber(cx, js_GetErrorMessage, NULL, JSMSG_PAR_ARRAY_BAD_ARG,
                             ".prototype.scatter");
        return false;
    }

    RootedParallelArrayObject obj(cx, as(&args.thisv().toObject()));
    uint32_t outer = obj->outermostDimension();

    // Get the scatter vector.
    RootedObject targets(cx, &args[0].toObject());
    uint32_t targetsLength;
    if (!js_GetLengthProperty(cx, targets, &targetsLength))
        return false;

    // Don't iterate more than the length of the source array.
    if (targetsLength > outer)
        targetsLength = outer;

    // The default value is optional and defaults to undefined.
    Value defaultValue;
    if (args.length() >= 2)
        defaultValue = args[1];
    else
        defaultValue.setUndefined();

    // The conflict function is optional.
    RootedObject conflictFun(cx);
    if (args.length() >= 3 && !args[2].isUndefined()) {
        conflictFun = ValueToCallable(cx, &args[2]);
        if (!conflictFun)
            return false;
    }

    // The length of the result array is optional and defaults to the length
    // of the source array.
    uint32_t resultLength;
    if (args.length() >= 4) {
        if (!ToUint32(cx, args[3], &resultLength))
            return false;
    } else {
        resultLength = outer;
    }

    // Create a destination buffer. Fail if we can't maintain denseness.
    RootedObject buffer(cx, NewDenseArrayWithType(cx, resultLength));
    if (!buffer)
        return false;

#ifdef DEBUG
    if (args.length() > 1) {
        DebugOptions options;
        if (options.init(cx, args[1])) {
            if (!options.check(cx, options.mode->scatter(cx, obj, targets, defaultValue,
                                                         conflictFun, buffer)))
            {
                return false;
            }
            return create(cx, buffer, args.rval());
        }
    }
#endif

    if (fallback.scatter(cx, obj, targets, defaultValue,
                         conflictFun, buffer) != ExecutionSucceeded)
    {
        return false;
    }

    return create(cx, buffer, args.rval());
}

bool
ParallelArrayObject::filter(JSContext *cx, CallArgs args)
{
    if (args.length() < 1) {
        JS_ReportErrorNumber(cx, js_GetErrorMessage, NULL, JSMSG_MORE_ARGS_NEEDED,
                             "ParallelArray.prototype.filter", "0", "s");
        return false;
    }

    if (!args[0].isObject()) {
        JS_ReportErrorNumber(cx, js_GetErrorMessage, NULL, JSMSG_PAR_ARRAY_BAD_ARG,
                             ".prototype.filter");
        return false;
    }

    RootedParallelArrayObject obj(cx, as(&args.thisv().toObject()));

    // Get the filter vector.
    RootedObject filters(cx, &args[0].toObject());

    RootedObject buffer(cx, NewDenseArrayWithType(cx, 0));
    if (!buffer)
        return false;

#ifdef DEBUG
    if (args.length() > 1) {
        DebugOptions options;
        if (options.init(cx, args[1])) {
            if (!options.check(cx, options.mode->filter(cx, obj, filters, buffer)))
                return false;
            return create(cx, buffer, args.rval());
        }
    }
#endif

    if (fallback.filter(cx, obj, filters, buffer) != ExecutionSucceeded)
        return false;

    return create(cx, buffer, args.rval());
}

bool
ParallelArrayObject::flatten(JSContext *cx, CallArgs args)
{
    RootedParallelArrayObject obj(cx, as(&args.thisv().toObject()));

    IndexVector dims(cx);
    if (!obj->getDimensions(cx, dims))
        return false;

    // Throw if already flat.
    if (dims.length() == 1) {
        JS_ReportErrorNumber(cx, js_GetErrorMessage, NULL, JSMSG_PAR_ARRAY_ALREADY_FLAT);
        return false;
    }

    // Flatten the two outermost dimensions.
    dims[1] *= dims[0];
    dims.erase(dims.begin());

    RootedObject buffer(cx, obj->buffer());
    return create(cx, buffer, obj->bufferOffset(), dims, args.rval());
}

bool
ParallelArrayObject::partition(JSContext *cx, CallArgs args)
{
    if (args.length() < 1) {
        JS_ReportErrorNumber(cx, js_GetErrorMessage, NULL, JSMSG_MORE_ARGS_NEEDED,
                             "ParallelArray.prototype.partition", "0", "s");
        return false;
    }

    uint32_t newDimension;
    if (!ToUint32(cx, args[0], &newDimension))
        return false;

    RootedParallelArrayObject obj(cx, as(&args.thisv().toObject()));

    // Throw if the outer dimension is not divisible by the new dimension.
    uint32_t outer = obj->outermostDimension();
    if (outer % newDimension) {
        JS_ReportErrorNumber(cx, js_GetErrorMessage, NULL, JSMSG_PAR_ARRAY_BAD_PARTITION);
        return false;
    }

    IndexVector dims(cx);
    if (!obj->getDimensions(cx, dims))
        return false;

    // Set the new outermost dimension to be the quotient of the old outermost
    // dimension and the new dimension.
    if (!dims.insert(dims.begin(), outer / newDimension))
        return false;

    // Set the old outermost dimension to be the new dimension.
    dims[1] = newDimension;

    RootedObject buffer(cx, obj->buffer());
    return create(cx, buffer, obj->bufferOffset(), dims, args.rval());
}

bool
ParallelArrayObject::get(JSContext *cx, CallArgs args)
{
    if (args.length() < 1) {
        JS_ReportErrorNumber(cx, js_GetErrorMessage, NULL, JSMSG_MORE_ARGS_NEEDED,
                             "ParallelArray.prototype.get", "0", "s");
        return false;
    }

    if (!args[0].isObject()) {
        JS_ReportErrorNumber(cx, js_GetErrorMessage, NULL, JSMSG_PAR_ARRAY_BAD_ARG,
                             ".prototype.get");
        return false;
    }

    RootedParallelArrayObject obj(cx, as(&args.thisv().toObject()));
    RootedObject indicesObj(cx, &(args[0].toObject()));

    if (obj->isOneDimensional()) {
        uint32_t length;
        if (is(indicesObj))
            length = as(indicesObj)->outermostDimension();
        else if (!js_GetLengthProperty(cx, indicesObj, &length))
            return false;

        // If we're one dimensional, indexing more than one dimension is
        // definitely out of bounds.
        if (length > 1) {
            args.rval().setUndefined();
            return true;
        }

        RootedValue elem(cx);
        uint32_t index;
        if (is(indicesObj)) {
            if (!as(indicesObj)->getParallelArrayElement(cx, 0, &elem))
                return false;
        } else {
            if (!indicesObj->getElement(cx, 0, &elem))
                return false;
        }

        if (!ToUint32(cx, elem, &index))
            return false;

        return obj->getElementFromOnlyDimension(cx, index, args.rval());
    }

    IndexInfo iv(cx);
    if (!iv.initialize(cx, obj, 0))
        return false;
    if (!ArrayLikeToIndexVector(cx, indicesObj, iv.indices))
        return false;

    // Set undefined if definitely out of bounds.
    if (iv.indices.length() > iv.dimensions.length()) {
        args.rval().setUndefined();
        return true;
    }

    return obj->getParallelArrayElement(cx, iv, args.rval());
}

bool
ParallelArrayObject::dimensionsGetter(JSContext *cx, CallArgs args)
{
    args.rval().setObject(*(as(&args.thisv().toObject())->dimensionArray()));
    return true;
}

bool
ParallelArrayObject::lengthGetter(JSContext *cx, CallArgs args)
{
    args.rval().setNumber(as(&args.thisv().toObject())->outermostDimension());
    return true;
}

bool
ParallelArrayObject::toStringBufferImpl(JSContext *cx, IndexInfo &iv, bool useLocale,
                                        HandleObject buffer, StringBuffer &sb)
{
    JS_ASSERT(iv.isInitialized());

    // The dimension we're printing out.
    uint32_t d = iv.indices.length() + 1;

    // If we still have more dimensions to go.
    if (d < iv.dimensions.length()) {
        if (!sb.append('<'))
            return false;

        iv.indices.infallibleAppend(0);
        uint32_t length = iv.dimensions[d - 1];
        for (size_t i = 0; i < length; i++) {
            iv.indices[d - 1] = i;
            if (!toStringBufferImpl(cx, iv, useLocale, buffer, sb) ||
                (i + 1 != length && !sb.append(',')))
            {
                return false;
            }
        }
        iv.indices.shrinkBy(1);

        if (!sb.append('>'))
            return false;

        return true;
    }

    // We're on the last dimension.
    if (!sb.append('<'))
        return false;

    uint32_t offset;
    uint32_t length;

    // If the array is flat, we can just use the entire extent.
    if (d == 1) {
        offset = bufferOffset();
        length = iv.dimensions[0];
    } else {
        offset = bufferOffset() + iv.toScalar();
        length = iv.partialProducts[d - 2];
    }

    RootedValue tmp(cx);
    RootedValue localeElem(cx);
    RootedId id(cx);

    const Value *start = buffer->getDenseArrayElements() + offset;
    const Value *end = start + length;
    const Value *elem;

    for (elem = start; elem < end; elem++) {
        if (!JS_CHECK_OPERATION_LIMIT(cx))
            return false;

        if (!elem->isMagic(JS_ARRAY_HOLE) && !elem->isNullOrUndefined()) {
            if (useLocale) {
                tmp = *elem;
                JSObject *robj = ToObject(cx, tmp);
                if (!robj)
                    return false;

                id = NameToId(cx->runtime->atomState.toLocaleStringAtom);
                if (!robj->callMethod(cx, id, 0, NULL, &localeElem) ||
                    !ValueToStringBuffer(cx, localeElem, sb))
                {
                    return false;
                }
            } else {
                if (!ValueToStringBuffer(cx, *elem, sb))
                    return false;
            }
        }

        if (elem + 1 != end && !sb.append(','))
            return false;
    }

    if (!sb.append('>'))
        return false;

    return true;
}

bool
ParallelArrayObject::toStringBuffer(JSContext *cx, bool useLocale, StringBuffer &sb)
{
    RootedParallelArrayObject self(cx, this);
    IndexInfo iv(cx);
    if (!iv.initialize(cx, self, 0))
        return false;
    RootedObject buffer(cx, this->buffer());
    return toStringBufferImpl(cx, iv, useLocale, buffer, sb);
}

bool
ParallelArrayObject::toString(JSContext *cx, CallArgs args)
{
    StringBuffer sb(cx);
    if (!as(&args.thisv().toObject())->toStringBuffer(cx, false, sb))
        return false;

    if (JSString *str = sb.finishString()) {
        args.rval().setString(str);
        return true;
    }

    return false;
}

bool
ParallelArrayObject::toLocaleString(JSContext *cx, CallArgs args)
{
    StringBuffer sb(cx);
    if (!as(&args.thisv().toObject())->toStringBuffer(cx, true, sb))
        return false;

    if (JSString *str = sb.finishString()) {
        args.rval().setString(str);
        return true;
    }

    return false;
}

void
ParallelArrayObject::mark(JSTracer *trc, JSObject *obj)
{
    gc::MarkSlot(trc, &obj->getSlotRef(SLOT_DIMENSIONS), "parallelarray.shape");
    gc::MarkSlot(trc, &obj->getSlotRef(SLOT_BUFFER), "parallelarray.buffer");
}

JSBool
ParallelArrayObject::lookupGeneric(JSContext *cx, HandleObject obj, HandleId id,
                                   MutableHandleObject objp, MutableHandleShape propp)
{
    RootedObject buffer(cx, as(obj)->buffer());

    if (JSID_IS_ATOM(id, cx->runtime->atomState.lengthAtom) ||
        as(obj)->inOutermostDimensionRange(cx, id)) {
        MarkNonNativePropertyFound(obj, propp);
        objp.set(obj);
        return true;
    }

    if (JSObject *proto = obj->getProto()) {
        return proto->lookupGeneric(cx, id, objp, propp);
    }

    objp.set(NULL);
    propp.set(NULL);
    return true;
}

JSBool
ParallelArrayObject::lookupProperty(JSContext *cx, HandleObject obj, HandlePropertyName name,
                                    MutableHandleObject objp, MutableHandleShape propp)
{
    RootedId id(cx, NameToId(name));
    return lookupGeneric(cx, obj, id, objp, propp);
}

JSBool
ParallelArrayObject::lookupElement(JSContext *cx, HandleObject obj, uint32_t index,
                                   MutableHandleObject objp, MutableHandleShape propp)
{
    if (as(obj)->inOutermostDimensionRange(index)) {
        MarkNonNativePropertyFound(obj, propp);
        objp.set(obj);
        return true;
    }

    if (JSObject *proto = obj->getProto())
        return proto->lookupElement(cx, index, objp, propp);

    objp.set(NULL);
    propp.set(NULL);
    return true;
}

JSBool
ParallelArrayObject::lookupSpecial(JSContext *cx, HandleObject obj, HandleSpecialId sid,
                                   MutableHandleObject objp, MutableHandleShape propp)
{
    RootedId id(cx, SPECIALID_TO_JSID(sid));
    return lookupGeneric(cx, obj, id, objp, propp);
}

JSBool
ParallelArrayObject::defineGeneric(JSContext *cx, HandleObject obj, HandleId id, HandleValue Value,
                                   JSPropertyOp getter, StrictPropertyOp setter, unsigned attrs)
{
    JS_ReportErrorNumber(cx, js_GetErrorMessage, NULL, JSMSG_PAR_ARRAY_IMMUTABLE);
    return false;
}

JSBool
ParallelArrayObject::defineProperty(JSContext *cx, HandleObject obj,
                                    HandlePropertyName name, HandleValue value,
                                    JSPropertyOp getter, StrictPropertyOp setter, unsigned attrs)
{
    JS_ReportErrorNumber(cx, js_GetErrorMessage, NULL, JSMSG_PAR_ARRAY_IMMUTABLE);
    return false;
}

JSBool
ParallelArrayObject::defineElement(JSContext *cx, HandleObject obj,
                                   uint32_t index, HandleValue value,
                                   PropertyOp getter, StrictPropertyOp setter, unsigned attrs)
{
    JS_ReportErrorNumber(cx, js_GetErrorMessage, NULL, JSMSG_PAR_ARRAY_IMMUTABLE);
    return false;
}

JSBool
ParallelArrayObject::defineSpecial(JSContext *cx, HandleObject obj,
                                   HandleSpecialId sid, HandleValue value,
                                   PropertyOp getter, StrictPropertyOp setter, unsigned attrs)
{
    JS_ReportErrorNumber(cx, js_GetErrorMessage, NULL, JSMSG_PAR_ARRAY_IMMUTABLE);
    return false;
}

JSBool
ParallelArrayObject::getGeneric(JSContext *cx, HandleObject obj, HandleObject receiver,
                                HandleId id, MutableHandleValue vp)
{
    Value idval = IdToValue(id);

    uint32_t index;
    if (IsDefinitelyIndex(idval, &index))
        return getElement(cx, obj, receiver, index, vp);

    JSAtom *atom = ToAtom(cx, idval);
    if (!atom)
        return false;

    if (atom->isIndex(&index))
        return getElement(cx, obj, receiver, index, vp);

    Rooted<PropertyName*> name(cx, atom->asPropertyName());
    return getProperty(cx, obj, receiver, name, vp);
}

JSBool
ParallelArrayObject::getProperty(JSContext *cx, HandleObject obj, HandleObject receiver,
                                 HandlePropertyName name, MutableHandleValue vp)
{
    if (name == cx->runtime->atomState.lengthAtom) {
        vp.setNumber(as(obj)->outermostDimension());
        return true;
    }

    if (JSObject *proto = obj->getProto())
        return proto->getProperty(cx, receiver, name, vp);

    vp.setUndefined();
    return true;
}

JSBool
ParallelArrayObject::getElement(JSContext *cx, HandleObject obj, HandleObject receiver,
                                uint32_t index, MutableHandleValue vp)
{
    RootedParallelArrayObject source(cx, as(obj));
    if (source->inOutermostDimensionRange(index)) {
        if (source->isOneDimensional())
            return source->getElementFromOnlyDimension(cx, index, vp);
        return source->getParallelArrayElement(cx, index, vp);
    }

    if (JSObject *proto = obj->getProto())
        return proto->getElement(cx, receiver, index, vp);

    vp.setUndefined();
    return true;
}

JSBool
ParallelArrayObject::getSpecial(JSContext *cx, HandleObject obj, HandleObject receiver,
                                HandleSpecialId sid, MutableHandleValue vp)
{
    if (!obj->getProto()) {
        vp.setUndefined();
        return true;
    }

    RootedId id(cx, SPECIALID_TO_JSID(sid));
    return baseops::GetProperty(cx, obj, receiver, id, vp);
}

JSBool
ParallelArrayObject::setGeneric(JSContext *cx, HandleObject obj, HandleId id,
                                MutableHandleValue vp, JSBool strict)
{
    JS_ReportErrorNumber(cx, js_GetErrorMessage, NULL, JSMSG_PAR_ARRAY_IMMUTABLE);
    return false;
}

JSBool
ParallelArrayObject::setProperty(JSContext *cx, HandleObject obj, HandlePropertyName name,
                                 MutableHandleValue vp, JSBool strict)
{
    JS_ReportErrorNumber(cx, js_GetErrorMessage, NULL, JSMSG_PAR_ARRAY_IMMUTABLE);
    return false;
}

JSBool
ParallelArrayObject::setElement(JSContext *cx, HandleObject obj, uint32_t index,
                                MutableHandleValue vp, JSBool strict)
{
    JS_ReportErrorNumber(cx, js_GetErrorMessage, NULL, JSMSG_PAR_ARRAY_IMMUTABLE);
    return false;
}

JSBool
ParallelArrayObject::setSpecial(JSContext *cx, HandleObject obj, HandleSpecialId sid,
                                MutableHandleValue vp, JSBool strict)
{
    JS_ReportErrorNumber(cx, js_GetErrorMessage, NULL, JSMSG_PAR_ARRAY_IMMUTABLE);
    return false;
}

JSBool
ParallelArrayObject::getGenericAttributes(JSContext *cx, HandleObject obj, HandleId id,
                                          unsigned *attrsp)
{
    if (JSID_IS_ATOM(id, cx->runtime->atomState.lengthAtom))
        *attrsp = JSPROP_PERMANENT | JSPROP_READONLY;
    else
        *attrsp = JSPROP_PERMANENT | JSPROP_READONLY | JSPROP_ENUMERATE;

    return true;
}

JSBool
ParallelArrayObject::getPropertyAttributes(JSContext *cx, HandleObject obj, HandlePropertyName name,
                                           unsigned *attrsp)
{
    if (name == cx->runtime->atomState.lengthAtom)
        *attrsp = JSPROP_PERMANENT | JSPROP_READONLY;
    return true;
}

JSBool
ParallelArrayObject::getElementAttributes(JSContext *cx, HandleObject obj, uint32_t index,
                                          unsigned *attrsp)
{
    *attrsp = JSPROP_PERMANENT | JSPROP_READONLY | JSPROP_ENUMERATE;
    return true;
}

JSBool
ParallelArrayObject::getSpecialAttributes(JSContext *cx, HandleObject obj, HandleSpecialId sid,
                                          unsigned *attrsp)
{
    *attrsp = JSPROP_PERMANENT | JSPROP_READONLY | JSPROP_ENUMERATE;
    return true;
}

JSBool
ParallelArrayObject::setGenericAttributes(JSContext *cx, HandleObject obj, HandleId id,
                                          unsigned *attrsp)
{
    JS_ReportErrorNumber(cx, js_GetErrorMessage, NULL, JSMSG_PAR_ARRAY_IMMUTABLE);
    return false;
}

JSBool
ParallelArrayObject::setPropertyAttributes(JSContext *cx, HandleObject obj, HandlePropertyName name,
                                           unsigned *attrsp)
{
    JS_ReportErrorNumber(cx, js_GetErrorMessage, NULL, JSMSG_PAR_ARRAY_IMMUTABLE);
    return false;
}

JSBool
ParallelArrayObject::setElementAttributes(JSContext *cx, HandleObject obj, uint32_t index,
                                          unsigned *attrsp)
{
    JS_ReportErrorNumber(cx, js_GetErrorMessage, NULL, JSMSG_PAR_ARRAY_IMMUTABLE);
    return false;
}

JSBool
ParallelArrayObject::setSpecialAttributes(JSContext *cx, HandleObject obj, HandleSpecialId sid,
                                          unsigned *attrsp)
{
    JS_ReportErrorNumber(cx, js_GetErrorMessage, NULL, JSMSG_PAR_ARRAY_IMMUTABLE);
    return false;
}

JSBool
ParallelArrayObject::deleteGeneric(JSContext *cx, HandleObject obj, HandleId id,
                                   MutableHandleValue rval, JSBool strict)
{
    JS_ReportErrorNumber(cx, js_GetErrorMessage, NULL, JSMSG_PAR_ARRAY_IMMUTABLE);
    return false;
}

JSBool
ParallelArrayObject::deleteProperty(JSContext *cx, HandleObject obj, HandlePropertyName name,
                                    MutableHandleValue rval, JSBool strict)
{
    JS_ReportErrorNumber(cx, js_GetErrorMessage, NULL, JSMSG_PAR_ARRAY_IMMUTABLE);
    return false;
}

JSBool
ParallelArrayObject::deleteElement(JSContext *cx, HandleObject obj, uint32_t index,
                                   MutableHandleValue rval, JSBool strict)
{
    JS_ReportErrorNumber(cx, js_GetErrorMessage, NULL, JSMSG_PAR_ARRAY_IMMUTABLE);
    return false;
}

JSBool
ParallelArrayObject::deleteSpecial(JSContext *cx, HandleObject obj, HandleSpecialId sid,
                                   MutableHandleValue rval, JSBool strict)
{
    JS_ReportErrorNumber(cx, js_GetErrorMessage, NULL, JSMSG_PAR_ARRAY_IMMUTABLE);
    return false;
}

JSBool
ParallelArrayObject::enumerate(JSContext *cx, HandleObject obj, JSIterateOp enum_op,
                               Value *statep, jsid *idp)
{
    JS_ASSERT(is(obj));
    RootedParallelArrayObject source(cx, as(obj));

    uint32_t index;
    switch (enum_op) {
      case JSENUMERATE_INIT_ALL:
      case JSENUMERATE_INIT:
        statep->setInt32(0);
        if (idp)
            *idp = ::INT_TO_JSID(source->outermostDimension());
        break;

      case JSENUMERATE_NEXT:
        index = static_cast<uint32_t>(statep->toInt32());
        if (index < source->outermostDimension()) {
            *idp = ::INT_TO_JSID(index);
            statep->setInt32(index + 1);
        } else {
            JS_ASSERT(index == source->outermostDimension());
            statep->setNull();
        }
        break;

      case JSENUMERATE_DESTROY:
        statep->setNull();
        break;
    }

    return true;
}

JSObject *
js_InitParallelArrayClass(JSContext *cx, JSObject *obj)
{
    return ParallelArrayObject::initClass(cx, obj);
}
