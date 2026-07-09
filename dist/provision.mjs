var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
var _a;
import { N as NODE_IDENTITY_SCHEMA_V2, v as DID, y as newDeviceDocumentByJwk, z as verifyJwtEdDSA, A as deviceDocumentToOrderedJson, B as decodeJwtClaimWithoutVerify, E as commonjsGlobal, G as createJwkByX, H as newOwnerDocument, I as ownerDocumentToOrderedJson, J as parseOODDescription, K as oodDescriptionToString, L as newZoneBootDocument, M as newZoneDocument, P as encodeZoneBootDocument, Q as DEFAULT_EXPIRE_TIME, R as zoneDocumentToOrderedJson, T as newDeviceMiniDocument, U as deviceMiniDocumentToJwt, V as encodeDeviceDocument, W as newDeviceMiniDocumentByDeviceDocument, X as newDeviceDocumentByMiniDocument, Y as buckyosGetUnixTimestamp, Z as buildNamedObjectByJson } from "./ndn_types-089ba30c.mjs";
import { Buffer as Buffer$1 } from "node:buffer";
import { pbkdf2Sync, createPublicKey, createPrivateKey, createECDH, createHmac } from "node:crypto";
const DEVICE_DOC_JWT_FILE_NAME = "device_doc.jwt";
const DEVICE_MINI_DOC_JWT_FILE_NAME = "device_mini_doc.jwt";
const NODE_GATEWAY_PARAMS_FILE_NAME = "node_gateway_params.json";
function requireNode$2(moduleName) {
  const proc = globalThis.process;
  if (typeof (proc == null ? void 0 : proc.getBuiltinModule) === "function") {
    const builtin = proc.getBuiltinModule(moduleName);
    if (builtin) {
      return builtin;
    }
  }
  if (typeof require === "function") {
    return require(moduleName);
  }
  throw new Error(`buckyos device_identity cannot load builtin module ${moduleName} in this runtime`);
}
function asDid(value) {
  return value instanceof DID ? value : DID.fromStr(value);
}
function writeJsonPretty(filePath, value) {
  const fs = requireNode$2("node:fs");
  const path = requireNode$2("node:path");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}
function newLocalNodeIdentityConfig(params) {
  return {
    schema: NODE_IDENTITY_SCHEMA_V2,
    zone_did: asDid(params.zoneDid).toString(),
    owner_did: asDid(params.ownerDid).toString(),
    owner_public_key: params.ownerPublicKey,
    device_name: params.deviceName,
    device_did: asDid(params.deviceDid).toString(),
    zone_iat: params.zoneIat
  };
}
function loadLocalNodeIdentityConfig(filePath) {
  const fs = requireNode$2("node:fs");
  const config = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (config.schema !== NODE_IDENTITY_SCHEMA_V2) {
    throw new Error(
      `unsupported node_identity schema '${config.schema}', expected '${NODE_IDENTITY_SCHEMA_V2}'`
    );
  }
  return config;
}
function deviceIdentityPathsForRoots(roots, deviceDid) {
  const path = requireNode$2("node:path");
  const deviceDidStr = asDid(deviceDid).toString();
  const publicDir = roots.publicDir(deviceDidStr);
  return {
    publicDir,
    securityDir: roots.securityDir(deviceDidStr),
    didJson: roots.publicFile(deviceDidStr, "authentication", "did-json"),
    deviceDocJwt: path.join(publicDir, DEVICE_DOC_JWT_FILE_NAME),
    deviceMiniDocJwt: path.join(publicDir, DEVICE_MINI_DOC_JWT_FILE_NAME),
    authenticationPrivateKey: roots.securityFile(deviceDidStr, "authentication", "private")
  };
}
function buildDeviceDid(deviceName, zoneDid) {
  const trimmedName = deviceName.trim();
  if (!trimmedName) {
    throw new Error("device name is empty");
  }
  const zone = asDid(zoneDid);
  const zoneName = zone.method === "web" ? zone.toRawHostName() : zone.id.split(":")[0] ?? zone.id;
  if (!zoneName.trim()) {
    throw new Error(`zone DID ${zone.toString()} has empty host/name`);
  }
  return new DID(zone.method, `${trimmedName}.${zoneName}`);
}
function bindDeviceDocumentDid(deviceDoc, deviceDid) {
  const deviceDidStr = asDid(deviceDid).toString();
  deviceDoc.id = deviceDidStr;
  if (!Array.isArray(deviceDoc.verificationMethod)) {
    throw new Error("device document verificationMethod is missing");
  }
  for (const method of deviceDoc.verificationMethod) {
    method.controller = deviceDidStr;
  }
  return deviceDoc;
}
function newDeviceDocumentByJwkWithDid(name, publicKeyJwk, deviceDid, now) {
  return bindDeviceDocumentDid(newDeviceDocumentByJwk(name, publicKeyJwk, now), deviceDid);
}
function loadDeviceDocJwtForRoots(roots, deviceDid) {
  const fs = requireNode$2("node:fs");
  return fs.readFileSync(deviceIdentityPathsForRoots(roots, deviceDid).deviceDocJwt, "utf8");
}
function loadDeviceMiniDocJwtForRoots(roots, deviceDid) {
  const fs = requireNode$2("node:fs");
  return fs.readFileSync(deviceIdentityPathsForRoots(roots, deviceDid).deviceMiniDocJwt, "utf8");
}
async function loadLocalDeviceDocumentForRoots(roots, nodeIdentity, verify) {
  const deviceDocJwt = loadDeviceDocJwtForRoots(roots, nodeIdentity.device_did);
  const deviceDoc = verify ? await verifyJwtEdDSA(deviceDocJwt, nodeIdentity.owner_public_key) : decodeDeviceDocumentWithoutVerify(deviceDocJwt);
  if (deviceDoc.id !== nodeIdentity.device_did) {
    throw new Error(
      `device_doc.jwt id ${deviceDoc.id} does not match node_identity device_did ${nodeIdentity.device_did}`
    );
  }
  return [deviceDocJwt, deviceDoc];
}
function saveNodeGatewayParams(etcDir, deviceDid) {
  const path = requireNode$2("node:path");
  writeJsonPretty(path.join(etcDir, NODE_GATEWAY_PARAMS_FILE_NAME), {
    params: {
      device_did: asDid(deviceDid).toString()
    }
  });
}
function saveLocalDeviceIdentityForRoots(etcDir, roots, nodeIdentity, deviceDoc, deviceDocJwt, deviceMiniDocJwt, devicePrivateKeyPem) {
  const fs = requireNode$2("node:fs");
  const path = requireNode$2("node:path");
  const paths = deviceIdentityPathsForRoots(roots, nodeIdentity.device_did);
  fs.mkdirSync(paths.publicDir, { recursive: true });
  fs.mkdirSync(paths.securityDir, { recursive: true });
  writeJsonPretty(path.join(etcDir, "node_identity.json"), nodeIdentity);
  saveNodeGatewayParams(etcDir, nodeIdentity.device_did);
  writeJsonPretty(paths.didJson, deviceDocumentToOrderedJson(deviceDoc));
  fs.writeFileSync(paths.deviceDocJwt, deviceDocJwt);
  fs.writeFileSync(paths.deviceMiniDocJwt, deviceMiniDocJwt);
  fs.writeFileSync(paths.authenticationPrivateKey, devicePrivateKeyPem);
  return paths;
}
function decodeDeviceDocumentWithoutVerify(deviceDocJwt) {
  return decodeJwtClaimWithoutVerify(deviceDocJwt);
}
/*! *****************************************************************************
Copyright (C) Microsoft. All rights reserved.
Licensed under the Apache License, Version 2.0 (the "License"); you may not use
this file except in compliance with the License. You may obtain a copy of the
License at http://www.apache.org/licenses/LICENSE-2.0

THIS CODE IS PROVIDED ON AN *AS IS* BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, EITHER EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION ANY IMPLIED
WARRANTIES OR CONDITIONS OF TITLE, FITNESS FOR A PARTICULAR PURPOSE,
MERCHANTABLITY OR NON-INFRINGEMENT.

See the Apache Version 2.0 License for specific language governing permissions
and limitations under the License.
***************************************************************************** */
var Reflect$1;
(function(Reflect2) {
  (function(factory) {
    var root = typeof globalThis === "object" ? globalThis : typeof commonjsGlobal === "object" ? commonjsGlobal : typeof self === "object" ? self : typeof this === "object" ? this : sloppyModeThis();
    var exporter = makeExporter(Reflect2);
    if (typeof root.Reflect !== "undefined") {
      exporter = makeExporter(root.Reflect, exporter);
    }
    factory(exporter, root);
    if (typeof root.Reflect === "undefined") {
      root.Reflect = Reflect2;
    }
    function makeExporter(target, previous) {
      return function(key, value) {
        Object.defineProperty(target, key, { configurable: true, writable: true, value });
        if (previous)
          previous(key, value);
      };
    }
    function functionThis() {
      try {
        return Function("return this;")();
      } catch (_) {
      }
    }
    function indirectEvalThis() {
      try {
        return (void 0, eval)("(function() { return this; })()");
      } catch (_) {
      }
    }
    function sloppyModeThis() {
      return functionThis() || indirectEvalThis();
    }
  })(function(exporter, root) {
    var hasOwn = Object.prototype.hasOwnProperty;
    var supportsSymbol = typeof Symbol === "function";
    var toPrimitiveSymbol = supportsSymbol && typeof Symbol.toPrimitive !== "undefined" ? Symbol.toPrimitive : "@@toPrimitive";
    var iteratorSymbol = supportsSymbol && typeof Symbol.iterator !== "undefined" ? Symbol.iterator : "@@iterator";
    var supportsCreate = typeof Object.create === "function";
    var supportsProto = { __proto__: [] } instanceof Array;
    var downLevel = !supportsCreate && !supportsProto;
    var HashMap = {
      // create an object in dictionary mode (a.k.a. "slow" mode in v8)
      create: supportsCreate ? function() {
        return MakeDictionary(/* @__PURE__ */ Object.create(null));
      } : supportsProto ? function() {
        return MakeDictionary({ __proto__: null });
      } : function() {
        return MakeDictionary({});
      },
      has: downLevel ? function(map, key) {
        return hasOwn.call(map, key);
      } : function(map, key) {
        return key in map;
      },
      get: downLevel ? function(map, key) {
        return hasOwn.call(map, key) ? map[key] : void 0;
      } : function(map, key) {
        return map[key];
      }
    };
    var functionPrototype = Object.getPrototypeOf(Function);
    var _Map = typeof Map === "function" && typeof Map.prototype.entries === "function" ? Map : CreateMapPolyfill();
    var _Set = typeof Set === "function" && typeof Set.prototype.entries === "function" ? Set : CreateSetPolyfill();
    var _WeakMap = typeof WeakMap === "function" ? WeakMap : CreateWeakMapPolyfill();
    var registrySymbol = supportsSymbol ? Symbol.for("@reflect-metadata:registry") : void 0;
    var metadataRegistry = GetOrCreateMetadataRegistry();
    var metadataProvider = CreateMetadataProvider(metadataRegistry);
    function decorate(decorators, target, propertyKey, attributes) {
      if (!IsUndefined(propertyKey)) {
        if (!IsArray(decorators))
          throw new TypeError();
        if (!IsObject(target))
          throw new TypeError();
        if (!IsObject(attributes) && !IsUndefined(attributes) && !IsNull(attributes))
          throw new TypeError();
        if (IsNull(attributes))
          attributes = void 0;
        propertyKey = ToPropertyKey(propertyKey);
        return DecorateProperty(decorators, target, propertyKey, attributes);
      } else {
        if (!IsArray(decorators))
          throw new TypeError();
        if (!IsConstructor(target))
          throw new TypeError();
        return DecorateConstructor(decorators, target);
      }
    }
    exporter("decorate", decorate);
    function metadata(metadataKey, metadataValue) {
      function decorator(target, propertyKey) {
        if (!IsObject(target))
          throw new TypeError();
        if (!IsUndefined(propertyKey) && !IsPropertyKey(propertyKey))
          throw new TypeError();
        OrdinaryDefineOwnMetadata(metadataKey, metadataValue, target, propertyKey);
      }
      return decorator;
    }
    exporter("metadata", metadata);
    function defineMetadata(metadataKey, metadataValue, target, propertyKey) {
      if (!IsObject(target))
        throw new TypeError();
      if (!IsUndefined(propertyKey))
        propertyKey = ToPropertyKey(propertyKey);
      return OrdinaryDefineOwnMetadata(metadataKey, metadataValue, target, propertyKey);
    }
    exporter("defineMetadata", defineMetadata);
    function hasMetadata(metadataKey, target, propertyKey) {
      if (!IsObject(target))
        throw new TypeError();
      if (!IsUndefined(propertyKey))
        propertyKey = ToPropertyKey(propertyKey);
      return OrdinaryHasMetadata(metadataKey, target, propertyKey);
    }
    exporter("hasMetadata", hasMetadata);
    function hasOwnMetadata(metadataKey, target, propertyKey) {
      if (!IsObject(target))
        throw new TypeError();
      if (!IsUndefined(propertyKey))
        propertyKey = ToPropertyKey(propertyKey);
      return OrdinaryHasOwnMetadata(metadataKey, target, propertyKey);
    }
    exporter("hasOwnMetadata", hasOwnMetadata);
    function getMetadata(metadataKey, target, propertyKey) {
      if (!IsObject(target))
        throw new TypeError();
      if (!IsUndefined(propertyKey))
        propertyKey = ToPropertyKey(propertyKey);
      return OrdinaryGetMetadata(metadataKey, target, propertyKey);
    }
    exporter("getMetadata", getMetadata);
    function getOwnMetadata(metadataKey, target, propertyKey) {
      if (!IsObject(target))
        throw new TypeError();
      if (!IsUndefined(propertyKey))
        propertyKey = ToPropertyKey(propertyKey);
      return OrdinaryGetOwnMetadata(metadataKey, target, propertyKey);
    }
    exporter("getOwnMetadata", getOwnMetadata);
    function getMetadataKeys(target, propertyKey) {
      if (!IsObject(target))
        throw new TypeError();
      if (!IsUndefined(propertyKey))
        propertyKey = ToPropertyKey(propertyKey);
      return OrdinaryMetadataKeys(target, propertyKey);
    }
    exporter("getMetadataKeys", getMetadataKeys);
    function getOwnMetadataKeys(target, propertyKey) {
      if (!IsObject(target))
        throw new TypeError();
      if (!IsUndefined(propertyKey))
        propertyKey = ToPropertyKey(propertyKey);
      return OrdinaryOwnMetadataKeys(target, propertyKey);
    }
    exporter("getOwnMetadataKeys", getOwnMetadataKeys);
    function deleteMetadata(metadataKey, target, propertyKey) {
      if (!IsObject(target))
        throw new TypeError();
      if (!IsUndefined(propertyKey))
        propertyKey = ToPropertyKey(propertyKey);
      if (!IsObject(target))
        throw new TypeError();
      if (!IsUndefined(propertyKey))
        propertyKey = ToPropertyKey(propertyKey);
      var provider = GetMetadataProvider(
        target,
        propertyKey,
        /*Create*/
        false
      );
      if (IsUndefined(provider))
        return false;
      return provider.OrdinaryDeleteMetadata(metadataKey, target, propertyKey);
    }
    exporter("deleteMetadata", deleteMetadata);
    function DecorateConstructor(decorators, target) {
      for (var i = decorators.length - 1; i >= 0; --i) {
        var decorator = decorators[i];
        var decorated = decorator(target);
        if (!IsUndefined(decorated) && !IsNull(decorated)) {
          if (!IsConstructor(decorated))
            throw new TypeError();
          target = decorated;
        }
      }
      return target;
    }
    function DecorateProperty(decorators, target, propertyKey, descriptor) {
      for (var i = decorators.length - 1; i >= 0; --i) {
        var decorator = decorators[i];
        var decorated = decorator(target, propertyKey, descriptor);
        if (!IsUndefined(decorated) && !IsNull(decorated)) {
          if (!IsObject(decorated))
            throw new TypeError();
          descriptor = decorated;
        }
      }
      return descriptor;
    }
    function OrdinaryHasMetadata(MetadataKey, O, P) {
      var hasOwn2 = OrdinaryHasOwnMetadata(MetadataKey, O, P);
      if (hasOwn2)
        return true;
      var parent = OrdinaryGetPrototypeOf(O);
      if (!IsNull(parent))
        return OrdinaryHasMetadata(MetadataKey, parent, P);
      return false;
    }
    function OrdinaryHasOwnMetadata(MetadataKey, O, P) {
      var provider = GetMetadataProvider(
        O,
        P,
        /*Create*/
        false
      );
      if (IsUndefined(provider))
        return false;
      return ToBoolean(provider.OrdinaryHasOwnMetadata(MetadataKey, O, P));
    }
    function OrdinaryGetMetadata(MetadataKey, O, P) {
      var hasOwn2 = OrdinaryHasOwnMetadata(MetadataKey, O, P);
      if (hasOwn2)
        return OrdinaryGetOwnMetadata(MetadataKey, O, P);
      var parent = OrdinaryGetPrototypeOf(O);
      if (!IsNull(parent))
        return OrdinaryGetMetadata(MetadataKey, parent, P);
      return void 0;
    }
    function OrdinaryGetOwnMetadata(MetadataKey, O, P) {
      var provider = GetMetadataProvider(
        O,
        P,
        /*Create*/
        false
      );
      if (IsUndefined(provider))
        return;
      return provider.OrdinaryGetOwnMetadata(MetadataKey, O, P);
    }
    function OrdinaryDefineOwnMetadata(MetadataKey, MetadataValue, O, P) {
      var provider = GetMetadataProvider(
        O,
        P,
        /*Create*/
        true
      );
      provider.OrdinaryDefineOwnMetadata(MetadataKey, MetadataValue, O, P);
    }
    function OrdinaryMetadataKeys(O, P) {
      var ownKeys = OrdinaryOwnMetadataKeys(O, P);
      var parent = OrdinaryGetPrototypeOf(O);
      if (parent === null)
        return ownKeys;
      var parentKeys = OrdinaryMetadataKeys(parent, P);
      if (parentKeys.length <= 0)
        return ownKeys;
      if (ownKeys.length <= 0)
        return parentKeys;
      var set = new _Set();
      var keys = [];
      for (var _i = 0, ownKeys_1 = ownKeys; _i < ownKeys_1.length; _i++) {
        var key = ownKeys_1[_i];
        var hasKey = set.has(key);
        if (!hasKey) {
          set.add(key);
          keys.push(key);
        }
      }
      for (var _a3 = 0, parentKeys_1 = parentKeys; _a3 < parentKeys_1.length; _a3++) {
        var key = parentKeys_1[_a3];
        var hasKey = set.has(key);
        if (!hasKey) {
          set.add(key);
          keys.push(key);
        }
      }
      return keys;
    }
    function OrdinaryOwnMetadataKeys(O, P) {
      var provider = GetMetadataProvider(
        O,
        P,
        /*create*/
        false
      );
      if (!provider) {
        return [];
      }
      return provider.OrdinaryOwnMetadataKeys(O, P);
    }
    function Type(x) {
      if (x === null)
        return 1;
      switch (typeof x) {
        case "undefined":
          return 0;
        case "boolean":
          return 2;
        case "string":
          return 3;
        case "symbol":
          return 4;
        case "number":
          return 5;
        case "object":
          return x === null ? 1 : 6;
        default:
          return 6;
      }
    }
    function IsUndefined(x) {
      return x === void 0;
    }
    function IsNull(x) {
      return x === null;
    }
    function IsSymbol(x) {
      return typeof x === "symbol";
    }
    function IsObject(x) {
      return typeof x === "object" ? x !== null : typeof x === "function";
    }
    function ToPrimitive(input, PreferredType) {
      switch (Type(input)) {
        case 0:
          return input;
        case 1:
          return input;
        case 2:
          return input;
        case 3:
          return input;
        case 4:
          return input;
        case 5:
          return input;
      }
      var hint = PreferredType === 3 ? "string" : PreferredType === 5 ? "number" : "default";
      var exoticToPrim = GetMethod(input, toPrimitiveSymbol);
      if (exoticToPrim !== void 0) {
        var result = exoticToPrim.call(input, hint);
        if (IsObject(result))
          throw new TypeError();
        return result;
      }
      return OrdinaryToPrimitive(input, hint === "default" ? "number" : hint);
    }
    function OrdinaryToPrimitive(O, hint) {
      if (hint === "string") {
        var toString_1 = O.toString;
        if (IsCallable(toString_1)) {
          var result = toString_1.call(O);
          if (!IsObject(result))
            return result;
        }
        var valueOf = O.valueOf;
        if (IsCallable(valueOf)) {
          var result = valueOf.call(O);
          if (!IsObject(result))
            return result;
        }
      } else {
        var valueOf = O.valueOf;
        if (IsCallable(valueOf)) {
          var result = valueOf.call(O);
          if (!IsObject(result))
            return result;
        }
        var toString_2 = O.toString;
        if (IsCallable(toString_2)) {
          var result = toString_2.call(O);
          if (!IsObject(result))
            return result;
        }
      }
      throw new TypeError();
    }
    function ToBoolean(argument) {
      return !!argument;
    }
    function ToString(argument) {
      return "" + argument;
    }
    function ToPropertyKey(argument) {
      var key = ToPrimitive(
        argument,
        3
        /* String */
      );
      if (IsSymbol(key))
        return key;
      return ToString(key);
    }
    function IsArray(argument) {
      return Array.isArray ? Array.isArray(argument) : argument instanceof Object ? argument instanceof Array : Object.prototype.toString.call(argument) === "[object Array]";
    }
    function IsCallable(argument) {
      return typeof argument === "function";
    }
    function IsConstructor(argument) {
      return typeof argument === "function";
    }
    function IsPropertyKey(argument) {
      switch (Type(argument)) {
        case 3:
          return true;
        case 4:
          return true;
        default:
          return false;
      }
    }
    function SameValueZero(x, y) {
      return x === y || x !== x && y !== y;
    }
    function GetMethod(V, P) {
      var func = V[P];
      if (func === void 0 || func === null)
        return void 0;
      if (!IsCallable(func))
        throw new TypeError();
      return func;
    }
    function GetIterator(obj) {
      var method = GetMethod(obj, iteratorSymbol);
      if (!IsCallable(method))
        throw new TypeError();
      var iterator = method.call(obj);
      if (!IsObject(iterator))
        throw new TypeError();
      return iterator;
    }
    function IteratorValue(iterResult) {
      return iterResult.value;
    }
    function IteratorStep(iterator) {
      var result = iterator.next();
      return result.done ? false : result;
    }
    function IteratorClose(iterator) {
      var f = iterator["return"];
      if (f)
        f.call(iterator);
    }
    function OrdinaryGetPrototypeOf(O) {
      var proto = Object.getPrototypeOf(O);
      if (typeof O !== "function" || O === functionPrototype)
        return proto;
      if (proto !== functionPrototype)
        return proto;
      var prototype = O.prototype;
      var prototypeProto = prototype && Object.getPrototypeOf(prototype);
      if (prototypeProto == null || prototypeProto === Object.prototype)
        return proto;
      var constructor = prototypeProto.constructor;
      if (typeof constructor !== "function")
        return proto;
      if (constructor === O)
        return proto;
      return constructor;
    }
    function CreateMetadataRegistry() {
      var fallback;
      if (!IsUndefined(registrySymbol) && typeof root.Reflect !== "undefined" && !(registrySymbol in root.Reflect) && typeof root.Reflect.defineMetadata === "function") {
        fallback = CreateFallbackProvider(root.Reflect);
      }
      var first;
      var second;
      var rest;
      var targetProviderMap = new _WeakMap();
      var registry = {
        registerProvider,
        getProvider,
        setProvider
      };
      return registry;
      function registerProvider(provider) {
        if (!Object.isExtensible(registry)) {
          throw new Error("Cannot add provider to a frozen registry.");
        }
        switch (true) {
          case fallback === provider:
            break;
          case IsUndefined(first):
            first = provider;
            break;
          case first === provider:
            break;
          case IsUndefined(second):
            second = provider;
            break;
          case second === provider:
            break;
          default:
            if (rest === void 0)
              rest = new _Set();
            rest.add(provider);
            break;
        }
      }
      function getProviderNoCache(O, P) {
        if (!IsUndefined(first)) {
          if (first.isProviderFor(O, P))
            return first;
          if (!IsUndefined(second)) {
            if (second.isProviderFor(O, P))
              return first;
            if (!IsUndefined(rest)) {
              var iterator = GetIterator(rest);
              while (true) {
                var next = IteratorStep(iterator);
                if (!next) {
                  return void 0;
                }
                var provider = IteratorValue(next);
                if (provider.isProviderFor(O, P)) {
                  IteratorClose(iterator);
                  return provider;
                }
              }
            }
          }
        }
        if (!IsUndefined(fallback) && fallback.isProviderFor(O, P)) {
          return fallback;
        }
        return void 0;
      }
      function getProvider(O, P) {
        var providerMap = targetProviderMap.get(O);
        var provider;
        if (!IsUndefined(providerMap)) {
          provider = providerMap.get(P);
        }
        if (!IsUndefined(provider)) {
          return provider;
        }
        provider = getProviderNoCache(O, P);
        if (!IsUndefined(provider)) {
          if (IsUndefined(providerMap)) {
            providerMap = new _Map();
            targetProviderMap.set(O, providerMap);
          }
          providerMap.set(P, provider);
        }
        return provider;
      }
      function hasProvider(provider) {
        if (IsUndefined(provider))
          throw new TypeError();
        return first === provider || second === provider || !IsUndefined(rest) && rest.has(provider);
      }
      function setProvider(O, P, provider) {
        if (!hasProvider(provider)) {
          throw new Error("Metadata provider not registered.");
        }
        var existingProvider = getProvider(O, P);
        if (existingProvider !== provider) {
          if (!IsUndefined(existingProvider)) {
            return false;
          }
          var providerMap = targetProviderMap.get(O);
          if (IsUndefined(providerMap)) {
            providerMap = new _Map();
            targetProviderMap.set(O, providerMap);
          }
          providerMap.set(P, provider);
        }
        return true;
      }
    }
    function GetOrCreateMetadataRegistry() {
      var metadataRegistry2;
      if (!IsUndefined(registrySymbol) && IsObject(root.Reflect) && Object.isExtensible(root.Reflect)) {
        metadataRegistry2 = root.Reflect[registrySymbol];
      }
      if (IsUndefined(metadataRegistry2)) {
        metadataRegistry2 = CreateMetadataRegistry();
      }
      if (!IsUndefined(registrySymbol) && IsObject(root.Reflect) && Object.isExtensible(root.Reflect)) {
        Object.defineProperty(root.Reflect, registrySymbol, {
          enumerable: false,
          configurable: false,
          writable: false,
          value: metadataRegistry2
        });
      }
      return metadataRegistry2;
    }
    function CreateMetadataProvider(registry) {
      var metadata2 = new _WeakMap();
      var provider = {
        isProviderFor: function(O, P) {
          var targetMetadata = metadata2.get(O);
          if (IsUndefined(targetMetadata))
            return false;
          return targetMetadata.has(P);
        },
        OrdinaryDefineOwnMetadata: OrdinaryDefineOwnMetadata2,
        OrdinaryHasOwnMetadata: OrdinaryHasOwnMetadata2,
        OrdinaryGetOwnMetadata: OrdinaryGetOwnMetadata2,
        OrdinaryOwnMetadataKeys: OrdinaryOwnMetadataKeys2,
        OrdinaryDeleteMetadata
      };
      metadataRegistry.registerProvider(provider);
      return provider;
      function GetOrCreateMetadataMap(O, P, Create) {
        var targetMetadata = metadata2.get(O);
        var createdTargetMetadata = false;
        if (IsUndefined(targetMetadata)) {
          if (!Create)
            return void 0;
          targetMetadata = new _Map();
          metadata2.set(O, targetMetadata);
          createdTargetMetadata = true;
        }
        var metadataMap = targetMetadata.get(P);
        if (IsUndefined(metadataMap)) {
          if (!Create)
            return void 0;
          metadataMap = new _Map();
          targetMetadata.set(P, metadataMap);
          if (!registry.setProvider(O, P, provider)) {
            targetMetadata.delete(P);
            if (createdTargetMetadata) {
              metadata2.delete(O);
            }
            throw new Error("Wrong provider for target.");
          }
        }
        return metadataMap;
      }
      function OrdinaryHasOwnMetadata2(MetadataKey, O, P) {
        var metadataMap = GetOrCreateMetadataMap(
          O,
          P,
          /*Create*/
          false
        );
        if (IsUndefined(metadataMap))
          return false;
        return ToBoolean(metadataMap.has(MetadataKey));
      }
      function OrdinaryGetOwnMetadata2(MetadataKey, O, P) {
        var metadataMap = GetOrCreateMetadataMap(
          O,
          P,
          /*Create*/
          false
        );
        if (IsUndefined(metadataMap))
          return void 0;
        return metadataMap.get(MetadataKey);
      }
      function OrdinaryDefineOwnMetadata2(MetadataKey, MetadataValue, O, P) {
        var metadataMap = GetOrCreateMetadataMap(
          O,
          P,
          /*Create*/
          true
        );
        metadataMap.set(MetadataKey, MetadataValue);
      }
      function OrdinaryOwnMetadataKeys2(O, P) {
        var keys = [];
        var metadataMap = GetOrCreateMetadataMap(
          O,
          P,
          /*Create*/
          false
        );
        if (IsUndefined(metadataMap))
          return keys;
        var keysObj = metadataMap.keys();
        var iterator = GetIterator(keysObj);
        var k = 0;
        while (true) {
          var next = IteratorStep(iterator);
          if (!next) {
            keys.length = k;
            return keys;
          }
          var nextValue = IteratorValue(next);
          try {
            keys[k] = nextValue;
          } catch (e) {
            try {
              IteratorClose(iterator);
            } finally {
              throw e;
            }
          }
          k++;
        }
      }
      function OrdinaryDeleteMetadata(MetadataKey, O, P) {
        var metadataMap = GetOrCreateMetadataMap(
          O,
          P,
          /*Create*/
          false
        );
        if (IsUndefined(metadataMap))
          return false;
        if (!metadataMap.delete(MetadataKey))
          return false;
        if (metadataMap.size === 0) {
          var targetMetadata = metadata2.get(O);
          if (!IsUndefined(targetMetadata)) {
            targetMetadata.delete(P);
            if (targetMetadata.size === 0) {
              metadata2.delete(targetMetadata);
            }
          }
        }
        return true;
      }
    }
    function CreateFallbackProvider(reflect) {
      var defineMetadata2 = reflect.defineMetadata, hasOwnMetadata2 = reflect.hasOwnMetadata, getOwnMetadata2 = reflect.getOwnMetadata, getOwnMetadataKeys2 = reflect.getOwnMetadataKeys, deleteMetadata2 = reflect.deleteMetadata;
      var metadataOwner = new _WeakMap();
      var provider = {
        isProviderFor: function(O, P) {
          var metadataPropertySet = metadataOwner.get(O);
          if (!IsUndefined(metadataPropertySet) && metadataPropertySet.has(P)) {
            return true;
          }
          if (getOwnMetadataKeys2(O, P).length) {
            if (IsUndefined(metadataPropertySet)) {
              metadataPropertySet = new _Set();
              metadataOwner.set(O, metadataPropertySet);
            }
            metadataPropertySet.add(P);
            return true;
          }
          return false;
        },
        OrdinaryDefineOwnMetadata: defineMetadata2,
        OrdinaryHasOwnMetadata: hasOwnMetadata2,
        OrdinaryGetOwnMetadata: getOwnMetadata2,
        OrdinaryOwnMetadataKeys: getOwnMetadataKeys2,
        OrdinaryDeleteMetadata: deleteMetadata2
      };
      return provider;
    }
    function GetMetadataProvider(O, P, Create) {
      var registeredProvider = metadataRegistry.getProvider(O, P);
      if (!IsUndefined(registeredProvider)) {
        return registeredProvider;
      }
      if (Create) {
        if (metadataRegistry.setProvider(O, P, metadataProvider)) {
          return metadataProvider;
        }
        throw new Error("Illegal state.");
      }
      return void 0;
    }
    function CreateMapPolyfill() {
      var cacheSentinel = {};
      var arraySentinel = [];
      var MapIterator = (
        /** @class */
        function() {
          function MapIterator2(keys, values, selector) {
            this._index = 0;
            this._keys = keys;
            this._values = values;
            this._selector = selector;
          }
          MapIterator2.prototype["@@iterator"] = function() {
            return this;
          };
          MapIterator2.prototype[iteratorSymbol] = function() {
            return this;
          };
          MapIterator2.prototype.next = function() {
            var index = this._index;
            if (index >= 0 && index < this._keys.length) {
              var result = this._selector(this._keys[index], this._values[index]);
              if (index + 1 >= this._keys.length) {
                this._index = -1;
                this._keys = arraySentinel;
                this._values = arraySentinel;
              } else {
                this._index++;
              }
              return { value: result, done: false };
            }
            return { value: void 0, done: true };
          };
          MapIterator2.prototype.throw = function(error) {
            if (this._index >= 0) {
              this._index = -1;
              this._keys = arraySentinel;
              this._values = arraySentinel;
            }
            throw error;
          };
          MapIterator2.prototype.return = function(value) {
            if (this._index >= 0) {
              this._index = -1;
              this._keys = arraySentinel;
              this._values = arraySentinel;
            }
            return { value, done: true };
          };
          return MapIterator2;
        }()
      );
      var Map2 = (
        /** @class */
        function() {
          function Map3() {
            this._keys = [];
            this._values = [];
            this._cacheKey = cacheSentinel;
            this._cacheIndex = -2;
          }
          Object.defineProperty(Map3.prototype, "size", {
            get: function() {
              return this._keys.length;
            },
            enumerable: true,
            configurable: true
          });
          Map3.prototype.has = function(key) {
            return this._find(
              key,
              /*insert*/
              false
            ) >= 0;
          };
          Map3.prototype.get = function(key) {
            var index = this._find(
              key,
              /*insert*/
              false
            );
            return index >= 0 ? this._values[index] : void 0;
          };
          Map3.prototype.set = function(key, value) {
            var index = this._find(
              key,
              /*insert*/
              true
            );
            this._values[index] = value;
            return this;
          };
          Map3.prototype.delete = function(key) {
            var index = this._find(
              key,
              /*insert*/
              false
            );
            if (index >= 0) {
              var size = this._keys.length;
              for (var i = index + 1; i < size; i++) {
                this._keys[i - 1] = this._keys[i];
                this._values[i - 1] = this._values[i];
              }
              this._keys.length--;
              this._values.length--;
              if (SameValueZero(key, this._cacheKey)) {
                this._cacheKey = cacheSentinel;
                this._cacheIndex = -2;
              }
              return true;
            }
            return false;
          };
          Map3.prototype.clear = function() {
            this._keys.length = 0;
            this._values.length = 0;
            this._cacheKey = cacheSentinel;
            this._cacheIndex = -2;
          };
          Map3.prototype.keys = function() {
            return new MapIterator(this._keys, this._values, getKey);
          };
          Map3.prototype.values = function() {
            return new MapIterator(this._keys, this._values, getValue);
          };
          Map3.prototype.entries = function() {
            return new MapIterator(this._keys, this._values, getEntry);
          };
          Map3.prototype["@@iterator"] = function() {
            return this.entries();
          };
          Map3.prototype[iteratorSymbol] = function() {
            return this.entries();
          };
          Map3.prototype._find = function(key, insert) {
            if (!SameValueZero(this._cacheKey, key)) {
              this._cacheIndex = -1;
              for (var i = 0; i < this._keys.length; i++) {
                if (SameValueZero(this._keys[i], key)) {
                  this._cacheIndex = i;
                  break;
                }
              }
            }
            if (this._cacheIndex < 0 && insert) {
              this._cacheIndex = this._keys.length;
              this._keys.push(key);
              this._values.push(void 0);
            }
            return this._cacheIndex;
          };
          return Map3;
        }()
      );
      return Map2;
      function getKey(key, _) {
        return key;
      }
      function getValue(_, value) {
        return value;
      }
      function getEntry(key, value) {
        return [key, value];
      }
    }
    function CreateSetPolyfill() {
      var Set3 = (
        /** @class */
        function() {
          function Set4() {
            this._map = new _Map();
          }
          Object.defineProperty(Set4.prototype, "size", {
            get: function() {
              return this._map.size;
            },
            enumerable: true,
            configurable: true
          });
          Set4.prototype.has = function(value) {
            return this._map.has(value);
          };
          Set4.prototype.add = function(value) {
            return this._map.set(value, value), this;
          };
          Set4.prototype.delete = function(value) {
            return this._map.delete(value);
          };
          Set4.prototype.clear = function() {
            this._map.clear();
          };
          Set4.prototype.keys = function() {
            return this._map.keys();
          };
          Set4.prototype.values = function() {
            return this._map.keys();
          };
          Set4.prototype.entries = function() {
            return this._map.entries();
          };
          Set4.prototype["@@iterator"] = function() {
            return this.keys();
          };
          Set4.prototype[iteratorSymbol] = function() {
            return this.keys();
          };
          return Set4;
        }()
      );
      return Set3;
    }
    function CreateWeakMapPolyfill() {
      var UUID_SIZE = 16;
      var keys = HashMap.create();
      var rootKey = CreateUniqueKey();
      return (
        /** @class */
        function() {
          function WeakMap2() {
            this._key = CreateUniqueKey();
          }
          WeakMap2.prototype.has = function(target) {
            var table = GetOrCreateWeakMapTable(
              target,
              /*create*/
              false
            );
            return table !== void 0 ? HashMap.has(table, this._key) : false;
          };
          WeakMap2.prototype.get = function(target) {
            var table = GetOrCreateWeakMapTable(
              target,
              /*create*/
              false
            );
            return table !== void 0 ? HashMap.get(table, this._key) : void 0;
          };
          WeakMap2.prototype.set = function(target, value) {
            var table = GetOrCreateWeakMapTable(
              target,
              /*create*/
              true
            );
            table[this._key] = value;
            return this;
          };
          WeakMap2.prototype.delete = function(target) {
            var table = GetOrCreateWeakMapTable(
              target,
              /*create*/
              false
            );
            return table !== void 0 ? delete table[this._key] : false;
          };
          WeakMap2.prototype.clear = function() {
            this._key = CreateUniqueKey();
          };
          return WeakMap2;
        }()
      );
      function CreateUniqueKey() {
        var key;
        do
          key = "@@WeakMap@@" + CreateUUID();
        while (HashMap.has(keys, key));
        keys[key] = true;
        return key;
      }
      function GetOrCreateWeakMapTable(target, create2) {
        if (!hasOwn.call(target, rootKey)) {
          if (!create2)
            return void 0;
          Object.defineProperty(target, rootKey, { value: HashMap.create() });
        }
        return target[rootKey];
      }
      function FillRandomBytes(buffer, size) {
        for (var i = 0; i < size; ++i)
          buffer[i] = Math.random() * 255 | 0;
        return buffer;
      }
      function GenRandomBytes(size) {
        if (typeof Uint8Array === "function") {
          var array = new Uint8Array(size);
          if (typeof crypto !== "undefined") {
            crypto.getRandomValues(array);
          } else if (typeof msCrypto !== "undefined") {
            msCrypto.getRandomValues(array);
          } else {
            FillRandomBytes(array, size);
          }
          return array;
        }
        return FillRandomBytes(new Array(size), size);
      }
      function CreateUUID() {
        var data = GenRandomBytes(UUID_SIZE);
        data[6] = data[6] & 79 | 64;
        data[8] = data[8] & 191 | 128;
        var result = "";
        for (var offset = 0; offset < UUID_SIZE; ++offset) {
          var byte = data[offset];
          if (offset === 4 || offset === 6 || offset === 8)
            result += "-";
          if (byte < 16)
            result += "0";
          result += byte.toString(16).toLowerCase();
        }
        return result;
      }
    }
    function MakeDictionary(obj) {
      obj.__ = void 0;
      delete obj.__;
      return obj;
    }
  });
})(Reflect$1 || (Reflect$1 = {}));
/*!
 * MIT License
 * 
 * Copyright (c) 2017-2024 Peculiar Ventures, LLC
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 * 
 */
const ARRAY_BUFFER_NAME = "[object ArrayBuffer]";
class BufferSourceConverter {
  static isArrayBuffer(data) {
    return Object.prototype.toString.call(data) === ARRAY_BUFFER_NAME;
  }
  static toArrayBuffer(data) {
    if (this.isArrayBuffer(data)) {
      return data;
    }
    if (data.byteLength === data.buffer.byteLength) {
      return data.buffer;
    }
    if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
      return data.buffer;
    }
    return this.toUint8Array(data.buffer).slice(data.byteOffset, data.byteOffset + data.byteLength).buffer;
  }
  static toUint8Array(data) {
    return this.toView(data, Uint8Array);
  }
  static toView(data, type) {
    if (data.constructor === type) {
      return data;
    }
    if (this.isArrayBuffer(data)) {
      return new type(data);
    }
    if (this.isArrayBufferView(data)) {
      return new type(data.buffer, data.byteOffset, data.byteLength);
    }
    throw new TypeError("The provided value is not of type '(ArrayBuffer or ArrayBufferView)'");
  }
  static isBufferSource(data) {
    return this.isArrayBufferView(data) || this.isArrayBuffer(data);
  }
  static isArrayBufferView(data) {
    return ArrayBuffer.isView(data) || data && this.isArrayBuffer(data.buffer);
  }
  static isEqual(a, b) {
    const aView = BufferSourceConverter.toUint8Array(a);
    const bView = BufferSourceConverter.toUint8Array(b);
    if (aView.length !== bView.byteLength) {
      return false;
    }
    for (let i = 0; i < aView.length; i++) {
      if (aView[i] !== bView[i]) {
        return false;
      }
    }
    return true;
  }
  static concat(...args) {
    let buffers;
    if (Array.isArray(args[0]) && !(args[1] instanceof Function)) {
      buffers = args[0];
    } else if (Array.isArray(args[0]) && args[1] instanceof Function) {
      buffers = args[0];
    } else {
      if (args[args.length - 1] instanceof Function) {
        buffers = args.slice(0, args.length - 1);
      } else {
        buffers = args;
      }
    }
    let size = 0;
    for (const buffer of buffers) {
      size += buffer.byteLength;
    }
    const res = new Uint8Array(size);
    let offset = 0;
    for (const buffer of buffers) {
      const view = this.toUint8Array(buffer);
      res.set(view, offset);
      offset += view.length;
    }
    if (args[args.length - 1] instanceof Function) {
      return this.toView(res, args[args.length - 1]);
    }
    return res.buffer;
  }
}
const STRING_TYPE = "string";
const HEX_REGEX = /^[0-9a-f\s]+$/i;
const BASE64_REGEX = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const BASE64URL_REGEX = /^[a-zA-Z0-9-_]+$/;
class Utf8Converter {
  static fromString(text) {
    const s = unescape(encodeURIComponent(text));
    const uintArray = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) {
      uintArray[i] = s.charCodeAt(i);
    }
    return uintArray.buffer;
  }
  static toString(buffer) {
    const buf = BufferSourceConverter.toUint8Array(buffer);
    let encodedString = "";
    for (let i = 0; i < buf.length; i++) {
      encodedString += String.fromCharCode(buf[i]);
    }
    const decodedString = decodeURIComponent(escape(encodedString));
    return decodedString;
  }
}
class Utf16Converter {
  static toString(buffer, littleEndian = false) {
    const arrayBuffer = BufferSourceConverter.toArrayBuffer(buffer);
    const dataView = new DataView(arrayBuffer);
    let res = "";
    for (let i = 0; i < arrayBuffer.byteLength; i += 2) {
      const code = dataView.getUint16(i, littleEndian);
      res += String.fromCharCode(code);
    }
    return res;
  }
  static fromString(text, littleEndian = false) {
    const res = new ArrayBuffer(text.length * 2);
    const dataView = new DataView(res);
    for (let i = 0; i < text.length; i++) {
      dataView.setUint16(i * 2, text.charCodeAt(i), littleEndian);
    }
    return res;
  }
}
class Convert {
  static isHex(data) {
    return typeof data === STRING_TYPE && HEX_REGEX.test(data);
  }
  static isBase64(data) {
    return typeof data === STRING_TYPE && BASE64_REGEX.test(data);
  }
  static isBase64Url(data) {
    return typeof data === STRING_TYPE && BASE64URL_REGEX.test(data);
  }
  static ToString(buffer, enc = "utf8") {
    const buf = BufferSourceConverter.toUint8Array(buffer);
    switch (enc.toLowerCase()) {
      case "utf8":
        return this.ToUtf8String(buf);
      case "binary":
        return this.ToBinary(buf);
      case "hex":
        return this.ToHex(buf);
      case "base64":
        return this.ToBase64(buf);
      case "base64url":
        return this.ToBase64Url(buf);
      case "utf16le":
        return Utf16Converter.toString(buf, true);
      case "utf16":
      case "utf16be":
        return Utf16Converter.toString(buf);
      default:
        throw new Error(`Unknown type of encoding '${enc}'`);
    }
  }
  static FromString(str, enc = "utf8") {
    if (!str) {
      return new ArrayBuffer(0);
    }
    switch (enc.toLowerCase()) {
      case "utf8":
        return this.FromUtf8String(str);
      case "binary":
        return this.FromBinary(str);
      case "hex":
        return this.FromHex(str);
      case "base64":
        return this.FromBase64(str);
      case "base64url":
        return this.FromBase64Url(str);
      case "utf16le":
        return Utf16Converter.fromString(str, true);
      case "utf16":
      case "utf16be":
        return Utf16Converter.fromString(str);
      default:
        throw new Error(`Unknown type of encoding '${enc}'`);
    }
  }
  static ToBase64(buffer) {
    const buf = BufferSourceConverter.toUint8Array(buffer);
    if (typeof btoa !== "undefined") {
      const binary = this.ToString(buf, "binary");
      return btoa(binary);
    } else {
      return Buffer.from(buf).toString("base64");
    }
  }
  static FromBase64(base64) {
    const formatted = this.formatString(base64);
    if (!formatted) {
      return new ArrayBuffer(0);
    }
    if (!Convert.isBase64(formatted)) {
      throw new TypeError("Argument 'base64Text' is not Base64 encoded");
    }
    if (typeof atob !== "undefined") {
      return this.FromBinary(atob(formatted));
    } else {
      return new Uint8Array(Buffer.from(formatted, "base64")).buffer;
    }
  }
  static FromBase64Url(base64url) {
    const formatted = this.formatString(base64url);
    if (!formatted) {
      return new ArrayBuffer(0);
    }
    if (!Convert.isBase64Url(formatted)) {
      throw new TypeError("Argument 'base64url' is not Base64Url encoded");
    }
    return this.FromBase64(this.Base64Padding(formatted.replace(/\-/g, "+").replace(/\_/g, "/")));
  }
  static ToBase64Url(data) {
    return this.ToBase64(data).replace(/\+/g, "-").replace(/\//g, "_").replace(/\=/g, "");
  }
  static FromUtf8String(text, encoding = Convert.DEFAULT_UTF8_ENCODING) {
    switch (encoding) {
      case "ascii":
        return this.FromBinary(text);
      case "utf8":
        return Utf8Converter.fromString(text);
      case "utf16":
      case "utf16be":
        return Utf16Converter.fromString(text);
      case "utf16le":
      case "usc2":
        return Utf16Converter.fromString(text, true);
      default:
        throw new Error(`Unknown type of encoding '${encoding}'`);
    }
  }
  static ToUtf8String(buffer, encoding = Convert.DEFAULT_UTF8_ENCODING) {
    switch (encoding) {
      case "ascii":
        return this.ToBinary(buffer);
      case "utf8":
        return Utf8Converter.toString(buffer);
      case "utf16":
      case "utf16be":
        return Utf16Converter.toString(buffer);
      case "utf16le":
      case "usc2":
        return Utf16Converter.toString(buffer, true);
      default:
        throw new Error(`Unknown type of encoding '${encoding}'`);
    }
  }
  static FromBinary(text) {
    const stringLength = text.length;
    const resultView = new Uint8Array(stringLength);
    for (let i = 0; i < stringLength; i++) {
      resultView[i] = text.charCodeAt(i);
    }
    return resultView.buffer;
  }
  static ToBinary(buffer) {
    const buf = BufferSourceConverter.toUint8Array(buffer);
    let res = "";
    for (let i = 0; i < buf.length; i++) {
      res += String.fromCharCode(buf[i]);
    }
    return res;
  }
  static ToHex(buffer) {
    const buf = BufferSourceConverter.toUint8Array(buffer);
    let result = "";
    const len = buf.length;
    for (let i = 0; i < len; i++) {
      const byte = buf[i];
      if (byte < 16) {
        result += "0";
      }
      result += byte.toString(16);
    }
    return result;
  }
  static FromHex(hexString) {
    let formatted = this.formatString(hexString);
    if (!formatted) {
      return new ArrayBuffer(0);
    }
    if (!Convert.isHex(formatted)) {
      throw new TypeError("Argument 'hexString' is not HEX encoded");
    }
    if (formatted.length % 2) {
      formatted = `0${formatted}`;
    }
    const res = new Uint8Array(formatted.length / 2);
    for (let i = 0; i < formatted.length; i = i + 2) {
      const c = formatted.slice(i, i + 2);
      res[i / 2] = parseInt(c, 16);
    }
    return res.buffer;
  }
  static ToUtf16String(buffer, littleEndian = false) {
    return Utf16Converter.toString(buffer, littleEndian);
  }
  static FromUtf16String(text, littleEndian = false) {
    return Utf16Converter.fromString(text, littleEndian);
  }
  static Base64Padding(base64) {
    const padCount = 4 - base64.length % 4;
    if (padCount < 4) {
      for (let i = 0; i < padCount; i++) {
        base64 += "=";
      }
    }
    return base64;
  }
  static formatString(data) {
    return (data === null || data === void 0 ? void 0 : data.replace(/[\n\r\t ]/g, "")) || "";
  }
}
Convert.DEFAULT_UTF8_ENCODING = "utf8";
function combine(...buf) {
  const totalByteLength = buf.map((item) => item.byteLength).reduce((prev, cur) => prev + cur);
  const res = new Uint8Array(totalByteLength);
  let currentPos = 0;
  buf.map((item) => new Uint8Array(item)).forEach((arr) => {
    for (const item2 of arr) {
      res[currentPos++] = item2;
    }
  });
  return res.buffer;
}
function isEqual(bytes1, bytes2) {
  if (!(bytes1 && bytes2)) {
    return false;
  }
  if (bytes1.byteLength !== bytes2.byteLength) {
    return false;
  }
  const b1 = new Uint8Array(bytes1);
  const b2 = new Uint8Array(bytes2);
  for (let i = 0; i < bytes1.byteLength; i++) {
    if (b1[i] !== b2[i]) {
      return false;
    }
  }
  return true;
}
/*!
 Copyright (c) Peculiar Ventures, LLC
*/
function utilFromBase(inputBuffer, inputBase) {
  let result = 0;
  if (inputBuffer.length === 1) {
    return inputBuffer[0];
  }
  for (let i = inputBuffer.length - 1; i >= 0; i--) {
    result += inputBuffer[inputBuffer.length - 1 - i] * Math.pow(2, inputBase * i);
  }
  return result;
}
function utilToBase(value, base, reserved = -1) {
  const internalReserved = reserved;
  let internalValue = value;
  let result = 0;
  let biggest = Math.pow(2, base);
  for (let i = 1; i < 8; i++) {
    if (value < biggest) {
      let retBuf;
      if (internalReserved < 0) {
        retBuf = new ArrayBuffer(i);
        result = i;
      } else {
        if (internalReserved < i) {
          return new ArrayBuffer(0);
        }
        retBuf = new ArrayBuffer(internalReserved);
        result = internalReserved;
      }
      const retView = new Uint8Array(retBuf);
      for (let j = i - 1; j >= 0; j--) {
        const basis = Math.pow(2, j * base);
        retView[result - j - 1] = Math.floor(internalValue / basis);
        internalValue -= retView[result - j - 1] * basis;
      }
      return retBuf;
    }
    biggest *= Math.pow(2, base);
  }
  return new ArrayBuffer(0);
}
function utilConcatView(...views) {
  let outputLength = 0;
  let prevLength = 0;
  for (const view of views) {
    outputLength += view.length;
  }
  const retBuf = new ArrayBuffer(outputLength);
  const retView = new Uint8Array(retBuf);
  for (const view of views) {
    retView.set(view, prevLength);
    prevLength += view.length;
  }
  return retView;
}
function utilDecodeTC() {
  const buf = new Uint8Array(this.valueHex);
  if (this.valueHex.byteLength >= 2) {
    const condition1 = buf[0] === 255 && buf[1] & 128;
    const condition2 = buf[0] === 0 && (buf[1] & 128) === 0;
    if (condition1 || condition2) {
      this.warnings.push("Needlessly long format");
    }
  }
  const bigIntBuffer = new ArrayBuffer(this.valueHex.byteLength);
  const bigIntView = new Uint8Array(bigIntBuffer);
  for (let i = 0; i < this.valueHex.byteLength; i++) {
    bigIntView[i] = 0;
  }
  bigIntView[0] = buf[0] & 128;
  const bigInt = utilFromBase(bigIntView, 8);
  const smallIntBuffer = new ArrayBuffer(this.valueHex.byteLength);
  const smallIntView = new Uint8Array(smallIntBuffer);
  for (let j = 0; j < this.valueHex.byteLength; j++) {
    smallIntView[j] = buf[j];
  }
  smallIntView[0] &= 127;
  const smallInt = utilFromBase(smallIntView, 8);
  return smallInt - bigInt;
}
function utilEncodeTC(value) {
  const modValue = value < 0 ? value * -1 : value;
  let bigInt = 128;
  for (let i = 1; i < 8; i++) {
    if (modValue <= bigInt) {
      if (value < 0) {
        const smallInt = bigInt - modValue;
        const retBuf2 = utilToBase(smallInt, 8, i);
        const retView2 = new Uint8Array(retBuf2);
        retView2[0] |= 128;
        return retBuf2;
      }
      let retBuf = utilToBase(modValue, 8, i);
      let retView = new Uint8Array(retBuf);
      if (retView[0] & 128) {
        const tempBuf = retBuf.slice(0);
        const tempView = new Uint8Array(tempBuf);
        retBuf = new ArrayBuffer(retBuf.byteLength + 1);
        retView = new Uint8Array(retBuf);
        for (let k = 0; k < tempBuf.byteLength; k++) {
          retView[k + 1] = tempView[k];
        }
        retView[0] = 0;
      }
      return retBuf;
    }
    bigInt *= Math.pow(2, 8);
  }
  return new ArrayBuffer(0);
}
function isEqualBuffer(inputBuffer1, inputBuffer2) {
  if (inputBuffer1.byteLength !== inputBuffer2.byteLength) {
    return false;
  }
  const view1 = new Uint8Array(inputBuffer1);
  const view2 = new Uint8Array(inputBuffer2);
  for (let i = 0; i < view1.length; i++) {
    if (view1[i] !== view2[i]) {
      return false;
    }
  }
  return true;
}
function padNumber(inputNumber, fullLength) {
  const str = inputNumber.toString(10);
  if (fullLength < str.length) {
    return "";
  }
  const dif = fullLength - str.length;
  const padding = new Array(dif);
  for (let i = 0; i < dif; i++) {
    padding[i] = "0";
  }
  const paddingString = padding.join("");
  return paddingString.concat(str);
}
/*!
 * Copyright (c) 2014, GMO GlobalSign
 * Copyright (c) 2015-2022, Peculiar Ventures
 * All rights reserved.
 * 
 * Author 2014-2019, Yury Strozhevsky
 * 
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 * 
 * * Redistributions of source code must retain the above copyright notice, this
 *   list of conditions and the following disclaimer.
 * 
 * * Redistributions in binary form must reproduce the above copyright notice, this
 *   list of conditions and the following disclaimer in the documentation and/or
 *   other materials provided with the distribution.
 * 
 * * Neither the name of the copyright holder nor the names of its
 *   contributors may be used to endorse or promote products derived from
 *   this software without specific prior written permission.
 * 
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
 * ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
 * ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 * 
 */
function assertBigInt() {
  if (typeof BigInt === "undefined") {
    throw new Error("BigInt is not defined. Your environment doesn't implement BigInt.");
  }
}
function concat(buffers) {
  let outputLength = 0;
  let prevLength = 0;
  for (let i = 0; i < buffers.length; i++) {
    const buffer = buffers[i];
    outputLength += buffer.byteLength;
  }
  const retView = new Uint8Array(outputLength);
  for (let i = 0; i < buffers.length; i++) {
    const buffer = buffers[i];
    retView.set(new Uint8Array(buffer), prevLength);
    prevLength += buffer.byteLength;
  }
  return retView.buffer;
}
function checkBufferParams(baseBlock, inputBuffer, inputOffset, inputLength) {
  if (!(inputBuffer instanceof Uint8Array)) {
    baseBlock.error = "Wrong parameter: inputBuffer must be 'Uint8Array'";
    return false;
  }
  if (!inputBuffer.byteLength) {
    baseBlock.error = "Wrong parameter: inputBuffer has zero length";
    return false;
  }
  if (inputOffset < 0) {
    baseBlock.error = "Wrong parameter: inputOffset less than zero";
    return false;
  }
  if (inputLength < 0) {
    baseBlock.error = "Wrong parameter: inputLength less than zero";
    return false;
  }
  if (inputBuffer.byteLength - inputOffset - inputLength < 0) {
    baseBlock.error = "End of input reached before message was fully decoded (inconsistent offset and length values)";
    return false;
  }
  return true;
}
class ViewWriter {
  constructor() {
    this.items = [];
  }
  write(buf) {
    this.items.push(buf);
  }
  final() {
    return concat(this.items);
  }
}
const powers2 = [new Uint8Array([1])];
const digitsString = "0123456789";
const NAME$1 = "name";
const VALUE_HEX_VIEW = "valueHexView";
const IS_HEX_ONLY = "isHexOnly";
const ID_BLOCK = "idBlock";
const TAG_CLASS = "tagClass";
const TAG_NUMBER = "tagNumber";
const IS_CONSTRUCTED = "isConstructed";
const FROM_BER = "fromBER";
const TO_BER = "toBER";
const LOCAL = "local";
const EMPTY_STRING = "";
const EMPTY_BUFFER = new ArrayBuffer(0);
const EMPTY_VIEW = new Uint8Array(0);
const END_OF_CONTENT_NAME = "EndOfContent";
const OCTET_STRING_NAME = "OCTET STRING";
const BIT_STRING_NAME = "BIT STRING";
function HexBlock(BaseClass) {
  var _a3;
  return _a3 = class Some extends BaseClass {
    get valueHex() {
      return this.valueHexView.slice().buffer;
    }
    set valueHex(value) {
      this.valueHexView = new Uint8Array(value);
    }
    constructor(...args) {
      var _b;
      super(...args);
      const params = args[0] || {};
      this.isHexOnly = (_b = params.isHexOnly) !== null && _b !== void 0 ? _b : false;
      this.valueHexView = params.valueHex ? BufferSourceConverter.toUint8Array(params.valueHex) : EMPTY_VIEW;
    }
    fromBER(inputBuffer, inputOffset, inputLength, _context) {
      const view = inputBuffer instanceof ArrayBuffer ? new Uint8Array(inputBuffer) : inputBuffer;
      if (!checkBufferParams(this, view, inputOffset, inputLength)) {
        return -1;
      }
      const endLength = inputOffset + inputLength;
      this.valueHexView = view.subarray(inputOffset, endLength);
      if (!this.valueHexView.length) {
        this.warnings.push("Zero buffer length");
        return inputOffset;
      }
      this.blockLength = inputLength;
      return endLength;
    }
    toBER(sizeOnly = false) {
      if (!this.isHexOnly) {
        this.error = "Flag 'isHexOnly' is not set, abort";
        return EMPTY_BUFFER;
      }
      if (sizeOnly) {
        return new ArrayBuffer(this.valueHexView.byteLength);
      }
      return this.valueHexView.byteLength === this.valueHexView.buffer.byteLength ? this.valueHexView.buffer : this.valueHexView.slice().buffer;
    }
    toJSON() {
      return {
        ...super.toJSON(),
        isHexOnly: this.isHexOnly,
        valueHex: Convert.ToHex(this.valueHexView)
      };
    }
  }, _a3.NAME = "hexBlock", _a3;
}
class LocalBaseBlock {
  static blockName() {
    return this.NAME;
  }
  get valueBeforeDecode() {
    return this.valueBeforeDecodeView.slice().buffer;
  }
  set valueBeforeDecode(value) {
    this.valueBeforeDecodeView = new Uint8Array(value);
  }
  constructor({ blockLength = 0, error = EMPTY_STRING, warnings = [], valueBeforeDecode = EMPTY_VIEW } = {}) {
    this.blockLength = blockLength;
    this.error = error;
    this.warnings = warnings;
    this.valueBeforeDecodeView = BufferSourceConverter.toUint8Array(valueBeforeDecode);
  }
  toJSON() {
    return {
      blockName: this.constructor.NAME,
      blockLength: this.blockLength,
      error: this.error,
      warnings: this.warnings,
      valueBeforeDecode: Convert.ToHex(this.valueBeforeDecodeView)
    };
  }
}
LocalBaseBlock.NAME = "baseBlock";
class ValueBlock extends LocalBaseBlock {
  fromBER(_inputBuffer, _inputOffset, _inputLength, _context) {
    throw TypeError("User need to make a specific function in a class which extends 'ValueBlock'");
  }
  toBER(_sizeOnly, _writer) {
    throw TypeError("User need to make a specific function in a class which extends 'ValueBlock'");
  }
}
ValueBlock.NAME = "valueBlock";
class LocalIdentificationBlock extends HexBlock(LocalBaseBlock) {
  constructor({ idBlock = {} } = {}) {
    var _a3, _b, _c, _d;
    super();
    if (idBlock) {
      this.isHexOnly = (_a3 = idBlock.isHexOnly) !== null && _a3 !== void 0 ? _a3 : false;
      this.valueHexView = idBlock.valueHex ? BufferSourceConverter.toUint8Array(idBlock.valueHex) : EMPTY_VIEW;
      this.tagClass = (_b = idBlock.tagClass) !== null && _b !== void 0 ? _b : -1;
      this.tagNumber = (_c = idBlock.tagNumber) !== null && _c !== void 0 ? _c : -1;
      this.isConstructed = (_d = idBlock.isConstructed) !== null && _d !== void 0 ? _d : false;
    } else {
      this.tagClass = -1;
      this.tagNumber = -1;
      this.isConstructed = false;
    }
  }
  toBER(sizeOnly = false) {
    let firstOctet = 0;
    switch (this.tagClass) {
      case 1:
        firstOctet |= 0;
        break;
      case 2:
        firstOctet |= 64;
        break;
      case 3:
        firstOctet |= 128;
        break;
      case 4:
        firstOctet |= 192;
        break;
      default:
        this.error = "Unknown tag class";
        return EMPTY_BUFFER;
    }
    if (this.isConstructed)
      firstOctet |= 32;
    if (this.tagNumber < 31 && !this.isHexOnly) {
      const retView2 = new Uint8Array(1);
      if (!sizeOnly) {
        let number = this.tagNumber;
        number &= 31;
        firstOctet |= number;
        retView2[0] = firstOctet;
      }
      return retView2.buffer;
    }
    if (!this.isHexOnly) {
      const encodedBuf = utilToBase(this.tagNumber, 7);
      const encodedView = new Uint8Array(encodedBuf);
      const size = encodedBuf.byteLength;
      const retView2 = new Uint8Array(size + 1);
      retView2[0] = firstOctet | 31;
      if (!sizeOnly) {
        for (let i = 0; i < size - 1; i++)
          retView2[i + 1] = encodedView[i] | 128;
        retView2[size] = encodedView[size - 1];
      }
      return retView2.buffer;
    }
    const retView = new Uint8Array(this.valueHexView.byteLength + 1);
    retView[0] = firstOctet | 31;
    if (!sizeOnly) {
      const curView = this.valueHexView;
      for (let i = 0; i < curView.length - 1; i++)
        retView[i + 1] = curView[i] | 128;
      retView[this.valueHexView.byteLength] = curView[curView.length - 1];
    }
    return retView.buffer;
  }
  fromBER(inputBuffer, inputOffset, inputLength) {
    const inputView = BufferSourceConverter.toUint8Array(inputBuffer);
    if (!checkBufferParams(this, inputView, inputOffset, inputLength)) {
      return -1;
    }
    const intBuffer = inputView.subarray(inputOffset, inputOffset + inputLength);
    if (intBuffer.length === 0) {
      this.error = "Zero buffer length";
      return -1;
    }
    const tagClassMask = intBuffer[0] & 192;
    switch (tagClassMask) {
      case 0:
        this.tagClass = 1;
        break;
      case 64:
        this.tagClass = 2;
        break;
      case 128:
        this.tagClass = 3;
        break;
      case 192:
        this.tagClass = 4;
        break;
      default:
        this.error = "Unknown tag class";
        return -1;
    }
    this.isConstructed = (intBuffer[0] & 32) === 32;
    this.isHexOnly = false;
    const tagNumberMask = intBuffer[0] & 31;
    if (tagNumberMask !== 31) {
      this.tagNumber = tagNumberMask;
      this.blockLength = 1;
    } else {
      let count = 0;
      while (true) {
        const tagByteIndex = count + 1;
        if (tagByteIndex >= intBuffer.length) {
          this.error = "End of input reached before message was fully decoded";
          return -1;
        }
        count++;
        if ((intBuffer[tagByteIndex] & 128) === 0)
          break;
      }
      this.blockLength = count + 1;
      const intTagNumberBuffer = this.valueHexView = new Uint8Array(count);
      for (let i = 0; i < count; i++)
        intTagNumberBuffer[i] = intBuffer[i + 1] & 127;
      if (this.blockLength <= 9)
        this.tagNumber = utilFromBase(intTagNumberBuffer, 7);
      else {
        this.isHexOnly = true;
        this.warnings.push("Tag too long, represented as hex-coded");
      }
    }
    if (this.tagClass === 1 && this.isConstructed) {
      switch (this.tagNumber) {
        case 1:
        case 2:
        case 5:
        case 6:
        case 9:
        case 13:
        case 14:
        case 23:
        case 24:
        case 31:
        case 32:
        case 33:
        case 34:
          this.error = "Constructed encoding used for primitive type";
          return -1;
      }
    }
    return inputOffset + this.blockLength;
  }
  toJSON() {
    return {
      ...super.toJSON(),
      tagClass: this.tagClass,
      tagNumber: this.tagNumber,
      isConstructed: this.isConstructed
    };
  }
}
LocalIdentificationBlock.NAME = "identificationBlock";
class LocalLengthBlock extends LocalBaseBlock {
  constructor({ lenBlock = {} } = {}) {
    var _a3, _b, _c;
    super();
    this.isIndefiniteForm = (_a3 = lenBlock.isIndefiniteForm) !== null && _a3 !== void 0 ? _a3 : false;
    this.longFormUsed = (_b = lenBlock.longFormUsed) !== null && _b !== void 0 ? _b : false;
    this.length = (_c = lenBlock.length) !== null && _c !== void 0 ? _c : 0;
  }
  fromBER(inputBuffer, inputOffset, inputLength) {
    const view = BufferSourceConverter.toUint8Array(inputBuffer);
    if (!checkBufferParams(this, view, inputOffset, inputLength)) {
      return -1;
    }
    const intBuffer = view.subarray(inputOffset, inputOffset + inputLength);
    if (intBuffer.length === 0) {
      this.error = "Zero buffer length";
      return -1;
    }
    if (intBuffer[0] === 255) {
      this.error = "Length block 0xFF is reserved by standard";
      return -1;
    }
    this.isIndefiniteForm = intBuffer[0] === 128;
    if (this.isIndefiniteForm) {
      this.blockLength = 1;
      return inputOffset + this.blockLength;
    }
    this.longFormUsed = !!(intBuffer[0] & 128);
    if (this.longFormUsed === false) {
      this.length = intBuffer[0];
      this.blockLength = 1;
      return inputOffset + this.blockLength;
    }
    const count = intBuffer[0] & 127;
    if (count > 8) {
      this.error = "Too big integer";
      return -1;
    }
    if (count + 1 > intBuffer.length) {
      this.error = "End of input reached before message was fully decoded";
      return -1;
    }
    const lenOffset = inputOffset + 1;
    const lengthBufferView = view.subarray(lenOffset, lenOffset + count);
    if (lengthBufferView[count - 1] === 0)
      this.warnings.push("Needlessly long encoded length");
    this.length = utilFromBase(lengthBufferView, 8);
    if (this.longFormUsed && this.length <= 127)
      this.warnings.push("Unnecessary usage of long length form");
    this.blockLength = count + 1;
    return inputOffset + this.blockLength;
  }
  toBER(sizeOnly = false) {
    let retBuf;
    let retView;
    if (this.length > 127)
      this.longFormUsed = true;
    if (this.isIndefiniteForm) {
      retBuf = new ArrayBuffer(1);
      if (sizeOnly === false) {
        retView = new Uint8Array(retBuf);
        retView[0] = 128;
      }
      return retBuf;
    }
    if (this.longFormUsed) {
      const encodedBuf = utilToBase(this.length, 8);
      if (encodedBuf.byteLength > 127) {
        this.error = "Too big length";
        return EMPTY_BUFFER;
      }
      retBuf = new ArrayBuffer(encodedBuf.byteLength + 1);
      if (sizeOnly)
        return retBuf;
      const encodedView = new Uint8Array(encodedBuf);
      retView = new Uint8Array(retBuf);
      retView[0] = encodedBuf.byteLength | 128;
      for (let i = 0; i < encodedBuf.byteLength; i++)
        retView[i + 1] = encodedView[i];
      return retBuf;
    }
    retBuf = new ArrayBuffer(1);
    if (sizeOnly === false) {
      retView = new Uint8Array(retBuf);
      retView[0] = this.length;
    }
    return retBuf;
  }
  toJSON() {
    return {
      ...super.toJSON(),
      isIndefiniteForm: this.isIndefiniteForm,
      longFormUsed: this.longFormUsed,
      length: this.length
    };
  }
}
LocalLengthBlock.NAME = "lengthBlock";
const typeStore = {};
class BaseBlock extends LocalBaseBlock {
  constructor({ name = EMPTY_STRING, optional = false, primitiveSchema, ...parameters } = {}, valueBlockType) {
    super(parameters);
    this.name = name;
    this.optional = optional;
    if (primitiveSchema) {
      this.primitiveSchema = primitiveSchema;
    }
    this.idBlock = new LocalIdentificationBlock(parameters);
    this.lenBlock = new LocalLengthBlock(parameters);
    this.valueBlock = valueBlockType ? new valueBlockType(parameters) : new ValueBlock(parameters);
  }
  fromBER(inputBuffer, inputOffset, inputLength, context) {
    const resultOffset = this.valueBlock.fromBER(inputBuffer, inputOffset, this.lenBlock.isIndefiniteForm ? inputLength : this.lenBlock.length, context);
    if (resultOffset === -1) {
      this.error = this.valueBlock.error;
      return resultOffset;
    }
    if (!this.idBlock.error.length)
      this.blockLength += this.idBlock.blockLength;
    if (!this.lenBlock.error.length)
      this.blockLength += this.lenBlock.blockLength;
    if (!this.valueBlock.error.length)
      this.blockLength += this.valueBlock.blockLength;
    return resultOffset;
  }
  toBER(sizeOnly, writer) {
    const _writer = writer || new ViewWriter();
    if (!writer) {
      prepareIndefiniteForm(this);
    }
    const idBlockBuf = this.idBlock.toBER(sizeOnly);
    _writer.write(idBlockBuf);
    if (this.lenBlock.isIndefiniteForm) {
      _writer.write(new Uint8Array([128]).buffer);
      this.valueBlock.toBER(sizeOnly, _writer);
      _writer.write(new ArrayBuffer(2));
    } else {
      const valueBlockBuf = this.valueBlock.toBER(sizeOnly);
      this.lenBlock.length = valueBlockBuf.byteLength;
      const lenBlockBuf = this.lenBlock.toBER(sizeOnly);
      _writer.write(lenBlockBuf);
      _writer.write(valueBlockBuf);
    }
    if (!writer) {
      return _writer.final();
    }
    return EMPTY_BUFFER;
  }
  toJSON() {
    const object = {
      ...super.toJSON(),
      idBlock: this.idBlock.toJSON(),
      lenBlock: this.lenBlock.toJSON(),
      valueBlock: this.valueBlock.toJSON(),
      name: this.name,
      optional: this.optional
    };
    if (this.primitiveSchema)
      object.primitiveSchema = this.primitiveSchema.toJSON();
    return object;
  }
  toString(encoding = "ascii") {
    if (encoding === "ascii") {
      return this.onAsciiEncoding();
    }
    return Convert.ToHex(this.toBER());
  }
  onAsciiEncoding() {
    const name = this.constructor.NAME;
    const value = Convert.ToHex(this.valueBlock.valueBeforeDecodeView);
    return `${name} : ${value}`;
  }
  isEqual(other) {
    if (this === other) {
      return true;
    }
    if (!(other instanceof this.constructor)) {
      return false;
    }
    const thisRaw = this.toBER();
    const otherRaw = other.toBER();
    return isEqualBuffer(thisRaw, otherRaw);
  }
}
BaseBlock.NAME = "BaseBlock";
function prepareIndefiniteForm(baseBlock) {
  var _a3;
  if (baseBlock instanceof typeStore.Constructed) {
    for (const value of baseBlock.valueBlock.value) {
      if (prepareIndefiniteForm(value)) {
        baseBlock.lenBlock.isIndefiniteForm = true;
      }
    }
  }
  return !!((_a3 = baseBlock.lenBlock) === null || _a3 === void 0 ? void 0 : _a3.isIndefiniteForm);
}
class BaseStringBlock extends BaseBlock {
  getValue() {
    return this.valueBlock.value;
  }
  setValue(value) {
    this.valueBlock.value = value;
  }
  constructor({ value = EMPTY_STRING, ...parameters } = {}, stringValueBlockType) {
    super(parameters, stringValueBlockType);
    if (value) {
      this.fromString(value);
    }
  }
  fromBER(inputBuffer, inputOffset, inputLength) {
    const resultOffset = this.valueBlock.fromBER(inputBuffer, inputOffset, this.lenBlock.isIndefiniteForm ? inputLength : this.lenBlock.length);
    if (resultOffset === -1) {
      this.error = this.valueBlock.error;
      return resultOffset;
    }
    this.fromBuffer(this.valueBlock.valueHexView);
    if (!this.idBlock.error.length)
      this.blockLength += this.idBlock.blockLength;
    if (!this.lenBlock.error.length)
      this.blockLength += this.lenBlock.blockLength;
    if (!this.valueBlock.error.length)
      this.blockLength += this.valueBlock.blockLength;
    return resultOffset;
  }
  onAsciiEncoding() {
    return `${this.constructor.NAME} : '${this.valueBlock.value}'`;
  }
}
BaseStringBlock.NAME = "BaseStringBlock";
class LocalPrimitiveValueBlock extends HexBlock(ValueBlock) {
  constructor({ isHexOnly = true, ...parameters } = {}) {
    super(parameters);
    this.isHexOnly = isHexOnly;
  }
}
LocalPrimitiveValueBlock.NAME = "PrimitiveValueBlock";
var _a$w;
class Primitive extends BaseBlock {
  constructor(parameters = {}) {
    super(parameters, LocalPrimitiveValueBlock);
    this.idBlock.isConstructed = false;
  }
}
_a$w = Primitive;
(() => {
  typeStore.Primitive = _a$w;
})();
Primitive.NAME = "PRIMITIVE";
const DEFAULT_MAX_DEPTH = 100;
const DEFAULT_MAX_NODES = 1e4;
const DEFAULT_MAX_CONTENT_LENGTH = 16 * 1024 * 1024;
const MAX_DEPTH_EXCEEDED_ERROR = "Maximum ASN.1 nesting depth exceeded";
const MAX_NODES_EXCEEDED_ERROR = "Maximum ASN.1 node count exceeded";
const MAX_CONTENT_LENGTH_EXCEEDED_ERROR = "Maximum ASN.1 content length exceeded";
function createFromBerContext(options = {}) {
  var _a3, _b, _c;
  return {
    depth: 0,
    maxDepth: (_a3 = options.maxDepth) !== null && _a3 !== void 0 ? _a3 : DEFAULT_MAX_DEPTH,
    nodesCount: 0,
    maxNodes: (_b = options.maxNodes) !== null && _b !== void 0 ? _b : DEFAULT_MAX_NODES,
    maxContentLength: (_c = options.maxContentLength) !== null && _c !== void 0 ? _c : DEFAULT_MAX_CONTENT_LENGTH
  };
}
function createErrorResult(error) {
  const result = new BaseBlock({}, ValueBlock);
  result.error = error;
  return {
    offset: -1,
    result
  };
}
function checkNodesLimit(context) {
  context.nodesCount += 1;
  if (context.nodesCount > context.maxNodes) {
    return MAX_NODES_EXCEEDED_ERROR;
  }
  return void 0;
}
function checkContentLengthLimit(inputLength, context) {
  if (inputLength > context.maxContentLength) {
    return MAX_CONTENT_LENGTH_EXCEEDED_ERROR;
  }
  return void 0;
}
function localFromBERWithChildContext(inputBuffer, inputOffset, inputLength, context) {
  const childDepth = context.depth + 1;
  if (childDepth > context.maxDepth) {
    return createErrorResult(MAX_DEPTH_EXCEEDED_ERROR);
  }
  context.depth = childDepth;
  try {
    return localFromBER(inputBuffer, inputOffset, inputLength, context);
  } finally {
    context.depth -= 1;
  }
}
function localChangeType(inputObject, newType) {
  if (inputObject instanceof newType) {
    return inputObject;
  }
  const newObject = new newType();
  newObject.idBlock = inputObject.idBlock;
  newObject.lenBlock = inputObject.lenBlock;
  newObject.warnings = inputObject.warnings;
  newObject.valueBeforeDecodeView = inputObject.valueBeforeDecodeView;
  return newObject;
}
function localFromBER(inputBuffer, inputOffset = 0, inputLength = inputBuffer.length, context = createFromBerContext()) {
  const incomingOffset = inputOffset;
  let returnObject = new BaseBlock({}, ValueBlock);
  const baseBlock = new LocalBaseBlock();
  if (!checkBufferParams(baseBlock, inputBuffer, inputOffset, inputLength)) {
    returnObject.error = baseBlock.error;
    return {
      offset: -1,
      result: returnObject
    };
  }
  const intBuffer = inputBuffer.subarray(inputOffset, inputOffset + inputLength);
  if (!intBuffer.length) {
    returnObject.error = "Zero buffer length";
    return {
      offset: -1,
      result: returnObject
    };
  }
  const nodesLimitError = checkNodesLimit(context);
  if (nodesLimitError) {
    returnObject.error = nodesLimitError;
    return {
      offset: -1,
      result: returnObject
    };
  }
  let resultOffset = returnObject.idBlock.fromBER(inputBuffer, inputOffset, inputLength);
  if (returnObject.idBlock.warnings.length) {
    returnObject.warnings.concat(returnObject.idBlock.warnings);
  }
  if (resultOffset === -1) {
    returnObject.error = returnObject.idBlock.error;
    return {
      offset: -1,
      result: returnObject
    };
  }
  inputOffset = resultOffset;
  inputLength -= returnObject.idBlock.blockLength;
  resultOffset = returnObject.lenBlock.fromBER(inputBuffer, inputOffset, inputLength);
  if (returnObject.lenBlock.warnings.length) {
    returnObject.warnings.concat(returnObject.lenBlock.warnings);
  }
  if (resultOffset === -1) {
    returnObject.error = returnObject.lenBlock.error;
    return {
      offset: -1,
      result: returnObject
    };
  }
  inputOffset = resultOffset;
  inputLength -= returnObject.lenBlock.blockLength;
  const valueLength = returnObject.lenBlock.isIndefiniteForm ? inputLength : returnObject.lenBlock.length;
  const contentLengthError = checkContentLengthLimit(valueLength, context);
  if (contentLengthError) {
    returnObject.error = contentLengthError;
    return {
      offset: -1,
      result: returnObject
    };
  }
  if (!returnObject.idBlock.isConstructed && returnObject.lenBlock.isIndefiniteForm) {
    returnObject.error = "Indefinite length form used for primitive encoding form";
    return {
      offset: -1,
      result: returnObject
    };
  }
  let newASN1Type = BaseBlock;
  switch (returnObject.idBlock.tagClass) {
    case 1:
      if (returnObject.idBlock.tagNumber >= 37 && returnObject.idBlock.isHexOnly === false) {
        returnObject.error = "UNIVERSAL 37 and upper tags are reserved by ASN.1 standard";
        return {
          offset: -1,
          result: returnObject
        };
      }
      switch (returnObject.idBlock.tagNumber) {
        case 0:
          if (returnObject.idBlock.isConstructed && returnObject.lenBlock.length > 0) {
            returnObject.error = "Type [UNIVERSAL 0] is reserved";
            return {
              offset: -1,
              result: returnObject
            };
          }
          newASN1Type = typeStore.EndOfContent;
          break;
        case 1:
          newASN1Type = typeStore.Boolean;
          break;
        case 2:
          newASN1Type = typeStore.Integer;
          break;
        case 3:
          newASN1Type = typeStore.BitString;
          break;
        case 4:
          newASN1Type = typeStore.OctetString;
          break;
        case 5:
          newASN1Type = typeStore.Null;
          break;
        case 6:
          newASN1Type = typeStore.ObjectIdentifier;
          break;
        case 10:
          newASN1Type = typeStore.Enumerated;
          break;
        case 12:
          newASN1Type = typeStore.Utf8String;
          break;
        case 13:
          newASN1Type = typeStore.RelativeObjectIdentifier;
          break;
        case 14:
          newASN1Type = typeStore.TIME;
          break;
        case 15:
          returnObject.error = "[UNIVERSAL 15] is reserved by ASN.1 standard";
          return {
            offset: -1,
            result: returnObject
          };
        case 16:
          newASN1Type = typeStore.Sequence;
          break;
        case 17:
          newASN1Type = typeStore.Set;
          break;
        case 18:
          newASN1Type = typeStore.NumericString;
          break;
        case 19:
          newASN1Type = typeStore.PrintableString;
          break;
        case 20:
          newASN1Type = typeStore.TeletexString;
          break;
        case 21:
          newASN1Type = typeStore.VideotexString;
          break;
        case 22:
          newASN1Type = typeStore.IA5String;
          break;
        case 23:
          newASN1Type = typeStore.UTCTime;
          break;
        case 24:
          newASN1Type = typeStore.GeneralizedTime;
          break;
        case 25:
          newASN1Type = typeStore.GraphicString;
          break;
        case 26:
          newASN1Type = typeStore.VisibleString;
          break;
        case 27:
          newASN1Type = typeStore.GeneralString;
          break;
        case 28:
          newASN1Type = typeStore.UniversalString;
          break;
        case 29:
          newASN1Type = typeStore.CharacterString;
          break;
        case 30:
          newASN1Type = typeStore.BmpString;
          break;
        case 31:
          newASN1Type = typeStore.DATE;
          break;
        case 32:
          newASN1Type = typeStore.TimeOfDay;
          break;
        case 33:
          newASN1Type = typeStore.DateTime;
          break;
        case 34:
          newASN1Type = typeStore.Duration;
          break;
        default: {
          const newObject = returnObject.idBlock.isConstructed ? new typeStore.Constructed() : new typeStore.Primitive();
          newObject.idBlock = returnObject.idBlock;
          newObject.lenBlock = returnObject.lenBlock;
          newObject.warnings = returnObject.warnings;
          returnObject = newObject;
        }
      }
      break;
    case 2:
    case 3:
    case 4:
    default: {
      newASN1Type = returnObject.idBlock.isConstructed ? typeStore.Constructed : typeStore.Primitive;
    }
  }
  returnObject = localChangeType(returnObject, newASN1Type);
  resultOffset = returnObject.fromBER(inputBuffer, inputOffset, valueLength, context);
  returnObject.valueBeforeDecodeView = inputBuffer.subarray(incomingOffset, incomingOffset + returnObject.blockLength);
  return {
    offset: resultOffset,
    result: returnObject
  };
}
function fromBER(inputBuffer, options = {}) {
  if (!inputBuffer.byteLength) {
    const result = new BaseBlock({}, ValueBlock);
    result.error = "Input buffer has zero length";
    return {
      offset: -1,
      result
    };
  }
  return localFromBER(BufferSourceConverter.toUint8Array(inputBuffer).slice(), 0, inputBuffer.byteLength, createFromBerContext(options));
}
function checkLen(indefiniteLength, length) {
  if (indefiniteLength) {
    return 1;
  }
  return length;
}
class LocalConstructedValueBlock extends ValueBlock {
  constructor({ value = [], isIndefiniteForm = false, ...parameters } = {}) {
    super(parameters);
    this.value = value;
    this.isIndefiniteForm = isIndefiniteForm;
  }
  fromBER(inputBuffer, inputOffset, inputLength, context) {
    const view = BufferSourceConverter.toUint8Array(inputBuffer);
    const parseContext = context !== null && context !== void 0 ? context : createFromBerContext();
    if (!checkBufferParams(this, view, inputOffset, inputLength)) {
      return -1;
    }
    this.valueBeforeDecodeView = view.subarray(inputOffset, inputOffset + inputLength);
    if (this.valueBeforeDecodeView.length === 0) {
      this.warnings.push("Zero buffer length");
      return inputOffset;
    }
    let currentOffset = inputOffset;
    while (checkLen(this.isIndefiniteForm, inputLength) > 0) {
      const returnObject = localFromBERWithChildContext(view, currentOffset, inputLength, parseContext);
      if (returnObject.offset === -1) {
        this.error = returnObject.result.error;
        this.warnings.concat(returnObject.result.warnings);
        return -1;
      }
      currentOffset = returnObject.offset;
      this.blockLength += returnObject.result.blockLength;
      inputLength -= returnObject.result.blockLength;
      this.value.push(returnObject.result);
      if (this.isIndefiniteForm && returnObject.result.constructor.NAME === END_OF_CONTENT_NAME) {
        break;
      }
    }
    if (this.isIndefiniteForm) {
      if (this.value[this.value.length - 1].constructor.NAME === END_OF_CONTENT_NAME) {
        this.value.pop();
      } else {
        this.warnings.push("No EndOfContent block encoded");
      }
    }
    return currentOffset;
  }
  toBER(sizeOnly, writer) {
    const _writer = writer || new ViewWriter();
    for (let i = 0; i < this.value.length; i++) {
      this.value[i].toBER(sizeOnly, _writer);
    }
    if (!writer) {
      return _writer.final();
    }
    return EMPTY_BUFFER;
  }
  toJSON() {
    const object = {
      ...super.toJSON(),
      isIndefiniteForm: this.isIndefiniteForm,
      value: []
    };
    for (const value of this.value) {
      object.value.push(value.toJSON());
    }
    return object;
  }
}
LocalConstructedValueBlock.NAME = "ConstructedValueBlock";
var _a$v;
class Constructed extends BaseBlock {
  constructor(parameters = {}) {
    super(parameters, LocalConstructedValueBlock);
    this.idBlock.isConstructed = true;
  }
  fromBER(inputBuffer, inputOffset, inputLength, context) {
    this.valueBlock.isIndefiniteForm = this.lenBlock.isIndefiniteForm;
    const resultOffset = this.valueBlock.fromBER(inputBuffer, inputOffset, this.lenBlock.isIndefiniteForm ? inputLength : this.lenBlock.length, context);
    if (resultOffset === -1) {
      this.error = this.valueBlock.error;
      return resultOffset;
    }
    if (!this.idBlock.error.length)
      this.blockLength += this.idBlock.blockLength;
    if (!this.lenBlock.error.length)
      this.blockLength += this.lenBlock.blockLength;
    if (!this.valueBlock.error.length)
      this.blockLength += this.valueBlock.blockLength;
    return resultOffset;
  }
  onAsciiEncoding() {
    const values = [];
    for (const value of this.valueBlock.value) {
      values.push(value.toString("ascii").split("\n").map((o) => `  ${o}`).join("\n"));
    }
    const blockName = this.idBlock.tagClass === 3 ? `[${this.idBlock.tagNumber}]` : this.constructor.NAME;
    return values.length ? `${blockName} :
${values.join("\n")}` : `${blockName} :`;
  }
}
_a$v = Constructed;
(() => {
  typeStore.Constructed = _a$v;
})();
Constructed.NAME = "CONSTRUCTED";
class LocalEndOfContentValueBlock extends ValueBlock {
  fromBER(inputBuffer, inputOffset, _inputLength) {
    return inputOffset;
  }
  toBER(_sizeOnly) {
    return EMPTY_BUFFER;
  }
}
LocalEndOfContentValueBlock.override = "EndOfContentValueBlock";
var _a$u;
class EndOfContent extends BaseBlock {
  constructor(parameters = {}) {
    super(parameters, LocalEndOfContentValueBlock);
    this.idBlock.tagClass = 1;
    this.idBlock.tagNumber = 0;
  }
}
_a$u = EndOfContent;
(() => {
  typeStore.EndOfContent = _a$u;
})();
EndOfContent.NAME = END_OF_CONTENT_NAME;
var _a$t;
class Null extends BaseBlock {
  constructor(parameters = {}) {
    super(parameters, ValueBlock);
    this.idBlock.tagClass = 1;
    this.idBlock.tagNumber = 5;
  }
  fromBER(inputBuffer, inputOffset, inputLength) {
    if (this.lenBlock.length > 0)
      this.warnings.push("Non-zero length of value block for Null type");
    if (!this.idBlock.error.length)
      this.blockLength += this.idBlock.blockLength;
    if (!this.lenBlock.error.length)
      this.blockLength += this.lenBlock.blockLength;
    this.blockLength += inputLength;
    if (inputOffset + inputLength > inputBuffer.byteLength) {
      this.error = "End of input reached before message was fully decoded (inconsistent offset and length values)";
      return -1;
    }
    return inputOffset + inputLength;
  }
  toBER(sizeOnly, writer) {
    const retBuf = new ArrayBuffer(2);
    if (!sizeOnly) {
      const retView = new Uint8Array(retBuf);
      retView[0] = 5;
      retView[1] = 0;
    }
    if (writer) {
      writer.write(retBuf);
    }
    return retBuf;
  }
  onAsciiEncoding() {
    return `${this.constructor.NAME}`;
  }
}
_a$t = Null;
(() => {
  typeStore.Null = _a$t;
})();
Null.NAME = "NULL";
class LocalBooleanValueBlock extends HexBlock(ValueBlock) {
  get value() {
    for (const octet of this.valueHexView) {
      if (octet > 0) {
        return true;
      }
    }
    return false;
  }
  set value(value) {
    this.valueHexView[0] = value ? 255 : 0;
  }
  constructor({ value, ...parameters } = {}) {
    super(parameters);
    if (parameters.valueHex) {
      this.valueHexView = BufferSourceConverter.toUint8Array(parameters.valueHex);
    } else {
      this.valueHexView = new Uint8Array(1);
    }
    if (value) {
      this.value = value;
    }
  }
  fromBER(inputBuffer, inputOffset, inputLength) {
    const inputView = BufferSourceConverter.toUint8Array(inputBuffer);
    if (!checkBufferParams(this, inputView, inputOffset, inputLength)) {
      return -1;
    }
    this.valueHexView = inputView.subarray(inputOffset, inputOffset + inputLength);
    if (inputLength > 1)
      this.warnings.push("Boolean value encoded in more then 1 octet");
    this.isHexOnly = true;
    utilDecodeTC.call(this);
    this.blockLength = inputLength;
    return inputOffset + inputLength;
  }
  toBER() {
    return this.valueHexView.slice();
  }
  toJSON() {
    return {
      ...super.toJSON(),
      value: this.value
    };
  }
}
LocalBooleanValueBlock.NAME = "BooleanValueBlock";
var _a$s;
class Boolean extends BaseBlock {
  getValue() {
    return this.valueBlock.value;
  }
  setValue(value) {
    this.valueBlock.value = value;
  }
  constructor(parameters = {}) {
    super(parameters, LocalBooleanValueBlock);
    this.idBlock.tagClass = 1;
    this.idBlock.tagNumber = 1;
  }
  onAsciiEncoding() {
    return `${this.constructor.NAME} : ${this.getValue}`;
  }
}
_a$s = Boolean;
(() => {
  typeStore.Boolean = _a$s;
})();
Boolean.NAME = "BOOLEAN";
class LocalOctetStringValueBlock extends HexBlock(LocalConstructedValueBlock) {
  constructor({ isConstructed = false, ...parameters } = {}) {
    super(parameters);
    this.isConstructed = isConstructed;
  }
  fromBER(inputBuffer, inputOffset, inputLength, context) {
    let resultOffset = 0;
    if (this.isConstructed) {
      this.isHexOnly = false;
      resultOffset = LocalConstructedValueBlock.prototype.fromBER.call(this, inputBuffer, inputOffset, inputLength, context);
      if (resultOffset === -1)
        return resultOffset;
      for (let i = 0; i < this.value.length; i++) {
        const currentBlockName = this.value[i].constructor.NAME;
        if (currentBlockName === END_OF_CONTENT_NAME) {
          if (this.isIndefiniteForm)
            break;
          else {
            this.error = "EndOfContent is unexpected, OCTET STRING may consists of OCTET STRINGs only";
            return -1;
          }
        }
        if (currentBlockName !== OCTET_STRING_NAME) {
          this.error = "OCTET STRING may consists of OCTET STRINGs only";
          return -1;
        }
      }
    } else {
      this.isHexOnly = true;
      resultOffset = super.fromBER(inputBuffer, inputOffset, inputLength);
      this.blockLength = inputLength;
    }
    return resultOffset;
  }
  toBER(sizeOnly, writer) {
    if (this.isConstructed)
      return LocalConstructedValueBlock.prototype.toBER.call(this, sizeOnly, writer);
    return sizeOnly ? new ArrayBuffer(this.valueHexView.byteLength) : this.valueHexView.slice().buffer;
  }
  toJSON() {
    return {
      ...super.toJSON(),
      isConstructed: this.isConstructed
    };
  }
}
LocalOctetStringValueBlock.NAME = "OctetStringValueBlock";
var _a$r;
let OctetString$1 = class OctetString extends BaseBlock {
  constructor({ idBlock = {}, lenBlock = {}, ...parameters } = {}) {
    var _b, _c;
    (_b = parameters.isConstructed) !== null && _b !== void 0 ? _b : parameters.isConstructed = !!((_c = parameters.value) === null || _c === void 0 ? void 0 : _c.length);
    super({
      idBlock: {
        isConstructed: parameters.isConstructed,
        ...idBlock
      },
      lenBlock: {
        ...lenBlock,
        isIndefiniteForm: !!parameters.isIndefiniteForm
      },
      ...parameters
    }, LocalOctetStringValueBlock);
    this.idBlock.tagClass = 1;
    this.idBlock.tagNumber = 4;
  }
  fromBER(inputBuffer, inputOffset, inputLength, context) {
    this.valueBlock.isConstructed = this.idBlock.isConstructed;
    this.valueBlock.isIndefiniteForm = this.lenBlock.isIndefiniteForm;
    if (inputLength === 0) {
      if (this.idBlock.error.length === 0)
        this.blockLength += this.idBlock.blockLength;
      if (this.lenBlock.error.length === 0)
        this.blockLength += this.lenBlock.blockLength;
      return inputOffset;
    }
    if (!this.valueBlock.isConstructed) {
      const view = inputBuffer instanceof ArrayBuffer ? new Uint8Array(inputBuffer) : inputBuffer;
      const buf = view.subarray(inputOffset, inputOffset + inputLength);
      try {
        if (buf.byteLength) {
          const parseContext = context !== null && context !== void 0 ? context : createFromBerContext();
          const asn = localFromBERWithChildContext(buf, 0, buf.byteLength, parseContext);
          if (asn.offset !== -1 && asn.offset === inputLength) {
            this.valueBlock.value = [asn.result];
          }
        }
      } catch {
      }
    }
    return super.fromBER(inputBuffer, inputOffset, inputLength, context);
  }
  onAsciiEncoding() {
    if (this.valueBlock.isConstructed || this.valueBlock.value && this.valueBlock.value.length) {
      return Constructed.prototype.onAsciiEncoding.call(this);
    }
    const name = this.constructor.NAME;
    const value = Convert.ToHex(this.valueBlock.valueHexView);
    return `${name} : ${value}`;
  }
  getValue() {
    if (!this.idBlock.isConstructed) {
      return this.valueBlock.valueHexView.slice().buffer;
    }
    const array = [];
    for (const content of this.valueBlock.value) {
      if (content instanceof _a$r) {
        array.push(content.valueBlock.valueHexView);
      }
    }
    return BufferSourceConverter.concat(array);
  }
};
_a$r = OctetString$1;
(() => {
  typeStore.OctetString = _a$r;
})();
OctetString$1.NAME = OCTET_STRING_NAME;
class LocalBitStringValueBlock extends HexBlock(LocalConstructedValueBlock) {
  constructor({ unusedBits = 0, isConstructed = false, ...parameters } = {}) {
    super(parameters);
    this.unusedBits = unusedBits;
    this.isConstructed = isConstructed;
    this.blockLength = this.valueHexView.byteLength;
  }
  fromBER(inputBuffer, inputOffset, inputLength, context) {
    if (!inputLength) {
      return inputOffset;
    }
    let resultOffset = -1;
    if (this.isConstructed) {
      resultOffset = LocalConstructedValueBlock.prototype.fromBER.call(this, inputBuffer, inputOffset, inputLength, context);
      if (resultOffset === -1)
        return resultOffset;
      for (const value of this.value) {
        const currentBlockName = value.constructor.NAME;
        if (currentBlockName === END_OF_CONTENT_NAME) {
          if (this.isIndefiniteForm)
            break;
          else {
            this.error = "EndOfContent is unexpected, BIT STRING may consists of BIT STRINGs only";
            return -1;
          }
        }
        if (currentBlockName !== BIT_STRING_NAME) {
          this.error = "BIT STRING may consists of BIT STRINGs only";
          return -1;
        }
        const valueBlock = value.valueBlock;
        if (this.unusedBits > 0 && valueBlock.unusedBits > 0) {
          this.error = 'Using of "unused bits" inside constructive BIT STRING allowed for least one only';
          return -1;
        }
        this.unusedBits = valueBlock.unusedBits;
      }
      return resultOffset;
    }
    const inputView = BufferSourceConverter.toUint8Array(inputBuffer);
    if (!checkBufferParams(this, inputView, inputOffset, inputLength)) {
      return -1;
    }
    const intBuffer = inputView.subarray(inputOffset, inputOffset + inputLength);
    this.unusedBits = intBuffer[0];
    if (this.unusedBits > 7) {
      this.error = "Unused bits for BitString must be in range 0-7";
      return -1;
    }
    if (!this.unusedBits) {
      const buf = intBuffer.subarray(1);
      try {
        if (buf.byteLength) {
          const parseContext = context !== null && context !== void 0 ? context : createFromBerContext();
          const asn = localFromBERWithChildContext(buf, 0, buf.byteLength, parseContext);
          if (asn.offset !== -1 && asn.offset === inputLength - 1) {
            this.value = [asn.result];
          }
        }
      } catch {
      }
    }
    this.valueHexView = intBuffer.subarray(1);
    this.blockLength = intBuffer.length;
    return inputOffset + inputLength;
  }
  toBER(sizeOnly, writer) {
    if (this.isConstructed) {
      return LocalConstructedValueBlock.prototype.toBER.call(this, sizeOnly, writer);
    }
    if (sizeOnly) {
      return new ArrayBuffer(this.valueHexView.byteLength + 1);
    }
    if (!this.valueHexView.byteLength) {
      const empty = new Uint8Array(1);
      empty[0] = 0;
      return empty.buffer;
    }
    const retView = new Uint8Array(this.valueHexView.length + 1);
    retView[0] = this.unusedBits;
    retView.set(this.valueHexView, 1);
    return retView.buffer;
  }
  toJSON() {
    return {
      ...super.toJSON(),
      unusedBits: this.unusedBits,
      isConstructed: this.isConstructed
    };
  }
}
LocalBitStringValueBlock.NAME = "BitStringValueBlock";
var _a$q;
let BitString$1 = class BitString extends BaseBlock {
  constructor({ idBlock = {}, lenBlock = {}, ...parameters } = {}) {
    var _b, _c;
    (_b = parameters.isConstructed) !== null && _b !== void 0 ? _b : parameters.isConstructed = !!((_c = parameters.value) === null || _c === void 0 ? void 0 : _c.length);
    super({
      idBlock: {
        isConstructed: parameters.isConstructed,
        ...idBlock
      },
      lenBlock: {
        ...lenBlock,
        isIndefiniteForm: !!parameters.isIndefiniteForm
      },
      ...parameters
    }, LocalBitStringValueBlock);
    this.idBlock.tagClass = 1;
    this.idBlock.tagNumber = 3;
  }
  fromBER(inputBuffer, inputOffset, inputLength, context) {
    this.valueBlock.isConstructed = this.idBlock.isConstructed;
    this.valueBlock.isIndefiniteForm = this.lenBlock.isIndefiniteForm;
    return super.fromBER(inputBuffer, inputOffset, inputLength, context);
  }
  onAsciiEncoding() {
    if (this.valueBlock.isConstructed || this.valueBlock.value && this.valueBlock.value.length) {
      return Constructed.prototype.onAsciiEncoding.call(this);
    } else {
      const bits = [];
      const valueHex = this.valueBlock.valueHexView;
      for (const byte of valueHex) {
        bits.push(byte.toString(2).padStart(8, "0"));
      }
      const bitsStr = bits.join("");
      const name = this.constructor.NAME;
      const value = bitsStr.substring(0, bitsStr.length - this.valueBlock.unusedBits);
      return `${name} : ${value}`;
    }
  }
};
_a$q = BitString$1;
(() => {
  typeStore.BitString = _a$q;
})();
BitString$1.NAME = BIT_STRING_NAME;
var _a$p;
function viewAdd(first, second) {
  const c = new Uint8Array([0]);
  const firstView = new Uint8Array(first);
  const secondView = new Uint8Array(second);
  let firstViewCopy = firstView.slice(0);
  const firstViewCopyLength = firstViewCopy.length - 1;
  const secondViewCopy = secondView.slice(0);
  const secondViewCopyLength = secondViewCopy.length - 1;
  let value = 0;
  const max = secondViewCopyLength < firstViewCopyLength ? firstViewCopyLength : secondViewCopyLength;
  let counter = 0;
  for (let i = max; i >= 0; i--, counter++) {
    switch (true) {
      case counter < secondViewCopy.length:
        value = firstViewCopy[firstViewCopyLength - counter] + secondViewCopy[secondViewCopyLength - counter] + c[0];
        break;
      default:
        value = firstViewCopy[firstViewCopyLength - counter] + c[0];
    }
    c[0] = value / 10;
    switch (true) {
      case counter >= firstViewCopy.length:
        firstViewCopy = utilConcatView(new Uint8Array([value % 10]), firstViewCopy);
        break;
      default:
        firstViewCopy[firstViewCopyLength - counter] = value % 10;
    }
  }
  if (c[0] > 0)
    firstViewCopy = utilConcatView(c, firstViewCopy);
  return firstViewCopy;
}
function power2(n) {
  if (n >= powers2.length) {
    for (let p = powers2.length; p <= n; p++) {
      const c = new Uint8Array([0]);
      let digits = powers2[p - 1].slice(0);
      for (let i = digits.length - 1; i >= 0; i--) {
        const newValue = new Uint8Array([(digits[i] << 1) + c[0]]);
        c[0] = newValue[0] / 10;
        digits[i] = newValue[0] % 10;
      }
      if (c[0] > 0)
        digits = utilConcatView(c, digits);
      powers2.push(digits);
    }
  }
  return powers2[n];
}
function viewSub(first, second) {
  let b = 0;
  const firstView = new Uint8Array(first);
  const secondView = new Uint8Array(second);
  const firstViewCopy = firstView.slice(0);
  const firstViewCopyLength = firstViewCopy.length - 1;
  const secondViewCopy = secondView.slice(0);
  const secondViewCopyLength = secondViewCopy.length - 1;
  let value;
  let counter = 0;
  for (let i = secondViewCopyLength; i >= 0; i--, counter++) {
    value = firstViewCopy[firstViewCopyLength - counter] - secondViewCopy[secondViewCopyLength - counter] - b;
    switch (true) {
      case value < 0:
        b = 1;
        firstViewCopy[firstViewCopyLength - counter] = value + 10;
        break;
      default:
        b = 0;
        firstViewCopy[firstViewCopyLength - counter] = value;
    }
  }
  if (b > 0) {
    for (let i = firstViewCopyLength - secondViewCopyLength + 1; i >= 0; i--, counter++) {
      value = firstViewCopy[firstViewCopyLength - counter] - b;
      if (value < 0) {
        b = 1;
        firstViewCopy[firstViewCopyLength - counter] = value + 10;
      } else {
        b = 0;
        firstViewCopy[firstViewCopyLength - counter] = value;
        break;
      }
    }
  }
  return firstViewCopy.slice();
}
class LocalIntegerValueBlock extends HexBlock(ValueBlock) {
  setValueHex() {
    if (this.valueHexView.length >= 4) {
      this.warnings.push("Too big Integer for decoding, hex only");
      this.isHexOnly = true;
      this._valueDec = 0;
    } else {
      this.isHexOnly = false;
      if (this.valueHexView.length > 0) {
        this._valueDec = utilDecodeTC.call(this);
      }
    }
  }
  constructor({ value, ...parameters } = {}) {
    super(parameters);
    this._valueDec = 0;
    if (parameters.valueHex) {
      this.setValueHex();
    }
    if (value !== void 0) {
      this.valueDec = value;
    }
  }
  set valueDec(v) {
    this._valueDec = v;
    this.isHexOnly = false;
    this.valueHexView = new Uint8Array(utilEncodeTC(v));
  }
  get valueDec() {
    return this._valueDec;
  }
  fromDER(inputBuffer, inputOffset, inputLength, expectedLength = 0) {
    const offset = this.fromBER(inputBuffer, inputOffset, inputLength);
    if (offset === -1)
      return offset;
    const view = this.valueHexView;
    if (view[0] === 0 && (view[1] & 128) !== 0) {
      this.valueHexView = view.subarray(1);
    } else {
      if (expectedLength !== 0) {
        if (view.length < expectedLength) {
          if (expectedLength - view.length > 1)
            expectedLength = view.length + 1;
          this.valueHexView = view.subarray(expectedLength - view.length);
        }
      }
    }
    return offset;
  }
  toDER(sizeOnly = false) {
    const view = this.valueHexView;
    switch (true) {
      case (view[0] & 128) !== 0:
        {
          const updatedView = new Uint8Array(this.valueHexView.length + 1);
          updatedView[0] = 0;
          updatedView.set(view, 1);
          this.valueHexView = updatedView;
        }
        break;
      case (view[0] === 0 && (view[1] & 128) === 0):
        {
          this.valueHexView = this.valueHexView.subarray(1);
        }
        break;
    }
    return this.toBER(sizeOnly);
  }
  fromBER(inputBuffer, inputOffset, inputLength) {
    const resultOffset = super.fromBER(inputBuffer, inputOffset, inputLength);
    if (resultOffset === -1) {
      return resultOffset;
    }
    this.setValueHex();
    return resultOffset;
  }
  toBER(sizeOnly) {
    return sizeOnly ? new ArrayBuffer(this.valueHexView.length) : this.valueHexView.slice().buffer;
  }
  toJSON() {
    return {
      ...super.toJSON(),
      valueDec: this.valueDec
    };
  }
  toString() {
    const firstBit = this.valueHexView.length * 8 - 1;
    let digits = new Uint8Array(this.valueHexView.length * 8 / 3);
    let bitNumber = 0;
    let currentByte;
    const asn1View = this.valueHexView;
    let result = "";
    let flag = false;
    for (let byteNumber = asn1View.byteLength - 1; byteNumber >= 0; byteNumber--) {
      currentByte = asn1View[byteNumber];
      for (let i = 0; i < 8; i++) {
        if ((currentByte & 1) === 1) {
          switch (bitNumber) {
            case firstBit:
              digits = viewSub(power2(bitNumber), digits);
              result = "-";
              break;
            default:
              digits = viewAdd(digits, power2(bitNumber));
          }
        }
        bitNumber++;
        currentByte >>= 1;
      }
    }
    for (let i = 0; i < digits.length; i++) {
      if (digits[i])
        flag = true;
      if (flag)
        result += digitsString.charAt(digits[i]);
    }
    if (flag === false)
      result += digitsString.charAt(0);
    return result;
  }
}
_a$p = LocalIntegerValueBlock;
LocalIntegerValueBlock.NAME = "IntegerValueBlock";
(() => {
  Object.defineProperty(_a$p.prototype, "valueHex", {
    set: function(v) {
      this.valueHexView = new Uint8Array(v);
      this.setValueHex();
    },
    get: function() {
      return this.valueHexView.slice().buffer;
    }
  });
})();
var _a$o;
class Integer extends BaseBlock {
  constructor(parameters = {}) {
    super(parameters, LocalIntegerValueBlock);
    this.idBlock.tagClass = 1;
    this.idBlock.tagNumber = 2;
  }
  toBigInt() {
    assertBigInt();
    return BigInt(this.valueBlock.toString());
  }
  static fromBigInt(value) {
    assertBigInt();
    const bigIntValue = BigInt(value);
    const writer = new ViewWriter();
    const hex = bigIntValue.toString(16).replace(/^-/, "");
    const view = new Uint8Array(Convert.FromHex(hex));
    if (bigIntValue < 0) {
      const first = new Uint8Array(view.length + (view[0] & 128 ? 1 : 0));
      first[0] |= 128;
      const firstInt = BigInt(`0x${Convert.ToHex(first)}`);
      const secondInt = firstInt + bigIntValue;
      const second = BufferSourceConverter.toUint8Array(Convert.FromHex(secondInt.toString(16)));
      second[0] |= 128;
      writer.write(second);
    } else {
      if (view[0] & 128) {
        writer.write(new Uint8Array([0]));
      }
      writer.write(view);
    }
    const res = new _a$o({ valueHex: writer.final() });
    return res;
  }
  convertToDER() {
    const integer = new _a$o({ valueHex: this.valueBlock.valueHexView });
    integer.valueBlock.toDER();
    return integer;
  }
  convertFromDER() {
    return new _a$o({
      valueHex: this.valueBlock.valueHexView[0] === 0 ? this.valueBlock.valueHexView.subarray(1) : this.valueBlock.valueHexView
    });
  }
  onAsciiEncoding() {
    return `${this.constructor.NAME} : ${this.valueBlock.toString()}`;
  }
}
_a$o = Integer;
(() => {
  typeStore.Integer = _a$o;
})();
Integer.NAME = "INTEGER";
var _a$n;
class Enumerated extends Integer {
  constructor(parameters = {}) {
    super(parameters);
    this.idBlock.tagClass = 1;
    this.idBlock.tagNumber = 10;
  }
}
_a$n = Enumerated;
(() => {
  typeStore.Enumerated = _a$n;
})();
Enumerated.NAME = "ENUMERATED";
class LocalSidValueBlock extends HexBlock(ValueBlock) {
  constructor({ valueDec = -1, isFirstSid = false, ...parameters } = {}) {
    super(parameters);
    this.valueDec = valueDec;
    this.isFirstSid = isFirstSid;
  }
  fromBER(inputBuffer, inputOffset, inputLength) {
    if (!inputLength) {
      return inputOffset;
    }
    const inputView = BufferSourceConverter.toUint8Array(inputBuffer);
    if (!checkBufferParams(this, inputView, inputOffset, inputLength)) {
      return -1;
    }
    const intBuffer = inputView.subarray(inputOffset, inputOffset + inputLength);
    this.valueHexView = new Uint8Array(inputLength);
    for (let i = 0; i < inputLength; i++) {
      this.valueHexView[i] = intBuffer[i] & 127;
      this.blockLength++;
      if ((intBuffer[i] & 128) === 0)
        break;
    }
    const tempView = new Uint8Array(this.blockLength);
    for (let i = 0; i < this.blockLength; i++) {
      tempView[i] = this.valueHexView[i];
    }
    this.valueHexView = tempView;
    if ((intBuffer[this.blockLength - 1] & 128) !== 0) {
      this.error = "End of input reached before message was fully decoded";
      return -1;
    }
    if (this.valueHexView[0] === 0)
      this.warnings.push("Needlessly long format of SID encoding");
    if (this.blockLength <= 8)
      this.valueDec = utilFromBase(this.valueHexView, 7);
    else {
      this.isHexOnly = true;
      this.warnings.push("Too big SID for decoding, hex only");
    }
    return inputOffset + this.blockLength;
  }
  set valueBigInt(value) {
    assertBigInt();
    let bits = BigInt(value).toString(2);
    while (bits.length % 7) {
      bits = "0" + bits;
    }
    const bytes = new Uint8Array(bits.length / 7);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(bits.slice(i * 7, i * 7 + 7), 2) + (i + 1 < bytes.length ? 128 : 0);
    }
    this.fromBER(bytes.buffer, 0, bytes.length);
  }
  toBER(sizeOnly) {
    if (this.isHexOnly) {
      if (sizeOnly)
        return new ArrayBuffer(this.valueHexView.byteLength);
      const curView = this.valueHexView;
      const retView2 = new Uint8Array(this.blockLength);
      for (let i = 0; i < this.blockLength - 1; i++)
        retView2[i] = curView[i] | 128;
      retView2[this.blockLength - 1] = curView[this.blockLength - 1];
      return retView2.buffer;
    }
    const encodedBuf = utilToBase(this.valueDec, 7);
    if (encodedBuf.byteLength === 0) {
      this.error = "Error during encoding SID value";
      return EMPTY_BUFFER;
    }
    const retView = new Uint8Array(encodedBuf.byteLength);
    if (!sizeOnly) {
      const encodedView = new Uint8Array(encodedBuf);
      const len = encodedBuf.byteLength - 1;
      for (let i = 0; i < len; i++)
        retView[i] = encodedView[i] | 128;
      retView[len] = encodedView[len];
    }
    return retView;
  }
  toString() {
    let result = "";
    if (this.isHexOnly)
      result = Convert.ToHex(this.valueHexView);
    else {
      if (this.isFirstSid) {
        let sidValue = this.valueDec;
        if (this.valueDec <= 39)
          result = "0.";
        else {
          if (this.valueDec <= 79) {
            result = "1.";
            sidValue -= 40;
          } else {
            result = "2.";
            sidValue -= 80;
          }
        }
        result += sidValue.toString();
      } else
        result = this.valueDec.toString();
    }
    return result;
  }
  toJSON() {
    return {
      ...super.toJSON(),
      valueDec: this.valueDec,
      isFirstSid: this.isFirstSid
    };
  }
}
LocalSidValueBlock.NAME = "sidBlock";
class LocalObjectIdentifierValueBlock extends ValueBlock {
  constructor({ value = EMPTY_STRING, ...parameters } = {}) {
    super(parameters);
    this.value = [];
    if (value) {
      this.fromString(value);
    }
  }
  fromBER(inputBuffer, inputOffset, inputLength) {
    let resultOffset = inputOffset;
    while (inputLength > 0) {
      const sidBlock = new LocalSidValueBlock();
      resultOffset = sidBlock.fromBER(inputBuffer, resultOffset, inputLength);
      if (resultOffset === -1) {
        this.blockLength = 0;
        this.error = sidBlock.error;
        return resultOffset;
      }
      if (this.value.length === 0)
        sidBlock.isFirstSid = true;
      this.blockLength += sidBlock.blockLength;
      inputLength -= sidBlock.blockLength;
      this.value.push(sidBlock);
    }
    return resultOffset;
  }
  toBER(sizeOnly) {
    const retBuffers = [];
    for (let i = 0; i < this.value.length; i++) {
      const valueBuf = this.value[i].toBER(sizeOnly);
      if (valueBuf.byteLength === 0) {
        this.error = this.value[i].error;
        return EMPTY_BUFFER;
      }
      retBuffers.push(valueBuf);
    }
    return concat(retBuffers);
  }
  fromString(string) {
    this.value = [];
    let pos1 = 0;
    let pos2 = 0;
    let sid = "";
    let flag = false;
    do {
      pos2 = string.indexOf(".", pos1);
      if (pos2 === -1)
        sid = string.substring(pos1);
      else
        sid = string.substring(pos1, pos2);
      pos1 = pos2 + 1;
      if (flag) {
        const sidBlock = this.value[0];
        let plus = 0;
        switch (sidBlock.valueDec) {
          case 0:
            break;
          case 1:
            plus = 40;
            break;
          case 2:
            plus = 80;
            break;
          default:
            this.value = [];
            return;
        }
        const parsedSID = parseInt(sid, 10);
        if (isNaN(parsedSID))
          return;
        sidBlock.valueDec = parsedSID + plus;
        flag = false;
      } else {
        const sidBlock = new LocalSidValueBlock();
        if (sid > Number.MAX_SAFE_INTEGER) {
          assertBigInt();
          const sidValue = BigInt(sid);
          sidBlock.valueBigInt = sidValue;
        } else {
          sidBlock.valueDec = parseInt(sid, 10);
          if (isNaN(sidBlock.valueDec))
            return;
        }
        if (!this.value.length) {
          sidBlock.isFirstSid = true;
          flag = true;
        }
        this.value.push(sidBlock);
      }
    } while (pos2 !== -1);
  }
  toString() {
    let result = "";
    let isHexOnly = false;
    for (let i = 0; i < this.value.length; i++) {
      isHexOnly = this.value[i].isHexOnly;
      let sidStr = this.value[i].toString();
      if (i !== 0)
        result = `${result}.`;
      if (isHexOnly) {
        sidStr = `{${sidStr}}`;
        if (this.value[i].isFirstSid)
          result = `2.{${sidStr} - 80}`;
        else
          result += sidStr;
      } else
        result += sidStr;
    }
    return result;
  }
  toJSON() {
    const object = {
      ...super.toJSON(),
      value: this.toString(),
      sidArray: []
    };
    for (let i = 0; i < this.value.length; i++) {
      object.sidArray.push(this.value[i].toJSON());
    }
    return object;
  }
}
LocalObjectIdentifierValueBlock.NAME = "ObjectIdentifierValueBlock";
var _a$m;
class ObjectIdentifier extends BaseBlock {
  getValue() {
    return this.valueBlock.toString();
  }
  setValue(value) {
    this.valueBlock.fromString(value);
  }
  constructor(parameters = {}) {
    super(parameters, LocalObjectIdentifierValueBlock);
    this.idBlock.tagClass = 1;
    this.idBlock.tagNumber = 6;
  }
  onAsciiEncoding() {
    return `${this.constructor.NAME} : ${this.valueBlock.toString() || "empty"}`;
  }
  toJSON() {
    return {
      ...super.toJSON(),
      value: this.getValue()
    };
  }
}
_a$m = ObjectIdentifier;
(() => {
  typeStore.ObjectIdentifier = _a$m;
})();
ObjectIdentifier.NAME = "OBJECT IDENTIFIER";
class LocalRelativeSidValueBlock extends HexBlock(LocalBaseBlock) {
  constructor({ valueDec = 0, ...parameters } = {}) {
    super(parameters);
    this.valueDec = valueDec;
  }
  fromBER(inputBuffer, inputOffset, inputLength) {
    if (inputLength === 0)
      return inputOffset;
    const inputView = BufferSourceConverter.toUint8Array(inputBuffer);
    if (!checkBufferParams(this, inputView, inputOffset, inputLength))
      return -1;
    const intBuffer = inputView.subarray(inputOffset, inputOffset + inputLength);
    this.valueHexView = new Uint8Array(inputLength);
    for (let i = 0; i < inputLength; i++) {
      this.valueHexView[i] = intBuffer[i] & 127;
      this.blockLength++;
      if ((intBuffer[i] & 128) === 0)
        break;
    }
    const tempView = new Uint8Array(this.blockLength);
    for (let i = 0; i < this.blockLength; i++)
      tempView[i] = this.valueHexView[i];
    this.valueHexView = tempView;
    if ((intBuffer[this.blockLength - 1] & 128) !== 0) {
      this.error = "End of input reached before message was fully decoded";
      return -1;
    }
    if (this.valueHexView[0] === 0)
      this.warnings.push("Needlessly long format of SID encoding");
    if (this.blockLength <= 8)
      this.valueDec = utilFromBase(this.valueHexView, 7);
    else {
      this.isHexOnly = true;
      this.warnings.push("Too big SID for decoding, hex only");
    }
    return inputOffset + this.blockLength;
  }
  toBER(sizeOnly) {
    if (this.isHexOnly) {
      if (sizeOnly)
        return new ArrayBuffer(this.valueHexView.byteLength);
      const curView = this.valueHexView;
      const retView2 = new Uint8Array(this.blockLength);
      for (let i = 0; i < this.blockLength - 1; i++)
        retView2[i] = curView[i] | 128;
      retView2[this.blockLength - 1] = curView[this.blockLength - 1];
      return retView2.buffer;
    }
    const encodedBuf = utilToBase(this.valueDec, 7);
    if (encodedBuf.byteLength === 0) {
      this.error = "Error during encoding SID value";
      return EMPTY_BUFFER;
    }
    const retView = new Uint8Array(encodedBuf.byteLength);
    if (!sizeOnly) {
      const encodedView = new Uint8Array(encodedBuf);
      const len = encodedBuf.byteLength - 1;
      for (let i = 0; i < len; i++)
        retView[i] = encodedView[i] | 128;
      retView[len] = encodedView[len];
    }
    return retView.buffer;
  }
  toString() {
    let result = "";
    if (this.isHexOnly)
      result = Convert.ToHex(this.valueHexView);
    else {
      result = this.valueDec.toString();
    }
    return result;
  }
  toJSON() {
    return {
      ...super.toJSON(),
      valueDec: this.valueDec
    };
  }
}
LocalRelativeSidValueBlock.NAME = "relativeSidBlock";
class LocalRelativeObjectIdentifierValueBlock extends ValueBlock {
  constructor({ value = EMPTY_STRING, ...parameters } = {}) {
    super(parameters);
    this.value = [];
    if (value) {
      this.fromString(value);
    }
  }
  fromBER(inputBuffer, inputOffset, inputLength) {
    let resultOffset = inputOffset;
    while (inputLength > 0) {
      const sidBlock = new LocalRelativeSidValueBlock();
      resultOffset = sidBlock.fromBER(inputBuffer, resultOffset, inputLength);
      if (resultOffset === -1) {
        this.blockLength = 0;
        this.error = sidBlock.error;
        return resultOffset;
      }
      this.blockLength += sidBlock.blockLength;
      inputLength -= sidBlock.blockLength;
      this.value.push(sidBlock);
    }
    return resultOffset;
  }
  toBER(sizeOnly, _writer) {
    const retBuffers = [];
    for (let i = 0; i < this.value.length; i++) {
      const valueBuf = this.value[i].toBER(sizeOnly);
      if (valueBuf.byteLength === 0) {
        this.error = this.value[i].error;
        return EMPTY_BUFFER;
      }
      retBuffers.push(valueBuf);
    }
    return concat(retBuffers);
  }
  fromString(string) {
    this.value = [];
    let pos1 = 0;
    let pos2 = 0;
    let sid = "";
    do {
      pos2 = string.indexOf(".", pos1);
      if (pos2 === -1)
        sid = string.substring(pos1);
      else
        sid = string.substring(pos1, pos2);
      pos1 = pos2 + 1;
      const sidBlock = new LocalRelativeSidValueBlock();
      sidBlock.valueDec = parseInt(sid, 10);
      if (isNaN(sidBlock.valueDec))
        return true;
      this.value.push(sidBlock);
    } while (pos2 !== -1);
    return true;
  }
  toString() {
    let result = "";
    let isHexOnly = false;
    for (let i = 0; i < this.value.length; i++) {
      isHexOnly = this.value[i].isHexOnly;
      let sidStr = this.value[i].toString();
      if (i !== 0)
        result = `${result}.`;
      if (isHexOnly) {
        sidStr = `{${sidStr}}`;
        result += sidStr;
      } else
        result += sidStr;
    }
    return result;
  }
  toJSON() {
    const object = {
      ...super.toJSON(),
      value: this.toString(),
      sidArray: []
    };
    for (let i = 0; i < this.value.length; i++)
      object.sidArray.push(this.value[i].toJSON());
    return object;
  }
}
LocalRelativeObjectIdentifierValueBlock.NAME = "RelativeObjectIdentifierValueBlock";
var _a$l;
class RelativeObjectIdentifier extends BaseBlock {
  getValue() {
    return this.valueBlock.toString();
  }
  setValue(value) {
    this.valueBlock.fromString(value);
  }
  constructor(parameters = {}) {
    super(parameters, LocalRelativeObjectIdentifierValueBlock);
    this.idBlock.tagClass = 1;
    this.idBlock.tagNumber = 13;
  }
  onAsciiEncoding() {
    return `${this.constructor.NAME} : ${this.valueBlock.toString() || "empty"}`;
  }
  toJSON() {
    return {
      ...super.toJSON(),
      value: this.getValue()
    };
  }
}
_a$l = RelativeObjectIdentifier;
(() => {
  typeStore.RelativeObjectIdentifier = _a$l;
})();
RelativeObjectIdentifier.NAME = "RelativeObjectIdentifier";
var _a$k;
class Sequence extends Constructed {
  constructor(parameters = {}) {
    super(parameters);
    this.idBlock.tagClass = 1;
    this.idBlock.tagNumber = 16;
  }
}
_a$k = Sequence;
(() => {
  typeStore.Sequence = _a$k;
})();
Sequence.NAME = "SEQUENCE";
var _a$j;
let Set$1 = class Set2 extends Constructed {
  constructor(parameters = {}) {
    super(parameters);
    this.idBlock.tagClass = 1;
    this.idBlock.tagNumber = 17;
  }
};
_a$j = Set$1;
(() => {
  typeStore.Set = _a$j;
})();
Set$1.NAME = "SET";
class LocalStringValueBlock extends HexBlock(ValueBlock) {
  constructor({ ...parameters } = {}) {
    super(parameters);
    this.isHexOnly = true;
    this.value = EMPTY_STRING;
  }
  toJSON() {
    return {
      ...super.toJSON(),
      value: this.value
    };
  }
}
LocalStringValueBlock.NAME = "StringValueBlock";
class LocalSimpleStringValueBlock extends LocalStringValueBlock {
}
LocalSimpleStringValueBlock.NAME = "SimpleStringValueBlock";
class LocalSimpleStringBlock extends BaseStringBlock {
  constructor({ ...parameters } = {}) {
    super(parameters, LocalSimpleStringValueBlock);
  }
  fromBuffer(inputBuffer) {
    this.valueBlock.value = String.fromCharCode.apply(null, BufferSourceConverter.toUint8Array(inputBuffer));
  }
  fromString(inputString) {
    const strLen = inputString.length;
    const view = this.valueBlock.valueHexView = new Uint8Array(strLen);
    for (let i = 0; i < strLen; i++)
      view[i] = inputString.charCodeAt(i);
    this.valueBlock.value = inputString;
  }
}
LocalSimpleStringBlock.NAME = "SIMPLE STRING";
class LocalUtf8StringValueBlock extends LocalSimpleStringBlock {
  fromBuffer(inputBuffer) {
    this.valueBlock.valueHexView = BufferSourceConverter.toUint8Array(inputBuffer);
    try {
      this.valueBlock.value = Convert.ToUtf8String(inputBuffer);
    } catch (ex) {
      this.warnings.push(`Error during "decodeURIComponent": ${ex}, using raw string`);
      this.valueBlock.value = Convert.ToBinary(inputBuffer);
    }
  }
  fromString(inputString) {
    this.valueBlock.valueHexView = new Uint8Array(Convert.FromUtf8String(inputString));
    this.valueBlock.value = inputString;
  }
}
LocalUtf8StringValueBlock.NAME = "Utf8StringValueBlock";
var _a$i;
class Utf8String extends LocalUtf8StringValueBlock {
  constructor(parameters = {}) {
    super(parameters);
    this.idBlock.tagClass = 1;
    this.idBlock.tagNumber = 12;
  }
}
_a$i = Utf8String;
(() => {
  typeStore.Utf8String = _a$i;
})();
Utf8String.NAME = "UTF8String";
class LocalBmpStringValueBlock extends LocalSimpleStringBlock {
  fromBuffer(inputBuffer) {
    this.valueBlock.value = Convert.ToUtf16String(inputBuffer);
    this.valueBlock.valueHexView = BufferSourceConverter.toUint8Array(inputBuffer);
  }
  fromString(inputString) {
    this.valueBlock.value = inputString;
    this.valueBlock.valueHexView = new Uint8Array(Convert.FromUtf16String(inputString));
  }
}
LocalBmpStringValueBlock.NAME = "BmpStringValueBlock";
var _a$h;
class BmpString extends LocalBmpStringValueBlock {
  constructor({ ...parameters } = {}) {
    super(parameters);
    this.idBlock.tagClass = 1;
    this.idBlock.tagNumber = 30;
  }
}
_a$h = BmpString;
(() => {
  typeStore.BmpString = _a$h;
})();
BmpString.NAME = "BMPString";
class LocalUniversalStringValueBlock extends LocalSimpleStringBlock {
  fromBuffer(inputBuffer) {
    const copyBuffer = ArrayBuffer.isView(inputBuffer) ? inputBuffer.slice().buffer : inputBuffer.slice(0);
    const valueView = new Uint8Array(copyBuffer);
    for (let i = 0; i < valueView.length; i += 4) {
      valueView[i] = valueView[i + 3];
      valueView[i + 1] = valueView[i + 2];
      valueView[i + 2] = 0;
      valueView[i + 3] = 0;
    }
    this.valueBlock.value = String.fromCharCode.apply(null, new Uint32Array(copyBuffer));
  }
  fromString(inputString) {
    const strLength = inputString.length;
    const valueHexView = this.valueBlock.valueHexView = new Uint8Array(strLength * 4);
    for (let i = 0; i < strLength; i++) {
      const codeBuf = utilToBase(inputString.charCodeAt(i), 8);
      const codeView = new Uint8Array(codeBuf);
      if (codeView.length > 4)
        continue;
      const dif = 4 - codeView.length;
      for (let j = codeView.length - 1; j >= 0; j--)
        valueHexView[i * 4 + j + dif] = codeView[j];
    }
    this.valueBlock.value = inputString;
  }
}
LocalUniversalStringValueBlock.NAME = "UniversalStringValueBlock";
var _a$g;
class UniversalString extends LocalUniversalStringValueBlock {
  constructor({ ...parameters } = {}) {
    super(parameters);
    this.idBlock.tagClass = 1;
    this.idBlock.tagNumber = 28;
  }
}
_a$g = UniversalString;
(() => {
  typeStore.UniversalString = _a$g;
})();
UniversalString.NAME = "UniversalString";
var _a$f;
class NumericString extends LocalSimpleStringBlock {
  constructor(parameters = {}) {
    super(parameters);
    this.idBlock.tagClass = 1;
    this.idBlock.tagNumber = 18;
  }
}
_a$f = NumericString;
(() => {
  typeStore.NumericString = _a$f;
})();
NumericString.NAME = "NumericString";
var _a$e;
class PrintableString extends LocalSimpleStringBlock {
  constructor(parameters = {}) {
    super(parameters);
    this.idBlock.tagClass = 1;
    this.idBlock.tagNumber = 19;
  }
}
_a$e = PrintableString;
(() => {
  typeStore.PrintableString = _a$e;
})();
PrintableString.NAME = "PrintableString";
var _a$d;
class TeletexString extends LocalSimpleStringBlock {
  constructor(parameters = {}) {
    super(parameters);
    this.idBlock.tagClass = 1;
    this.idBlock.tagNumber = 20;
  }
}
_a$d = TeletexString;
(() => {
  typeStore.TeletexString = _a$d;
})();
TeletexString.NAME = "TeletexString";
var _a$c;
class VideotexString extends LocalSimpleStringBlock {
  constructor(parameters = {}) {
    super(parameters);
    this.idBlock.tagClass = 1;
    this.idBlock.tagNumber = 21;
  }
}
_a$c = VideotexString;
(() => {
  typeStore.VideotexString = _a$c;
})();
VideotexString.NAME = "VideotexString";
var _a$b;
class IA5String extends LocalSimpleStringBlock {
  constructor(parameters = {}) {
    super(parameters);
    this.idBlock.tagClass = 1;
    this.idBlock.tagNumber = 22;
  }
}
_a$b = IA5String;
(() => {
  typeStore.IA5String = _a$b;
})();
IA5String.NAME = "IA5String";
var _a$a;
class GraphicString extends LocalSimpleStringBlock {
  constructor(parameters = {}) {
    super(parameters);
    this.idBlock.tagClass = 1;
    this.idBlock.tagNumber = 25;
  }
}
_a$a = GraphicString;
(() => {
  typeStore.GraphicString = _a$a;
})();
GraphicString.NAME = "GraphicString";
var _a$9;
class VisibleString extends LocalSimpleStringBlock {
  constructor(parameters = {}) {
    super(parameters);
    this.idBlock.tagClass = 1;
    this.idBlock.tagNumber = 26;
  }
}
_a$9 = VisibleString;
(() => {
  typeStore.VisibleString = _a$9;
})();
VisibleString.NAME = "VisibleString";
var _a$8;
class GeneralString extends LocalSimpleStringBlock {
  constructor(parameters = {}) {
    super(parameters);
    this.idBlock.tagClass = 1;
    this.idBlock.tagNumber = 27;
  }
}
_a$8 = GeneralString;
(() => {
  typeStore.GeneralString = _a$8;
})();
GeneralString.NAME = "GeneralString";
var _a$7;
class CharacterString extends LocalSimpleStringBlock {
  constructor(parameters = {}) {
    super(parameters);
    this.idBlock.tagClass = 1;
    this.idBlock.tagNumber = 29;
  }
}
_a$7 = CharacterString;
(() => {
  typeStore.CharacterString = _a$7;
})();
CharacterString.NAME = "CharacterString";
var _a$6;
class UTCTime extends VisibleString {
  constructor({ value, valueDate, ...parameters } = {}) {
    super(parameters);
    this.year = 0;
    this.month = 0;
    this.day = 0;
    this.hour = 0;
    this.minute = 0;
    this.second = 0;
    if (value) {
      this.fromString(value);
      this.valueBlock.valueHexView = new Uint8Array(value.length);
      for (let i = 0; i < value.length; i++)
        this.valueBlock.valueHexView[i] = value.charCodeAt(i);
    }
    if (valueDate) {
      this.fromDate(valueDate);
      this.valueBlock.valueHexView = new Uint8Array(this.toBuffer());
    }
    this.idBlock.tagClass = 1;
    this.idBlock.tagNumber = 23;
  }
  fromBuffer(inputBuffer) {
    this.fromString(String.fromCharCode.apply(null, BufferSourceConverter.toUint8Array(inputBuffer)));
  }
  toBuffer() {
    const str = this.toString();
    const buffer = new ArrayBuffer(str.length);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < str.length; i++)
      view[i] = str.charCodeAt(i);
    return buffer;
  }
  fromDate(inputDate) {
    this.year = inputDate.getUTCFullYear();
    this.month = inputDate.getUTCMonth() + 1;
    this.day = inputDate.getUTCDate();
    this.hour = inputDate.getUTCHours();
    this.minute = inputDate.getUTCMinutes();
    this.second = inputDate.getUTCSeconds();
  }
  toDate() {
    return new Date(Date.UTC(this.year, this.month - 1, this.day, this.hour, this.minute, this.second));
  }
  fromString(inputString) {
    const parser = /(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z/ig;
    const parserArray = parser.exec(inputString);
    if (parserArray === null) {
      this.error = "Wrong input string for conversion";
      return;
    }
    const year = parseInt(parserArray[1], 10);
    if (year >= 50)
      this.year = 1900 + year;
    else
      this.year = 2e3 + year;
    this.month = parseInt(parserArray[2], 10);
    this.day = parseInt(parserArray[3], 10);
    this.hour = parseInt(parserArray[4], 10);
    this.minute = parseInt(parserArray[5], 10);
    this.second = parseInt(parserArray[6], 10);
  }
  toString(encoding = "iso") {
    if (encoding === "iso") {
      const outputArray = new Array(7);
      outputArray[0] = padNumber(this.year < 2e3 ? this.year - 1900 : this.year - 2e3, 2);
      outputArray[1] = padNumber(this.month, 2);
      outputArray[2] = padNumber(this.day, 2);
      outputArray[3] = padNumber(this.hour, 2);
      outputArray[4] = padNumber(this.minute, 2);
      outputArray[5] = padNumber(this.second, 2);
      outputArray[6] = "Z";
      return outputArray.join("");
    }
    return super.toString(encoding);
  }
  onAsciiEncoding() {
    return `${this.constructor.NAME} : ${this.toDate().toISOString()}`;
  }
  toJSON() {
    return {
      ...super.toJSON(),
      year: this.year,
      month: this.month,
      day: this.day,
      hour: this.hour,
      minute: this.minute,
      second: this.second
    };
  }
}
_a$6 = UTCTime;
(() => {
  typeStore.UTCTime = _a$6;
})();
UTCTime.NAME = "UTCTime";
var _a$5;
class GeneralizedTime extends UTCTime {
  constructor(parameters = {}) {
    var _b;
    super(parameters);
    (_b = this.millisecond) !== null && _b !== void 0 ? _b : this.millisecond = 0;
    this.idBlock.tagClass = 1;
    this.idBlock.tagNumber = 24;
  }
  fromDate(inputDate) {
    super.fromDate(inputDate);
    this.millisecond = inputDate.getUTCMilliseconds();
  }
  toDate() {
    const utcDate = Date.UTC(this.year, this.month - 1, this.day, this.hour, this.minute, this.second, this.millisecond);
    return new Date(utcDate);
  }
  fromString(inputString) {
    let isUTC = false;
    let timeString = "";
    let dateTimeString = "";
    let fractionPart = 0;
    let parser;
    let hourDifference = 0;
    let minuteDifference = 0;
    if (inputString[inputString.length - 1] === "Z") {
      timeString = inputString.substring(0, inputString.length - 1);
      isUTC = true;
    } else {
      const number = new Number(inputString[inputString.length - 1]);
      if (isNaN(number.valueOf()))
        throw new Error("Wrong input string for conversion");
      timeString = inputString;
    }
    if (isUTC) {
      if (timeString.indexOf("+") !== -1)
        throw new Error("Wrong input string for conversion");
      if (timeString.indexOf("-") !== -1)
        throw new Error("Wrong input string for conversion");
    } else {
      let multiplier = 1;
      let differencePosition = timeString.indexOf("+");
      let differenceString = "";
      if (differencePosition === -1) {
        differencePosition = timeString.indexOf("-");
        multiplier = -1;
      }
      if (differencePosition !== -1) {
        differenceString = timeString.substring(differencePosition + 1);
        timeString = timeString.substring(0, differencePosition);
        if (differenceString.length !== 2 && differenceString.length !== 4)
          throw new Error("Wrong input string for conversion");
        let number = parseInt(differenceString.substring(0, 2), 10);
        if (isNaN(number.valueOf()))
          throw new Error("Wrong input string for conversion");
        hourDifference = multiplier * number;
        if (differenceString.length === 4) {
          number = parseInt(differenceString.substring(2, 4), 10);
          if (isNaN(number.valueOf()))
            throw new Error("Wrong input string for conversion");
          minuteDifference = multiplier * number;
        }
      }
    }
    let fractionPointPosition = timeString.indexOf(".");
    if (fractionPointPosition === -1)
      fractionPointPosition = timeString.indexOf(",");
    if (fractionPointPosition !== -1) {
      const fractionPartCheck = new Number(`0${timeString.substring(fractionPointPosition)}`);
      if (isNaN(fractionPartCheck.valueOf()))
        throw new Error("Wrong input string for conversion");
      fractionPart = fractionPartCheck.valueOf();
      dateTimeString = timeString.substring(0, fractionPointPosition);
    } else
      dateTimeString = timeString;
    switch (true) {
      case dateTimeString.length === 8:
        parser = /(\d{4})(\d{2})(\d{2})/ig;
        if (fractionPointPosition !== -1)
          throw new Error("Wrong input string for conversion");
        break;
      case dateTimeString.length === 10:
        parser = /(\d{4})(\d{2})(\d{2})(\d{2})/ig;
        if (fractionPointPosition !== -1) {
          let fractionResult = 60 * fractionPart;
          this.minute = Math.floor(fractionResult);
          fractionResult = 60 * (fractionResult - this.minute);
          this.second = Math.floor(fractionResult);
          fractionResult = 1e3 * (fractionResult - this.second);
          this.millisecond = Math.floor(fractionResult);
        }
        break;
      case dateTimeString.length === 12:
        parser = /(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/ig;
        if (fractionPointPosition !== -1) {
          let fractionResult = 60 * fractionPart;
          this.second = Math.floor(fractionResult);
          fractionResult = 1e3 * (fractionResult - this.second);
          this.millisecond = Math.floor(fractionResult);
        }
        break;
      case dateTimeString.length === 14:
        parser = /(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/ig;
        if (fractionPointPosition !== -1) {
          const fractionResult = 1e3 * fractionPart;
          this.millisecond = Math.floor(fractionResult);
        }
        break;
      default:
        throw new Error("Wrong input string for conversion");
    }
    const parserArray = parser.exec(dateTimeString);
    if (parserArray === null)
      throw new Error("Wrong input string for conversion");
    for (let j = 1; j < parserArray.length; j++) {
      switch (j) {
        case 1:
          this.year = parseInt(parserArray[j], 10);
          break;
        case 2:
          this.month = parseInt(parserArray[j], 10);
          break;
        case 3:
          this.day = parseInt(parserArray[j], 10);
          break;
        case 4:
          this.hour = parseInt(parserArray[j], 10) + hourDifference;
          break;
        case 5:
          this.minute = parseInt(parserArray[j], 10) + minuteDifference;
          break;
        case 6:
          this.second = parseInt(parserArray[j], 10);
          break;
        default:
          throw new Error("Wrong input string for conversion");
      }
    }
    if (isUTC === false) {
      const tempDate = new Date(this.year, this.month, this.day, this.hour, this.minute, this.second, this.millisecond);
      this.year = tempDate.getUTCFullYear();
      this.month = tempDate.getUTCMonth();
      this.day = tempDate.getUTCDay();
      this.hour = tempDate.getUTCHours();
      this.minute = tempDate.getUTCMinutes();
      this.second = tempDate.getUTCSeconds();
      this.millisecond = tempDate.getUTCMilliseconds();
    }
  }
  toString(encoding = "iso") {
    if (encoding === "iso") {
      const outputArray = [];
      outputArray.push(padNumber(this.year, 4));
      outputArray.push(padNumber(this.month, 2));
      outputArray.push(padNumber(this.day, 2));
      outputArray.push(padNumber(this.hour, 2));
      outputArray.push(padNumber(this.minute, 2));
      outputArray.push(padNumber(this.second, 2));
      if (this.millisecond !== 0) {
        outputArray.push(".");
        outputArray.push(padNumber(this.millisecond, 3));
      }
      outputArray.push("Z");
      return outputArray.join("");
    }
    return super.toString(encoding);
  }
  toJSON() {
    return {
      ...super.toJSON(),
      millisecond: this.millisecond
    };
  }
}
_a$5 = GeneralizedTime;
(() => {
  typeStore.GeneralizedTime = _a$5;
})();
GeneralizedTime.NAME = "GeneralizedTime";
var _a$4;
class DATE extends Utf8String {
  constructor(parameters = {}) {
    super(parameters);
    this.idBlock.tagClass = 1;
    this.idBlock.tagNumber = 31;
  }
}
_a$4 = DATE;
(() => {
  typeStore.DATE = _a$4;
})();
DATE.NAME = "DATE";
var _a$3;
class TimeOfDay extends Utf8String {
  constructor(parameters = {}) {
    super(parameters);
    this.idBlock.tagClass = 1;
    this.idBlock.tagNumber = 32;
  }
}
_a$3 = TimeOfDay;
(() => {
  typeStore.TimeOfDay = _a$3;
})();
TimeOfDay.NAME = "TimeOfDay";
var _a$2;
class DateTime extends Utf8String {
  constructor(parameters = {}) {
    super(parameters);
    this.idBlock.tagClass = 1;
    this.idBlock.tagNumber = 33;
  }
}
_a$2 = DateTime;
(() => {
  typeStore.DateTime = _a$2;
})();
DateTime.NAME = "DateTime";
var _a$1;
class Duration extends Utf8String {
  constructor(parameters = {}) {
    super(parameters);
    this.idBlock.tagClass = 1;
    this.idBlock.tagNumber = 34;
  }
}
_a$1 = Duration;
(() => {
  typeStore.Duration = _a$1;
})();
Duration.NAME = "Duration";
var _a$x;
class TIME extends Utf8String {
  constructor(parameters = {}) {
    super(parameters);
    this.idBlock.tagClass = 1;
    this.idBlock.tagNumber = 14;
  }
}
_a$x = TIME;
(() => {
  typeStore.TIME = _a$x;
})();
TIME.NAME = "TIME";
class Any {
  constructor({ name = EMPTY_STRING, optional = false } = {}) {
    this.name = name;
    this.optional = optional;
  }
}
class Choice extends Any {
  constructor({ value = [], ...parameters } = {}) {
    super(parameters);
    this.value = value;
  }
}
class Repeated extends Any {
  constructor({ value = new Any(), local = false, ...parameters } = {}) {
    super(parameters);
    this.value = value;
    this.local = local;
  }
}
class RawData {
  get data() {
    return this.dataView.slice().buffer;
  }
  set data(value) {
    this.dataView = BufferSourceConverter.toUint8Array(value);
  }
  constructor({ data = EMPTY_VIEW } = {}) {
    this.dataView = BufferSourceConverter.toUint8Array(data);
  }
  fromBER(inputBuffer, inputOffset, inputLength) {
    const endLength = inputOffset + inputLength;
    this.dataView = BufferSourceConverter.toUint8Array(inputBuffer).subarray(inputOffset, endLength);
    return endLength;
  }
  toBER(_sizeOnly) {
    return this.dataView.slice().buffer;
  }
}
function compareSchema(root, inputData, inputSchema) {
  if (inputSchema instanceof Choice) {
    for (const element of inputSchema.value) {
      const result = compareSchema(root, inputData, element);
      if (result.verified) {
        return {
          verified: true,
          result: root
        };
      }
    }
    {
      const _result = {
        verified: false,
        result: { error: "Wrong values for Choice type" }
      };
      if (inputSchema.hasOwnProperty(NAME$1))
        _result.name = inputSchema.name;
      return _result;
    }
  }
  if (inputSchema instanceof Any) {
    if (inputSchema.hasOwnProperty(NAME$1))
      root[inputSchema.name] = inputData;
    return {
      verified: true,
      result: root
    };
  }
  if (root instanceof Object === false) {
    return {
      verified: false,
      result: { error: "Wrong root object" }
    };
  }
  if (inputData instanceof Object === false) {
    return {
      verified: false,
      result: { error: "Wrong ASN.1 data" }
    };
  }
  if (inputSchema instanceof Object === false) {
    return {
      verified: false,
      result: { error: "Wrong ASN.1 schema" }
    };
  }
  if (ID_BLOCK in inputSchema === false) {
    return {
      verified: false,
      result: { error: "Wrong ASN.1 schema" }
    };
  }
  if (FROM_BER in inputSchema.idBlock === false) {
    return {
      verified: false,
      result: { error: "Wrong ASN.1 schema" }
    };
  }
  if (TO_BER in inputSchema.idBlock === false) {
    return {
      verified: false,
      result: { error: "Wrong ASN.1 schema" }
    };
  }
  const encodedId = inputSchema.idBlock.toBER(false);
  if (encodedId.byteLength === 0) {
    return {
      verified: false,
      result: { error: "Error encoding idBlock for ASN.1 schema" }
    };
  }
  const decodedOffset = inputSchema.idBlock.fromBER(encodedId, 0, encodedId.byteLength);
  if (decodedOffset === -1) {
    return {
      verified: false,
      result: { error: "Error decoding idBlock for ASN.1 schema" }
    };
  }
  if (inputSchema.idBlock.hasOwnProperty(TAG_CLASS) === false) {
    return {
      verified: false,
      result: { error: "Wrong ASN.1 schema" }
    };
  }
  if (inputSchema.idBlock.tagClass !== inputData.idBlock.tagClass) {
    return {
      verified: false,
      result: root
    };
  }
  if (inputSchema.idBlock.hasOwnProperty(TAG_NUMBER) === false) {
    return {
      verified: false,
      result: { error: "Wrong ASN.1 schema" }
    };
  }
  if (inputSchema.idBlock.tagNumber !== inputData.idBlock.tagNumber) {
    return {
      verified: false,
      result: root
    };
  }
  if (inputSchema.idBlock.hasOwnProperty(IS_CONSTRUCTED) === false) {
    return {
      verified: false,
      result: { error: "Wrong ASN.1 schema" }
    };
  }
  if (inputSchema.idBlock.isConstructed !== inputData.idBlock.isConstructed) {
    return {
      verified: false,
      result: root
    };
  }
  if (!(IS_HEX_ONLY in inputSchema.idBlock)) {
    return {
      verified: false,
      result: { error: "Wrong ASN.1 schema" }
    };
  }
  if (inputSchema.idBlock.isHexOnly !== inputData.idBlock.isHexOnly) {
    return {
      verified: false,
      result: root
    };
  }
  if (inputSchema.idBlock.isHexOnly) {
    if (VALUE_HEX_VIEW in inputSchema.idBlock === false) {
      return {
        verified: false,
        result: { error: "Wrong ASN.1 schema" }
      };
    }
    const schemaView = inputSchema.idBlock.valueHexView;
    const asn1View = inputData.idBlock.valueHexView;
    if (schemaView.length !== asn1View.length) {
      return {
        verified: false,
        result: root
      };
    }
    for (let i = 0; i < schemaView.length; i++) {
      if (schemaView[i] !== asn1View[1]) {
        return {
          verified: false,
          result: root
        };
      }
    }
  }
  if (inputSchema.name) {
    inputSchema.name = inputSchema.name.replace(/^\s+|\s+$/g, EMPTY_STRING);
    if (inputSchema.name)
      root[inputSchema.name] = inputData;
  }
  if (inputSchema instanceof typeStore.Constructed) {
    let admission = 0;
    let result = {
      verified: false,
      result: { error: "Unknown error" }
    };
    let maxLength = inputSchema.valueBlock.value.length;
    if (maxLength > 0) {
      if (inputSchema.valueBlock.value[0] instanceof Repeated) {
        maxLength = inputData.valueBlock.value.length;
      }
    }
    if (maxLength === 0) {
      return {
        verified: true,
        result: root
      };
    }
    if (inputData.valueBlock.value.length === 0 && inputSchema.valueBlock.value.length !== 0) {
      let _optional = true;
      for (let i = 0; i < inputSchema.valueBlock.value.length; i++)
        _optional = _optional && (inputSchema.valueBlock.value[i].optional || false);
      if (_optional) {
        return {
          verified: true,
          result: root
        };
      }
      if (inputSchema.name) {
        inputSchema.name = inputSchema.name.replace(/^\s+|\s+$/g, EMPTY_STRING);
        if (inputSchema.name)
          delete root[inputSchema.name];
      }
      root.error = "Inconsistent object length";
      return {
        verified: false,
        result: root
      };
    }
    for (let i = 0; i < maxLength; i++) {
      if (i - admission >= inputData.valueBlock.value.length) {
        if (inputSchema.valueBlock.value[i].optional === false) {
          const _result = {
            verified: false,
            result: root
          };
          root.error = "Inconsistent length between ASN.1 data and schema";
          if (inputSchema.name) {
            inputSchema.name = inputSchema.name.replace(/^\s+|\s+$/g, EMPTY_STRING);
            if (inputSchema.name) {
              delete root[inputSchema.name];
              _result.name = inputSchema.name;
            }
          }
          return _result;
        }
      } else {
        if (inputSchema.valueBlock.value[0] instanceof Repeated) {
          result = compareSchema(root, inputData.valueBlock.value[i], inputSchema.valueBlock.value[0].value);
          if (result.verified === false) {
            if (inputSchema.valueBlock.value[0].optional)
              admission++;
            else {
              if (inputSchema.name) {
                inputSchema.name = inputSchema.name.replace(/^\s+|\s+$/g, EMPTY_STRING);
                if (inputSchema.name)
                  delete root[inputSchema.name];
              }
              return result;
            }
          }
          if (NAME$1 in inputSchema.valueBlock.value[0] && inputSchema.valueBlock.value[0].name.length > 0) {
            let arrayRoot = {};
            if (LOCAL in inputSchema.valueBlock.value[0] && inputSchema.valueBlock.value[0].local)
              arrayRoot = inputData;
            else
              arrayRoot = root;
            if (typeof arrayRoot[inputSchema.valueBlock.value[0].name] === "undefined")
              arrayRoot[inputSchema.valueBlock.value[0].name] = [];
            arrayRoot[inputSchema.valueBlock.value[0].name].push(inputData.valueBlock.value[i]);
          }
        } else {
          result = compareSchema(root, inputData.valueBlock.value[i - admission], inputSchema.valueBlock.value[i]);
          if (result.verified === false) {
            if (inputSchema.valueBlock.value[i].optional)
              admission++;
            else {
              if (inputSchema.name) {
                inputSchema.name = inputSchema.name.replace(/^\s+|\s+$/g, EMPTY_STRING);
                if (inputSchema.name)
                  delete root[inputSchema.name];
              }
              return result;
            }
          }
        }
      }
    }
    if (result.verified === false) {
      const _result = {
        verified: false,
        result: root
      };
      if (inputSchema.name) {
        inputSchema.name = inputSchema.name.replace(/^\s+|\s+$/g, EMPTY_STRING);
        if (inputSchema.name) {
          delete root[inputSchema.name];
          _result.name = inputSchema.name;
        }
      }
      return _result;
    }
    return {
      verified: true,
      result: root
    };
  }
  if (inputSchema.primitiveSchema && VALUE_HEX_VIEW in inputData.valueBlock) {
    const asn1 = localFromBER(inputData.valueBlock.valueHexView);
    if (asn1.offset === -1) {
      const _result = {
        verified: false,
        result: asn1.result
      };
      if (inputSchema.name) {
        inputSchema.name = inputSchema.name.replace(/^\s+|\s+$/g, EMPTY_STRING);
        if (inputSchema.name) {
          delete root[inputSchema.name];
          _result.name = inputSchema.name;
        }
      }
      return _result;
    }
    return compareSchema(root, asn1.result, inputSchema.primitiveSchema);
  }
  return {
    verified: true,
    result: root
  };
}
function verifySchema(inputBuffer, inputSchema) {
  if (inputSchema instanceof Object === false) {
    return {
      verified: false,
      result: { error: "Wrong ASN.1 schema type" }
    };
  }
  const asn1 = localFromBER(BufferSourceConverter.toUint8Array(inputBuffer));
  if (asn1.offset === -1) {
    return {
      verified: false,
      result: asn1.result
    };
  }
  return compareSchema(asn1.result, asn1.result, inputSchema);
}
const asn1js = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  Any,
  BaseBlock,
  BaseStringBlock,
  BitString: BitString$1,
  BmpString,
  Boolean,
  CharacterString,
  Choice,
  Constructed,
  DATE,
  DEFAULT_MAX_CONTENT_LENGTH,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_NODES,
  DateTime,
  Duration,
  EndOfContent,
  Enumerated,
  GeneralString,
  GeneralizedTime,
  GraphicString,
  HexBlock,
  IA5String,
  Integer,
  Null,
  NumericString,
  ObjectIdentifier,
  OctetString: OctetString$1,
  Primitive,
  PrintableString,
  RawData,
  RelativeObjectIdentifier,
  Repeated,
  Sequence,
  Set: Set$1,
  TIME,
  TeletexString,
  TimeOfDay,
  UTCTime,
  UniversalString,
  Utf8String,
  ValueBlock,
  VideotexString,
  ViewWriter,
  VisibleString,
  compareSchema,
  fromBER,
  verifySchema
}, Symbol.toStringTag, { value: "Module" }));
const ARRAY_BUFFER_TAG = "[object ArrayBuffer]";
const SHARED_ARRAY_BUFFER_TAG = "[object SharedArrayBuffer]";
function tagOf(value) {
  return Object.prototype.toString.call(value);
}
function isArrayBufferViewLike(value) {
  if (ArrayBuffer.isView(value)) {
    return true;
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  const view = value;
  return typeof view.byteOffset === "number" && typeof view.byteLength === "number" && isArrayBufferLike(view.buffer);
}
function isArrayBuffer(value) {
  return tagOf(value) === ARRAY_BUFFER_TAG;
}
function isSharedArrayBuffer(value) {
  return typeof SharedArrayBuffer !== "undefined" && tagOf(value) === SHARED_ARRAY_BUFFER_TAG;
}
function isArrayBufferLike(value) {
  return isArrayBuffer(value) || isSharedArrayBuffer(value);
}
function isArrayBufferView(value) {
  return isArrayBufferViewLike(value);
}
function isBufferSource(value) {
  return isArrayBufferLike(value) || isArrayBufferView(value);
}
function assertBufferSource(value) {
  if (!isBufferSource(value)) {
    throw new TypeError("Expected ArrayBuffer, SharedArrayBuffer, or ArrayBufferView");
  }
}
function toUint8Array(data) {
  assertBufferSource(data);
  if (isArrayBufferLike(data)) {
    return new Uint8Array(data);
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}
function toArrayBuffer(data) {
  assertBufferSource(data);
  if (isArrayBuffer(data)) {
    return data;
  }
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(toUint8Array(data));
  return buffer;
}
function equal(a, b, options = {}) {
  const left = toUint8Array(a);
  const right = toUint8Array(b);
  if (!options.constantTime && left.byteLength !== right.byteLength) {
    return false;
  }
  const length = Math.max(left.byteLength, right.byteLength);
  let diff = left.byteLength ^ right.byteLength;
  for (let i = 0; i < length; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}
var AsnTypeTypes;
(function(AsnTypeTypes2) {
  AsnTypeTypes2[AsnTypeTypes2["Sequence"] = 0] = "Sequence";
  AsnTypeTypes2[AsnTypeTypes2["Set"] = 1] = "Set";
  AsnTypeTypes2[AsnTypeTypes2["Choice"] = 2] = "Choice";
})(AsnTypeTypes || (AsnTypeTypes = {}));
var AsnPropTypes;
(function(AsnPropTypes2) {
  AsnPropTypes2[AsnPropTypes2["Any"] = 1] = "Any";
  AsnPropTypes2[AsnPropTypes2["Boolean"] = 2] = "Boolean";
  AsnPropTypes2[AsnPropTypes2["OctetString"] = 3] = "OctetString";
  AsnPropTypes2[AsnPropTypes2["BitString"] = 4] = "BitString";
  AsnPropTypes2[AsnPropTypes2["Integer"] = 5] = "Integer";
  AsnPropTypes2[AsnPropTypes2["Enumerated"] = 6] = "Enumerated";
  AsnPropTypes2[AsnPropTypes2["ObjectIdentifier"] = 7] = "ObjectIdentifier";
  AsnPropTypes2[AsnPropTypes2["Utf8String"] = 8] = "Utf8String";
  AsnPropTypes2[AsnPropTypes2["BmpString"] = 9] = "BmpString";
  AsnPropTypes2[AsnPropTypes2["UniversalString"] = 10] = "UniversalString";
  AsnPropTypes2[AsnPropTypes2["NumericString"] = 11] = "NumericString";
  AsnPropTypes2[AsnPropTypes2["PrintableString"] = 12] = "PrintableString";
  AsnPropTypes2[AsnPropTypes2["TeletexString"] = 13] = "TeletexString";
  AsnPropTypes2[AsnPropTypes2["VideotexString"] = 14] = "VideotexString";
  AsnPropTypes2[AsnPropTypes2["IA5String"] = 15] = "IA5String";
  AsnPropTypes2[AsnPropTypes2["GraphicString"] = 16] = "GraphicString";
  AsnPropTypes2[AsnPropTypes2["VisibleString"] = 17] = "VisibleString";
  AsnPropTypes2[AsnPropTypes2["GeneralString"] = 18] = "GeneralString";
  AsnPropTypes2[AsnPropTypes2["CharacterString"] = 19] = "CharacterString";
  AsnPropTypes2[AsnPropTypes2["UTCTime"] = 20] = "UTCTime";
  AsnPropTypes2[AsnPropTypes2["GeneralizedTime"] = 21] = "GeneralizedTime";
  AsnPropTypes2[AsnPropTypes2["DATE"] = 22] = "DATE";
  AsnPropTypes2[AsnPropTypes2["TimeOfDay"] = 23] = "TimeOfDay";
  AsnPropTypes2[AsnPropTypes2["DateTime"] = 24] = "DateTime";
  AsnPropTypes2[AsnPropTypes2["Duration"] = 25] = "Duration";
  AsnPropTypes2[AsnPropTypes2["TIME"] = 26] = "TIME";
  AsnPropTypes2[AsnPropTypes2["Null"] = 27] = "Null";
})(AsnPropTypes || (AsnPropTypes = {}));
class BitString2 {
  constructor(params, unusedBits = 0) {
    __publicField(this, "unusedBits", 0);
    __publicField(this, "value", new ArrayBuffer(0));
    if (params) {
      if (typeof params === "number") {
        this.fromNumber(params);
      } else if (isBufferSource(params)) {
        this.unusedBits = unusedBits;
        this.value = toArrayBuffer(params);
      } else {
        throw TypeError("Unsupported type of 'params' argument for BitString");
      }
    }
  }
  fromASN(asn) {
    if (!(asn instanceof BitString$1)) {
      throw new TypeError("Argument 'asn' is not instance of ASN.1 BitString");
    }
    this.unusedBits = asn.valueBlock.unusedBits;
    this.value = toArrayBuffer(asn.valueBlock.valueHex);
    return this;
  }
  toASN() {
    return new BitString$1({
      unusedBits: this.unusedBits,
      valueHex: this.value
    });
  }
  toSchema(name) {
    return new BitString$1({ name });
  }
  toNumber() {
    let res = "";
    const uintArray = new Uint8Array(this.value);
    for (const octet of uintArray) {
      res += octet.toString(2).padStart(8, "0");
    }
    res = res.split("").reverse().join("");
    if (this.unusedBits) {
      res = res.slice(this.unusedBits).padStart(this.unusedBits, "0");
    }
    return parseInt(res, 2);
  }
  fromNumber(value) {
    let bits = value.toString(2);
    const octetSize = bits.length + 7 >> 3;
    this.unusedBits = (octetSize << 3) - bits.length;
    const octets = new Uint8Array(octetSize);
    bits = bits.padStart(octetSize << 3, "0").split("").reverse().join("");
    let index = 0;
    while (index < octetSize) {
      octets[index] = parseInt(bits.slice(index << 3, (index << 3) + 8), 2);
      index++;
    }
    this.value = octets.buffer;
  }
}
class OctetString2 {
  constructor(param) {
    __publicField(this, "buffer");
    if (typeof param === "number") {
      this.buffer = new ArrayBuffer(param);
    } else {
      if (isBufferSource(param)) {
        this.buffer = toArrayBuffer(param);
      } else if (Array.isArray(param)) {
        this.buffer = new Uint8Array(param).buffer;
      } else {
        this.buffer = new ArrayBuffer(0);
      }
    }
  }
  get byteLength() {
    return this.buffer.byteLength;
  }
  get byteOffset() {
    return 0;
  }
  fromASN(asn) {
    if (!(asn instanceof OctetString$1)) {
      throw new TypeError("Argument 'asn' is not instance of ASN.1 OctetString");
    }
    this.buffer = toArrayBuffer(asn.valueBlock.valueHex);
    return this;
  }
  toASN() {
    return new OctetString$1({ valueHex: this.buffer });
  }
  toSchema(name) {
    return new OctetString$1({ name });
  }
}
const AsnAnyConverter = {
  fromASN: (value) => value instanceof Null ? null : toArrayBuffer(value.valueBeforeDecodeView),
  toASN: (value) => {
    if (value === null) {
      return new Null();
    }
    const schema = fromBER(value);
    if (schema.result.error) {
      throw new Error(schema.result.error);
    }
    return schema.result;
  }
};
const AsnIntegerConverter = {
  fromASN: (value) => value.valueBlock.valueHexView.byteLength >= 4 ? value.valueBlock.toString() : value.valueBlock.valueDec,
  toASN: (value) => new Integer({ value: +value })
};
const AsnEnumeratedConverter = {
  fromASN: (value) => value.valueBlock.valueDec,
  toASN: (value) => new Enumerated({ value })
};
const AsnIntegerArrayBufferConverter = {
  fromASN: (value) => toArrayBuffer(value.valueBlock.valueHexView),
  toASN: (value) => new Integer({ valueHex: value })
};
const AsnBitStringConverter = {
  fromASN: (value) => toArrayBuffer(value.valueBlock.valueHexView),
  toASN: (value) => new BitString$1({ valueHex: value })
};
const AsnObjectIdentifierConverter = {
  fromASN: (value) => value.valueBlock.toString(),
  toASN: (value) => new ObjectIdentifier({ value })
};
const AsnBooleanConverter = {
  fromASN: (value) => value.valueBlock.value,
  toASN: (value) => new Boolean({ value })
};
const AsnOctetStringConverter = {
  fromASN: (value) => toArrayBuffer(value.valueBlock.valueHexView),
  toASN: (value) => new OctetString$1({ valueHex: value })
};
const AsnConstructedOctetStringConverter = {
  fromASN: (value) => new OctetString2(value.getValue()),
  toASN: (value) => value.toASN()
};
function createStringConverter(Asn1Type) {
  return {
    fromASN: (value) => value.valueBlock.value,
    toASN: (value) => new Asn1Type({ value })
  };
}
const AsnUtf8StringConverter = createStringConverter(Utf8String);
const AsnBmpStringConverter = createStringConverter(BmpString);
const AsnUniversalStringConverter = createStringConverter(UniversalString);
const AsnNumericStringConverter = createStringConverter(NumericString);
const AsnPrintableStringConverter = createStringConverter(PrintableString);
const AsnTeletexStringConverter = createStringConverter(TeletexString);
const AsnVideotexStringConverter = createStringConverter(VideotexString);
const AsnIA5StringConverter = createStringConverter(IA5String);
const AsnGraphicStringConverter = createStringConverter(GraphicString);
const AsnVisibleStringConverter = createStringConverter(VisibleString);
const AsnGeneralStringConverter = createStringConverter(GeneralString);
const AsnCharacterStringConverter = createStringConverter(CharacterString);
const AsnUTCTimeConverter = {
  fromASN: (value) => value.toDate(),
  toASN: (value) => new UTCTime({ valueDate: value })
};
const AsnGeneralizedTimeConverter = {
  fromASN: (value) => value.toDate(),
  toASN: (value) => new GeneralizedTime({ valueDate: value })
};
const AsnNullConverter = {
  fromASN: () => null,
  toASN: () => {
    return new Null();
  }
};
function defaultConverter(type) {
  switch (type) {
    case AsnPropTypes.Any:
      return AsnAnyConverter;
    case AsnPropTypes.BitString:
      return AsnBitStringConverter;
    case AsnPropTypes.BmpString:
      return AsnBmpStringConverter;
    case AsnPropTypes.Boolean:
      return AsnBooleanConverter;
    case AsnPropTypes.CharacterString:
      return AsnCharacterStringConverter;
    case AsnPropTypes.Enumerated:
      return AsnEnumeratedConverter;
    case AsnPropTypes.GeneralString:
      return AsnGeneralStringConverter;
    case AsnPropTypes.GeneralizedTime:
      return AsnGeneralizedTimeConverter;
    case AsnPropTypes.GraphicString:
      return AsnGraphicStringConverter;
    case AsnPropTypes.IA5String:
      return AsnIA5StringConverter;
    case AsnPropTypes.Integer:
      return AsnIntegerConverter;
    case AsnPropTypes.Null:
      return AsnNullConverter;
    case AsnPropTypes.NumericString:
      return AsnNumericStringConverter;
    case AsnPropTypes.ObjectIdentifier:
      return AsnObjectIdentifierConverter;
    case AsnPropTypes.OctetString:
      return AsnOctetStringConverter;
    case AsnPropTypes.PrintableString:
      return AsnPrintableStringConverter;
    case AsnPropTypes.TeletexString:
      return AsnTeletexStringConverter;
    case AsnPropTypes.UTCTime:
      return AsnUTCTimeConverter;
    case AsnPropTypes.UniversalString:
      return AsnUniversalStringConverter;
    case AsnPropTypes.Utf8String:
      return AsnUtf8StringConverter;
    case AsnPropTypes.VideotexString:
      return AsnVideotexStringConverter;
    case AsnPropTypes.VisibleString:
      return AsnVisibleStringConverter;
    default:
      return null;
  }
}
function isConvertible(target) {
  if (typeof target === "function" && target.prototype) {
    if (target.prototype.toASN && target.prototype.fromASN) {
      return true;
    } else {
      return isConvertible(target.prototype);
    }
  } else {
    return !!(target && typeof target === "object" && "toASN" in target && "fromASN" in target);
  }
}
function isTypeOfArray(target) {
  var _a3;
  if (target) {
    const proto = Object.getPrototypeOf(target);
    if (((_a3 = proto == null ? void 0 : proto.prototype) == null ? void 0 : _a3.constructor) === Array) {
      return true;
    }
    return isTypeOfArray(proto);
  }
  return false;
}
function isArrayEqual(bytes1, bytes2) {
  if (!(bytes1 && bytes2)) {
    return false;
  }
  if (bytes1.byteLength !== bytes2.byteLength) {
    return false;
  }
  const b1 = new Uint8Array(bytes1);
  const b2 = new Uint8Array(bytes2);
  for (let i = 0; i < bytes1.byteLength; i++) {
    if (b1[i] !== b2[i]) {
      return false;
    }
  }
  return true;
}
class AsnSchemaStorage {
  constructor() {
    __publicField(this, "items", /* @__PURE__ */ new WeakMap());
  }
  has(target) {
    return this.items.has(target);
  }
  get(target, checkSchema = false) {
    const schema = this.items.get(target);
    if (!schema) {
      throw new Error(`Cannot get schema for '${target.prototype.constructor.name}' target`);
    }
    if (checkSchema && !schema.schema) {
      throw new Error(`Schema '${target.prototype.constructor.name}' doesn't contain ASN.1 schema. Call 'AsnSchemaStorage.cache'.`);
    }
    return schema;
  }
  cache(target) {
    const schema = this.get(target);
    if (!schema.schema) {
      schema.schema = this.create(target, true);
    }
  }
  createDefault(target) {
    const schema = {
      type: AsnTypeTypes.Sequence,
      items: {}
    };
    const parentSchema = this.findParentSchema(target);
    if (parentSchema) {
      Object.assign(schema, parentSchema);
      schema.items = Object.assign({}, schema.items, parentSchema.items);
    }
    return schema;
  }
  create(target, useNames) {
    const schema = this.items.get(target) || this.createDefault(target);
    const asn1Value = [];
    for (const key in schema.items) {
      const item = schema.items[key];
      const name = useNames ? key : "";
      let asn1Item;
      if (typeof item.type === "number") {
        const Asn1TypeName = AsnPropTypes[item.type];
        const Asn1Type = asn1js[Asn1TypeName];
        if (!Asn1Type) {
          throw new Error(`Cannot get ASN1 class by name '${Asn1TypeName}'`);
        }
        asn1Item = new Asn1Type({ name });
      } else if (isConvertible(item.type)) {
        const instance2 = new item.type();
        asn1Item = instance2.toSchema(name);
      } else if (item.optional) {
        const itemSchema = this.get(item.type);
        if (itemSchema.type === AsnTypeTypes.Choice) {
          asn1Item = new Any({ name });
        } else {
          asn1Item = this.create(item.type, false);
          asn1Item.name = name;
        }
      } else {
        asn1Item = new Any({ name });
      }
      const optional = !!item.optional || item.defaultValue !== void 0;
      if (item.repeated) {
        asn1Item.name = "";
        const Container = item.repeated === "set" ? Set$1 : Sequence;
        asn1Item = new Container({
          name: "",
          value: [new Repeated({
            name,
            value: asn1Item
          })]
        });
      }
      if (item.context !== null && item.context !== void 0) {
        if (item.implicit) {
          if (typeof item.type === "number" || isConvertible(item.type)) {
            const Container = item.repeated ? Constructed : Primitive;
            asn1Value.push(new Container({
              name,
              optional,
              idBlock: {
                tagClass: 3,
                tagNumber: item.context
              }
            }));
          } else {
            this.cache(item.type);
            const isRepeated = !!item.repeated;
            let value = !isRepeated ? this.get(item.type, true).schema : asn1Item;
            value = "valueBlock" in value ? value.valueBlock.value : value.value;
            asn1Value.push(new Constructed({
              name: !isRepeated ? name : "",
              optional,
              idBlock: {
                tagClass: 3,
                tagNumber: item.context
              },
              value
            }));
          }
        } else {
          asn1Value.push(new Constructed({
            optional,
            idBlock: {
              tagClass: 3,
              tagNumber: item.context
            },
            value: [asn1Item]
          }));
        }
      } else {
        asn1Item.optional = optional;
        asn1Value.push(asn1Item);
      }
    }
    switch (schema.type) {
      case AsnTypeTypes.Sequence:
        return new Sequence({
          value: asn1Value,
          name: ""
        });
      case AsnTypeTypes.Set:
        return new Set$1({
          value: asn1Value,
          name: ""
        });
      case AsnTypeTypes.Choice:
        return new Choice({
          value: asn1Value,
          name: ""
        });
      default:
        throw new Error("Unsupported ASN1 type in use");
    }
  }
  set(target, schema) {
    this.items.set(target, schema);
    return this;
  }
  findParentSchema(target) {
    const parent = Object.getPrototypeOf(target);
    if (parent) {
      const schema = this.items.get(parent);
      return schema || this.findParentSchema(parent);
    }
    return null;
  }
}
const schemaStorage = new AsnSchemaStorage();
const AsnType = (options) => (target) => {
  let schema;
  if (!schemaStorage.has(target)) {
    schema = schemaStorage.createDefault(target);
    schemaStorage.set(target, schema);
  } else {
    schema = schemaStorage.get(target);
  }
  Object.assign(schema, options);
};
const AsnProp = (options) => (target, propertyKey) => {
  let schema;
  if (!schemaStorage.has(target.constructor)) {
    schema = schemaStorage.createDefault(target.constructor);
    schemaStorage.set(target.constructor, schema);
  } else {
    schema = schemaStorage.get(target.constructor);
  }
  const copyOptions = Object.assign({}, options);
  if (typeof copyOptions.type === "number" && !copyOptions.converter) {
    const defaultConverter$1 = defaultConverter(options.type);
    if (!defaultConverter$1) {
      throw new Error(`Cannot get default converter for property '${propertyKey}' of ${target.constructor.name}`);
    }
    copyOptions.converter = defaultConverter$1;
  }
  copyOptions.raw = options.raw;
  schema.items[propertyKey] = copyOptions;
};
class AsnSchemaValidationError extends Error {
  constructor() {
    super(...arguments);
    __publicField(this, "schemas", []);
  }
}
class AsnParser {
  static parse(data, target, options) {
    const asn1Parsed = fromBER(toArrayBuffer(data), options == null ? void 0 : options.berOptions);
    if (asn1Parsed.result.error) {
      throw new Error(asn1Parsed.result.error);
    }
    const res = this.fromASN(asn1Parsed.result, target, options);
    return res;
  }
  static fromASN(asn1Schema, target, options) {
    try {
      if (isConvertible(target)) {
        const value = new target();
        return value.fromASN(asn1Schema);
      }
      const schema = schemaStorage.get(target);
      schemaStorage.cache(target);
      let targetSchema = schema.schema;
      const choiceResult = this.handleChoiceTypes(asn1Schema, schema, target, targetSchema, options);
      if (choiceResult == null ? void 0 : choiceResult.result) {
        return choiceResult.result;
      }
      if (choiceResult == null ? void 0 : choiceResult.targetSchema) {
        targetSchema = choiceResult.targetSchema;
      }
      const sequenceResult = this.handleSequenceTypes(asn1Schema, schema, target, targetSchema);
      const res = new target();
      if (isTypeOfArray(target)) {
        return this.handleArrayTypes(asn1Schema, schema, target, options);
      }
      this.processSchemaItems(schema, sequenceResult, res, options);
      return res;
    } catch (error) {
      if (error instanceof AsnSchemaValidationError) {
        error.schemas.push(target.name);
      }
      throw error;
    }
  }
  static handleChoiceTypes(asn1Schema, schema, target, targetSchema, options) {
    if (asn1Schema.constructor === Constructed && schema.type === AsnTypeTypes.Choice && asn1Schema.idBlock.tagClass === 3) {
      for (const key in schema.items) {
        const schemaItem = schema.items[key];
        if (schemaItem.context === asn1Schema.idBlock.tagNumber && schemaItem.implicit) {
          if (typeof schemaItem.type === "function" && schemaStorage.has(schemaItem.type)) {
            const fieldSchema = schemaStorage.get(schemaItem.type);
            if (fieldSchema && fieldSchema.type === AsnTypeTypes.Sequence) {
              const newSeq = new Sequence();
              if ("value" in asn1Schema.valueBlock && Array.isArray(asn1Schema.valueBlock.value) && "value" in newSeq.valueBlock) {
                newSeq.valueBlock.value = asn1Schema.valueBlock.value;
                const fieldValue = this.fromASN(newSeq, schemaItem.type, options);
                const res = new target();
                res[key] = fieldValue;
                return { result: res };
              }
            }
          }
        }
      }
    } else if (asn1Schema.constructor === Constructed && schema.type !== AsnTypeTypes.Choice) {
      const newTargetSchema = new Constructed({
        idBlock: {
          tagClass: 3,
          tagNumber: asn1Schema.idBlock.tagNumber
        },
        value: schema.schema.valueBlock.value
      });
      for (const key in schema.items) {
        delete asn1Schema[key];
      }
      return { targetSchema: newTargetSchema };
    }
    return null;
  }
  static handleSequenceTypes(asn1Schema, schema, target, targetSchema) {
    if (schema.type === AsnTypeTypes.Sequence) {
      const asn1ComparedSchema = compareSchema({}, asn1Schema, targetSchema);
      if (!asn1ComparedSchema.verified) {
        throw new AsnSchemaValidationError(`Data does not match to ${target.name} ASN1 schema.${asn1ComparedSchema.result.error ? ` ${asn1ComparedSchema.result.error}` : ""}`);
      }
      return asn1ComparedSchema;
    } else {
      const asn1ComparedSchema = compareSchema({}, asn1Schema, targetSchema);
      if (!asn1ComparedSchema.verified) {
        throw new AsnSchemaValidationError(`Data does not match to ${target.name} ASN1 schema.${asn1ComparedSchema.result.error ? ` ${asn1ComparedSchema.result.error}` : ""}`);
      }
      return asn1ComparedSchema;
    }
  }
  static processRepeatedField(asn1Elements, asn1Index, schemaItem) {
    let elementsToProcess = asn1Elements.slice(asn1Index);
    if (elementsToProcess.length === 1 && elementsToProcess[0].constructor.name === "Sequence") {
      const seq = elementsToProcess[0];
      if (seq.valueBlock && seq.valueBlock.value && Array.isArray(seq.valueBlock.value)) {
        elementsToProcess = seq.valueBlock.value;
      }
    }
    if (typeof schemaItem.type === "number") {
      const converter = defaultConverter(schemaItem.type);
      if (!converter)
        throw new Error(`No converter for ASN.1 type ${schemaItem.type}`);
      return elementsToProcess.filter((el) => el && el.valueBlock).map((el) => {
        try {
          return converter.fromASN(el);
        } catch {
          return void 0;
        }
      }).filter((v) => v !== void 0);
    } else {
      return elementsToProcess.filter((el) => el && el.valueBlock).map((el) => {
        try {
          return this.fromASN(el, schemaItem.type);
        } catch {
          return void 0;
        }
      }).filter((v) => v !== void 0);
    }
  }
  static processPrimitiveField(asn1Element, schemaItem) {
    const converter = defaultConverter(schemaItem.type);
    if (!converter)
      throw new Error(`No converter for ASN.1 type ${schemaItem.type}`);
    return converter.fromASN(asn1Element);
  }
  static isOptionalChoiceField(schemaItem) {
    return schemaItem.optional && typeof schemaItem.type === "function" && schemaStorage.has(schemaItem.type) && schemaStorage.get(schemaItem.type).type === AsnTypeTypes.Choice;
  }
  static processOptionalChoiceField(asn1Element, schemaItem) {
    try {
      const value = this.fromASN(asn1Element, schemaItem.type);
      return {
        processed: true,
        value
      };
    } catch (err) {
      if (err instanceof AsnSchemaValidationError && /Wrong values for Choice type/.test(err.message)) {
        return { processed: false };
      }
      throw err;
    }
  }
  static handleArrayTypes(asn1Schema, schema, target, options) {
    if (!("value" in asn1Schema.valueBlock && Array.isArray(asn1Schema.valueBlock.value))) {
      throw new Error("Cannot get items from the ASN.1 parsed value. ASN.1 object is not constructed.");
    }
    const itemType = schema.itemType;
    if (typeof itemType === "number") {
      const converter = defaultConverter(itemType);
      if (!converter) {
        throw new Error(`Cannot get default converter for array item of ${target.name} ASN1 schema`);
      }
      return target.from(asn1Schema.valueBlock.value, (element) => converter.fromASN(element));
    } else {
      return target.from(asn1Schema.valueBlock.value, (element) => this.fromASN(element, itemType, options));
    }
  }
  static processSchemaItems(schema, asn1ComparedSchema, res, options) {
    for (const key in schema.items) {
      const asn1SchemaValue = asn1ComparedSchema.result[key];
      if (!asn1SchemaValue) {
        continue;
      }
      const schemaItem = schema.items[key];
      const schemaItemType = schemaItem.type;
      let parsedValue;
      if (typeof schemaItemType === "number" || isConvertible(schemaItemType)) {
        parsedValue = this.processPrimitiveSchemaItem(asn1SchemaValue, schemaItem, schemaItemType, options);
      } else {
        parsedValue = this.processComplexSchemaItem(asn1SchemaValue, schemaItem, schemaItemType, options);
      }
      if (parsedValue && typeof parsedValue === "object" && "value" in parsedValue && "raw" in parsedValue) {
        res[key] = parsedValue.value;
        res[`${key}Raw`] = parsedValue.raw;
      } else {
        res[key] = parsedValue;
      }
    }
  }
  static processPrimitiveSchemaItem(asn1SchemaValue, schemaItem, schemaItemType, options) {
    const converter = schemaItem.converter ?? (isConvertible(schemaItemType) ? new schemaItemType() : null);
    if (!converter) {
      throw new Error("Converter is empty");
    }
    if (schemaItem.repeated) {
      return this.processRepeatedPrimitiveItem(asn1SchemaValue, schemaItem, converter, options);
    } else {
      return this.processSinglePrimitiveItem(asn1SchemaValue, schemaItem, schemaItemType, converter, options);
    }
  }
  static processRepeatedPrimitiveItem(asn1SchemaValue, schemaItem, converter, options) {
    if (schemaItem.implicit) {
      const Container = schemaItem.repeated === "sequence" ? Sequence : Set$1;
      const newItem = new Container();
      newItem.valueBlock = asn1SchemaValue.valueBlock;
      const newItemAsn = fromBER(newItem.toBER(false), options == null ? void 0 : options.berOptions);
      if (newItemAsn.offset === -1) {
        throw new Error(`Cannot parse the child item. ${newItemAsn.result.error}`);
      }
      if (!("value" in newItemAsn.result.valueBlock && Array.isArray(newItemAsn.result.valueBlock.value))) {
        throw new Error("Cannot get items from the ASN.1 parsed value. ASN.1 object is not constructed.");
      }
      const value = newItemAsn.result.valueBlock.value;
      return Array.from(value, (element) => converter.fromASN(element));
    } else {
      return Array.from(asn1SchemaValue, (element) => converter.fromASN(element));
    }
  }
  static processSinglePrimitiveItem(asn1SchemaValue, schemaItem, schemaItemType, converter, options) {
    let value = asn1SchemaValue;
    if (schemaItem.implicit) {
      let newItem;
      if (isConvertible(schemaItemType)) {
        newItem = new schemaItemType().toSchema("");
      } else {
        const Asn1TypeName = AsnPropTypes[schemaItemType];
        const Asn1Type = asn1js[Asn1TypeName];
        if (!Asn1Type) {
          throw new Error(`Cannot get '${Asn1TypeName}' class from asn1js module`);
        }
        newItem = new Asn1Type();
      }
      newItem.valueBlock = value.valueBlock;
      value = fromBER(newItem.toBER(false), options == null ? void 0 : options.berOptions).result;
    }
    return converter.fromASN(value);
  }
  static processComplexSchemaItem(asn1SchemaValue, schemaItem, schemaItemType, options) {
    if (schemaItem.repeated) {
      if (!Array.isArray(asn1SchemaValue)) {
        throw new Error("Cannot get list of items from the ASN.1 parsed value. ASN.1 value should be iterable.");
      }
      return Array.from(asn1SchemaValue, (element) => this.fromASN(element, schemaItemType, options));
    } else {
      const valueToProcess = this.handleImplicitTagging(asn1SchemaValue, schemaItem, schemaItemType);
      if (this.isOptionalChoiceField(schemaItem)) {
        try {
          return this.fromASN(valueToProcess, schemaItemType, options);
        } catch (err) {
          if (err instanceof AsnSchemaValidationError && /Wrong values for Choice type/.test(err.message)) {
            return void 0;
          }
          throw err;
        }
      } else {
        const parsedValue = this.fromASN(valueToProcess, schemaItemType, options);
        if (schemaItem.raw) {
          return {
            value: parsedValue,
            raw: asn1SchemaValue.valueBeforeDecodeView
          };
        }
        return parsedValue;
      }
    }
  }
  static handleImplicitTagging(asn1SchemaValue, schemaItem, schemaItemType) {
    if (schemaItem.implicit && typeof schemaItem.context === "number") {
      const schema = schemaStorage.get(schemaItemType);
      if (schema.type === AsnTypeTypes.Sequence) {
        const newSeq = new Sequence();
        if ("value" in asn1SchemaValue.valueBlock && Array.isArray(asn1SchemaValue.valueBlock.value) && "value" in newSeq.valueBlock) {
          newSeq.valueBlock.value = asn1SchemaValue.valueBlock.value;
          return newSeq;
        }
      } else if (schema.type === AsnTypeTypes.Set) {
        const newSet = new Set$1();
        if ("value" in asn1SchemaValue.valueBlock && Array.isArray(asn1SchemaValue.valueBlock.value) && "value" in newSet.valueBlock) {
          newSet.valueBlock.value = asn1SchemaValue.valueBlock.value;
          return newSet;
        }
      }
    }
    return asn1SchemaValue;
  }
}
class AsnSerializer {
  static serialize(obj) {
    if (obj instanceof BaseBlock) {
      return obj.toBER(false);
    }
    return this.toASN(obj).toBER(false);
  }
  static toASN(obj) {
    if (obj && typeof obj === "object" && isConvertible(obj)) {
      return obj.toASN();
    }
    if (!(obj && typeof obj === "object")) {
      throw new TypeError("Parameter 1 should be type of Object.");
    }
    const target = obj.constructor;
    const schema = schemaStorage.get(target);
    schemaStorage.cache(target);
    let asn1Value = [];
    if (schema.itemType) {
      if (!Array.isArray(obj)) {
        throw new TypeError("Parameter 1 should be type of Array.");
      }
      if (typeof schema.itemType === "number") {
        const converter = defaultConverter(schema.itemType);
        if (!converter) {
          throw new Error(`Cannot get default converter for array item of ${target.name} ASN1 schema`);
        }
        asn1Value = obj.map((o) => converter.toASN(o));
      } else {
        asn1Value = obj.map((o) => this.toAsnItem({ type: schema.itemType }, "[]", target, o));
      }
    } else {
      for (const key in schema.items) {
        const schemaItem = schema.items[key];
        const objProp = obj[key];
        if (objProp === void 0 || schemaItem.defaultValue === objProp || typeof schemaItem.defaultValue === "object" && typeof objProp === "object" && isArrayEqual(this.serialize(schemaItem.defaultValue), this.serialize(objProp))) {
          continue;
        }
        const asn1Item = AsnSerializer.toAsnItem(schemaItem, key, target, objProp);
        if (typeof schemaItem.context === "number") {
          if (schemaItem.implicit) {
            if (!schemaItem.repeated && (typeof schemaItem.type === "number" || isConvertible(schemaItem.type))) {
              const value = {};
              value.valueHex = asn1Item instanceof Null ? toArrayBuffer(asn1Item.valueBeforeDecodeView) : asn1Item.valueBlock.toBER();
              asn1Value.push(new Primitive({
                optional: schemaItem.optional,
                idBlock: {
                  tagClass: 3,
                  tagNumber: schemaItem.context
                },
                ...value
              }));
            } else {
              asn1Value.push(new Constructed({
                optional: schemaItem.optional,
                idBlock: {
                  tagClass: 3,
                  tagNumber: schemaItem.context
                },
                value: asn1Item.valueBlock.value
              }));
            }
          } else {
            asn1Value.push(new Constructed({
              optional: schemaItem.optional,
              idBlock: {
                tagClass: 3,
                tagNumber: schemaItem.context
              },
              value: [asn1Item]
            }));
          }
        } else if (schemaItem.repeated) {
          asn1Value = asn1Value.concat(asn1Item);
        } else {
          asn1Value.push(asn1Item);
        }
      }
    }
    let asnSchema;
    switch (schema.type) {
      case AsnTypeTypes.Sequence:
        asnSchema = new Sequence({ value: asn1Value });
        break;
      case AsnTypeTypes.Set:
        asnSchema = new Set$1({ value: asn1Value });
        break;
      case AsnTypeTypes.Choice:
        if (!asn1Value[0]) {
          throw new Error(`Schema '${target.name}' has wrong data. Choice cannot be empty.`);
        }
        asnSchema = asn1Value[0];
        break;
    }
    return asnSchema;
  }
  static toAsnItem(schemaItem, key, target, objProp) {
    let asn1Item;
    if (typeof schemaItem.type === "number") {
      const converter = schemaItem.converter;
      if (!converter) {
        throw new Error(`Property '${key}' doesn't have converter for type ${AsnPropTypes[schemaItem.type]} in schema '${target.name}'`);
      }
      if (schemaItem.repeated) {
        if (!Array.isArray(objProp)) {
          throw new TypeError("Parameter 'objProp' should be type of Array.");
        }
        const items = Array.from(objProp, (element) => converter.toASN(element));
        const Container = schemaItem.repeated === "sequence" ? Sequence : Set$1;
        asn1Item = new Container({ value: items });
      } else {
        asn1Item = converter.toASN(objProp);
      }
    } else {
      if (schemaItem.repeated) {
        if (!Array.isArray(objProp)) {
          throw new TypeError("Parameter 'objProp' should be type of Array.");
        }
        const items = Array.from(objProp, (element) => this.toASN(element));
        const Container = schemaItem.repeated === "sequence" ? Sequence : Set$1;
        asn1Item = new Container({ value: items });
      } else {
        asn1Item = this.toASN(objProp);
      }
    }
    return asn1Item;
  }
}
class AsnArray extends Array {
  constructor(items = []) {
    if (typeof items === "number") {
      super(items);
    } else {
      super();
      for (const item of items) {
        this.push(item);
      }
    }
  }
}
class AsnConvert {
  static serialize(obj) {
    return AsnSerializer.serialize(obj);
  }
  static parse(data, target, options) {
    return AsnParser.parse(data, target, options);
  }
  static toString(data, options) {
    const buf = isBufferSource(data) ? toArrayBuffer(data) : AsnConvert.serialize(data);
    const asn = fromBER(buf, options == null ? void 0 : options.berOptions);
    if (asn.offset === -1) {
      throw new Error(`Cannot decode ASN.1 data. ${asn.result.error}`);
    }
    return asn.result.toString();
  }
}
function __decorate(decorators, target, key, desc) {
  var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
  if (typeof Reflect === "object" && typeof Reflect.decorate === "function")
    r = Reflect.decorate(decorators, target, key, desc);
  else
    for (var i = decorators.length - 1; i >= 0; i--)
      if (d = decorators[i])
        r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
  return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function __classPrivateFieldGet(receiver, state, kind, f) {
  if (kind === "a" && !f)
    throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
    throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
}
function __classPrivateFieldSet(receiver, state, value, kind, f) {
  if (kind === "m")
    throw new TypeError("Private method is not writable");
  if (kind === "a" && !f)
    throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
    throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
}
typeof SuppressedError === "function" ? SuppressedError : function(error, suppressed, message) {
  var e = new Error(message);
  return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
};
function groupPairs(pairs, group) {
  if (!group) {
    return pairs.join("");
  }
  if (!Number.isInteger(group.size) || group.size < 1) {
    throw new RangeError("Hex group size must be a positive integer");
  }
  const chunks = [];
  for (let index = 0; index < pairs.length; index += group.size) {
    chunks.push(pairs.slice(index, index + group.size).join(""));
  }
  return chunks.join(group.separator);
}
function encode(data, options = {}) {
  const bytes = toUint8Array(data);
  const casing = options.case ?? "lower";
  const pairs = Array.from(bytes, (byte) => {
    const text = byte.toString(16).padStart(2, "0");
    return casing === "upper" ? text.toUpperCase() : text;
  });
  let body = "";
  if (options.line) {
    const bytesPerLine = options.line.bytesPerLine;
    if (!Number.isInteger(bytesPerLine) || bytesPerLine < 1) {
      throw new RangeError("Hex bytesPerLine must be a positive integer");
    }
    const separator = options.line.separator ?? "\n";
    const lines = [];
    for (let index = 0; index < pairs.length; index += bytesPerLine) {
      lines.push(groupPairs(pairs.slice(index, index + bytesPerLine), options.group));
    }
    body = lines.join(separator);
  } else {
    body = groupPairs(pairs, options.group);
  }
  return `${options.prefix ?? ""}${body}`;
}
class IpConverter {
  static isIPv4(ip) {
    return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip);
  }
  static parseIPv4(ip) {
    const parts = ip.split(".");
    if (parts.length !== 4) {
      throw new Error("Invalid IPv4 address");
    }
    return parts.map((part) => {
      const num = parseInt(part, 10);
      if (isNaN(num) || num < 0 || num > 255) {
        throw new Error("Invalid IPv4 address part");
      }
      return num;
    });
  }
  static parseIPv6(ip) {
    const expandedIP = this.expandIPv6(ip);
    const parts = expandedIP.split(":");
    if (parts.length !== 8) {
      throw new Error("Invalid IPv6 address");
    }
    return parts.reduce((bytes, part) => {
      const num = parseInt(part, 16);
      if (isNaN(num) || num < 0 || num > 65535) {
        throw new Error("Invalid IPv6 address part");
      }
      bytes.push(num >> 8 & 255);
      bytes.push(num & 255);
      return bytes;
    }, []);
  }
  static expandIPv6(ip) {
    if (!ip.includes("::")) {
      return ip;
    }
    const parts = ip.split("::");
    if (parts.length > 2) {
      throw new Error("Invalid IPv6 address");
    }
    const left = parts[0] ? parts[0].split(":") : [];
    const right = parts[1] ? parts[1].split(":") : [];
    const missing = 8 - (left.length + right.length);
    if (missing < 0) {
      throw new Error("Invalid IPv6 address");
    }
    return [...left, ...Array(missing).fill("0"), ...right].join(":");
  }
  static formatIPv6(bytes) {
    const parts = [];
    for (let i = 0; i < 16; i += 2) {
      parts.push((bytes[i] << 8 | bytes[i + 1]).toString(16));
    }
    return this.compressIPv6(parts.join(":"));
  }
  static compressIPv6(ip) {
    const parts = ip.split(":");
    let longestZeroStart = -1;
    let longestZeroLength = 0;
    let currentZeroStart = -1;
    let currentZeroLength = 0;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === "0") {
        if (currentZeroStart === -1) {
          currentZeroStart = i;
        }
        currentZeroLength++;
      } else {
        if (currentZeroLength > longestZeroLength) {
          longestZeroStart = currentZeroStart;
          longestZeroLength = currentZeroLength;
        }
        currentZeroStart = -1;
        currentZeroLength = 0;
      }
    }
    if (currentZeroLength > longestZeroLength) {
      longestZeroStart = currentZeroStart;
      longestZeroLength = currentZeroLength;
    }
    if (longestZeroLength > 1) {
      const before = parts.slice(0, longestZeroStart).join(":");
      const after = parts.slice(longestZeroStart + longestZeroLength).join(":");
      return `${before}::${after}`;
    }
    return ip;
  }
  static parseCIDR(text) {
    const [addr, prefixStr] = text.split("/");
    const prefix = parseInt(prefixStr, 10);
    if (this.isIPv4(addr)) {
      if (prefix < 0 || prefix > 32) {
        throw new Error("Invalid IPv4 prefix length");
      }
      return [this.parseIPv4(addr), prefix];
    } else {
      if (prefix < 0 || prefix > 128) {
        throw new Error("Invalid IPv6 prefix length");
      }
      return [this.parseIPv6(addr), prefix];
    }
  }
  static decodeIP(value) {
    if (value.length === 64 && parseInt(value, 16) === 0) {
      return "::/0";
    }
    if (value.length !== 16) {
      return value;
    }
    const mask = parseInt(value.slice(8), 16).toString(2).split("").reduce((a, k) => a + +k, 0);
    let ip = value.slice(0, 8).replace(/(.{2})/g, (match) => `${parseInt(match, 16)}.`);
    ip = ip.slice(0, -1);
    return `${ip}/${mask}`;
  }
  static toString(buf) {
    const uint8 = new Uint8Array(buf);
    if (uint8.length === 4) {
      return Array.from(uint8).join(".");
    }
    if (uint8.length === 16) {
      return this.formatIPv6(uint8);
    }
    if (uint8.length === 8 || uint8.length === 32) {
      const half = uint8.length / 2;
      const addrBytes = uint8.slice(0, half);
      const maskBytes = uint8.slice(half);
      const isAllZeros = uint8.every((byte) => byte === 0);
      if (isAllZeros) {
        return uint8.length === 8 ? "0.0.0.0/0" : "::/0";
      }
      const prefixLen = maskBytes.reduce((a, b) => a + (b.toString(2).match(/1/g) || []).length, 0);
      if (uint8.length === 8) {
        const addrStr = Array.from(addrBytes).join(".");
        return `${addrStr}/${prefixLen}`;
      } else {
        const addrStr = this.formatIPv6(addrBytes);
        return `${addrStr}/${prefixLen}`;
      }
    }
    return this.decodeIP(encode(buf));
  }
  static fromString(text) {
    if (text.includes("/")) {
      const [addr, prefix] = this.parseCIDR(text);
      const maskBytes = new Uint8Array(addr.length);
      let bitsLeft = prefix;
      for (let i = 0; i < maskBytes.length; i++) {
        if (bitsLeft >= 8) {
          maskBytes[i] = 255;
          bitsLeft -= 8;
        } else if (bitsLeft > 0) {
          maskBytes[i] = 255 << 8 - bitsLeft;
          bitsLeft = 0;
        }
      }
      const out = new Uint8Array(addr.length * 2);
      out.set(addr, 0);
      out.set(maskBytes, addr.length);
      return out.buffer;
    }
    const bytes = this.isIPv4(text) ? this.parseIPv4(text) : this.parseIPv6(text);
    return new Uint8Array(bytes).buffer;
  }
}
var RelativeDistinguishedName_1, RDNSequence_1, Name_1;
let DirectoryString = class DirectoryString2 {
  constructor(params = {}) {
    __publicField(this, "teletexString");
    __publicField(this, "printableString");
    __publicField(this, "universalString");
    __publicField(this, "utf8String");
    __publicField(this, "bmpString");
    Object.assign(this, params);
  }
  toString() {
    return this.bmpString || this.printableString || this.teletexString || this.universalString || this.utf8String || "";
  }
};
__decorate([
  AsnProp({ type: AsnPropTypes.TeletexString })
], DirectoryString.prototype, "teletexString", void 0);
__decorate([
  AsnProp({ type: AsnPropTypes.PrintableString })
], DirectoryString.prototype, "printableString", void 0);
__decorate([
  AsnProp({ type: AsnPropTypes.UniversalString })
], DirectoryString.prototype, "universalString", void 0);
__decorate([
  AsnProp({ type: AsnPropTypes.Utf8String })
], DirectoryString.prototype, "utf8String", void 0);
__decorate([
  AsnProp({ type: AsnPropTypes.BmpString })
], DirectoryString.prototype, "bmpString", void 0);
DirectoryString = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], DirectoryString);
let AttributeValue = class AttributeValue2 extends DirectoryString {
  constructor(params = {}) {
    super(params);
    __publicField(this, "ia5String");
    __publicField(this, "anyValue");
    Object.assign(this, params);
  }
  toString() {
    return this.ia5String || (this.anyValue ? encode(this.anyValue) : super.toString());
  }
};
__decorate([
  AsnProp({ type: AsnPropTypes.IA5String })
], AttributeValue.prototype, "ia5String", void 0);
__decorate([
  AsnProp({ type: AsnPropTypes.Any })
], AttributeValue.prototype, "anyValue", void 0);
AttributeValue = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], AttributeValue);
class AttributeTypeAndValue {
  constructor(params = {}) {
    __publicField(this, "type", "");
    __publicField(this, "value", new AttributeValue());
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], AttributeTypeAndValue.prototype, "type", void 0);
__decorate([
  AsnProp({ type: AttributeValue })
], AttributeTypeAndValue.prototype, "value", void 0);
let RelativeDistinguishedName = RelativeDistinguishedName_1 = class RelativeDistinguishedName2 extends AsnArray {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, RelativeDistinguishedName_1.prototype);
  }
};
RelativeDistinguishedName = RelativeDistinguishedName_1 = __decorate([
  AsnType({
    type: AsnTypeTypes.Set,
    itemType: AttributeTypeAndValue
  })
], RelativeDistinguishedName);
let RDNSequence = RDNSequence_1 = class RDNSequence2 extends AsnArray {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, RDNSequence_1.prototype);
  }
};
RDNSequence = RDNSequence_1 = __decorate([
  AsnType({
    type: AsnTypeTypes.Sequence,
    itemType: RelativeDistinguishedName
  })
], RDNSequence);
let Name$1 = Name_1 = class Name extends RDNSequence {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, Name_1.prototype);
  }
};
Name$1 = Name_1 = __decorate([
  AsnType({ type: AsnTypeTypes.Sequence })
], Name$1);
const AsnIpConverter = {
  fromASN: (value) => IpConverter.toString(AsnOctetStringConverter.fromASN(value)),
  toASN: (value) => AsnOctetStringConverter.toASN(IpConverter.fromString(value))
};
class OtherName {
  constructor(params = {}) {
    __publicField(this, "typeId", "");
    __publicField(this, "value", new ArrayBuffer(0));
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], OtherName.prototype, "typeId", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Any,
    context: 0
  })
], OtherName.prototype, "value", void 0);
class EDIPartyName {
  constructor(params = {}) {
    __publicField(this, "nameAssigner");
    __publicField(this, "partyName", new DirectoryString());
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({
    type: DirectoryString,
    optional: true,
    context: 0,
    implicit: true
  })
], EDIPartyName.prototype, "nameAssigner", void 0);
__decorate([
  AsnProp({
    type: DirectoryString,
    context: 1,
    implicit: true
  })
], EDIPartyName.prototype, "partyName", void 0);
let GeneralName$1 = class GeneralName {
  constructor(params = {}) {
    __publicField(this, "otherName");
    __publicField(this, "rfc822Name");
    __publicField(this, "dNSName");
    __publicField(this, "x400Address");
    __publicField(this, "directoryName");
    __publicField(this, "ediPartyName");
    __publicField(this, "uniformResourceIdentifier");
    __publicField(this, "iPAddress");
    __publicField(this, "registeredID");
    Object.assign(this, params);
  }
};
__decorate([
  AsnProp({
    type: OtherName,
    context: 0,
    implicit: true
  })
], GeneralName$1.prototype, "otherName", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.IA5String,
    context: 1,
    implicit: true
  })
], GeneralName$1.prototype, "rfc822Name", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.IA5String,
    context: 2,
    implicit: true
  })
], GeneralName$1.prototype, "dNSName", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Any,
    context: 3,
    implicit: true
  })
], GeneralName$1.prototype, "x400Address", void 0);
__decorate([
  AsnProp({
    type: Name$1,
    context: 4,
    implicit: false
  })
], GeneralName$1.prototype, "directoryName", void 0);
__decorate([
  AsnProp({
    type: EDIPartyName,
    context: 5
  })
], GeneralName$1.prototype, "ediPartyName", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.IA5String,
    context: 6,
    implicit: true
  })
], GeneralName$1.prototype, "uniformResourceIdentifier", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.OctetString,
    context: 7,
    implicit: true,
    converter: AsnIpConverter
  })
], GeneralName$1.prototype, "iPAddress", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.ObjectIdentifier,
    context: 8,
    implicit: true
  })
], GeneralName$1.prototype, "registeredID", void 0);
GeneralName$1 = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], GeneralName$1);
const id_pkix = "1.3.6.1.5.5.7";
const id_pe = `${id_pkix}.1`;
const id_kp = `${id_pkix}.3`;
const id_ad = `${id_pkix}.48`;
const id_ad_ocsp = `${id_ad}.1`;
const id_ad_caIssuers = `${id_ad}.2`;
const id_ad_timeStamping = `${id_ad}.3`;
const id_ad_caRepository = `${id_ad}.5`;
const id_ce = "2.5.29";
var AuthorityInfoAccessSyntax_1;
const id_pe_authorityInfoAccess = `${id_pe}.1`;
class AccessDescription {
  constructor(params = {}) {
    __publicField(this, "accessMethod", "");
    __publicField(this, "accessLocation", new GeneralName$1());
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], AccessDescription.prototype, "accessMethod", void 0);
__decorate([
  AsnProp({ type: GeneralName$1 })
], AccessDescription.prototype, "accessLocation", void 0);
let AuthorityInfoAccessSyntax = AuthorityInfoAccessSyntax_1 = class AuthorityInfoAccessSyntax2 extends AsnArray {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, AuthorityInfoAccessSyntax_1.prototype);
  }
};
AuthorityInfoAccessSyntax = AuthorityInfoAccessSyntax_1 = __decorate([
  AsnType({
    type: AsnTypeTypes.Sequence,
    itemType: AccessDescription
  })
], AuthorityInfoAccessSyntax);
const id_ce_authorityKeyIdentifier = `${id_ce}.35`;
class KeyIdentifier extends OctetString2 {
}
class AuthorityKeyIdentifier {
  constructor(params = {}) {
    __publicField(this, "keyIdentifier");
    __publicField(this, "authorityCertIssuer");
    __publicField(this, "authorityCertSerialNumber");
    if (params) {
      Object.assign(this, params);
    }
  }
}
__decorate([
  AsnProp({
    type: KeyIdentifier,
    context: 0,
    optional: true,
    implicit: true
  })
], AuthorityKeyIdentifier.prototype, "keyIdentifier", void 0);
__decorate([
  AsnProp({
    type: GeneralName$1,
    context: 1,
    optional: true,
    implicit: true,
    repeated: "sequence"
  })
], AuthorityKeyIdentifier.prototype, "authorityCertIssuer", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    context: 2,
    optional: true,
    implicit: true,
    converter: AsnIntegerArrayBufferConverter
  })
], AuthorityKeyIdentifier.prototype, "authorityCertSerialNumber", void 0);
const id_ce_basicConstraints = `${id_ce}.19`;
class BasicConstraints {
  constructor(params = {}) {
    __publicField(this, "cA", false);
    __publicField(this, "pathLenConstraint");
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({
    type: AsnPropTypes.Boolean,
    defaultValue: false
  })
], BasicConstraints.prototype, "cA", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    optional: true
  })
], BasicConstraints.prototype, "pathLenConstraint", void 0);
var GeneralNames_1;
let GeneralNames$1 = GeneralNames_1 = class GeneralNames extends AsnArray {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, GeneralNames_1.prototype);
  }
};
GeneralNames$1 = GeneralNames_1 = __decorate([
  AsnType({
    type: AsnTypeTypes.Sequence,
    itemType: GeneralName$1
  })
], GeneralNames$1);
var CertificateIssuer_1;
let CertificateIssuer = CertificateIssuer_1 = class CertificateIssuer2 extends GeneralNames$1 {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, CertificateIssuer_1.prototype);
  }
};
CertificateIssuer = CertificateIssuer_1 = __decorate([
  AsnType({ type: AsnTypeTypes.Sequence })
], CertificateIssuer);
var CertificatePolicies_1;
const id_ce_certificatePolicies = `${id_ce}.32`;
let DisplayText = class DisplayText2 {
  constructor(params = {}) {
    __publicField(this, "ia5String");
    __publicField(this, "visibleString");
    __publicField(this, "bmpString");
    __publicField(this, "utf8String");
    Object.assign(this, params);
  }
  toString() {
    return this.ia5String || this.visibleString || this.bmpString || this.utf8String || "";
  }
};
__decorate([
  AsnProp({ type: AsnPropTypes.IA5String })
], DisplayText.prototype, "ia5String", void 0);
__decorate([
  AsnProp({ type: AsnPropTypes.VisibleString })
], DisplayText.prototype, "visibleString", void 0);
__decorate([
  AsnProp({ type: AsnPropTypes.BmpString })
], DisplayText.prototype, "bmpString", void 0);
__decorate([
  AsnProp({ type: AsnPropTypes.Utf8String })
], DisplayText.prototype, "utf8String", void 0);
DisplayText = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], DisplayText);
class NoticeReference {
  constructor(params = {}) {
    __publicField(this, "organization", new DisplayText());
    __publicField(this, "noticeNumbers", []);
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: DisplayText })
], NoticeReference.prototype, "organization", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    repeated: "sequence"
  })
], NoticeReference.prototype, "noticeNumbers", void 0);
class UserNotice {
  constructor(params = {}) {
    __publicField(this, "noticeRef");
    __publicField(this, "explicitText");
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({
    type: NoticeReference,
    optional: true
  })
], UserNotice.prototype, "noticeRef", void 0);
__decorate([
  AsnProp({
    type: DisplayText,
    optional: true
  })
], UserNotice.prototype, "explicitText", void 0);
let Qualifier = class Qualifier2 {
  constructor(params = {}) {
    __publicField(this, "cPSuri");
    __publicField(this, "userNotice");
    Object.assign(this, params);
  }
};
__decorate([
  AsnProp({ type: AsnPropTypes.IA5String })
], Qualifier.prototype, "cPSuri", void 0);
__decorate([
  AsnProp({ type: UserNotice })
], Qualifier.prototype, "userNotice", void 0);
Qualifier = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], Qualifier);
class PolicyQualifierInfo {
  constructor(params = {}) {
    __publicField(this, "policyQualifierId", "");
    __publicField(this, "qualifier", new ArrayBuffer(0));
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], PolicyQualifierInfo.prototype, "policyQualifierId", void 0);
__decorate([
  AsnProp({ type: AsnPropTypes.Any })
], PolicyQualifierInfo.prototype, "qualifier", void 0);
class PolicyInformation {
  constructor(params = {}) {
    __publicField(this, "policyIdentifier", "");
    __publicField(this, "policyQualifiers");
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], PolicyInformation.prototype, "policyIdentifier", void 0);
__decorate([
  AsnProp({
    type: PolicyQualifierInfo,
    repeated: "sequence",
    optional: true
  })
], PolicyInformation.prototype, "policyQualifiers", void 0);
let CertificatePolicies = CertificatePolicies_1 = class CertificatePolicies2 extends AsnArray {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, CertificatePolicies_1.prototype);
  }
};
CertificatePolicies = CertificatePolicies_1 = __decorate([
  AsnType({
    type: AsnTypeTypes.Sequence,
    itemType: PolicyInformation
  })
], CertificatePolicies);
let CRLNumber = class CRLNumber2 {
  constructor(value = 0) {
    __publicField(this, "value");
    this.value = value;
  }
};
__decorate([
  AsnProp({ type: AsnPropTypes.Integer })
], CRLNumber.prototype, "value", void 0);
CRLNumber = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], CRLNumber);
let BaseCRLNumber = class BaseCRLNumber2 extends CRLNumber {
};
BaseCRLNumber = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], BaseCRLNumber);
var CRLDistributionPoints_1;
const id_ce_cRLDistributionPoints = `${id_ce}.31`;
var ReasonFlags;
(function(ReasonFlags2) {
  ReasonFlags2[ReasonFlags2["unused"] = 1] = "unused";
  ReasonFlags2[ReasonFlags2["keyCompromise"] = 2] = "keyCompromise";
  ReasonFlags2[ReasonFlags2["cACompromise"] = 4] = "cACompromise";
  ReasonFlags2[ReasonFlags2["affiliationChanged"] = 8] = "affiliationChanged";
  ReasonFlags2[ReasonFlags2["superseded"] = 16] = "superseded";
  ReasonFlags2[ReasonFlags2["cessationOfOperation"] = 32] = "cessationOfOperation";
  ReasonFlags2[ReasonFlags2["certificateHold"] = 64] = "certificateHold";
  ReasonFlags2[ReasonFlags2["privilegeWithdrawn"] = 128] = "privilegeWithdrawn";
  ReasonFlags2[ReasonFlags2["aACompromise"] = 256] = "aACompromise";
})(ReasonFlags || (ReasonFlags = {}));
class Reason extends BitString2 {
  toJSON() {
    const res = [];
    const flags = this.toNumber();
    if (flags & ReasonFlags.aACompromise) {
      res.push("aACompromise");
    }
    if (flags & ReasonFlags.affiliationChanged) {
      res.push("affiliationChanged");
    }
    if (flags & ReasonFlags.cACompromise) {
      res.push("cACompromise");
    }
    if (flags & ReasonFlags.certificateHold) {
      res.push("certificateHold");
    }
    if (flags & ReasonFlags.cessationOfOperation) {
      res.push("cessationOfOperation");
    }
    if (flags & ReasonFlags.keyCompromise) {
      res.push("keyCompromise");
    }
    if (flags & ReasonFlags.privilegeWithdrawn) {
      res.push("privilegeWithdrawn");
    }
    if (flags & ReasonFlags.superseded) {
      res.push("superseded");
    }
    if (flags & ReasonFlags.unused) {
      res.push("unused");
    }
    return res;
  }
  toString() {
    return `[${this.toJSON().join(", ")}]`;
  }
}
let DistributionPointName = class DistributionPointName2 {
  constructor(params = {}) {
    __publicField(this, "fullName");
    __publicField(this, "nameRelativeToCRLIssuer");
    Object.assign(this, params);
  }
};
__decorate([
  AsnProp({
    type: GeneralName$1,
    context: 0,
    repeated: "sequence",
    implicit: true
  })
], DistributionPointName.prototype, "fullName", void 0);
__decorate([
  AsnProp({
    type: RelativeDistinguishedName,
    context: 1,
    implicit: true
  })
], DistributionPointName.prototype, "nameRelativeToCRLIssuer", void 0);
DistributionPointName = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], DistributionPointName);
class DistributionPoint {
  constructor(params = {}) {
    __publicField(this, "distributionPoint");
    __publicField(this, "reasons");
    __publicField(this, "cRLIssuer");
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({
    type: DistributionPointName,
    context: 0,
    optional: true
  })
], DistributionPoint.prototype, "distributionPoint", void 0);
__decorate([
  AsnProp({
    type: Reason,
    context: 1,
    optional: true,
    implicit: true
  })
], DistributionPoint.prototype, "reasons", void 0);
__decorate([
  AsnProp({
    type: GeneralName$1,
    context: 2,
    optional: true,
    repeated: "sequence",
    implicit: true
  })
], DistributionPoint.prototype, "cRLIssuer", void 0);
let CRLDistributionPoints = CRLDistributionPoints_1 = class CRLDistributionPoints2 extends AsnArray {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, CRLDistributionPoints_1.prototype);
  }
};
CRLDistributionPoints = CRLDistributionPoints_1 = __decorate([
  AsnType({
    type: AsnTypeTypes.Sequence,
    itemType: DistributionPoint
  })
], CRLDistributionPoints);
var FreshestCRL_1;
let FreshestCRL = FreshestCRL_1 = class FreshestCRL2 extends CRLDistributionPoints {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, FreshestCRL_1.prototype);
  }
};
FreshestCRL = FreshestCRL_1 = __decorate([
  AsnType({
    type: AsnTypeTypes.Sequence,
    itemType: DistributionPoint
  })
], FreshestCRL);
const _IssuingDistributionPoint = class _IssuingDistributionPoint {
  constructor(params = {}) {
    __publicField(this, "distributionPoint");
    __publicField(this, "onlyContainsUserCerts", _IssuingDistributionPoint.ONLY);
    __publicField(this, "onlyContainsCACerts", _IssuingDistributionPoint.ONLY);
    __publicField(this, "onlySomeReasons");
    __publicField(this, "indirectCRL", _IssuingDistributionPoint.ONLY);
    __publicField(this, "onlyContainsAttributeCerts", _IssuingDistributionPoint.ONLY);
    Object.assign(this, params);
  }
};
__publicField(_IssuingDistributionPoint, "ONLY", false);
let IssuingDistributionPoint = _IssuingDistributionPoint;
__decorate([
  AsnProp({
    type: DistributionPointName,
    context: 0,
    optional: true
  })
], IssuingDistributionPoint.prototype, "distributionPoint", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Boolean,
    context: 1,
    defaultValue: IssuingDistributionPoint.ONLY,
    implicit: true
  })
], IssuingDistributionPoint.prototype, "onlyContainsUserCerts", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Boolean,
    context: 2,
    defaultValue: IssuingDistributionPoint.ONLY,
    implicit: true
  })
], IssuingDistributionPoint.prototype, "onlyContainsCACerts", void 0);
__decorate([
  AsnProp({
    type: Reason,
    context: 3,
    optional: true,
    implicit: true
  })
], IssuingDistributionPoint.prototype, "onlySomeReasons", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Boolean,
    context: 4,
    defaultValue: IssuingDistributionPoint.ONLY,
    implicit: true
  })
], IssuingDistributionPoint.prototype, "indirectCRL", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Boolean,
    context: 5,
    defaultValue: IssuingDistributionPoint.ONLY,
    implicit: true
  })
], IssuingDistributionPoint.prototype, "onlyContainsAttributeCerts", void 0);
var CRLReasons;
(function(CRLReasons2) {
  CRLReasons2[CRLReasons2["unspecified"] = 0] = "unspecified";
  CRLReasons2[CRLReasons2["keyCompromise"] = 1] = "keyCompromise";
  CRLReasons2[CRLReasons2["cACompromise"] = 2] = "cACompromise";
  CRLReasons2[CRLReasons2["affiliationChanged"] = 3] = "affiliationChanged";
  CRLReasons2[CRLReasons2["superseded"] = 4] = "superseded";
  CRLReasons2[CRLReasons2["cessationOfOperation"] = 5] = "cessationOfOperation";
  CRLReasons2[CRLReasons2["certificateHold"] = 6] = "certificateHold";
  CRLReasons2[CRLReasons2["removeFromCRL"] = 8] = "removeFromCRL";
  CRLReasons2[CRLReasons2["privilegeWithdrawn"] = 9] = "privilegeWithdrawn";
  CRLReasons2[CRLReasons2["aACompromise"] = 10] = "aACompromise";
})(CRLReasons || (CRLReasons = {}));
let CRLReason = class CRLReason2 {
  constructor(reason = CRLReasons.unspecified) {
    __publicField(this, "reason", CRLReasons.unspecified);
    this.reason = reason;
  }
  toJSON() {
    return CRLReasons[this.reason];
  }
  toString() {
    return this.toJSON();
  }
};
__decorate([
  AsnProp({ type: AsnPropTypes.Enumerated })
], CRLReason.prototype, "reason", void 0);
CRLReason = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], CRLReason);
var ExtendedKeyUsage_1;
const id_ce_extKeyUsage = `${id_ce}.37`;
let ExtendedKeyUsage$1 = ExtendedKeyUsage_1 = class ExtendedKeyUsage extends AsnArray {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, ExtendedKeyUsage_1.prototype);
  }
};
ExtendedKeyUsage$1 = ExtendedKeyUsage_1 = __decorate([
  AsnType({
    type: AsnTypeTypes.Sequence,
    itemType: AsnPropTypes.ObjectIdentifier
  })
], ExtendedKeyUsage$1);
const id_kp_serverAuth = `${id_kp}.1`;
const id_kp_clientAuth = `${id_kp}.2`;
const id_kp_codeSigning = `${id_kp}.3`;
const id_kp_emailProtection = `${id_kp}.4`;
const id_kp_timeStamping = `${id_kp}.8`;
const id_kp_OCSPSigning = `${id_kp}.9`;
let InhibitAnyPolicy = class InhibitAnyPolicy2 {
  constructor(value = new ArrayBuffer(0)) {
    __publicField(this, "value");
    this.value = value;
  }
};
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    converter: AsnIntegerArrayBufferConverter
  })
], InhibitAnyPolicy.prototype, "value", void 0);
InhibitAnyPolicy = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], InhibitAnyPolicy);
let InvalidityDate = class InvalidityDate2 {
  constructor(value) {
    __publicField(this, "value", /* @__PURE__ */ new Date());
    if (value) {
      this.value = value;
    }
  }
};
__decorate([
  AsnProp({ type: AsnPropTypes.GeneralizedTime })
], InvalidityDate.prototype, "value", void 0);
InvalidityDate = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], InvalidityDate);
var IssueAlternativeName_1;
const id_ce_issuerAltName = `${id_ce}.18`;
let IssueAlternativeName = IssueAlternativeName_1 = class IssueAlternativeName2 extends GeneralNames$1 {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, IssueAlternativeName_1.prototype);
  }
};
IssueAlternativeName = IssueAlternativeName_1 = __decorate([
  AsnType({ type: AsnTypeTypes.Sequence })
], IssueAlternativeName);
const id_ce_keyUsage = `${id_ce}.15`;
var KeyUsageFlags$1;
(function(KeyUsageFlags2) {
  KeyUsageFlags2[KeyUsageFlags2["digitalSignature"] = 1] = "digitalSignature";
  KeyUsageFlags2[KeyUsageFlags2["nonRepudiation"] = 2] = "nonRepudiation";
  KeyUsageFlags2[KeyUsageFlags2["keyEncipherment"] = 4] = "keyEncipherment";
  KeyUsageFlags2[KeyUsageFlags2["dataEncipherment"] = 8] = "dataEncipherment";
  KeyUsageFlags2[KeyUsageFlags2["keyAgreement"] = 16] = "keyAgreement";
  KeyUsageFlags2[KeyUsageFlags2["keyCertSign"] = 32] = "keyCertSign";
  KeyUsageFlags2[KeyUsageFlags2["cRLSign"] = 64] = "cRLSign";
  KeyUsageFlags2[KeyUsageFlags2["encipherOnly"] = 128] = "encipherOnly";
  KeyUsageFlags2[KeyUsageFlags2["decipherOnly"] = 256] = "decipherOnly";
})(KeyUsageFlags$1 || (KeyUsageFlags$1 = {}));
class KeyUsage extends BitString2 {
  toJSON() {
    const flag = this.toNumber();
    const res = [];
    if (flag & KeyUsageFlags$1.cRLSign) {
      res.push("crlSign");
    }
    if (flag & KeyUsageFlags$1.dataEncipherment) {
      res.push("dataEncipherment");
    }
    if (flag & KeyUsageFlags$1.decipherOnly) {
      res.push("decipherOnly");
    }
    if (flag & KeyUsageFlags$1.digitalSignature) {
      res.push("digitalSignature");
    }
    if (flag & KeyUsageFlags$1.encipherOnly) {
      res.push("encipherOnly");
    }
    if (flag & KeyUsageFlags$1.keyAgreement) {
      res.push("keyAgreement");
    }
    if (flag & KeyUsageFlags$1.keyCertSign) {
      res.push("keyCertSign");
    }
    if (flag & KeyUsageFlags$1.keyEncipherment) {
      res.push("keyEncipherment");
    }
    if (flag & KeyUsageFlags$1.nonRepudiation) {
      res.push("nonRepudiation");
    }
    return res;
  }
  toString() {
    return `[${this.toJSON().join(", ")}]`;
  }
}
var GeneralSubtrees_1;
class GeneralSubtree {
  constructor(params = {}) {
    __publicField(this, "base", new GeneralName$1());
    __publicField(this, "minimum", 0);
    __publicField(this, "maximum");
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: GeneralName$1 })
], GeneralSubtree.prototype, "base", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    context: 0,
    defaultValue: 0,
    implicit: true
  })
], GeneralSubtree.prototype, "minimum", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    context: 1,
    optional: true,
    implicit: true
  })
], GeneralSubtree.prototype, "maximum", void 0);
let GeneralSubtrees = GeneralSubtrees_1 = class GeneralSubtrees2 extends AsnArray {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, GeneralSubtrees_1.prototype);
  }
};
GeneralSubtrees = GeneralSubtrees_1 = __decorate([
  AsnType({
    type: AsnTypeTypes.Sequence,
    itemType: GeneralSubtree
  })
], GeneralSubtrees);
class NameConstraints {
  constructor(params = {}) {
    __publicField(this, "permittedSubtrees");
    __publicField(this, "excludedSubtrees");
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({
    type: GeneralSubtrees,
    context: 0,
    optional: true,
    implicit: true
  })
], NameConstraints.prototype, "permittedSubtrees", void 0);
__decorate([
  AsnProp({
    type: GeneralSubtrees,
    context: 1,
    optional: true,
    implicit: true
  })
], NameConstraints.prototype, "excludedSubtrees", void 0);
class PolicyConstraints {
  constructor(params = {}) {
    __publicField(this, "requireExplicitPolicy");
    __publicField(this, "inhibitPolicyMapping");
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    context: 0,
    implicit: true,
    optional: true,
    converter: AsnIntegerArrayBufferConverter
  })
], PolicyConstraints.prototype, "requireExplicitPolicy", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    context: 1,
    implicit: true,
    optional: true,
    converter: AsnIntegerArrayBufferConverter
  })
], PolicyConstraints.prototype, "inhibitPolicyMapping", void 0);
var PolicyMappings_1;
class PolicyMapping {
  constructor(params = {}) {
    __publicField(this, "issuerDomainPolicy", "");
    __publicField(this, "subjectDomainPolicy", "");
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], PolicyMapping.prototype, "issuerDomainPolicy", void 0);
__decorate([
  AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], PolicyMapping.prototype, "subjectDomainPolicy", void 0);
let PolicyMappings = PolicyMappings_1 = class PolicyMappings2 extends AsnArray {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, PolicyMappings_1.prototype);
  }
};
PolicyMappings = PolicyMappings_1 = __decorate([
  AsnType({
    type: AsnTypeTypes.Sequence,
    itemType: PolicyMapping
  })
], PolicyMappings);
var SubjectAlternativeName_1;
const id_ce_subjectAltName = `${id_ce}.17`;
let SubjectAlternativeName = SubjectAlternativeName_1 = class SubjectAlternativeName2 extends GeneralNames$1 {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, SubjectAlternativeName_1.prototype);
  }
};
SubjectAlternativeName = SubjectAlternativeName_1 = __decorate([
  AsnType({ type: AsnTypeTypes.Sequence })
], SubjectAlternativeName);
let Attribute$2 = class Attribute {
  constructor(params = {}) {
    __publicField(this, "type", "");
    __publicField(this, "values", []);
    Object.assign(this, params);
  }
};
__decorate([
  AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], Attribute$2.prototype, "type", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Any,
    repeated: "set"
  })
], Attribute$2.prototype, "values", void 0);
var SubjectDirectoryAttributes_1;
let SubjectDirectoryAttributes = SubjectDirectoryAttributes_1 = class SubjectDirectoryAttributes2 extends AsnArray {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, SubjectDirectoryAttributes_1.prototype);
  }
};
SubjectDirectoryAttributes = SubjectDirectoryAttributes_1 = __decorate([
  AsnType({
    type: AsnTypeTypes.Sequence,
    itemType: Attribute$2
  })
], SubjectDirectoryAttributes);
const id_ce_subjectKeyIdentifier = `${id_ce}.14`;
class SubjectKeyIdentifier extends KeyIdentifier {
}
class PrivateKeyUsagePeriod {
  constructor(params = {}) {
    __publicField(this, "notBefore");
    __publicField(this, "notAfter");
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({
    type: AsnPropTypes.GeneralizedTime,
    context: 0,
    implicit: true,
    optional: true
  })
], PrivateKeyUsagePeriod.prototype, "notBefore", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.GeneralizedTime,
    context: 1,
    implicit: true,
    optional: true
  })
], PrivateKeyUsagePeriod.prototype, "notAfter", void 0);
var EntrustInfoFlags;
(function(EntrustInfoFlags2) {
  EntrustInfoFlags2[EntrustInfoFlags2["keyUpdateAllowed"] = 1] = "keyUpdateAllowed";
  EntrustInfoFlags2[EntrustInfoFlags2["newExtensions"] = 2] = "newExtensions";
  EntrustInfoFlags2[EntrustInfoFlags2["pKIXCertificate"] = 4] = "pKIXCertificate";
})(EntrustInfoFlags || (EntrustInfoFlags = {}));
class EntrustInfo extends BitString2 {
  toJSON() {
    const res = [];
    const flags = this.toNumber();
    if (flags & EntrustInfoFlags.pKIXCertificate) {
      res.push("pKIXCertificate");
    }
    if (flags & EntrustInfoFlags.newExtensions) {
      res.push("newExtensions");
    }
    if (flags & EntrustInfoFlags.keyUpdateAllowed) {
      res.push("keyUpdateAllowed");
    }
    return res;
  }
  toString() {
    return `[${this.toJSON().join(", ")}]`;
  }
}
class EntrustVersionInfo {
  constructor(params = {}) {
    __publicField(this, "entrustVers", "");
    __publicField(this, "entrustInfoFlags", new EntrustInfo());
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.GeneralString })
], EntrustVersionInfo.prototype, "entrustVers", void 0);
__decorate([
  AsnProp({ type: EntrustInfo })
], EntrustVersionInfo.prototype, "entrustInfoFlags", void 0);
var SubjectInfoAccessSyntax_1;
let SubjectInfoAccessSyntax = SubjectInfoAccessSyntax_1 = class SubjectInfoAccessSyntax2 extends AsnArray {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, SubjectInfoAccessSyntax_1.prototype);
  }
};
SubjectInfoAccessSyntax = SubjectInfoAccessSyntax_1 = __decorate([
  AsnType({
    type: AsnTypeTypes.Sequence,
    itemType: AccessDescription
  })
], SubjectInfoAccessSyntax);
class AlgorithmIdentifier {
  constructor(params = {}) {
    __publicField(this, "algorithm", "");
    __publicField(this, "parameters");
    Object.assign(this, params);
  }
  isEqual(data) {
    return data instanceof AlgorithmIdentifier && data.algorithm == this.algorithm && (data.parameters && this.parameters && equal(data.parameters, this.parameters) || data.parameters === this.parameters);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], AlgorithmIdentifier.prototype, "algorithm", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Any,
    optional: true
  })
], AlgorithmIdentifier.prototype, "parameters", void 0);
class SubjectPublicKeyInfo {
  constructor(params = {}) {
    __publicField(this, "algorithm", new AlgorithmIdentifier());
    __publicField(this, "subjectPublicKey", new ArrayBuffer(0));
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AlgorithmIdentifier })
], SubjectPublicKeyInfo.prototype, "algorithm", void 0);
__decorate([
  AsnProp({ type: AsnPropTypes.BitString })
], SubjectPublicKeyInfo.prototype, "subjectPublicKey", void 0);
let Time = class Time2 {
  constructor(time) {
    __publicField(this, "utcTime");
    __publicField(this, "generalTime");
    if (time) {
      if (typeof time === "string" || typeof time === "number" || time instanceof Date) {
        const date = new Date(time);
        date.setMilliseconds(0);
        if (date.getUTCFullYear() > 2049) {
          this.generalTime = date;
        } else {
          this.utcTime = date;
        }
      } else {
        Object.assign(this, time);
      }
    }
  }
  getTime() {
    const time = this.utcTime || this.generalTime;
    if (!time) {
      throw new Error("Cannot get time from CHOICE object");
    }
    return time;
  }
};
__decorate([
  AsnProp({ type: AsnPropTypes.UTCTime })
], Time.prototype, "utcTime", void 0);
__decorate([
  AsnProp({ type: AsnPropTypes.GeneralizedTime })
], Time.prototype, "generalTime", void 0);
Time = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], Time);
class Validity {
  constructor(params) {
    __publicField(this, "notBefore", new Time(/* @__PURE__ */ new Date()));
    __publicField(this, "notAfter", new Time(/* @__PURE__ */ new Date()));
    if (params) {
      this.notBefore = new Time(params.notBefore);
      this.notAfter = new Time(params.notAfter);
    }
  }
}
__decorate([
  AsnProp({ type: Time })
], Validity.prototype, "notBefore", void 0);
__decorate([
  AsnProp({ type: Time })
], Validity.prototype, "notAfter", void 0);
var Extensions_1;
let Extension$1 = (_a = class {
  constructor(params = {}) {
    __publicField(this, "extnID", "");
    __publicField(this, "critical", _a.CRITICAL);
    __publicField(this, "extnValue", new OctetString2());
    Object.assign(this, params);
  }
}, __publicField(_a, "CRITICAL", false), _a);
__decorate([
  AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], Extension$1.prototype, "extnID", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Boolean,
    defaultValue: Extension$1.CRITICAL
  })
], Extension$1.prototype, "critical", void 0);
__decorate([
  AsnProp({ type: OctetString2 })
], Extension$1.prototype, "extnValue", void 0);
let Extensions = Extensions_1 = class Extensions2 extends AsnArray {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, Extensions_1.prototype);
  }
};
Extensions = Extensions_1 = __decorate([
  AsnType({
    type: AsnTypeTypes.Sequence,
    itemType: Extension$1
  })
], Extensions);
var Version$1;
(function(Version2) {
  Version2[Version2["v1"] = 0] = "v1";
  Version2[Version2["v2"] = 1] = "v2";
  Version2[Version2["v3"] = 2] = "v3";
})(Version$1 || (Version$1 = {}));
class TBSCertificate {
  constructor(params = {}) {
    __publicField(this, "version", Version$1.v1);
    __publicField(this, "serialNumber", new ArrayBuffer(0));
    __publicField(this, "signature", new AlgorithmIdentifier());
    __publicField(this, "issuer", new Name$1());
    __publicField(this, "validity", new Validity());
    __publicField(this, "subject", new Name$1());
    __publicField(this, "subjectPublicKeyInfo", new SubjectPublicKeyInfo());
    __publicField(this, "issuerUniqueID");
    __publicField(this, "subjectUniqueID");
    __publicField(this, "extensions");
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    context: 0,
    defaultValue: Version$1.v1
  })
], TBSCertificate.prototype, "version", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    converter: AsnIntegerArrayBufferConverter
  })
], TBSCertificate.prototype, "serialNumber", void 0);
__decorate([
  AsnProp({ type: AlgorithmIdentifier })
], TBSCertificate.prototype, "signature", void 0);
__decorate([
  AsnProp({ type: Name$1 })
], TBSCertificate.prototype, "issuer", void 0);
__decorate([
  AsnProp({ type: Validity })
], TBSCertificate.prototype, "validity", void 0);
__decorate([
  AsnProp({ type: Name$1 })
], TBSCertificate.prototype, "subject", void 0);
__decorate([
  AsnProp({ type: SubjectPublicKeyInfo })
], TBSCertificate.prototype, "subjectPublicKeyInfo", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.BitString,
    context: 1,
    implicit: true,
    optional: true
  })
], TBSCertificate.prototype, "issuerUniqueID", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.BitString,
    context: 2,
    implicit: true,
    optional: true
  })
], TBSCertificate.prototype, "subjectUniqueID", void 0);
__decorate([
  AsnProp({
    type: Extensions,
    context: 3,
    optional: true
  })
], TBSCertificate.prototype, "extensions", void 0);
class Certificate {
  constructor(params = {}) {
    __publicField(this, "tbsCertificate", new TBSCertificate());
    __publicField(this, "tbsCertificateRaw");
    __publicField(this, "signatureAlgorithm", new AlgorithmIdentifier());
    __publicField(this, "signatureValue", new ArrayBuffer(0));
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({
    type: TBSCertificate,
    raw: true
  })
], Certificate.prototype, "tbsCertificate", void 0);
__decorate([
  AsnProp({ type: AlgorithmIdentifier })
], Certificate.prototype, "signatureAlgorithm", void 0);
__decorate([
  AsnProp({ type: AsnPropTypes.BitString })
], Certificate.prototype, "signatureValue", void 0);
class RevokedCertificate {
  constructor(params = {}) {
    __publicField(this, "userCertificate", new ArrayBuffer(0));
    __publicField(this, "revocationDate", new Time());
    __publicField(this, "crlEntryExtensions");
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    converter: AsnIntegerArrayBufferConverter
  })
], RevokedCertificate.prototype, "userCertificate", void 0);
__decorate([
  AsnProp({ type: Time })
], RevokedCertificate.prototype, "revocationDate", void 0);
__decorate([
  AsnProp({
    type: Extension$1,
    optional: true,
    repeated: "sequence"
  })
], RevokedCertificate.prototype, "crlEntryExtensions", void 0);
class TBSCertList {
  constructor(params = {}) {
    __publicField(this, "version");
    __publicField(this, "signature", new AlgorithmIdentifier());
    __publicField(this, "issuer", new Name$1());
    __publicField(this, "thisUpdate", new Time());
    __publicField(this, "nextUpdate");
    __publicField(this, "revokedCertificates");
    __publicField(this, "crlExtensions");
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    optional: true
  })
], TBSCertList.prototype, "version", void 0);
__decorate([
  AsnProp({ type: AlgorithmIdentifier })
], TBSCertList.prototype, "signature", void 0);
__decorate([
  AsnProp({ type: Name$1 })
], TBSCertList.prototype, "issuer", void 0);
__decorate([
  AsnProp({ type: Time })
], TBSCertList.prototype, "thisUpdate", void 0);
__decorate([
  AsnProp({
    type: Time,
    optional: true
  })
], TBSCertList.prototype, "nextUpdate", void 0);
__decorate([
  AsnProp({
    type: RevokedCertificate,
    repeated: "sequence",
    optional: true
  })
], TBSCertList.prototype, "revokedCertificates", void 0);
__decorate([
  AsnProp({
    type: Extension$1,
    optional: true,
    context: 0,
    repeated: "sequence"
  })
], TBSCertList.prototype, "crlExtensions", void 0);
class CertificateList {
  constructor(params = {}) {
    __publicField(this, "tbsCertList", new TBSCertList());
    __publicField(this, "tbsCertListRaw");
    __publicField(this, "signatureAlgorithm", new AlgorithmIdentifier());
    __publicField(this, "signature", new ArrayBuffer(0));
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({
    type: TBSCertList,
    raw: true
  })
], CertificateList.prototype, "tbsCertList", void 0);
__decorate([
  AsnProp({ type: AlgorithmIdentifier })
], CertificateList.prototype, "signatureAlgorithm", void 0);
__decorate([
  AsnProp({ type: AsnPropTypes.BitString })
], CertificateList.prototype, "signature", void 0);
class IssuerAndSerialNumber {
  constructor(params = {}) {
    __publicField(this, "issuer", new Name$1());
    __publicField(this, "serialNumber", new ArrayBuffer(0));
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: Name$1 })
], IssuerAndSerialNumber.prototype, "issuer", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    converter: AsnIntegerArrayBufferConverter
  })
], IssuerAndSerialNumber.prototype, "serialNumber", void 0);
let SignerIdentifier = class SignerIdentifier2 {
  constructor(params = {}) {
    __publicField(this, "subjectKeyIdentifier");
    __publicField(this, "issuerAndSerialNumber");
    Object.assign(this, params);
  }
};
__decorate([
  AsnProp({
    type: SubjectKeyIdentifier,
    context: 0,
    implicit: true
  })
], SignerIdentifier.prototype, "subjectKeyIdentifier", void 0);
__decorate([
  AsnProp({ type: IssuerAndSerialNumber })
], SignerIdentifier.prototype, "issuerAndSerialNumber", void 0);
SignerIdentifier = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], SignerIdentifier);
var CMSVersion;
(function(CMSVersion2) {
  CMSVersion2[CMSVersion2["v0"] = 0] = "v0";
  CMSVersion2[CMSVersion2["v1"] = 1] = "v1";
  CMSVersion2[CMSVersion2["v2"] = 2] = "v2";
  CMSVersion2[CMSVersion2["v3"] = 3] = "v3";
  CMSVersion2[CMSVersion2["v4"] = 4] = "v4";
  CMSVersion2[CMSVersion2["v5"] = 5] = "v5";
})(CMSVersion || (CMSVersion = {}));
let DigestAlgorithmIdentifier = class DigestAlgorithmIdentifier2 extends AlgorithmIdentifier {
};
DigestAlgorithmIdentifier = __decorate([
  AsnType({ type: AsnTypeTypes.Sequence })
], DigestAlgorithmIdentifier);
let SignatureAlgorithmIdentifier = class SignatureAlgorithmIdentifier2 extends AlgorithmIdentifier {
};
SignatureAlgorithmIdentifier = __decorate([
  AsnType({ type: AsnTypeTypes.Sequence })
], SignatureAlgorithmIdentifier);
let KeyEncryptionAlgorithmIdentifier = class KeyEncryptionAlgorithmIdentifier2 extends AlgorithmIdentifier {
};
KeyEncryptionAlgorithmIdentifier = __decorate([
  AsnType({ type: AsnTypeTypes.Sequence })
], KeyEncryptionAlgorithmIdentifier);
let ContentEncryptionAlgorithmIdentifier = class ContentEncryptionAlgorithmIdentifier2 extends AlgorithmIdentifier {
};
ContentEncryptionAlgorithmIdentifier = __decorate([
  AsnType({ type: AsnTypeTypes.Sequence })
], ContentEncryptionAlgorithmIdentifier);
let MessageAuthenticationCodeAlgorithm = class MessageAuthenticationCodeAlgorithm2 extends AlgorithmIdentifier {
};
MessageAuthenticationCodeAlgorithm = __decorate([
  AsnType({ type: AsnTypeTypes.Sequence })
], MessageAuthenticationCodeAlgorithm);
let KeyDerivationAlgorithmIdentifier = class KeyDerivationAlgorithmIdentifier2 extends AlgorithmIdentifier {
};
KeyDerivationAlgorithmIdentifier = __decorate([
  AsnType({ type: AsnTypeTypes.Sequence })
], KeyDerivationAlgorithmIdentifier);
let Attribute$1 = class Attribute2 {
  constructor(params = {}) {
    __publicField(this, "attrType", "");
    __publicField(this, "attrValues", []);
    Object.assign(this, params);
  }
};
__decorate([
  AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], Attribute$1.prototype, "attrType", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Any,
    repeated: "set"
  })
], Attribute$1.prototype, "attrValues", void 0);
var SignerInfos_1;
class SignerInfo {
  constructor(params = {}) {
    __publicField(this, "version", CMSVersion.v0);
    __publicField(this, "sid", new SignerIdentifier());
    __publicField(this, "digestAlgorithm", new DigestAlgorithmIdentifier());
    __publicField(this, "signedAttrs");
    __publicField(this, "signedAttrsRaw");
    __publicField(this, "signatureAlgorithm", new SignatureAlgorithmIdentifier());
    __publicField(this, "signature", new OctetString2());
    __publicField(this, "unsignedAttrs");
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.Integer })
], SignerInfo.prototype, "version", void 0);
__decorate([
  AsnProp({ type: SignerIdentifier })
], SignerInfo.prototype, "sid", void 0);
__decorate([
  AsnProp({ type: DigestAlgorithmIdentifier })
], SignerInfo.prototype, "digestAlgorithm", void 0);
__decorate([
  AsnProp({
    type: Attribute$1,
    repeated: "set",
    context: 0,
    implicit: true,
    optional: true,
    raw: true
  })
], SignerInfo.prototype, "signedAttrs", void 0);
__decorate([
  AsnProp({ type: SignatureAlgorithmIdentifier })
], SignerInfo.prototype, "signatureAlgorithm", void 0);
__decorate([
  AsnProp({ type: OctetString2 })
], SignerInfo.prototype, "signature", void 0);
__decorate([
  AsnProp({
    type: Attribute$1,
    repeated: "set",
    context: 1,
    implicit: true,
    optional: true
  })
], SignerInfo.prototype, "unsignedAttrs", void 0);
let SignerInfos = SignerInfos_1 = class SignerInfos2 extends AsnArray {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, SignerInfos_1.prototype);
  }
};
SignerInfos = SignerInfos_1 = __decorate([
  AsnType({
    type: AsnTypeTypes.Set,
    itemType: SignerInfo
  })
], SignerInfos);
let CounterSignature$1 = class CounterSignature extends SignerInfo {
};
CounterSignature$1 = __decorate([
  AsnType({ type: AsnTypeTypes.Sequence })
], CounterSignature$1);
let SigningTime$1 = class SigningTime extends Time {
};
SigningTime$1 = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], SigningTime$1);
class ACClearAttrs {
  constructor(params = {}) {
    __publicField(this, "acIssuer", new GeneralName$1());
    __publicField(this, "acSerial", 0);
    __publicField(this, "attrs", []);
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: GeneralName$1 })
], ACClearAttrs.prototype, "acIssuer", void 0);
__decorate([
  AsnProp({ type: AsnPropTypes.Integer })
], ACClearAttrs.prototype, "acSerial", void 0);
__decorate([
  AsnProp({
    type: Attribute$2,
    repeated: "sequence"
  })
], ACClearAttrs.prototype, "attrs", void 0);
var AttrSpec_1;
let AttrSpec = AttrSpec_1 = class AttrSpec2 extends AsnArray {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, AttrSpec_1.prototype);
  }
};
AttrSpec = AttrSpec_1 = __decorate([
  AsnType({
    type: AsnTypeTypes.Sequence,
    itemType: AsnPropTypes.ObjectIdentifier
  })
], AttrSpec);
class AAControls {
  constructor(params = {}) {
    __publicField(this, "pathLenConstraint");
    __publicField(this, "permittedAttrs");
    __publicField(this, "excludedAttrs");
    __publicField(this, "permitUnSpecified", true);
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    optional: true
  })
], AAControls.prototype, "pathLenConstraint", void 0);
__decorate([
  AsnProp({
    type: AttrSpec,
    implicit: true,
    context: 0,
    optional: true
  })
], AAControls.prototype, "permittedAttrs", void 0);
__decorate([
  AsnProp({
    type: AttrSpec,
    implicit: true,
    context: 1,
    optional: true
  })
], AAControls.prototype, "excludedAttrs", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Boolean,
    defaultValue: true
  })
], AAControls.prototype, "permitUnSpecified", void 0);
class IssuerSerial {
  constructor(params = {}) {
    __publicField(this, "issuer", new GeneralNames$1());
    __publicField(this, "serial", new ArrayBuffer(0));
    __publicField(this, "issuerUID", new ArrayBuffer(0));
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: GeneralNames$1 })
], IssuerSerial.prototype, "issuer", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    converter: AsnIntegerArrayBufferConverter
  })
], IssuerSerial.prototype, "serial", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.BitString,
    optional: true
  })
], IssuerSerial.prototype, "issuerUID", void 0);
var DigestedObjectType;
(function(DigestedObjectType2) {
  DigestedObjectType2[DigestedObjectType2["publicKey"] = 0] = "publicKey";
  DigestedObjectType2[DigestedObjectType2["publicKeyCert"] = 1] = "publicKeyCert";
  DigestedObjectType2[DigestedObjectType2["otherObjectTypes"] = 2] = "otherObjectTypes";
})(DigestedObjectType || (DigestedObjectType = {}));
class ObjectDigestInfo {
  constructor(params = {}) {
    __publicField(this, "digestedObjectType", DigestedObjectType.publicKey);
    __publicField(this, "otherObjectTypeID");
    __publicField(this, "digestAlgorithm", new AlgorithmIdentifier());
    __publicField(this, "objectDigest", new ArrayBuffer(0));
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.Enumerated })
], ObjectDigestInfo.prototype, "digestedObjectType", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.ObjectIdentifier,
    optional: true
  })
], ObjectDigestInfo.prototype, "otherObjectTypeID", void 0);
__decorate([
  AsnProp({ type: AlgorithmIdentifier })
], ObjectDigestInfo.prototype, "digestAlgorithm", void 0);
__decorate([
  AsnProp({ type: AsnPropTypes.BitString })
], ObjectDigestInfo.prototype, "objectDigest", void 0);
class V2Form {
  constructor(params = {}) {
    __publicField(this, "issuerName");
    __publicField(this, "baseCertificateID");
    __publicField(this, "objectDigestInfo");
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({
    type: GeneralNames$1,
    optional: true
  })
], V2Form.prototype, "issuerName", void 0);
__decorate([
  AsnProp({
    type: IssuerSerial,
    context: 0,
    implicit: true,
    optional: true
  })
], V2Form.prototype, "baseCertificateID", void 0);
__decorate([
  AsnProp({
    type: ObjectDigestInfo,
    context: 1,
    implicit: true,
    optional: true
  })
], V2Form.prototype, "objectDigestInfo", void 0);
let AttCertIssuer = class AttCertIssuer2 {
  constructor(params = {}) {
    __publicField(this, "v1Form");
    __publicField(this, "v2Form");
    Object.assign(this, params);
  }
};
__decorate([
  AsnProp({
    type: GeneralName$1,
    repeated: "sequence"
  })
], AttCertIssuer.prototype, "v1Form", void 0);
__decorate([
  AsnProp({
    type: V2Form,
    context: 0,
    implicit: true
  })
], AttCertIssuer.prototype, "v2Form", void 0);
AttCertIssuer = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], AttCertIssuer);
class AttCertValidityPeriod {
  constructor(params = {}) {
    __publicField(this, "notBeforeTime", /* @__PURE__ */ new Date());
    __publicField(this, "notAfterTime", /* @__PURE__ */ new Date());
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.GeneralizedTime })
], AttCertValidityPeriod.prototype, "notBeforeTime", void 0);
__decorate([
  AsnProp({ type: AsnPropTypes.GeneralizedTime })
], AttCertValidityPeriod.prototype, "notAfterTime", void 0);
class Holder {
  constructor(params = {}) {
    __publicField(this, "baseCertificateID");
    __publicField(this, "entityName");
    __publicField(this, "objectDigestInfo");
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({
    type: IssuerSerial,
    implicit: true,
    context: 0,
    optional: true
  })
], Holder.prototype, "baseCertificateID", void 0);
__decorate([
  AsnProp({
    type: GeneralNames$1,
    implicit: true,
    context: 1,
    optional: true
  })
], Holder.prototype, "entityName", void 0);
__decorate([
  AsnProp({
    type: ObjectDigestInfo,
    implicit: true,
    context: 2,
    optional: true
  })
], Holder.prototype, "objectDigestInfo", void 0);
var AttCertVersion;
(function(AttCertVersion2) {
  AttCertVersion2[AttCertVersion2["v2"] = 1] = "v2";
})(AttCertVersion || (AttCertVersion = {}));
class AttributeCertificateInfo {
  constructor(params = {}) {
    __publicField(this, "version", AttCertVersion.v2);
    __publicField(this, "holder", new Holder());
    __publicField(this, "issuer", new AttCertIssuer());
    __publicField(this, "signature", new AlgorithmIdentifier());
    __publicField(this, "serialNumber", new ArrayBuffer(0));
    __publicField(this, "attrCertValidityPeriod", new AttCertValidityPeriod());
    __publicField(this, "attributes", []);
    __publicField(this, "issuerUniqueID");
    __publicField(this, "extensions");
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.Integer })
], AttributeCertificateInfo.prototype, "version", void 0);
__decorate([
  AsnProp({ type: Holder })
], AttributeCertificateInfo.prototype, "holder", void 0);
__decorate([
  AsnProp({ type: AttCertIssuer })
], AttributeCertificateInfo.prototype, "issuer", void 0);
__decorate([
  AsnProp({ type: AlgorithmIdentifier })
], AttributeCertificateInfo.prototype, "signature", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    converter: AsnIntegerArrayBufferConverter
  })
], AttributeCertificateInfo.prototype, "serialNumber", void 0);
__decorate([
  AsnProp({ type: AttCertValidityPeriod })
], AttributeCertificateInfo.prototype, "attrCertValidityPeriod", void 0);
__decorate([
  AsnProp({
    type: Attribute$2,
    repeated: "sequence"
  })
], AttributeCertificateInfo.prototype, "attributes", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.BitString,
    optional: true
  })
], AttributeCertificateInfo.prototype, "issuerUniqueID", void 0);
__decorate([
  AsnProp({
    type: Extensions,
    optional: true
  })
], AttributeCertificateInfo.prototype, "extensions", void 0);
class AttributeCertificate {
  constructor(params = {}) {
    __publicField(this, "acinfo", new AttributeCertificateInfo());
    __publicField(this, "signatureAlgorithm", new AlgorithmIdentifier());
    __publicField(this, "signatureValue", new ArrayBuffer(0));
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AttributeCertificateInfo })
], AttributeCertificate.prototype, "acinfo", void 0);
__decorate([
  AsnProp({ type: AlgorithmIdentifier })
], AttributeCertificate.prototype, "signatureAlgorithm", void 0);
__decorate([
  AsnProp({ type: AsnPropTypes.BitString })
], AttributeCertificate.prototype, "signatureValue", void 0);
var ClassListFlags;
(function(ClassListFlags2) {
  ClassListFlags2[ClassListFlags2["unmarked"] = 1] = "unmarked";
  ClassListFlags2[ClassListFlags2["unclassified"] = 2] = "unclassified";
  ClassListFlags2[ClassListFlags2["restricted"] = 4] = "restricted";
  ClassListFlags2[ClassListFlags2["confidential"] = 8] = "confidential";
  ClassListFlags2[ClassListFlags2["secret"] = 16] = "secret";
  ClassListFlags2[ClassListFlags2["topSecret"] = 32] = "topSecret";
})(ClassListFlags || (ClassListFlags = {}));
class ClassList extends BitString2 {
}
class SecurityCategory {
  constructor(params = {}) {
    __publicField(this, "type", "");
    __publicField(this, "value", new ArrayBuffer(0));
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({
    type: AsnPropTypes.ObjectIdentifier,
    implicit: true,
    context: 0
  })
], SecurityCategory.prototype, "type", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Any,
    implicit: true,
    context: 1
  })
], SecurityCategory.prototype, "value", void 0);
class Clearance {
  constructor(params = {}) {
    __publicField(this, "policyId", "");
    __publicField(this, "classList", new ClassList(ClassListFlags.unclassified));
    __publicField(this, "securityCategories");
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], Clearance.prototype, "policyId", void 0);
__decorate([
  AsnProp({
    type: ClassList,
    defaultValue: new ClassList(ClassListFlags.unclassified)
  })
], Clearance.prototype, "classList", void 0);
__decorate([
  AsnProp({
    type: SecurityCategory,
    repeated: "set"
  })
], Clearance.prototype, "securityCategories", void 0);
class IetfAttrSyntaxValueChoices {
  constructor(params = {}) {
    __publicField(this, "cotets");
    __publicField(this, "oid");
    __publicField(this, "string");
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: OctetString2 })
], IetfAttrSyntaxValueChoices.prototype, "cotets", void 0);
__decorate([
  AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], IetfAttrSyntaxValueChoices.prototype, "oid", void 0);
__decorate([
  AsnProp({ type: AsnPropTypes.Utf8String })
], IetfAttrSyntaxValueChoices.prototype, "string", void 0);
class IetfAttrSyntax {
  constructor(params = {}) {
    __publicField(this, "policyAuthority");
    __publicField(this, "values", []);
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({
    type: GeneralNames$1,
    implicit: true,
    context: 0,
    optional: true
  })
], IetfAttrSyntax.prototype, "policyAuthority", void 0);
__decorate([
  AsnProp({
    type: IetfAttrSyntaxValueChoices,
    repeated: "sequence"
  })
], IetfAttrSyntax.prototype, "values", void 0);
var Targets_1;
class TargetCert {
  constructor(params = {}) {
    __publicField(this, "targetCertificate", new IssuerSerial());
    __publicField(this, "targetName");
    __publicField(this, "certDigestInfo");
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: IssuerSerial })
], TargetCert.prototype, "targetCertificate", void 0);
__decorate([
  AsnProp({
    type: GeneralName$1,
    optional: true
  })
], TargetCert.prototype, "targetName", void 0);
__decorate([
  AsnProp({
    type: ObjectDigestInfo,
    optional: true
  })
], TargetCert.prototype, "certDigestInfo", void 0);
let Target = class Target2 {
  constructor(params = {}) {
    __publicField(this, "targetName");
    __publicField(this, "targetGroup");
    __publicField(this, "targetCert");
    Object.assign(this, params);
  }
};
__decorate([
  AsnProp({
    type: GeneralName$1,
    context: 0,
    implicit: true
  })
], Target.prototype, "targetName", void 0);
__decorate([
  AsnProp({
    type: GeneralName$1,
    context: 1,
    implicit: true
  })
], Target.prototype, "targetGroup", void 0);
__decorate([
  AsnProp({
    type: TargetCert,
    context: 2,
    implicit: true
  })
], Target.prototype, "targetCert", void 0);
Target = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], Target);
let Targets = Targets_1 = class Targets2 extends AsnArray {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, Targets_1.prototype);
  }
};
Targets = Targets_1 = __decorate([
  AsnType({
    type: AsnTypeTypes.Sequence,
    itemType: Target
  })
], Targets);
var ProxyInfo_1;
let ProxyInfo = ProxyInfo_1 = class ProxyInfo2 extends AsnArray {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, ProxyInfo_1.prototype);
  }
};
ProxyInfo = ProxyInfo_1 = __decorate([
  AsnType({
    type: AsnTypeTypes.Sequence,
    itemType: Targets
  })
], ProxyInfo);
class RoleSyntax {
  constructor(params = {}) {
    __publicField(this, "roleAuthority");
    __publicField(this, "roleName");
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({
    type: GeneralNames$1,
    implicit: true,
    context: 0,
    optional: true
  })
], RoleSyntax.prototype, "roleAuthority", void 0);
__decorate([
  AsnProp({
    type: GeneralName$1,
    implicit: true,
    context: 1
  })
], RoleSyntax.prototype, "roleName", void 0);
class SvceAuthInfo {
  constructor(params = {}) {
    __publicField(this, "service", new GeneralName$1());
    __publicField(this, "ident", new GeneralName$1());
    __publicField(this, "authInfo");
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: GeneralName$1 })
], SvceAuthInfo.prototype, "service", void 0);
__decorate([
  AsnProp({ type: GeneralName$1 })
], SvceAuthInfo.prototype, "ident", void 0);
__decorate([
  AsnProp({
    type: OctetString2,
    optional: true
  })
], SvceAuthInfo.prototype, "authInfo", void 0);
var CertificateSet_1;
class OtherCertificateFormat {
  constructor(params = {}) {
    __publicField(this, "otherCertFormat", "");
    __publicField(this, "otherCert", new ArrayBuffer(0));
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], OtherCertificateFormat.prototype, "otherCertFormat", void 0);
__decorate([
  AsnProp({ type: AsnPropTypes.Any })
], OtherCertificateFormat.prototype, "otherCert", void 0);
let CertificateChoices = class CertificateChoices2 {
  constructor(params = {}) {
    __publicField(this, "certificate");
    __publicField(this, "v2AttrCert");
    __publicField(this, "other");
    Object.assign(this, params);
  }
};
__decorate([
  AsnProp({ type: Certificate })
], CertificateChoices.prototype, "certificate", void 0);
__decorate([
  AsnProp({
    type: AttributeCertificate,
    context: 2,
    implicit: true
  })
], CertificateChoices.prototype, "v2AttrCert", void 0);
__decorate([
  AsnProp({
    type: OtherCertificateFormat,
    context: 3,
    implicit: true
  })
], CertificateChoices.prototype, "other", void 0);
CertificateChoices = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], CertificateChoices);
let CertificateSet = CertificateSet_1 = class CertificateSet2 extends AsnArray {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, CertificateSet_1.prototype);
  }
};
CertificateSet = CertificateSet_1 = __decorate([
  AsnType({
    type: AsnTypeTypes.Set,
    itemType: CertificateChoices
  })
], CertificateSet);
class ContentInfo {
  constructor(params = {}) {
    __publicField(this, "contentType", "");
    __publicField(this, "content", new ArrayBuffer(0));
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], ContentInfo.prototype, "contentType", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Any,
    context: 0
  })
], ContentInfo.prototype, "content", void 0);
let EncapsulatedContent = class EncapsulatedContent2 {
  constructor(params = {}) {
    __publicField(this, "single");
    __publicField(this, "any");
    Object.assign(this, params);
  }
};
__decorate([
  AsnProp({ type: OctetString2 })
], EncapsulatedContent.prototype, "single", void 0);
__decorate([
  AsnProp({ type: AsnPropTypes.Any })
], EncapsulatedContent.prototype, "any", void 0);
EncapsulatedContent = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], EncapsulatedContent);
class EncapsulatedContentInfo {
  constructor(params = {}) {
    __publicField(this, "eContentType", "");
    __publicField(this, "eContent");
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], EncapsulatedContentInfo.prototype, "eContentType", void 0);
__decorate([
  AsnProp({
    type: EncapsulatedContent,
    context: 0,
    optional: true
  })
], EncapsulatedContentInfo.prototype, "eContent", void 0);
let EncryptedContent = class EncryptedContent2 {
  constructor(params = {}) {
    __publicField(this, "value");
    __publicField(this, "constructedValue");
    Object.assign(this, params);
  }
};
__decorate([
  AsnProp({
    type: OctetString2,
    context: 0,
    implicit: true,
    optional: true
  })
], EncryptedContent.prototype, "value", void 0);
__decorate([
  AsnProp({
    type: OctetString2,
    converter: AsnConstructedOctetStringConverter,
    context: 0,
    implicit: true,
    optional: true,
    repeated: "sequence"
  })
], EncryptedContent.prototype, "constructedValue", void 0);
EncryptedContent = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], EncryptedContent);
class EncryptedContentInfo {
  constructor(params = {}) {
    __publicField(this, "contentType", "");
    __publicField(this, "contentEncryptionAlgorithm", new ContentEncryptionAlgorithmIdentifier());
    __publicField(this, "encryptedContent");
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], EncryptedContentInfo.prototype, "contentType", void 0);
__decorate([
  AsnProp({ type: ContentEncryptionAlgorithmIdentifier })
], EncryptedContentInfo.prototype, "contentEncryptionAlgorithm", void 0);
__decorate([
  AsnProp({
    type: EncryptedContent,
    optional: true
  })
], EncryptedContentInfo.prototype, "encryptedContent", void 0);
class OtherKeyAttribute {
  constructor(params = {}) {
    __publicField(this, "keyAttrId", "");
    __publicField(this, "keyAttr");
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], OtherKeyAttribute.prototype, "keyAttrId", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Any,
    optional: true
  })
], OtherKeyAttribute.prototype, "keyAttr", void 0);
var RecipientEncryptedKeys_1;
class RecipientKeyIdentifier {
  constructor(params = {}) {
    __publicField(this, "subjectKeyIdentifier", new SubjectKeyIdentifier());
    __publicField(this, "date");
    __publicField(this, "other");
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: SubjectKeyIdentifier })
], RecipientKeyIdentifier.prototype, "subjectKeyIdentifier", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.GeneralizedTime,
    optional: true
  })
], RecipientKeyIdentifier.prototype, "date", void 0);
__decorate([
  AsnProp({
    type: OtherKeyAttribute,
    optional: true
  })
], RecipientKeyIdentifier.prototype, "other", void 0);
let KeyAgreeRecipientIdentifier = class KeyAgreeRecipientIdentifier2 {
  constructor(params = {}) {
    __publicField(this, "rKeyId");
    __publicField(this, "issuerAndSerialNumber");
    Object.assign(this, params);
  }
};
__decorate([
  AsnProp({
    type: RecipientKeyIdentifier,
    context: 0,
    implicit: true,
    optional: true
  })
], KeyAgreeRecipientIdentifier.prototype, "rKeyId", void 0);
__decorate([
  AsnProp({
    type: IssuerAndSerialNumber,
    optional: true
  })
], KeyAgreeRecipientIdentifier.prototype, "issuerAndSerialNumber", void 0);
KeyAgreeRecipientIdentifier = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], KeyAgreeRecipientIdentifier);
class RecipientEncryptedKey {
  constructor(params = {}) {
    __publicField(this, "rid", new KeyAgreeRecipientIdentifier());
    __publicField(this, "encryptedKey", new OctetString2());
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: KeyAgreeRecipientIdentifier })
], RecipientEncryptedKey.prototype, "rid", void 0);
__decorate([
  AsnProp({ type: OctetString2 })
], RecipientEncryptedKey.prototype, "encryptedKey", void 0);
let RecipientEncryptedKeys = RecipientEncryptedKeys_1 = class RecipientEncryptedKeys2 extends AsnArray {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, RecipientEncryptedKeys_1.prototype);
  }
};
RecipientEncryptedKeys = RecipientEncryptedKeys_1 = __decorate([
  AsnType({
    type: AsnTypeTypes.Sequence,
    itemType: RecipientEncryptedKey
  })
], RecipientEncryptedKeys);
class OriginatorPublicKey {
  constructor(params = {}) {
    __publicField(this, "algorithm", new AlgorithmIdentifier());
    __publicField(this, "publicKey", new ArrayBuffer(0));
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AlgorithmIdentifier })
], OriginatorPublicKey.prototype, "algorithm", void 0);
__decorate([
  AsnProp({ type: AsnPropTypes.BitString })
], OriginatorPublicKey.prototype, "publicKey", void 0);
let OriginatorIdentifierOrKey = class OriginatorIdentifierOrKey2 {
  constructor(params = {}) {
    __publicField(this, "subjectKeyIdentifier");
    __publicField(this, "originatorKey");
    __publicField(this, "issuerAndSerialNumber");
    Object.assign(this, params);
  }
};
__decorate([
  AsnProp({
    type: SubjectKeyIdentifier,
    context: 0,
    implicit: true,
    optional: true
  })
], OriginatorIdentifierOrKey.prototype, "subjectKeyIdentifier", void 0);
__decorate([
  AsnProp({
    type: OriginatorPublicKey,
    context: 1,
    implicit: true,
    optional: true
  })
], OriginatorIdentifierOrKey.prototype, "originatorKey", void 0);
__decorate([
  AsnProp({
    type: IssuerAndSerialNumber,
    optional: true
  })
], OriginatorIdentifierOrKey.prototype, "issuerAndSerialNumber", void 0);
OriginatorIdentifierOrKey = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], OriginatorIdentifierOrKey);
class KeyAgreeRecipientInfo {
  constructor(params = {}) {
    __publicField(this, "version", CMSVersion.v3);
    __publicField(this, "originator", new OriginatorIdentifierOrKey());
    __publicField(this, "ukm");
    __publicField(this, "keyEncryptionAlgorithm", new KeyEncryptionAlgorithmIdentifier());
    __publicField(this, "recipientEncryptedKeys", new RecipientEncryptedKeys());
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.Integer })
], KeyAgreeRecipientInfo.prototype, "version", void 0);
__decorate([
  AsnProp({
    type: OriginatorIdentifierOrKey,
    context: 0
  })
], KeyAgreeRecipientInfo.prototype, "originator", void 0);
__decorate([
  AsnProp({
    type: OctetString2,
    context: 1,
    optional: true
  })
], KeyAgreeRecipientInfo.prototype, "ukm", void 0);
__decorate([
  AsnProp({ type: KeyEncryptionAlgorithmIdentifier })
], KeyAgreeRecipientInfo.prototype, "keyEncryptionAlgorithm", void 0);
__decorate([
  AsnProp({ type: RecipientEncryptedKeys })
], KeyAgreeRecipientInfo.prototype, "recipientEncryptedKeys", void 0);
let RecipientIdentifier = class RecipientIdentifier2 {
  constructor(params = {}) {
    __publicField(this, "subjectKeyIdentifier");
    __publicField(this, "issuerAndSerialNumber");
    Object.assign(this, params);
  }
};
__decorate([
  AsnProp({
    type: SubjectKeyIdentifier,
    context: 0,
    implicit: true
  })
], RecipientIdentifier.prototype, "subjectKeyIdentifier", void 0);
__decorate([
  AsnProp({ type: IssuerAndSerialNumber })
], RecipientIdentifier.prototype, "issuerAndSerialNumber", void 0);
RecipientIdentifier = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], RecipientIdentifier);
class KeyTransRecipientInfo {
  constructor(params = {}) {
    __publicField(this, "version", CMSVersion.v0);
    __publicField(this, "rid", new RecipientIdentifier());
    __publicField(this, "keyEncryptionAlgorithm", new KeyEncryptionAlgorithmIdentifier());
    __publicField(this, "encryptedKey", new OctetString2());
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.Integer })
], KeyTransRecipientInfo.prototype, "version", void 0);
__decorate([
  AsnProp({ type: RecipientIdentifier })
], KeyTransRecipientInfo.prototype, "rid", void 0);
__decorate([
  AsnProp({ type: KeyEncryptionAlgorithmIdentifier })
], KeyTransRecipientInfo.prototype, "keyEncryptionAlgorithm", void 0);
__decorate([
  AsnProp({ type: OctetString2 })
], KeyTransRecipientInfo.prototype, "encryptedKey", void 0);
class KEKIdentifier {
  constructor(params = {}) {
    __publicField(this, "keyIdentifier", new OctetString2());
    __publicField(this, "date");
    __publicField(this, "other");
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: OctetString2 })
], KEKIdentifier.prototype, "keyIdentifier", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.GeneralizedTime,
    optional: true
  })
], KEKIdentifier.prototype, "date", void 0);
__decorate([
  AsnProp({
    type: OtherKeyAttribute,
    optional: true
  })
], KEKIdentifier.prototype, "other", void 0);
class KEKRecipientInfo {
  constructor(params = {}) {
    __publicField(this, "version", CMSVersion.v4);
    __publicField(this, "kekid", new KEKIdentifier());
    __publicField(this, "keyEncryptionAlgorithm", new KeyEncryptionAlgorithmIdentifier());
    __publicField(this, "encryptedKey", new OctetString2());
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.Integer })
], KEKRecipientInfo.prototype, "version", void 0);
__decorate([
  AsnProp({ type: KEKIdentifier })
], KEKRecipientInfo.prototype, "kekid", void 0);
__decorate([
  AsnProp({ type: KeyEncryptionAlgorithmIdentifier })
], KEKRecipientInfo.prototype, "keyEncryptionAlgorithm", void 0);
__decorate([
  AsnProp({ type: OctetString2 })
], KEKRecipientInfo.prototype, "encryptedKey", void 0);
class PasswordRecipientInfo {
  constructor(params = {}) {
    __publicField(this, "version", CMSVersion.v0);
    __publicField(this, "keyDerivationAlgorithm");
    __publicField(this, "keyEncryptionAlgorithm", new KeyEncryptionAlgorithmIdentifier());
    __publicField(this, "encryptedKey", new OctetString2());
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.Integer })
], PasswordRecipientInfo.prototype, "version", void 0);
__decorate([
  AsnProp({
    type: KeyDerivationAlgorithmIdentifier,
    context: 0,
    optional: true
  })
], PasswordRecipientInfo.prototype, "keyDerivationAlgorithm", void 0);
__decorate([
  AsnProp({ type: KeyEncryptionAlgorithmIdentifier })
], PasswordRecipientInfo.prototype, "keyEncryptionAlgorithm", void 0);
__decorate([
  AsnProp({ type: OctetString2 })
], PasswordRecipientInfo.prototype, "encryptedKey", void 0);
class OtherRecipientInfo {
  constructor(params = {}) {
    __publicField(this, "oriType", "");
    __publicField(this, "oriValue", new ArrayBuffer(0));
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], OtherRecipientInfo.prototype, "oriType", void 0);
__decorate([
  AsnProp({ type: AsnPropTypes.Any })
], OtherRecipientInfo.prototype, "oriValue", void 0);
let RecipientInfo = class RecipientInfo2 {
  constructor(params = {}) {
    __publicField(this, "ktri");
    __publicField(this, "kari");
    __publicField(this, "kekri");
    __publicField(this, "pwri");
    __publicField(this, "ori");
    Object.assign(this, params);
  }
};
__decorate([
  AsnProp({
    type: KeyTransRecipientInfo,
    optional: true
  })
], RecipientInfo.prototype, "ktri", void 0);
__decorate([
  AsnProp({
    type: KeyAgreeRecipientInfo,
    context: 1,
    implicit: true,
    optional: true
  })
], RecipientInfo.prototype, "kari", void 0);
__decorate([
  AsnProp({
    type: KEKRecipientInfo,
    context: 2,
    implicit: true,
    optional: true
  })
], RecipientInfo.prototype, "kekri", void 0);
__decorate([
  AsnProp({
    type: PasswordRecipientInfo,
    context: 3,
    implicit: true,
    optional: true
  })
], RecipientInfo.prototype, "pwri", void 0);
__decorate([
  AsnProp({
    type: OtherRecipientInfo,
    context: 4,
    implicit: true,
    optional: true
  })
], RecipientInfo.prototype, "ori", void 0);
RecipientInfo = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], RecipientInfo);
var RecipientInfos_1;
let RecipientInfos = RecipientInfos_1 = class RecipientInfos2 extends AsnArray {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, RecipientInfos_1.prototype);
  }
};
RecipientInfos = RecipientInfos_1 = __decorate([
  AsnType({
    type: AsnTypeTypes.Set,
    itemType: RecipientInfo
  })
], RecipientInfos);
var RevocationInfoChoices_1;
class OtherRevocationInfoFormat {
  constructor(params = {}) {
    __publicField(this, "otherRevInfoFormat", "");
    __publicField(this, "otherRevInfo", new ArrayBuffer(0));
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], OtherRevocationInfoFormat.prototype, "otherRevInfoFormat", void 0);
__decorate([
  AsnProp({ type: AsnPropTypes.Any })
], OtherRevocationInfoFormat.prototype, "otherRevInfo", void 0);
let RevocationInfoChoice = class RevocationInfoChoice2 {
  constructor(params = {}) {
    __publicField(this, "other", new OtherRevocationInfoFormat());
    Object.assign(this, params);
  }
};
__decorate([
  AsnProp({
    type: OtherRevocationInfoFormat,
    context: 1,
    implicit: true
  })
], RevocationInfoChoice.prototype, "other", void 0);
RevocationInfoChoice = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], RevocationInfoChoice);
let RevocationInfoChoices = RevocationInfoChoices_1 = class RevocationInfoChoices2 extends AsnArray {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, RevocationInfoChoices_1.prototype);
  }
};
RevocationInfoChoices = RevocationInfoChoices_1 = __decorate([
  AsnType({
    type: AsnTypeTypes.Set,
    itemType: RevocationInfoChoice
  })
], RevocationInfoChoices);
class OriginatorInfo {
  constructor(params = {}) {
    __publicField(this, "certs");
    __publicField(this, "crls");
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({
    type: CertificateSet,
    context: 0,
    implicit: true,
    optional: true
  })
], OriginatorInfo.prototype, "certs", void 0);
__decorate([
  AsnProp({
    type: RevocationInfoChoices,
    context: 1,
    implicit: true,
    optional: true
  })
], OriginatorInfo.prototype, "crls", void 0);
var UnprotectedAttributes_1;
let UnprotectedAttributes = UnprotectedAttributes_1 = class UnprotectedAttributes2 extends AsnArray {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, UnprotectedAttributes_1.prototype);
  }
};
UnprotectedAttributes = UnprotectedAttributes_1 = __decorate([
  AsnType({
    type: AsnTypeTypes.Set,
    itemType: Attribute$1
  })
], UnprotectedAttributes);
class EnvelopedData {
  constructor(params = {}) {
    __publicField(this, "version", CMSVersion.v0);
    __publicField(this, "originatorInfo");
    __publicField(this, "recipientInfos", new RecipientInfos());
    __publicField(this, "encryptedContentInfo", new EncryptedContentInfo());
    __publicField(this, "unprotectedAttrs");
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.Integer })
], EnvelopedData.prototype, "version", void 0);
__decorate([
  AsnProp({
    type: OriginatorInfo,
    context: 0,
    implicit: true,
    optional: true
  })
], EnvelopedData.prototype, "originatorInfo", void 0);
__decorate([
  AsnProp({ type: RecipientInfos })
], EnvelopedData.prototype, "recipientInfos", void 0);
__decorate([
  AsnProp({ type: EncryptedContentInfo })
], EnvelopedData.prototype, "encryptedContentInfo", void 0);
__decorate([
  AsnProp({
    type: UnprotectedAttributes,
    context: 1,
    implicit: true,
    optional: true
  })
], EnvelopedData.prototype, "unprotectedAttrs", void 0);
const id_signedData = "1.2.840.113549.1.7.2";
var DigestAlgorithmIdentifiers_1;
let DigestAlgorithmIdentifiers = DigestAlgorithmIdentifiers_1 = class DigestAlgorithmIdentifiers2 extends AsnArray {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, DigestAlgorithmIdentifiers_1.prototype);
  }
};
DigestAlgorithmIdentifiers = DigestAlgorithmIdentifiers_1 = __decorate([
  AsnType({
    type: AsnTypeTypes.Set,
    itemType: DigestAlgorithmIdentifier
  })
], DigestAlgorithmIdentifiers);
class SignedData {
  constructor(params = {}) {
    __publicField(this, "version", CMSVersion.v0);
    __publicField(this, "digestAlgorithms", new DigestAlgorithmIdentifiers());
    __publicField(this, "encapContentInfo", new EncapsulatedContentInfo());
    __publicField(this, "certificates");
    __publicField(this, "crls");
    __publicField(this, "signerInfos", new SignerInfos());
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.Integer })
], SignedData.prototype, "version", void 0);
__decorate([
  AsnProp({ type: DigestAlgorithmIdentifiers })
], SignedData.prototype, "digestAlgorithms", void 0);
__decorate([
  AsnProp({ type: EncapsulatedContentInfo })
], SignedData.prototype, "encapContentInfo", void 0);
__decorate([
  AsnProp({
    type: CertificateSet,
    context: 0,
    implicit: true,
    optional: true
  })
], SignedData.prototype, "certificates", void 0);
__decorate([
  AsnProp({
    type: RevocationInfoChoices,
    context: 1,
    implicit: true,
    optional: true
  })
], SignedData.prototype, "crls", void 0);
__decorate([
  AsnProp({ type: SignerInfos })
], SignedData.prototype, "signerInfos", void 0);
const id_ecPublicKey = "1.2.840.10045.2.1";
const id_ecdsaWithSHA1 = "1.2.840.10045.4.1";
const id_ecdsaWithSHA224 = "1.2.840.10045.4.3.1";
const id_ecdsaWithSHA256 = "1.2.840.10045.4.3.2";
const id_ecdsaWithSHA384 = "1.2.840.10045.4.3.3";
const id_ecdsaWithSHA512 = "1.2.840.10045.4.3.4";
const id_secp256r1 = "1.2.840.10045.3.1.7";
const id_secp384r1 = "1.3.132.0.34";
const id_secp521r1 = "1.3.132.0.35";
function create$1(algorithm) {
  return new AlgorithmIdentifier({ algorithm });
}
const ecdsaWithSHA1 = create$1(id_ecdsaWithSHA1);
create$1(id_ecdsaWithSHA224);
const ecdsaWithSHA256 = create$1(id_ecdsaWithSHA256);
const ecdsaWithSHA384 = create$1(id_ecdsaWithSHA384);
const ecdsaWithSHA512 = create$1(id_ecdsaWithSHA512);
let FieldID = class FieldID2 {
  constructor(params = {}) {
    __publicField(this, "fieldType");
    __publicField(this, "parameters");
    Object.assign(this, params);
  }
};
__decorate([
  AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], FieldID.prototype, "fieldType", void 0);
__decorate([
  AsnProp({ type: AsnPropTypes.Any })
], FieldID.prototype, "parameters", void 0);
FieldID = __decorate([
  AsnType({ type: AsnTypeTypes.Sequence })
], FieldID);
class ECPoint extends OctetString2 {
}
let Curve = class Curve2 {
  constructor(params = {}) {
    __publicField(this, "a");
    __publicField(this, "b");
    __publicField(this, "seed");
    Object.assign(this, params);
  }
};
__decorate([
  AsnProp({ type: AsnPropTypes.OctetString })
], Curve.prototype, "a", void 0);
__decorate([
  AsnProp({ type: AsnPropTypes.OctetString })
], Curve.prototype, "b", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.BitString,
    optional: true
  })
], Curve.prototype, "seed", void 0);
Curve = __decorate([
  AsnType({ type: AsnTypeTypes.Sequence })
], Curve);
var ECPVer;
(function(ECPVer2) {
  ECPVer2[ECPVer2["ecpVer1"] = 1] = "ecpVer1";
})(ECPVer || (ECPVer = {}));
let SpecifiedECDomain = class SpecifiedECDomain2 {
  constructor(params = {}) {
    __publicField(this, "version", ECPVer.ecpVer1);
    __publicField(this, "fieldID");
    __publicField(this, "curve");
    __publicField(this, "base");
    __publicField(this, "order");
    __publicField(this, "cofactor");
    Object.assign(this, params);
  }
};
__decorate([
  AsnProp({ type: AsnPropTypes.Integer })
], SpecifiedECDomain.prototype, "version", void 0);
__decorate([
  AsnProp({ type: FieldID })
], SpecifiedECDomain.prototype, "fieldID", void 0);
__decorate([
  AsnProp({ type: Curve })
], SpecifiedECDomain.prototype, "curve", void 0);
__decorate([
  AsnProp({ type: ECPoint })
], SpecifiedECDomain.prototype, "base", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    converter: AsnIntegerArrayBufferConverter
  })
], SpecifiedECDomain.prototype, "order", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    optional: true
  })
], SpecifiedECDomain.prototype, "cofactor", void 0);
SpecifiedECDomain = __decorate([
  AsnType({ type: AsnTypeTypes.Sequence })
], SpecifiedECDomain);
let ECParameters = class ECParameters2 {
  constructor(params = {}) {
    __publicField(this, "namedCurve");
    __publicField(this, "implicitCurve");
    __publicField(this, "specifiedCurve");
    Object.assign(this, params);
  }
};
__decorate([
  AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], ECParameters.prototype, "namedCurve", void 0);
__decorate([
  AsnProp({ type: AsnPropTypes.Null })
], ECParameters.prototype, "implicitCurve", void 0);
__decorate([
  AsnProp({ type: SpecifiedECDomain })
], ECParameters.prototype, "specifiedCurve", void 0);
ECParameters = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], ECParameters);
class ECPrivateKey {
  constructor(params = {}) {
    __publicField(this, "version", 1);
    __publicField(this, "privateKey", new OctetString2());
    __publicField(this, "parameters");
    __publicField(this, "publicKey");
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.Integer })
], ECPrivateKey.prototype, "version", void 0);
__decorate([
  AsnProp({ type: OctetString2 })
], ECPrivateKey.prototype, "privateKey", void 0);
__decorate([
  AsnProp({
    type: ECParameters,
    context: 0,
    optional: true
  })
], ECPrivateKey.prototype, "parameters", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.BitString,
    context: 1,
    optional: true
  })
], ECPrivateKey.prototype, "publicKey", void 0);
class ECDSASigValue {
  constructor(params = {}) {
    __publicField(this, "r", new ArrayBuffer(0));
    __publicField(this, "s", new ArrayBuffer(0));
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    converter: AsnIntegerArrayBufferConverter
  })
], ECDSASigValue.prototype, "r", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    converter: AsnIntegerArrayBufferConverter
  })
], ECDSASigValue.prototype, "s", void 0);
const id_pkcs_1 = "1.2.840.113549.1.1";
const id_rsaEncryption = `${id_pkcs_1}.1`;
const id_RSAES_OAEP = `${id_pkcs_1}.7`;
const id_pSpecified = `${id_pkcs_1}.9`;
const id_RSASSA_PSS = `${id_pkcs_1}.10`;
const id_md2WithRSAEncryption = `${id_pkcs_1}.2`;
const id_md5WithRSAEncryption = `${id_pkcs_1}.4`;
const id_sha1WithRSAEncryption = `${id_pkcs_1}.5`;
const id_sha224WithRSAEncryption = `${id_pkcs_1}.14`;
const id_sha256WithRSAEncryption = `${id_pkcs_1}.11`;
const id_sha384WithRSAEncryption = `${id_pkcs_1}.12`;
const id_sha512WithRSAEncryption = `${id_pkcs_1}.13`;
const id_sha512_224WithRSAEncryption = `${id_pkcs_1}.15`;
const id_sha512_256WithRSAEncryption = `${id_pkcs_1}.16`;
const id_sha1 = "1.3.14.3.2.26";
const id_sha224 = "2.16.840.1.101.3.4.2.4";
const id_sha256 = "2.16.840.1.101.3.4.2.1";
const id_sha384 = "2.16.840.1.101.3.4.2.2";
const id_sha512 = "2.16.840.1.101.3.4.2.3";
const id_sha512_224 = "2.16.840.1.101.3.4.2.5";
const id_sha512_256 = "2.16.840.1.101.3.4.2.6";
const id_md2 = "1.2.840.113549.2.2";
const id_md5 = "1.2.840.113549.2.5";
const id_mgf1 = `${id_pkcs_1}.8`;
function create(algorithm) {
  return new AlgorithmIdentifier({
    algorithm,
    parameters: null
  });
}
create(id_md2);
create(id_md5);
const sha1 = create(id_sha1);
create(id_sha224);
create(id_sha256);
create(id_sha384);
create(id_sha512);
create(id_sha512_224);
create(id_sha512_256);
const mgf1SHA1 = new AlgorithmIdentifier({
  algorithm: id_mgf1,
  parameters: AsnConvert.serialize(sha1)
});
const pSpecifiedEmpty = new AlgorithmIdentifier({
  algorithm: id_pSpecified,
  parameters: AsnConvert.serialize(AsnOctetStringConverter.toASN(new Uint8Array([
    218,
    57,
    163,
    238,
    94,
    107,
    75,
    13,
    50,
    85,
    191,
    239,
    149,
    96,
    24,
    144,
    175,
    216,
    7,
    9
  ]).buffer))
});
create(id_rsaEncryption);
create(id_md2WithRSAEncryption);
create(id_md5WithRSAEncryption);
create(id_sha1WithRSAEncryption);
create(id_sha512_224WithRSAEncryption);
create(id_sha512_256WithRSAEncryption);
create(id_sha384WithRSAEncryption);
create(id_sha512WithRSAEncryption);
create(id_sha512_224WithRSAEncryption);
create(id_sha512_256WithRSAEncryption);
class RsaEsOaepParams {
  constructor(params = {}) {
    __publicField(this, "hashAlgorithm", new AlgorithmIdentifier(sha1));
    __publicField(this, "maskGenAlgorithm", new AlgorithmIdentifier({
      algorithm: id_mgf1,
      parameters: AsnConvert.serialize(sha1)
    }));
    __publicField(this, "pSourceAlgorithm", new AlgorithmIdentifier(pSpecifiedEmpty));
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({
    type: AlgorithmIdentifier,
    context: 0,
    defaultValue: sha1
  })
], RsaEsOaepParams.prototype, "hashAlgorithm", void 0);
__decorate([
  AsnProp({
    type: AlgorithmIdentifier,
    context: 1,
    defaultValue: mgf1SHA1
  })
], RsaEsOaepParams.prototype, "maskGenAlgorithm", void 0);
__decorate([
  AsnProp({
    type: AlgorithmIdentifier,
    context: 2,
    defaultValue: pSpecifiedEmpty
  })
], RsaEsOaepParams.prototype, "pSourceAlgorithm", void 0);
new AlgorithmIdentifier({
  algorithm: id_RSAES_OAEP,
  parameters: AsnConvert.serialize(new RsaEsOaepParams())
});
class RsaSaPssParams {
  constructor(params = {}) {
    __publicField(this, "hashAlgorithm", new AlgorithmIdentifier(sha1));
    __publicField(this, "maskGenAlgorithm", new AlgorithmIdentifier({
      algorithm: id_mgf1,
      parameters: AsnConvert.serialize(sha1)
    }));
    __publicField(this, "saltLength", 20);
    __publicField(this, "trailerField", 1);
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({
    type: AlgorithmIdentifier,
    context: 0,
    defaultValue: sha1
  })
], RsaSaPssParams.prototype, "hashAlgorithm", void 0);
__decorate([
  AsnProp({
    type: AlgorithmIdentifier,
    context: 1,
    defaultValue: mgf1SHA1
  })
], RsaSaPssParams.prototype, "maskGenAlgorithm", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    context: 2,
    defaultValue: 20
  })
], RsaSaPssParams.prototype, "saltLength", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    context: 3,
    defaultValue: 1
  })
], RsaSaPssParams.prototype, "trailerField", void 0);
new AlgorithmIdentifier({
  algorithm: id_RSASSA_PSS,
  parameters: AsnConvert.serialize(new RsaSaPssParams())
});
class DigestInfo {
  constructor(params = {}) {
    __publicField(this, "digestAlgorithm", new AlgorithmIdentifier());
    __publicField(this, "digest", new OctetString2());
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AlgorithmIdentifier })
], DigestInfo.prototype, "digestAlgorithm", void 0);
__decorate([
  AsnProp({ type: OctetString2 })
], DigestInfo.prototype, "digest", void 0);
var OtherPrimeInfos_1;
class OtherPrimeInfo {
  constructor(params = {}) {
    __publicField(this, "prime", new ArrayBuffer(0));
    __publicField(this, "exponent", new ArrayBuffer(0));
    __publicField(this, "coefficient", new ArrayBuffer(0));
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    converter: AsnIntegerArrayBufferConverter
  })
], OtherPrimeInfo.prototype, "prime", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    converter: AsnIntegerArrayBufferConverter
  })
], OtherPrimeInfo.prototype, "exponent", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    converter: AsnIntegerArrayBufferConverter
  })
], OtherPrimeInfo.prototype, "coefficient", void 0);
let OtherPrimeInfos = OtherPrimeInfos_1 = class OtherPrimeInfos2 extends AsnArray {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, OtherPrimeInfos_1.prototype);
  }
};
OtherPrimeInfos = OtherPrimeInfos_1 = __decorate([
  AsnType({
    type: AsnTypeTypes.Sequence,
    itemType: OtherPrimeInfo
  })
], OtherPrimeInfos);
class RSAPrivateKey {
  constructor(params = {}) {
    __publicField(this, "version", 0);
    __publicField(this, "modulus", new ArrayBuffer(0));
    __publicField(this, "publicExponent", new ArrayBuffer(0));
    __publicField(this, "privateExponent", new ArrayBuffer(0));
    __publicField(this, "prime1", new ArrayBuffer(0));
    __publicField(this, "prime2", new ArrayBuffer(0));
    __publicField(this, "exponent1", new ArrayBuffer(0));
    __publicField(this, "exponent2", new ArrayBuffer(0));
    __publicField(this, "coefficient", new ArrayBuffer(0));
    __publicField(this, "otherPrimeInfos");
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.Integer })
], RSAPrivateKey.prototype, "version", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    converter: AsnIntegerArrayBufferConverter
  })
], RSAPrivateKey.prototype, "modulus", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    converter: AsnIntegerArrayBufferConverter
  })
], RSAPrivateKey.prototype, "publicExponent", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    converter: AsnIntegerArrayBufferConverter
  })
], RSAPrivateKey.prototype, "privateExponent", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    converter: AsnIntegerArrayBufferConverter
  })
], RSAPrivateKey.prototype, "prime1", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    converter: AsnIntegerArrayBufferConverter
  })
], RSAPrivateKey.prototype, "prime2", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    converter: AsnIntegerArrayBufferConverter
  })
], RSAPrivateKey.prototype, "exponent1", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    converter: AsnIntegerArrayBufferConverter
  })
], RSAPrivateKey.prototype, "exponent2", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    converter: AsnIntegerArrayBufferConverter
  })
], RSAPrivateKey.prototype, "coefficient", void 0);
__decorate([
  AsnProp({
    type: OtherPrimeInfos,
    optional: true
  })
], RSAPrivateKey.prototype, "otherPrimeInfos", void 0);
class RSAPublicKey {
  constructor(params = {}) {
    __publicField(this, "modulus", new ArrayBuffer(0));
    __publicField(this, "publicExponent", new ArrayBuffer(0));
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    converter: AsnIntegerArrayBufferConverter
  })
], RSAPublicKey.prototype, "modulus", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    converter: AsnIntegerArrayBufferConverter
  })
], RSAPublicKey.prototype, "publicExponent", void 0);
var Lifecycle;
(function(Lifecycle2) {
  Lifecycle2[Lifecycle2["Transient"] = 0] = "Transient";
  Lifecycle2[Lifecycle2["Singleton"] = 1] = "Singleton";
  Lifecycle2[Lifecycle2["ResolutionScoped"] = 2] = "ResolutionScoped";
  Lifecycle2[Lifecycle2["ContainerScoped"] = 3] = "ContainerScoped";
})(Lifecycle || (Lifecycle = {}));
const Lifecycle$1 = Lifecycle;
/*! *****************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */
var extendStatics = function(d, b) {
  extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d2, b2) {
    d2.__proto__ = b2;
  } || function(d2, b2) {
    for (var p in b2)
      if (b2.hasOwnProperty(p))
        d2[p] = b2[p];
  };
  return extendStatics(d, b);
};
function __extends(d, b) {
  extendStatics(d, b);
  function __() {
    this.constructor = d;
  }
  d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
}
function __awaiter(thisArg, _arguments, P, generator) {
  function adopt(value) {
    return value instanceof P ? value : new P(function(resolve) {
      resolve(value);
    });
  }
  return new (P || (P = Promise))(function(resolve, reject) {
    function fulfilled(value) {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    }
    function rejected(value) {
      try {
        step(generator["throw"](value));
      } catch (e) {
        reject(e);
      }
    }
    function step(result) {
      result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
    }
    step((generator = generator.apply(thisArg, _arguments || [])).next());
  });
}
function __generator(thisArg, body) {
  var _ = { label: 0, sent: function() {
    if (t[0] & 1)
      throw t[1];
    return t[1];
  }, trys: [], ops: [] }, f, y, t, g;
  return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() {
    return this;
  }), g;
  function verb(n) {
    return function(v) {
      return step([n, v]);
    };
  }
  function step(op) {
    if (f)
      throw new TypeError("Generator is already executing.");
    while (_)
      try {
        if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done)
          return t;
        if (y = 0, t)
          op = [op[0] & 2, t.value];
        switch (op[0]) {
          case 0:
          case 1:
            t = op;
            break;
          case 4:
            _.label++;
            return { value: op[1], done: false };
          case 5:
            _.label++;
            y = op[1];
            op = [0];
            continue;
          case 7:
            op = _.ops.pop();
            _.trys.pop();
            continue;
          default:
            if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) {
              _ = 0;
              continue;
            }
            if (op[0] === 3 && (!t || op[1] > t[0] && op[1] < t[3])) {
              _.label = op[1];
              break;
            }
            if (op[0] === 6 && _.label < t[1]) {
              _.label = t[1];
              t = op;
              break;
            }
            if (t && _.label < t[2]) {
              _.label = t[2];
              _.ops.push(op);
              break;
            }
            if (t[2])
              _.ops.pop();
            _.trys.pop();
            continue;
        }
        op = body.call(thisArg, _);
      } catch (e) {
        op = [6, e];
        y = 0;
      } finally {
        f = t = 0;
      }
    if (op[0] & 5)
      throw op[1];
    return { value: op[0] ? op[1] : void 0, done: true };
  }
}
function __values(o) {
  var s = typeof Symbol === "function" && Symbol.iterator, m = s && o[s], i = 0;
  if (m)
    return m.call(o);
  if (o && typeof o.length === "number")
    return {
      next: function() {
        if (o && i >= o.length)
          o = void 0;
        return { value: o && o[i++], done: !o };
      }
    };
  throw new TypeError(s ? "Object is not iterable." : "Symbol.iterator is not defined.");
}
function __read(o, n) {
  var m = typeof Symbol === "function" && o[Symbol.iterator];
  if (!m)
    return o;
  var i = m.call(o), r, ar = [], e;
  try {
    while ((n === void 0 || n-- > 0) && !(r = i.next()).done)
      ar.push(r.value);
  } catch (error) {
    e = { error };
  } finally {
    try {
      if (r && !r.done && (m = i["return"]))
        m.call(i);
    } finally {
      if (e)
        throw e.error;
    }
  }
  return ar;
}
function __spread() {
  for (var ar = [], i = 0; i < arguments.length; i++)
    ar = ar.concat(__read(arguments[i]));
  return ar;
}
var INJECTION_TOKEN_METADATA_KEY = "injectionTokens";
function getParamInfo(target) {
  var params = Reflect.getMetadata("design:paramtypes", target) || [];
  var injectionTokens = Reflect.getOwnMetadata(INJECTION_TOKEN_METADATA_KEY, target) || {};
  Object.keys(injectionTokens).forEach(function(key) {
    params[+key] = injectionTokens[key];
  });
  return params;
}
function isClassProvider(provider) {
  return !!provider.useClass;
}
function isFactoryProvider(provider) {
  return !!provider.useFactory;
}
var DelayedConstructor = function() {
  function DelayedConstructor2(wrap) {
    this.wrap = wrap;
    this.reflectMethods = [
      "get",
      "getPrototypeOf",
      "setPrototypeOf",
      "getOwnPropertyDescriptor",
      "defineProperty",
      "has",
      "set",
      "deleteProperty",
      "apply",
      "construct",
      "ownKeys"
    ];
  }
  DelayedConstructor2.prototype.createProxy = function(createObject) {
    var _this = this;
    var target = {};
    var init = false;
    var value;
    var delayedObject = function() {
      if (!init) {
        value = createObject(_this.wrap());
        init = true;
      }
      return value;
    };
    return new Proxy(target, this.createHandler(delayedObject));
  };
  DelayedConstructor2.prototype.createHandler = function(delayedObject) {
    var handler = {};
    var install = function(name) {
      handler[name] = function() {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
          args[_i] = arguments[_i];
        }
        args[0] = delayedObject();
        var method = Reflect[name];
        return method.apply(void 0, __spread(args));
      };
    };
    this.reflectMethods.forEach(install);
    return handler;
  };
  return DelayedConstructor2;
}();
function isNormalToken(token) {
  return typeof token === "string" || typeof token === "symbol";
}
function isTokenDescriptor(descriptor) {
  return typeof descriptor === "object" && "token" in descriptor && "multiple" in descriptor;
}
function isTransformDescriptor(descriptor) {
  return typeof descriptor === "object" && "token" in descriptor && "transform" in descriptor;
}
function isConstructorToken(token) {
  return typeof token === "function" || token instanceof DelayedConstructor;
}
function isTokenProvider(provider) {
  return !!provider.useToken;
}
function isValueProvider(provider) {
  return provider.useValue != void 0;
}
function isProvider(provider) {
  return isClassProvider(provider) || isValueProvider(provider) || isTokenProvider(provider) || isFactoryProvider(provider);
}
var RegistryBase = function() {
  function RegistryBase2() {
    this._registryMap = /* @__PURE__ */ new Map();
  }
  RegistryBase2.prototype.entries = function() {
    return this._registryMap.entries();
  };
  RegistryBase2.prototype.getAll = function(key) {
    this.ensure(key);
    return this._registryMap.get(key);
  };
  RegistryBase2.prototype.get = function(key) {
    this.ensure(key);
    var value = this._registryMap.get(key);
    return value[value.length - 1] || null;
  };
  RegistryBase2.prototype.set = function(key, value) {
    this.ensure(key);
    this._registryMap.get(key).push(value);
  };
  RegistryBase2.prototype.setAll = function(key, value) {
    this._registryMap.set(key, value);
  };
  RegistryBase2.prototype.has = function(key) {
    this.ensure(key);
    return this._registryMap.get(key).length > 0;
  };
  RegistryBase2.prototype.clear = function() {
    this._registryMap.clear();
  };
  RegistryBase2.prototype.ensure = function(key) {
    if (!this._registryMap.has(key)) {
      this._registryMap.set(key, []);
    }
  };
  return RegistryBase2;
}();
var Registry = function(_super) {
  __extends(Registry2, _super);
  function Registry2() {
    return _super !== null && _super.apply(this, arguments) || this;
  }
  return Registry2;
}(RegistryBase);
var ResolutionContext = function() {
  function ResolutionContext2() {
    this.scopedResolutions = /* @__PURE__ */ new Map();
  }
  return ResolutionContext2;
}();
function formatDependency(params, idx) {
  if (params === null) {
    return "at position #" + idx;
  }
  var argName = params.split(",")[idx].trim();
  return '"' + argName + '" at position #' + idx;
}
function composeErrorMessage(msg, e, indent) {
  if (indent === void 0) {
    indent = "    ";
  }
  return __spread([msg], e.message.split("\n").map(function(l) {
    return indent + l;
  })).join("\n");
}
function formatErrorCtor(ctor, paramIdx, error) {
  var _a3 = __read(ctor.toString().match(/constructor\(([\w, ]+)\)/) || [], 2), _b = _a3[1], params = _b === void 0 ? null : _b;
  var dep = formatDependency(params, paramIdx);
  return composeErrorMessage("Cannot inject the dependency " + dep + ' of "' + ctor.name + '" constructor. Reason:', error);
}
function isDisposable(value) {
  if (typeof value.dispose !== "function")
    return false;
  var disposeFun = value.dispose;
  if (disposeFun.length > 0) {
    return false;
  }
  return true;
}
var PreResolutionInterceptors = function(_super) {
  __extends(PreResolutionInterceptors2, _super);
  function PreResolutionInterceptors2() {
    return _super !== null && _super.apply(this, arguments) || this;
  }
  return PreResolutionInterceptors2;
}(RegistryBase);
var PostResolutionInterceptors = function(_super) {
  __extends(PostResolutionInterceptors2, _super);
  function PostResolutionInterceptors2() {
    return _super !== null && _super.apply(this, arguments) || this;
  }
  return PostResolutionInterceptors2;
}(RegistryBase);
var Interceptors = function() {
  function Interceptors2() {
    this.preResolution = new PreResolutionInterceptors();
    this.postResolution = new PostResolutionInterceptors();
  }
  return Interceptors2;
}();
var typeInfo = /* @__PURE__ */ new Map();
var InternalDependencyContainer = function() {
  function InternalDependencyContainer2(parent) {
    this.parent = parent;
    this._registry = new Registry();
    this.interceptors = new Interceptors();
    this.disposed = false;
    this.disposables = /* @__PURE__ */ new Set();
  }
  InternalDependencyContainer2.prototype.register = function(token, providerOrConstructor, options) {
    if (options === void 0) {
      options = { lifecycle: Lifecycle$1.Transient };
    }
    this.ensureNotDisposed();
    var provider;
    if (!isProvider(providerOrConstructor)) {
      provider = { useClass: providerOrConstructor };
    } else {
      provider = providerOrConstructor;
    }
    if (isTokenProvider(provider)) {
      var path = [token];
      var tokenProvider = provider;
      while (tokenProvider != null) {
        var currentToken = tokenProvider.useToken;
        if (path.includes(currentToken)) {
          throw new Error("Token registration cycle detected! " + __spread(path, [currentToken]).join(" -> "));
        }
        path.push(currentToken);
        var registration = this._registry.get(currentToken);
        if (registration && isTokenProvider(registration.provider)) {
          tokenProvider = registration.provider;
        } else {
          tokenProvider = null;
        }
      }
    }
    if (options.lifecycle === Lifecycle$1.Singleton || options.lifecycle == Lifecycle$1.ContainerScoped || options.lifecycle == Lifecycle$1.ResolutionScoped) {
      if (isValueProvider(provider) || isFactoryProvider(provider)) {
        throw new Error('Cannot use lifecycle "' + Lifecycle$1[options.lifecycle] + '" with ValueProviders or FactoryProviders');
      }
    }
    this._registry.set(token, { provider, options });
    return this;
  };
  InternalDependencyContainer2.prototype.registerType = function(from, to) {
    this.ensureNotDisposed();
    if (isNormalToken(to)) {
      return this.register(from, {
        useToken: to
      });
    }
    return this.register(from, {
      useClass: to
    });
  };
  InternalDependencyContainer2.prototype.registerInstance = function(token, instance2) {
    this.ensureNotDisposed();
    return this.register(token, {
      useValue: instance2
    });
  };
  InternalDependencyContainer2.prototype.registerSingleton = function(from, to) {
    this.ensureNotDisposed();
    if (isNormalToken(from)) {
      if (isNormalToken(to)) {
        return this.register(from, {
          useToken: to
        }, { lifecycle: Lifecycle$1.Singleton });
      } else if (to) {
        return this.register(from, {
          useClass: to
        }, { lifecycle: Lifecycle$1.Singleton });
      }
      throw new Error('Cannot register a type name as a singleton without a "to" token');
    }
    var useClass = from;
    if (to && !isNormalToken(to)) {
      useClass = to;
    }
    return this.register(from, {
      useClass
    }, { lifecycle: Lifecycle$1.Singleton });
  };
  InternalDependencyContainer2.prototype.resolve = function(token, context, isOptional) {
    if (context === void 0) {
      context = new ResolutionContext();
    }
    if (isOptional === void 0) {
      isOptional = false;
    }
    this.ensureNotDisposed();
    var registration = this.getRegistration(token);
    if (!registration && isNormalToken(token)) {
      if (isOptional) {
        return void 0;
      }
      throw new Error('Attempted to resolve unregistered dependency token: "' + token.toString() + '"');
    }
    this.executePreResolutionInterceptor(token, "Single");
    if (registration) {
      var result = this.resolveRegistration(registration, context);
      this.executePostResolutionInterceptor(token, result, "Single");
      return result;
    }
    if (isConstructorToken(token)) {
      var result = this.construct(token, context);
      this.executePostResolutionInterceptor(token, result, "Single");
      return result;
    }
    throw new Error("Attempted to construct an undefined constructor. Could mean a circular dependency problem. Try using `delay` function.");
  };
  InternalDependencyContainer2.prototype.executePreResolutionInterceptor = function(token, resolutionType) {
    var e_1, _a3;
    if (this.interceptors.preResolution.has(token)) {
      var remainingInterceptors = [];
      try {
        for (var _b = __values(this.interceptors.preResolution.getAll(token)), _c = _b.next(); !_c.done; _c = _b.next()) {
          var interceptor = _c.value;
          if (interceptor.options.frequency != "Once") {
            remainingInterceptors.push(interceptor);
          }
          interceptor.callback(token, resolutionType);
        }
      } catch (e_1_1) {
        e_1 = { error: e_1_1 };
      } finally {
        try {
          if (_c && !_c.done && (_a3 = _b.return))
            _a3.call(_b);
        } finally {
          if (e_1)
            throw e_1.error;
        }
      }
      this.interceptors.preResolution.setAll(token, remainingInterceptors);
    }
  };
  InternalDependencyContainer2.prototype.executePostResolutionInterceptor = function(token, result, resolutionType) {
    var e_2, _a3;
    if (this.interceptors.postResolution.has(token)) {
      var remainingInterceptors = [];
      try {
        for (var _b = __values(this.interceptors.postResolution.getAll(token)), _c = _b.next(); !_c.done; _c = _b.next()) {
          var interceptor = _c.value;
          if (interceptor.options.frequency != "Once") {
            remainingInterceptors.push(interceptor);
          }
          interceptor.callback(token, result, resolutionType);
        }
      } catch (e_2_1) {
        e_2 = { error: e_2_1 };
      } finally {
        try {
          if (_c && !_c.done && (_a3 = _b.return))
            _a3.call(_b);
        } finally {
          if (e_2)
            throw e_2.error;
        }
      }
      this.interceptors.postResolution.setAll(token, remainingInterceptors);
    }
  };
  InternalDependencyContainer2.prototype.resolveRegistration = function(registration, context) {
    this.ensureNotDisposed();
    if (registration.options.lifecycle === Lifecycle$1.ResolutionScoped && context.scopedResolutions.has(registration)) {
      return context.scopedResolutions.get(registration);
    }
    var isSingleton = registration.options.lifecycle === Lifecycle$1.Singleton;
    var isContainerScoped = registration.options.lifecycle === Lifecycle$1.ContainerScoped;
    var returnInstance = isSingleton || isContainerScoped;
    var resolved;
    if (isValueProvider(registration.provider)) {
      resolved = registration.provider.useValue;
    } else if (isTokenProvider(registration.provider)) {
      resolved = returnInstance ? registration.instance || (registration.instance = this.resolve(registration.provider.useToken, context)) : this.resolve(registration.provider.useToken, context);
    } else if (isClassProvider(registration.provider)) {
      resolved = returnInstance ? registration.instance || (registration.instance = this.construct(registration.provider.useClass, context)) : this.construct(registration.provider.useClass, context);
    } else if (isFactoryProvider(registration.provider)) {
      resolved = registration.provider.useFactory(this);
    } else {
      resolved = this.construct(registration.provider, context);
    }
    if (registration.options.lifecycle === Lifecycle$1.ResolutionScoped) {
      context.scopedResolutions.set(registration, resolved);
    }
    return resolved;
  };
  InternalDependencyContainer2.prototype.resolveAll = function(token, context, isOptional) {
    var _this = this;
    if (context === void 0) {
      context = new ResolutionContext();
    }
    if (isOptional === void 0) {
      isOptional = false;
    }
    this.ensureNotDisposed();
    var registrations = this.getAllRegistrations(token);
    if (!registrations && isNormalToken(token)) {
      if (isOptional) {
        return [];
      }
      throw new Error('Attempted to resolve unregistered dependency token: "' + token.toString() + '"');
    }
    this.executePreResolutionInterceptor(token, "All");
    if (registrations) {
      var result_1 = registrations.map(function(item) {
        return _this.resolveRegistration(item, context);
      });
      this.executePostResolutionInterceptor(token, result_1, "All");
      return result_1;
    }
    var result = [this.construct(token, context)];
    this.executePostResolutionInterceptor(token, result, "All");
    return result;
  };
  InternalDependencyContainer2.prototype.isRegistered = function(token, recursive) {
    if (recursive === void 0) {
      recursive = false;
    }
    this.ensureNotDisposed();
    return this._registry.has(token) || recursive && (this.parent || false) && this.parent.isRegistered(token, true);
  };
  InternalDependencyContainer2.prototype.reset = function() {
    this.ensureNotDisposed();
    this._registry.clear();
    this.interceptors.preResolution.clear();
    this.interceptors.postResolution.clear();
  };
  InternalDependencyContainer2.prototype.clearInstances = function() {
    var e_3, _a3;
    this.ensureNotDisposed();
    try {
      for (var _b = __values(this._registry.entries()), _c = _b.next(); !_c.done; _c = _b.next()) {
        var _d = __read(_c.value, 2), token = _d[0], registrations = _d[1];
        this._registry.setAll(token, registrations.filter(function(registration) {
          return !isValueProvider(registration.provider);
        }).map(function(registration) {
          registration.instance = void 0;
          return registration;
        }));
      }
    } catch (e_3_1) {
      e_3 = { error: e_3_1 };
    } finally {
      try {
        if (_c && !_c.done && (_a3 = _b.return))
          _a3.call(_b);
      } finally {
        if (e_3)
          throw e_3.error;
      }
    }
  };
  InternalDependencyContainer2.prototype.createChildContainer = function() {
    var e_4, _a3;
    this.ensureNotDisposed();
    var childContainer = new InternalDependencyContainer2(this);
    try {
      for (var _b = __values(this._registry.entries()), _c = _b.next(); !_c.done; _c = _b.next()) {
        var _d = __read(_c.value, 2), token = _d[0], registrations = _d[1];
        if (registrations.some(function(_a4) {
          var options = _a4.options;
          return options.lifecycle === Lifecycle$1.ContainerScoped;
        })) {
          childContainer._registry.setAll(token, registrations.map(function(registration) {
            if (registration.options.lifecycle === Lifecycle$1.ContainerScoped) {
              return {
                provider: registration.provider,
                options: registration.options
              };
            }
            return registration;
          }));
        }
      }
    } catch (e_4_1) {
      e_4 = { error: e_4_1 };
    } finally {
      try {
        if (_c && !_c.done && (_a3 = _b.return))
          _a3.call(_b);
      } finally {
        if (e_4)
          throw e_4.error;
      }
    }
    return childContainer;
  };
  InternalDependencyContainer2.prototype.beforeResolution = function(token, callback, options) {
    if (options === void 0) {
      options = { frequency: "Always" };
    }
    this.interceptors.preResolution.set(token, {
      callback,
      options
    });
  };
  InternalDependencyContainer2.prototype.afterResolution = function(token, callback, options) {
    if (options === void 0) {
      options = { frequency: "Always" };
    }
    this.interceptors.postResolution.set(token, {
      callback,
      options
    });
  };
  InternalDependencyContainer2.prototype.dispose = function() {
    return __awaiter(this, void 0, void 0, function() {
      var promises;
      return __generator(this, function(_a3) {
        switch (_a3.label) {
          case 0:
            this.disposed = true;
            promises = [];
            this.disposables.forEach(function(disposable) {
              var maybePromise = disposable.dispose();
              if (maybePromise) {
                promises.push(maybePromise);
              }
            });
            return [4, Promise.all(promises)];
          case 1:
            _a3.sent();
            return [2];
        }
      });
    });
  };
  InternalDependencyContainer2.prototype.getRegistration = function(token) {
    if (this.isRegistered(token)) {
      return this._registry.get(token);
    }
    if (this.parent) {
      return this.parent.getRegistration(token);
    }
    return null;
  };
  InternalDependencyContainer2.prototype.getAllRegistrations = function(token) {
    if (this.isRegistered(token)) {
      return this._registry.getAll(token);
    }
    if (this.parent) {
      return this.parent.getAllRegistrations(token);
    }
    return null;
  };
  InternalDependencyContainer2.prototype.construct = function(ctor, context) {
    var _this = this;
    if (ctor instanceof DelayedConstructor) {
      return ctor.createProxy(function(target) {
        return _this.resolve(target, context);
      });
    }
    var instance2 = function() {
      var paramInfo = typeInfo.get(ctor);
      if (!paramInfo || paramInfo.length === 0) {
        if (ctor.length === 0) {
          return new ctor();
        } else {
          throw new Error('TypeInfo not known for "' + ctor.name + '"');
        }
      }
      var params = paramInfo.map(_this.resolveParams(context, ctor));
      return new (ctor.bind.apply(ctor, __spread([void 0], params)))();
    }();
    if (isDisposable(instance2)) {
      this.disposables.add(instance2);
    }
    return instance2;
  };
  InternalDependencyContainer2.prototype.resolveParams = function(context, ctor) {
    var _this = this;
    return function(param, idx) {
      var _a3, _b, _c;
      try {
        if (isTokenDescriptor(param)) {
          if (isTransformDescriptor(param)) {
            return param.multiple ? (_a3 = _this.resolve(param.transform)).transform.apply(_a3, __spread([_this.resolveAll(param.token, new ResolutionContext(), param.isOptional)], param.transformArgs)) : (_b = _this.resolve(param.transform)).transform.apply(_b, __spread([_this.resolve(param.token, context, param.isOptional)], param.transformArgs));
          } else {
            return param.multiple ? _this.resolveAll(param.token, new ResolutionContext(), param.isOptional) : _this.resolve(param.token, context, param.isOptional);
          }
        } else if (isTransformDescriptor(param)) {
          return (_c = _this.resolve(param.transform, context)).transform.apply(_c, __spread([_this.resolve(param.token, context)], param.transformArgs));
        }
        return _this.resolve(param, context);
      } catch (e) {
        throw new Error(formatErrorCtor(ctor, idx, e));
      }
    };
  };
  InternalDependencyContainer2.prototype.ensureNotDisposed = function() {
    if (this.disposed) {
      throw new Error("This container has been disposed, you cannot interact with a disposed container");
    }
  };
  return InternalDependencyContainer2;
}();
var instance = new InternalDependencyContainer();
function injectable(options) {
  return function(target) {
    typeInfo.set(target, getParamInfo(target));
    if (options && options.token) {
      if (!Array.isArray(options.token)) {
        instance.register(options.token, target);
      } else {
        options.token.forEach(function(token) {
          instance.register(token, target);
        });
      }
    }
  };
}
if (typeof Reflect === "undefined" || !Reflect.getMetadata) {
  throw new Error(`tsyringe requires a reflect polyfill. Please add 'import "reflect-metadata"' to the top of your entry point.`);
}
var PKCS12AttrSet_1;
class PKCS12Attribute {
  constructor(params = {}) {
    __publicField(this, "attrId", "");
    __publicField(this, "attrValues", []);
    Object.assign(params);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], PKCS12Attribute.prototype, "attrId", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Any,
    repeated: "set"
  })
], PKCS12Attribute.prototype, "attrValues", void 0);
let PKCS12AttrSet = PKCS12AttrSet_1 = class PKCS12AttrSet2 extends AsnArray {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, PKCS12AttrSet_1.prototype);
  }
};
PKCS12AttrSet = PKCS12AttrSet_1 = __decorate([
  AsnType({
    type: AsnTypeTypes.Sequence,
    itemType: PKCS12Attribute
  })
], PKCS12AttrSet);
var AuthenticatedSafe_1;
let AuthenticatedSafe = AuthenticatedSafe_1 = class AuthenticatedSafe2 extends AsnArray {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, AuthenticatedSafe_1.prototype);
  }
};
AuthenticatedSafe = AuthenticatedSafe_1 = __decorate([
  AsnType({
    type: AsnTypeTypes.Sequence,
    itemType: ContentInfo
  })
], AuthenticatedSafe);
class CertBag {
  constructor(params = {}) {
    __publicField(this, "certId", "");
    __publicField(this, "certValue", new ArrayBuffer(0));
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], CertBag.prototype, "certId", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Any,
    context: 0
  })
], CertBag.prototype, "certValue", void 0);
class CRLBag {
  constructor(params = {}) {
    __publicField(this, "crlId", "");
    __publicField(this, "crltValue", new ArrayBuffer(0));
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], CRLBag.prototype, "crlId", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Any,
    context: 0
  })
], CRLBag.prototype, "crltValue", void 0);
class EncryptedData extends OctetString2 {
}
let EncryptedPrivateKeyInfo$1 = class EncryptedPrivateKeyInfo {
  constructor(params = {}) {
    __publicField(this, "encryptionAlgorithm", new AlgorithmIdentifier());
    __publicField(this, "encryptedData", new EncryptedData());
    Object.assign(this, params);
  }
};
__decorate([
  AsnProp({ type: AlgorithmIdentifier })
], EncryptedPrivateKeyInfo$1.prototype, "encryptionAlgorithm", void 0);
__decorate([
  AsnProp({ type: EncryptedData })
], EncryptedPrivateKeyInfo$1.prototype, "encryptedData", void 0);
var Attributes_1$1;
var Version;
(function(Version2) {
  Version2[Version2["v1"] = 0] = "v1";
})(Version || (Version = {}));
class PrivateKey extends OctetString2 {
}
let Attributes$1 = Attributes_1$1 = class Attributes extends AsnArray {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, Attributes_1$1.prototype);
  }
};
Attributes$1 = Attributes_1$1 = __decorate([
  AsnType({
    type: AsnTypeTypes.Sequence,
    itemType: Attribute$2
  })
], Attributes$1);
class PrivateKeyInfo {
  constructor(params = {}) {
    __publicField(this, "version", Version.v1);
    __publicField(this, "privateKeyAlgorithm", new AlgorithmIdentifier());
    __publicField(this, "privateKey", new PrivateKey());
    __publicField(this, "attributes");
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.Integer })
], PrivateKeyInfo.prototype, "version", void 0);
__decorate([
  AsnProp({ type: AlgorithmIdentifier })
], PrivateKeyInfo.prototype, "privateKeyAlgorithm", void 0);
__decorate([
  AsnProp({ type: PrivateKey })
], PrivateKeyInfo.prototype, "privateKey", void 0);
__decorate([
  AsnProp({
    type: Attributes$1,
    implicit: true,
    context: 0,
    optional: true
  })
], PrivateKeyInfo.prototype, "attributes", void 0);
let KeyBag = class KeyBag2 extends PrivateKeyInfo {
};
KeyBag = __decorate([
  AsnType({ type: AsnTypeTypes.Sequence })
], KeyBag);
let PKCS8ShroudedKeyBag = class PKCS8ShroudedKeyBag2 extends EncryptedPrivateKeyInfo$1 {
};
PKCS8ShroudedKeyBag = __decorate([
  AsnType({ type: AsnTypeTypes.Sequence })
], PKCS8ShroudedKeyBag);
class SecretBag {
  constructor(params = {}) {
    __publicField(this, "secretTypeId", "");
    __publicField(this, "secretValue", new ArrayBuffer(0));
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], SecretBag.prototype, "secretTypeId", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Any,
    context: 0
  })
], SecretBag.prototype, "secretValue", void 0);
class MacData {
  constructor(params = {}) {
    __publicField(this, "mac", new DigestInfo());
    __publicField(this, "macSalt", new OctetString2());
    __publicField(this, "iterations", 1);
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: DigestInfo })
], MacData.prototype, "mac", void 0);
__decorate([
  AsnProp({ type: OctetString2 })
], MacData.prototype, "macSalt", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Integer,
    defaultValue: 1
  })
], MacData.prototype, "iterations", void 0);
class PFX {
  constructor(params = {}) {
    __publicField(this, "version", 3);
    __publicField(this, "authSafe", new ContentInfo());
    __publicField(this, "macData", new MacData());
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.Integer })
], PFX.prototype, "version", void 0);
__decorate([
  AsnProp({ type: ContentInfo })
], PFX.prototype, "authSafe", void 0);
__decorate([
  AsnProp({
    type: MacData,
    optional: true
  })
], PFX.prototype, "macData", void 0);
var SafeContents_1;
class SafeBag {
  constructor(params = {}) {
    __publicField(this, "bagId", "");
    __publicField(this, "bagValue", new ArrayBuffer(0));
    __publicField(this, "bagAttributes");
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], SafeBag.prototype, "bagId", void 0);
__decorate([
  AsnProp({
    type: AsnPropTypes.Any,
    context: 0
  })
], SafeBag.prototype, "bagValue", void 0);
__decorate([
  AsnProp({
    type: PKCS12Attribute,
    repeated: "set",
    optional: true
  })
], SafeBag.prototype, "bagAttributes", void 0);
let SafeContents = SafeContents_1 = class SafeContents2 extends AsnArray {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, SafeContents_1.prototype);
  }
};
SafeContents = SafeContents_1 = __decorate([
  AsnType({
    type: AsnTypeTypes.Sequence,
    itemType: SafeBag
  })
], SafeContents);
var ExtensionRequest_1, ExtendedCertificateAttributes_1, SMIMECapabilities_1;
const id_pkcs9 = "1.2.840.113549.1.9";
const id_pkcs9_at_challengePassword = `${id_pkcs9}.7`;
const id_pkcs9_at_extensionRequest = `${id_pkcs9}.14`;
let PKCS9String = class PKCS9String2 extends DirectoryString {
  constructor(params = {}) {
    super(params);
    __publicField(this, "ia5String");
  }
  toString() {
    return this.ia5String || super.toString();
  }
};
__decorate([
  AsnProp({ type: AsnPropTypes.IA5String })
], PKCS9String.prototype, "ia5String", void 0);
PKCS9String = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], PKCS9String);
let Pkcs7PDU = class Pkcs7PDU2 extends ContentInfo {
};
Pkcs7PDU = __decorate([
  AsnType({ type: AsnTypeTypes.Sequence })
], Pkcs7PDU);
let UserPKCS12 = class UserPKCS122 extends PFX {
};
UserPKCS12 = __decorate([
  AsnType({ type: AsnTypeTypes.Sequence })
], UserPKCS12);
let EncryptedPrivateKeyInfo2 = class EncryptedPrivateKeyInfo3 extends EncryptedPrivateKeyInfo$1 {
};
EncryptedPrivateKeyInfo2 = __decorate([
  AsnType({ type: AsnTypeTypes.Sequence })
], EncryptedPrivateKeyInfo2);
let EmailAddress = class EmailAddress2 {
  constructor(value = "") {
    __publicField(this, "value");
    this.value = value;
  }
  toString() {
    return this.value;
  }
};
__decorate([
  AsnProp({ type: AsnPropTypes.IA5String })
], EmailAddress.prototype, "value", void 0);
EmailAddress = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], EmailAddress);
let UnstructuredName = class UnstructuredName2 extends PKCS9String {
};
UnstructuredName = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], UnstructuredName);
let UnstructuredAddress = class UnstructuredAddress2 extends DirectoryString {
};
UnstructuredAddress = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], UnstructuredAddress);
let DateOfBirth = class DateOfBirth2 {
  constructor(value = /* @__PURE__ */ new Date()) {
    __publicField(this, "value");
    this.value = value;
  }
};
__decorate([
  AsnProp({ type: AsnPropTypes.GeneralizedTime })
], DateOfBirth.prototype, "value", void 0);
DateOfBirth = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], DateOfBirth);
let PlaceOfBirth = class PlaceOfBirth2 extends DirectoryString {
};
PlaceOfBirth = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], PlaceOfBirth);
let Gender = class Gender2 {
  constructor(value = "M") {
    __publicField(this, "value");
    this.value = value;
  }
  toString() {
    return this.value;
  }
};
__decorate([
  AsnProp({ type: AsnPropTypes.PrintableString })
], Gender.prototype, "value", void 0);
Gender = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], Gender);
let CountryOfCitizenship = class CountryOfCitizenship2 {
  constructor(value = "") {
    __publicField(this, "value");
    this.value = value;
  }
  toString() {
    return this.value;
  }
};
__decorate([
  AsnProp({ type: AsnPropTypes.PrintableString })
], CountryOfCitizenship.prototype, "value", void 0);
CountryOfCitizenship = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], CountryOfCitizenship);
let CountryOfResidence = class CountryOfResidence2 extends CountryOfCitizenship {
};
CountryOfResidence = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], CountryOfResidence);
let Pseudonym = class Pseudonym2 extends DirectoryString {
};
Pseudonym = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], Pseudonym);
let ContentType = class ContentType2 {
  constructor(value = "") {
    __publicField(this, "value");
    this.value = value;
  }
  toString() {
    return this.value;
  }
};
__decorate([
  AsnProp({ type: AsnPropTypes.ObjectIdentifier })
], ContentType.prototype, "value", void 0);
ContentType = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], ContentType);
let SigningTime2 = class SigningTime3 extends Time {
};
SigningTime2 = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], SigningTime2);
let SequenceNumber = class SequenceNumber2 {
  constructor(value = 0) {
    __publicField(this, "value");
    this.value = value;
  }
  toString() {
    return this.value.toString();
  }
};
__decorate([
  AsnProp({ type: AsnPropTypes.Integer })
], SequenceNumber.prototype, "value", void 0);
SequenceNumber = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], SequenceNumber);
let CounterSignature2 = class CounterSignature3 extends SignerInfo {
};
CounterSignature2 = __decorate([
  AsnType({ type: AsnTypeTypes.Sequence })
], CounterSignature2);
let ChallengePassword = class ChallengePassword2 extends DirectoryString {
};
ChallengePassword = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], ChallengePassword);
let ExtensionRequest = ExtensionRequest_1 = class ExtensionRequest2 extends Extensions {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, ExtensionRequest_1.prototype);
  }
};
ExtensionRequest = ExtensionRequest_1 = __decorate([
  AsnType({ type: AsnTypeTypes.Sequence })
], ExtensionRequest);
let ExtendedCertificateAttributes = ExtendedCertificateAttributes_1 = class ExtendedCertificateAttributes2 extends AsnArray {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, ExtendedCertificateAttributes_1.prototype);
  }
};
ExtendedCertificateAttributes = ExtendedCertificateAttributes_1 = __decorate([
  AsnType({
    type: AsnTypeTypes.Set,
    itemType: Attribute$1
  })
], ExtendedCertificateAttributes);
let FriendlyName = class FriendlyName2 {
  constructor(value = "") {
    __publicField(this, "value");
    this.value = value;
  }
  toString() {
    return this.value;
  }
};
__decorate([
  AsnProp({ type: AsnPropTypes.BmpString })
], FriendlyName.prototype, "value", void 0);
FriendlyName = __decorate([
  AsnType({ type: AsnTypeTypes.Choice })
], FriendlyName);
let SMIMECapability = class SMIMECapability2 extends AlgorithmIdentifier {
};
SMIMECapability = __decorate([
  AsnType({ type: AsnTypeTypes.Sequence })
], SMIMECapability);
let SMIMECapabilities = SMIMECapabilities_1 = class SMIMECapabilities2 extends AsnArray {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, SMIMECapabilities_1.prototype);
  }
};
SMIMECapabilities = SMIMECapabilities_1 = __decorate([
  AsnType({
    type: AsnTypeTypes.Sequence,
    itemType: SMIMECapability
  })
], SMIMECapabilities);
var Attributes_1;
let Attributes2 = Attributes_1 = class Attributes3 extends AsnArray {
  constructor(items) {
    super(items);
    Object.setPrototypeOf(this, Attributes_1.prototype);
  }
};
Attributes2 = Attributes_1 = __decorate([
  AsnType({
    type: AsnTypeTypes.Sequence,
    itemType: Attribute$2
  })
], Attributes2);
class CertificationRequestInfo {
  constructor(params = {}) {
    __publicField(this, "version", 0);
    __publicField(this, "subject", new Name$1());
    __publicField(this, "subjectPKInfo", new SubjectPublicKeyInfo());
    __publicField(this, "attributes", new Attributes2());
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({ type: AsnPropTypes.Integer })
], CertificationRequestInfo.prototype, "version", void 0);
__decorate([
  AsnProp({ type: Name$1 })
], CertificationRequestInfo.prototype, "subject", void 0);
__decorate([
  AsnProp({ type: SubjectPublicKeyInfo })
], CertificationRequestInfo.prototype, "subjectPKInfo", void 0);
__decorate([
  AsnProp({
    type: Attributes2,
    implicit: true,
    context: 0,
    optional: true
  })
], CertificationRequestInfo.prototype, "attributes", void 0);
class CertificationRequest {
  constructor(params = {}) {
    __publicField(this, "certificationRequestInfo", new CertificationRequestInfo());
    __publicField(this, "certificationRequestInfoRaw");
    __publicField(this, "signatureAlgorithm", new AlgorithmIdentifier());
    __publicField(this, "signature", new ArrayBuffer(0));
    Object.assign(this, params);
  }
}
__decorate([
  AsnProp({
    type: CertificationRequestInfo,
    raw: true
  })
], CertificationRequest.prototype, "certificationRequestInfo", void 0);
__decorate([
  AsnProp({ type: AlgorithmIdentifier })
], CertificationRequest.prototype, "signatureAlgorithm", void 0);
__decorate([
  AsnProp({ type: AsnPropTypes.BitString })
], CertificationRequest.prototype, "signature", void 0);
/*!
 * MIT License
 * 
 * Copyright (c) Peculiar Ventures. All rights reserved.
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 * 
 */
const diAlgorithm = "crypto.algorithm";
class AlgorithmProvider {
  getAlgorithms() {
    return instance.resolveAll(diAlgorithm);
  }
  toAsnAlgorithm(alg) {
    ({ ...alg });
    for (const algorithm of this.getAlgorithms()) {
      const res = algorithm.toAsnAlgorithm(alg);
      if (res) {
        return res;
      }
    }
    if (/^[0-9.]+$/.test(alg.name)) {
      const res = new AlgorithmIdentifier({ algorithm: alg.name });
      if ("parameters" in alg) {
        const unknown = alg;
        res.parameters = unknown.parameters;
      }
      return res;
    }
    throw new Error("Cannot convert WebCrypto algorithm to ASN.1 algorithm");
  }
  toWebAlgorithm(alg) {
    for (const algorithm of this.getAlgorithms()) {
      const res = algorithm.toWebAlgorithm(alg);
      if (res) {
        return res;
      }
    }
    const unknown = {
      name: alg.algorithm,
      parameters: alg.parameters
    };
    return unknown;
  }
}
const diAlgorithmProvider = "crypto.algorithmProvider";
instance.registerSingleton(diAlgorithmProvider, AlgorithmProvider);
var EcAlgorithm_1;
const idVersionOne = "1.3.36.3.3.2.8.1.1";
const idBrainpoolP160r1 = `${idVersionOne}.1`;
const idBrainpoolP160t1 = `${idVersionOne}.2`;
const idBrainpoolP192r1 = `${idVersionOne}.3`;
const idBrainpoolP192t1 = `${idVersionOne}.4`;
const idBrainpoolP224r1 = `${idVersionOne}.5`;
const idBrainpoolP224t1 = `${idVersionOne}.6`;
const idBrainpoolP256r1 = `${idVersionOne}.7`;
const idBrainpoolP256t1 = `${idVersionOne}.8`;
const idBrainpoolP320r1 = `${idVersionOne}.9`;
const idBrainpoolP320t1 = `${idVersionOne}.10`;
const idBrainpoolP384r1 = `${idVersionOne}.11`;
const idBrainpoolP384t1 = `${idVersionOne}.12`;
const idBrainpoolP512r1 = `${idVersionOne}.13`;
const idBrainpoolP512t1 = `${idVersionOne}.14`;
const brainpoolP160r1 = "brainpoolP160r1";
const brainpoolP160t1 = "brainpoolP160t1";
const brainpoolP192r1 = "brainpoolP192r1";
const brainpoolP192t1 = "brainpoolP192t1";
const brainpoolP224r1 = "brainpoolP224r1";
const brainpoolP224t1 = "brainpoolP224t1";
const brainpoolP256r1 = "brainpoolP256r1";
const brainpoolP256t1 = "brainpoolP256t1";
const brainpoolP320r1 = "brainpoolP320r1";
const brainpoolP320t1 = "brainpoolP320t1";
const brainpoolP384r1 = "brainpoolP384r1";
const brainpoolP384t1 = "brainpoolP384t1";
const brainpoolP512r1 = "brainpoolP512r1";
const brainpoolP512t1 = "brainpoolP512t1";
const ECDSA = "ECDSA";
let EcAlgorithm = EcAlgorithm_1 = class EcAlgorithm2 {
  toAsnAlgorithm(alg) {
    switch (alg.name.toLowerCase()) {
      case ECDSA.toLowerCase():
        if ("hash" in alg) {
          const hash = typeof alg.hash === "string" ? alg.hash : alg.hash.name;
          switch (hash.toLowerCase()) {
            case "sha-1":
              return ecdsaWithSHA1;
            case "sha-256":
              return ecdsaWithSHA256;
            case "sha-384":
              return ecdsaWithSHA384;
            case "sha-512":
              return ecdsaWithSHA512;
          }
        } else if ("namedCurve" in alg) {
          let parameters = "";
          switch (alg.namedCurve) {
            case "P-256":
              parameters = id_secp256r1;
              break;
            case "K-256":
              parameters = EcAlgorithm_1.SECP256K1;
              break;
            case "P-384":
              parameters = id_secp384r1;
              break;
            case "P-521":
              parameters = id_secp521r1;
              break;
            case brainpoolP160r1:
              parameters = idBrainpoolP160r1;
              break;
            case brainpoolP160t1:
              parameters = idBrainpoolP160t1;
              break;
            case brainpoolP192r1:
              parameters = idBrainpoolP192r1;
              break;
            case brainpoolP192t1:
              parameters = idBrainpoolP192t1;
              break;
            case brainpoolP224r1:
              parameters = idBrainpoolP224r1;
              break;
            case brainpoolP224t1:
              parameters = idBrainpoolP224t1;
              break;
            case brainpoolP256r1:
              parameters = idBrainpoolP256r1;
              break;
            case brainpoolP256t1:
              parameters = idBrainpoolP256t1;
              break;
            case brainpoolP320r1:
              parameters = idBrainpoolP320r1;
              break;
            case brainpoolP320t1:
              parameters = idBrainpoolP320t1;
              break;
            case brainpoolP384r1:
              parameters = idBrainpoolP384r1;
              break;
            case brainpoolP384t1:
              parameters = idBrainpoolP384t1;
              break;
            case brainpoolP512r1:
              parameters = idBrainpoolP512r1;
              break;
            case brainpoolP512t1:
              parameters = idBrainpoolP512t1;
              break;
          }
          if (parameters) {
            return new AlgorithmIdentifier({
              algorithm: id_ecPublicKey,
              parameters: AsnConvert.serialize(new ECParameters({ namedCurve: parameters }))
            });
          }
        }
    }
    return null;
  }
  toWebAlgorithm(alg) {
    switch (alg.algorithm) {
      case id_ecdsaWithSHA1:
        return {
          name: ECDSA,
          hash: { name: "SHA-1" }
        };
      case id_ecdsaWithSHA256:
        return {
          name: ECDSA,
          hash: { name: "SHA-256" }
        };
      case id_ecdsaWithSHA384:
        return {
          name: ECDSA,
          hash: { name: "SHA-384" }
        };
      case id_ecdsaWithSHA512:
        return {
          name: ECDSA,
          hash: { name: "SHA-512" }
        };
      case id_ecPublicKey: {
        if (!alg.parameters) {
          throw new TypeError("Cannot get required parameters from EC algorithm");
        }
        const parameters = AsnConvert.parse(alg.parameters, ECParameters);
        switch (parameters.namedCurve) {
          case id_secp256r1:
            return {
              name: ECDSA,
              namedCurve: "P-256"
            };
          case EcAlgorithm_1.SECP256K1:
            return {
              name: ECDSA,
              namedCurve: "K-256"
            };
          case id_secp384r1:
            return {
              name: ECDSA,
              namedCurve: "P-384"
            };
          case id_secp521r1:
            return {
              name: ECDSA,
              namedCurve: "P-521"
            };
          case idBrainpoolP160r1:
            return {
              name: ECDSA,
              namedCurve: brainpoolP160r1
            };
          case idBrainpoolP160t1:
            return {
              name: ECDSA,
              namedCurve: brainpoolP160t1
            };
          case idBrainpoolP192r1:
            return {
              name: ECDSA,
              namedCurve: brainpoolP192r1
            };
          case idBrainpoolP192t1:
            return {
              name: ECDSA,
              namedCurve: brainpoolP192t1
            };
          case idBrainpoolP224r1:
            return {
              name: ECDSA,
              namedCurve: brainpoolP224r1
            };
          case idBrainpoolP224t1:
            return {
              name: ECDSA,
              namedCurve: brainpoolP224t1
            };
          case idBrainpoolP256r1:
            return {
              name: ECDSA,
              namedCurve: brainpoolP256r1
            };
          case idBrainpoolP256t1:
            return {
              name: ECDSA,
              namedCurve: brainpoolP256t1
            };
          case idBrainpoolP320r1:
            return {
              name: ECDSA,
              namedCurve: brainpoolP320r1
            };
          case idBrainpoolP320t1:
            return {
              name: ECDSA,
              namedCurve: brainpoolP320t1
            };
          case idBrainpoolP384r1:
            return {
              name: ECDSA,
              namedCurve: brainpoolP384r1
            };
          case idBrainpoolP384t1:
            return {
              name: ECDSA,
              namedCurve: brainpoolP384t1
            };
          case idBrainpoolP512r1:
            return {
              name: ECDSA,
              namedCurve: brainpoolP512r1
            };
          case idBrainpoolP512t1:
            return {
              name: ECDSA,
              namedCurve: brainpoolP512t1
            };
        }
      }
    }
    return null;
  }
};
EcAlgorithm.SECP256K1 = "1.3.132.0.10";
EcAlgorithm = EcAlgorithm_1 = __decorate([
  injectable()
], EcAlgorithm);
instance.registerSingleton(diAlgorithm, EcAlgorithm);
const NAME = Symbol("name");
const VALUE = Symbol("value");
class TextObject {
  constructor(name, items = {}, value = "") {
    this[NAME] = name;
    this[VALUE] = value;
    for (const key in items) {
      this[key] = items[key];
    }
  }
}
TextObject.NAME = NAME;
TextObject.VALUE = VALUE;
class DefaultAlgorithmSerializer {
  static toTextObject(alg) {
    const obj = new TextObject("Algorithm Identifier", {}, OidSerializer.toString(alg.algorithm));
    if (alg.parameters) {
      switch (alg.algorithm) {
        case id_ecPublicKey: {
          const ecAlg = new EcAlgorithm().toWebAlgorithm(alg);
          if (ecAlg && "namedCurve" in ecAlg) {
            obj["Named Curve"] = ecAlg.namedCurve;
          } else {
            obj["Parameters"] = alg.parameters;
          }
          break;
        }
        default:
          obj["Parameters"] = alg.parameters;
      }
    }
    return obj;
  }
}
class OidSerializer {
  static toString(oid) {
    const name = this.items[oid];
    if (name) {
      return name;
    }
    return oid;
  }
}
OidSerializer.items = {
  [id_sha1]: "sha1",
  [id_sha224]: "sha224",
  [id_sha256]: "sha256",
  [id_sha384]: "sha384",
  [id_sha512]: "sha512",
  [id_rsaEncryption]: "rsaEncryption",
  [id_sha1WithRSAEncryption]: "sha1WithRSAEncryption",
  [id_sha224WithRSAEncryption]: "sha224WithRSAEncryption",
  [id_sha256WithRSAEncryption]: "sha256WithRSAEncryption",
  [id_sha384WithRSAEncryption]: "sha384WithRSAEncryption",
  [id_sha512WithRSAEncryption]: "sha512WithRSAEncryption",
  [id_ecPublicKey]: "ecPublicKey",
  [id_ecdsaWithSHA1]: "ecdsaWithSHA1",
  [id_ecdsaWithSHA224]: "ecdsaWithSHA224",
  [id_ecdsaWithSHA256]: "ecdsaWithSHA256",
  [id_ecdsaWithSHA384]: "ecdsaWithSHA384",
  [id_ecdsaWithSHA512]: "ecdsaWithSHA512",
  [id_kp_serverAuth]: "TLS WWW server authentication",
  [id_kp_clientAuth]: "TLS WWW client authentication",
  [id_kp_codeSigning]: "Code Signing",
  [id_kp_emailProtection]: "E-mail Protection",
  [id_kp_timeStamping]: "Time Stamping",
  [id_kp_OCSPSigning]: "OCSP Signing",
  [id_signedData]: "Signed Data"
};
class TextConverter {
  static serialize(obj) {
    return this.serializeObj(obj).join("\n");
  }
  static pad(deep = 0) {
    return "".padStart(2 * deep, " ");
  }
  static serializeObj(obj, deep = 0) {
    const res = [];
    let pad = this.pad(deep++);
    let value = "";
    const objValue = obj[TextObject.VALUE];
    if (objValue) {
      value = ` ${objValue}`;
    }
    res.push(`${pad}${obj[TextObject.NAME]}:${value}`);
    pad = this.pad(deep);
    for (const key in obj) {
      if (typeof key === "symbol") {
        continue;
      }
      const value2 = obj[key];
      const keyValue = key ? `${key}: ` : "";
      if (typeof value2 === "string" || typeof value2 === "number" || typeof value2 === "boolean") {
        res.push(`${pad}${keyValue}${value2}`);
      } else if (value2 instanceof Date) {
        res.push(`${pad}${keyValue}${value2.toUTCString()}`);
      } else if (Array.isArray(value2)) {
        for (const obj2 of value2) {
          obj2[TextObject.NAME] = key;
          res.push(...this.serializeObj(obj2, deep));
        }
      } else if (value2 instanceof TextObject) {
        value2[TextObject.NAME] = key;
        res.push(...this.serializeObj(value2, deep));
      } else if (BufferSourceConverter.isBufferSource(value2)) {
        if (key) {
          res.push(`${pad}${keyValue}`);
          res.push(...this.serializeBufferSource(value2, deep + 1));
        } else {
          res.push(...this.serializeBufferSource(value2, deep));
        }
      } else if ("toTextObject" in value2) {
        const obj2 = value2.toTextObject();
        obj2[TextObject.NAME] = key;
        res.push(...this.serializeObj(obj2, deep));
      } else {
        throw new TypeError("Cannot serialize data in text format. Unsupported type.");
      }
    }
    return res;
  }
  static serializeBufferSource(buffer, deep = 0) {
    const pad = this.pad(deep);
    const view = BufferSourceConverter.toUint8Array(buffer);
    const res = [];
    for (let i = 0; i < view.length; ) {
      const row = [];
      for (let j = 0; j < 16 && i < view.length; j++) {
        if (j === 8) {
          row.push("");
        }
        const hex = view[i++].toString(16).padStart(2, "0");
        row.push(hex);
      }
      res.push(`${pad}${row.join(" ")}`);
    }
    return res;
  }
  static serializeAlgorithm(alg) {
    return this.algorithmSerializer.toTextObject(alg);
  }
}
TextConverter.oidSerializer = OidSerializer;
TextConverter.algorithmSerializer = DefaultAlgorithmSerializer;
var _AsnData_rawData;
class AsnData {
  get rawData() {
    if (!__classPrivateFieldGet(this, _AsnData_rawData, "f")) {
      __classPrivateFieldSet(this, _AsnData_rawData, AsnConvert.serialize(this.asn), "f");
    }
    return __classPrivateFieldGet(this, _AsnData_rawData, "f");
  }
  constructor(...args) {
    _AsnData_rawData.set(this, void 0);
    if (BufferSourceConverter.isBufferSource(args[0])) {
      this.asn = AsnConvert.parse(args[0], args[1]);
      __classPrivateFieldSet(this, _AsnData_rawData, BufferSourceConverter.toArrayBuffer(args[0]), "f");
      this.onInit(this.asn);
    } else {
      this.asn = args[0];
      this.onInit(this.asn);
    }
  }
  equal(data) {
    if (data instanceof AsnData) {
      return isEqual(data.rawData, this.rawData);
    }
    return false;
  }
  toString(format = "text") {
    switch (format) {
      case "asn":
        return AsnConvert.toString(this.rawData);
      case "text":
        return TextConverter.serialize(this.toTextObject());
      case "hex":
        return Convert.ToHex(this.rawData);
      case "base64":
        return Convert.ToBase64(this.rawData);
      case "base64url":
        return Convert.ToBase64Url(this.rawData);
      default:
        throw TypeError("Argument 'format' is unsupported value");
    }
  }
  getTextName() {
    const constructor = this.constructor;
    return constructor.NAME;
  }
  toTextObject() {
    const obj = this.toTextObjectEmpty();
    obj[""] = this.rawData;
    return obj;
  }
  toTextObjectEmpty(value) {
    return new TextObject(this.getTextName(), {}, value);
  }
}
_AsnData_rawData = /* @__PURE__ */ new WeakMap();
AsnData.NAME = "ASN";
class Extension extends AsnData {
  constructor(...args) {
    let raw;
    if (BufferSourceConverter.isBufferSource(args[0])) {
      raw = BufferSourceConverter.toArrayBuffer(args[0]);
    } else {
      raw = AsnConvert.serialize(new Extension$1({
        extnID: args[0],
        critical: args[1],
        extnValue: new OctetString2(BufferSourceConverter.toArrayBuffer(args[2]))
      }));
    }
    super(raw, Extension$1);
  }
  onInit(asn) {
    this.type = asn.extnID;
    this.critical = asn.critical;
    this.value = asn.extnValue.buffer;
  }
  toTextObject() {
    const obj = this.toTextObjectWithoutValue();
    obj[""] = this.value;
    return obj;
  }
  toTextObjectWithoutValue() {
    const obj = this.toTextObjectEmpty(this.critical ? "critical" : void 0);
    if (obj[TextObject.NAME] === Extension.NAME) {
      obj[TextObject.NAME] = OidSerializer.toString(this.type);
    }
    return obj;
  }
}
var _a2;
class CryptoProvider {
  static isCryptoKeyPair(data) {
    return data && data.privateKey && data.publicKey;
  }
  static isCryptoKey(data) {
    return data && data.usages && data.type && data.algorithm && data.extractable !== void 0;
  }
  constructor() {
    this.items = /* @__PURE__ */ new Map();
    this[_a2] = "CryptoProvider";
    if (typeof self !== "undefined" && typeof crypto !== "undefined") {
      this.set(CryptoProvider.DEFAULT, crypto);
    } else if (typeof global !== "undefined" && global.crypto && global.crypto.subtle) {
      this.set(CryptoProvider.DEFAULT, global.crypto);
    }
  }
  clear() {
    this.items.clear();
  }
  delete(key) {
    return this.items.delete(key);
  }
  forEach(callbackfn, thisArg) {
    return this.items.forEach(callbackfn, thisArg);
  }
  has(key) {
    return this.items.has(key);
  }
  get size() {
    return this.items.size;
  }
  entries() {
    return this.items.entries();
  }
  keys() {
    return this.items.keys();
  }
  values() {
    return this.items.values();
  }
  [Symbol.iterator]() {
    return this.items[Symbol.iterator]();
  }
  get(key = CryptoProvider.DEFAULT) {
    const crypto2 = this.items.get(key.toLowerCase());
    if (!crypto2) {
      throw new Error(`Cannot get Crypto by name '${key}'`);
    }
    return crypto2;
  }
  set(key, value) {
    if (typeof key === "string") {
      if (!value) {
        throw new TypeError("Argument 'value' is required");
      }
      this.items.set(key.toLowerCase(), value);
    } else {
      this.items.set(CryptoProvider.DEFAULT, key);
    }
    return this;
  }
}
_a2 = Symbol.toStringTag;
CryptoProvider.DEFAULT = "default";
const cryptoProvider = new CryptoProvider();
const OID_REGEX = /^[0-2](?:\.[1-9][0-9]*)+$/;
function isOID(id) {
  return new RegExp(OID_REGEX).test(id);
}
class NameIdentifier {
  constructor(names2 = {}) {
    this.items = {};
    for (const id in names2) {
      this.register(id, names2[id]);
    }
  }
  get(idOrName) {
    return this.items[idOrName] || null;
  }
  findId(idOrName) {
    if (!isOID(idOrName)) {
      return this.get(idOrName);
    }
    return idOrName;
  }
  register(id, name) {
    this.items[id] = name;
    this.items[name] = id;
  }
}
const names = new NameIdentifier();
names.register("CN", "2.5.4.3");
names.register("L", "2.5.4.7");
names.register("ST", "2.5.4.8");
names.register("O", "2.5.4.10");
names.register("OU", "2.5.4.11");
names.register("C", "2.5.4.6");
names.register("DC", "0.9.2342.19200300.100.1.25");
names.register("E", "1.2.840.113549.1.9.1");
names.register("G", "2.5.4.42");
names.register("I", "2.5.4.43");
names.register("SN", "2.5.4.4");
names.register("T", "2.5.4.12");
function replaceUnknownCharacter(text, char) {
  return `\\${Convert.ToHex(Convert.FromUtf8String(char)).toUpperCase()}`;
}
function escape$1(data) {
  return data.replace(/([,+"\\<>;])/g, "\\$1").replace(/^([ #])/, "\\$1").replace(/([ ]$)/, "\\$1").replace(/([\r\n\t])/, replaceUnknownCharacter);
}
class Name2 {
  static isASCII(text) {
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code > 255) {
        return false;
      }
    }
    return true;
  }
  static isPrintableString(text) {
    return /^[A-Za-z0-9 '()+,-./:=?]*$/g.test(text);
  }
  constructor(data, extraNames = {}) {
    this.extraNames = new NameIdentifier();
    this.asn = new Name$1();
    for (const key in extraNames) {
      if (Object.prototype.hasOwnProperty.call(extraNames, key)) {
        const value = extraNames[key];
        this.extraNames.register(key, value);
      }
    }
    if (typeof data === "string") {
      this.asn = this.fromString(data);
    } else if (data instanceof Name$1) {
      this.asn = data;
    } else if (BufferSourceConverter.isBufferSource(data)) {
      this.asn = AsnConvert.parse(data, Name$1);
    } else {
      this.asn = this.fromJSON(data);
    }
  }
  getField(idOrName) {
    const id = this.extraNames.findId(idOrName) || names.findId(idOrName);
    const res = [];
    for (const name of this.asn) {
      for (const rdn of name) {
        if (rdn.type === id) {
          res.push(rdn.value.toString());
        }
      }
    }
    return res;
  }
  getName(idOrName) {
    return this.extraNames.get(idOrName) || names.get(idOrName);
  }
  toString() {
    return this.asn.map((rdn) => rdn.map((o) => {
      const type = this.getName(o.type) || o.type;
      const value = o.value.anyValue ? `#${Convert.ToHex(o.value.anyValue)}` : escape$1(o.value.toString());
      return `${type}=${value}`;
    }).join("+")).join(", ");
  }
  toJSON() {
    var _a3;
    const json = [];
    for (const rdn of this.asn) {
      const jsonItem = {};
      for (const attr of rdn) {
        const type = this.getName(attr.type) || attr.type;
        (_a3 = jsonItem[type]) !== null && _a3 !== void 0 ? _a3 : jsonItem[type] = [];
        jsonItem[type].push(attr.value.anyValue ? `#${Convert.ToHex(attr.value.anyValue)}` : attr.value.toString());
      }
      json.push(jsonItem);
    }
    return json;
  }
  fromString(data) {
    const asn = new Name$1();
    const regex = /(\d\.[\d.]*\d|[A-Za-z]+)=((?:"")|(?:".*?[^\\]")|(?:[^,+"\\](?=[,+]|$))|(?:[^,+].*?(?:[^\\][,+]))|(?:))([,+])?/g;
    let matches = null;
    let level = ",";
    while (matches = regex.exec(`${data},`)) {
      let [, type, value] = matches;
      const lastChar = value[value.length - 1];
      if (lastChar === "," || lastChar === "+") {
        value = value.slice(0, value.length - 1);
        matches[3] = lastChar;
      }
      const next = matches[3];
      type = this.getTypeOid(type);
      const attr = this.createAttribute(type, value);
      if (level === "+") {
        asn[asn.length - 1].push(attr);
      } else {
        asn.push(new RelativeDistinguishedName([attr]));
      }
      level = next;
    }
    return asn;
  }
  fromJSON(data) {
    const asn = new Name$1();
    for (const item of data) {
      const asnRdn = new RelativeDistinguishedName();
      for (const type in item) {
        const typeId = this.getTypeOid(type);
        const values = item[type];
        for (const value of values) {
          const asnAttr = this.createAttribute(typeId, value);
          asnRdn.push(asnAttr);
        }
      }
      asn.push(asnRdn);
    }
    return asn;
  }
  getTypeOid(type) {
    if (!/[\d.]+/.test(type)) {
      type = this.getName(type) || "";
    }
    if (!type) {
      throw new Error(`Cannot get OID for name type '${type}'`);
    }
    return type;
  }
  createAttribute(type, value) {
    const attr = new AttributeTypeAndValue({ type });
    if (typeof value === "object") {
      for (const key in value) {
        switch (key) {
          case "ia5String":
            attr.value.ia5String = value[key];
            break;
          case "utf8String":
            attr.value.utf8String = value[key];
            break;
          case "universalString":
            attr.value.universalString = value[key];
            break;
          case "bmpString":
            attr.value.bmpString = value[key];
            break;
          case "printableString":
            attr.value.printableString = value[key];
            break;
        }
      }
    } else if (value[0] === "#") {
      attr.value.anyValue = Convert.FromHex(value.slice(1));
    } else {
      const processedValue = this.processStringValue(value);
      if (type === this.getName("E") || type === this.getName("DC")) {
        attr.value.ia5String = processedValue;
      } else {
        if (Name2.isPrintableString(processedValue)) {
          attr.value.printableString = processedValue;
        } else {
          attr.value.utf8String = processedValue;
        }
      }
    }
    return attr;
  }
  processStringValue(value) {
    const quotedMatches = /"(.*?[^\\])?"/.exec(value);
    if (quotedMatches) {
      value = quotedMatches[1];
    }
    return value.replace(/\\0a/ig, "\n").replace(/\\0d/ig, "\r").replace(/\\0g/ig, "	").replace(/\\(.)/g, "$1");
  }
  toArrayBuffer() {
    return AsnConvert.serialize(this.asn);
  }
  async getThumbprint(...args) {
    var _a3;
    let crypto2;
    let algorithm = "SHA-1";
    if (args.length >= 1 && !((_a3 = args[0]) === null || _a3 === void 0 ? void 0 : _a3.subtle)) {
      algorithm = args[0] || algorithm;
      crypto2 = args[1] || cryptoProvider.get();
    } else {
      crypto2 = args[0] || cryptoProvider.get();
    }
    return await crypto2.subtle.digest(algorithm, this.toArrayBuffer());
  }
}
const ERR_GN_CONSTRUCTOR = "Cannot initialize GeneralName from ASN.1 data.";
const ERR_GN_STRING_FORMAT = `${ERR_GN_CONSTRUCTOR} Unsupported string format in use.`;
const ERR_GUID = `${ERR_GN_CONSTRUCTOR} Value doesn't match to GUID regular expression.`;
const GUID_REGEX = /^([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})$/i;
const id_GUID = "1.3.6.1.4.1.311.25.1";
const id_UPN = "1.3.6.1.4.1.311.20.2.3";
const DNS = "dns";
const DN = "dn";
const EMAIL = "email";
const IP = "ip";
const URL = "url";
const GUID = "guid";
const UPN = "upn";
const REGISTERED_ID = "id";
class GeneralName2 extends AsnData {
  constructor(...args) {
    let name;
    if (args.length === 2) {
      switch (args[0]) {
        case DN: {
          const derName = new Name2(args[1]).toArrayBuffer();
          const asnName = AsnConvert.parse(derName, Name$1);
          name = new GeneralName$1({ directoryName: asnName });
          break;
        }
        case DNS:
          name = new GeneralName$1({ dNSName: args[1] });
          break;
        case EMAIL:
          name = new GeneralName$1({ rfc822Name: args[1] });
          break;
        case GUID: {
          const matches = new RegExp(GUID_REGEX, "i").exec(args[1]);
          if (!matches) {
            throw new Error("Cannot parse GUID value. Value doesn't match to regular expression");
          }
          const hex = matches.slice(1).map((o, i) => {
            if (i < 3) {
              return Convert.ToHex(new Uint8Array(Convert.FromHex(o)).reverse());
            }
            return o;
          }).join("");
          name = new GeneralName$1({
            otherName: new OtherName({
              typeId: id_GUID,
              value: AsnConvert.serialize(new OctetString2(Convert.FromHex(hex)))
            })
          });
          break;
        }
        case IP:
          name = new GeneralName$1({ iPAddress: args[1] });
          break;
        case REGISTERED_ID:
          name = new GeneralName$1({ registeredID: args[1] });
          break;
        case UPN: {
          name = new GeneralName$1({
            otherName: new OtherName({
              typeId: id_UPN,
              value: AsnConvert.serialize(AsnUtf8StringConverter.toASN(args[1]))
            })
          });
          break;
        }
        case URL:
          name = new GeneralName$1({ uniformResourceIdentifier: args[1] });
          break;
        default:
          throw new Error("Cannot create GeneralName. Unsupported type of the name");
      }
    } else if (BufferSourceConverter.isBufferSource(args[0])) {
      name = AsnConvert.parse(args[0], GeneralName$1);
    } else {
      name = args[0];
    }
    super(name);
  }
  onInit(asn) {
    if (asn.dNSName != void 0) {
      this.type = DNS;
      this.value = asn.dNSName;
    } else if (asn.rfc822Name != void 0) {
      this.type = EMAIL;
      this.value = asn.rfc822Name;
    } else if (asn.iPAddress != void 0) {
      this.type = IP;
      this.value = asn.iPAddress;
    } else if (asn.uniformResourceIdentifier != void 0) {
      this.type = URL;
      this.value = asn.uniformResourceIdentifier;
    } else if (asn.registeredID != void 0) {
      this.type = REGISTERED_ID;
      this.value = asn.registeredID;
    } else if (asn.directoryName != void 0) {
      this.type = DN;
      this.value = new Name2(asn.directoryName).toString();
    } else if (asn.otherName != void 0) {
      if (asn.otherName.typeId === id_GUID) {
        this.type = GUID;
        const guid = AsnConvert.parse(asn.otherName.value, OctetString2);
        const matches = new RegExp(GUID_REGEX, "i").exec(Convert.ToHex(guid));
        if (!matches) {
          throw new Error(ERR_GUID);
        }
        this.value = matches.slice(1).map((o, i) => {
          if (i < 3) {
            return Convert.ToHex(new Uint8Array(Convert.FromHex(o)).reverse());
          }
          return o;
        }).join("-");
      } else if (asn.otherName.typeId === id_UPN) {
        this.type = UPN;
        this.value = AsnConvert.parse(asn.otherName.value, DirectoryString).toString();
      } else {
        throw new Error(ERR_GN_STRING_FORMAT);
      }
    } else {
      throw new Error(ERR_GN_STRING_FORMAT);
    }
  }
  toJSON() {
    return {
      type: this.type,
      value: this.value
    };
  }
  toTextObject() {
    let type;
    switch (this.type) {
      case DN:
      case DNS:
      case GUID:
      case IP:
      case REGISTERED_ID:
      case UPN:
      case URL:
        type = this.type.toUpperCase();
        break;
      case EMAIL:
        type = "Email";
        break;
      default:
        throw new Error("Unsupported GeneralName type");
    }
    let value = this.value;
    if (this.type === REGISTERED_ID) {
      value = OidSerializer.toString(value);
    }
    return new TextObject(type, void 0, value);
  }
}
class GeneralNames2 extends AsnData {
  constructor(params) {
    let names2;
    if (params instanceof GeneralNames$1) {
      names2 = params;
    } else if (Array.isArray(params)) {
      const items = [];
      for (const name of params) {
        if (name instanceof GeneralName$1) {
          items.push(name);
        } else {
          const asnName = AsnConvert.parse(new GeneralName2(name.type, name.value).rawData, GeneralName$1);
          items.push(asnName);
        }
      }
      names2 = new GeneralNames$1(items);
    } else if (BufferSourceConverter.isBufferSource(params)) {
      names2 = AsnConvert.parse(params, GeneralNames$1);
    } else {
      throw new Error("Cannot initialize GeneralNames. Incorrect incoming arguments");
    }
    super(names2);
  }
  onInit(asn) {
    const items = [];
    for (const asnName of asn) {
      let name = null;
      try {
        name = new GeneralName2(asnName);
      } catch {
        continue;
      }
      items.push(name);
    }
    this.items = items;
  }
  toJSON() {
    return this.items.map((o) => o.toJSON());
  }
  toTextObject() {
    const res = super.toTextObjectEmpty();
    for (const name of this.items) {
      const nameObj = name.toTextObject();
      let field = res[nameObj[TextObject.NAME]];
      if (!Array.isArray(field)) {
        field = [];
        res[nameObj[TextObject.NAME]] = field;
      }
      field.push(nameObj);
    }
    return res;
  }
}
GeneralNames2.NAME = "GeneralNames";
const rPaddingTag = "-{5}";
const rEolChars = "\\n";
const rNameTag = `[^${rEolChars}]+`;
const rBeginTag = `${rPaddingTag}BEGIN (${rNameTag}(?=${rPaddingTag}))${rPaddingTag}`;
const rEndTag = `${rPaddingTag}END \\1${rPaddingTag}`;
const rEolGroup = "\\n";
const rHeaderKey = `[^:${rEolChars}]+`;
const rHeaderValue = `(?:[^${rEolChars}]+${rEolGroup}(?: +[^${rEolChars}]+${rEolGroup})*)`;
const rBase64Chars = "[a-zA-Z0-9=+/]+";
const rBase64 = `(?:${rBase64Chars}${rEolGroup})+`;
const rPem = `${rBeginTag}${rEolGroup}(?:((?:${rHeaderKey}: ${rHeaderValue})+))?${rEolGroup}?(${rBase64})${rEndTag}`;
class PemConverter {
  static isPem(data) {
    return typeof data === "string" && new RegExp(rPem, "g").test(data.replace(/\r/g, ""));
  }
  static decodeWithHeaders(pem) {
    pem = pem.replace(/\r/g, "");
    const pattern = new RegExp(rPem, "g");
    const res = [];
    let matches = null;
    while (matches = pattern.exec(pem)) {
      const base64 = matches[3].replace(new RegExp(`[${rEolChars}]+`, "g"), "");
      const pemStruct = {
        type: matches[1],
        headers: [],
        rawData: Convert.FromBase64(base64)
      };
      const headersString = matches[2];
      if (headersString) {
        const headers = headersString.split(new RegExp(rEolGroup, "g"));
        let lastHeader = null;
        for (const header of headers) {
          const [key, value] = header.split(/:(.*)/);
          if (value === void 0) {
            if (!lastHeader) {
              throw new Error("Cannot parse PEM string. Incorrect header value");
            }
            lastHeader.value += key.trim();
          } else {
            if (lastHeader) {
              pemStruct.headers.push(lastHeader);
            }
            lastHeader = {
              key,
              value: value.trim()
            };
          }
        }
        if (lastHeader) {
          pemStruct.headers.push(lastHeader);
        }
      }
      res.push(pemStruct);
    }
    return res;
  }
  static decode(pem) {
    const blocks = this.decodeWithHeaders(pem);
    return blocks.map((o) => o.rawData);
  }
  static decodeFirst(pem) {
    const items = this.decode(pem);
    if (!items.length) {
      throw new RangeError("PEM string doesn't contain any objects");
    }
    return items[0];
  }
  static encode(rawData, tag) {
    if (Array.isArray(rawData)) {
      const raws = new Array();
      if (tag) {
        rawData.forEach((element) => {
          if (!BufferSourceConverter.isBufferSource(element)) {
            throw new TypeError("Cannot encode array of BufferSource in PEM format. Not all items of the array are BufferSource");
          }
          raws.push(this.encodeStruct({
            type: tag,
            rawData: BufferSourceConverter.toArrayBuffer(element)
          }));
        });
      } else {
        rawData.forEach((element) => {
          if (!("type" in element)) {
            throw new TypeError("Cannot encode array of PemStruct in PEM format. Not all items of the array are PemStrut");
          }
          raws.push(this.encodeStruct(element));
        });
      }
      return raws.join("\n");
    } else {
      if (!tag) {
        throw new Error("Required argument 'tag' is missed");
      }
      return this.encodeStruct({
        type: tag,
        rawData: BufferSourceConverter.toArrayBuffer(rawData)
      });
    }
  }
  static encodeStruct(pem) {
    var _a3;
    const upperCaseType = pem.type.toLocaleUpperCase();
    const res = [];
    res.push(`-----BEGIN ${upperCaseType}-----`);
    if ((_a3 = pem.headers) === null || _a3 === void 0 ? void 0 : _a3.length) {
      for (const header of pem.headers) {
        res.push(`${header.key}: ${header.value}`);
      }
      res.push("");
    }
    const base64 = Convert.ToBase64(pem.rawData);
    let sliced;
    let offset = 0;
    const rows = Array();
    while (offset < base64.length) {
      if (base64.length - offset < 64) {
        sliced = base64.substring(offset);
      } else {
        sliced = base64.substring(offset, offset + 64);
        offset += 64;
      }
      if (sliced.length !== 0) {
        rows.push(sliced);
        if (sliced.length < 64) {
          break;
        }
      } else {
        break;
      }
    }
    res.push(...rows);
    res.push(`-----END ${upperCaseType}-----`);
    return res.join("\n");
  }
}
PemConverter.CertificateTag = "CERTIFICATE";
PemConverter.CrlTag = "CRL";
PemConverter.CertificateRequestTag = "CERTIFICATE REQUEST";
PemConverter.PublicKeyTag = "PUBLIC KEY";
PemConverter.PrivateKeyTag = "PRIVATE KEY";
class PemData extends AsnData {
  static isAsnEncoded(data) {
    return BufferSourceConverter.isBufferSource(data) || typeof data === "string";
  }
  static toArrayBuffer(raw) {
    if (typeof raw === "string") {
      if (PemConverter.isPem(raw)) {
        return PemConverter.decode(raw)[0];
      } else if (Convert.isHex(raw)) {
        return Convert.FromHex(raw);
      } else if (Convert.isBase64(raw)) {
        return Convert.FromBase64(raw);
      } else if (Convert.isBase64Url(raw)) {
        return Convert.FromBase64Url(raw);
      } else {
        throw new TypeError("Unsupported format of 'raw' argument. Must be one of DER, PEM, HEX, Base64, or Base4Url");
      }
    } else {
      const buffer = BufferSourceConverter.toUint8Array(raw);
      if (buffer.length > 0 && buffer[0] === 48) {
        return BufferSourceConverter.toArrayBuffer(raw);
      }
      const stringRaw = Convert.ToBinary(raw);
      if (PemConverter.isPem(stringRaw)) {
        return PemConverter.decode(stringRaw)[0];
      } else if (Convert.isHex(stringRaw)) {
        return Convert.FromHex(stringRaw);
      } else if (Convert.isBase64(stringRaw)) {
        return Convert.FromBase64(stringRaw);
      } else if (Convert.isBase64Url(stringRaw)) {
        return Convert.FromBase64Url(stringRaw);
      }
      throw new TypeError("Unsupported format of 'raw' argument. Must be one of DER, PEM, HEX, Base64, or Base4Url");
    }
  }
  constructor(...args) {
    if (PemData.isAsnEncoded(args[0])) {
      super(PemData.toArrayBuffer(args[0]), args[1]);
    } else {
      super(args[0]);
    }
  }
  toString(format = "pem") {
    switch (format) {
      case "pem":
        return PemConverter.encode(this.rawData, this.tag);
      default:
        return super.toString(format);
    }
  }
}
class PublicKey extends PemData {
  static async create(data, crypto2 = cryptoProvider.get()) {
    if (data instanceof PublicKey) {
      return data;
    } else if (CryptoProvider.isCryptoKey(data)) {
      if (data.type !== "public") {
        throw new TypeError("Public key is required");
      }
      const spki = await crypto2.subtle.exportKey("spki", data);
      return new PublicKey(spki);
    } else if (data.publicKey) {
      return data.publicKey;
    } else if (BufferSourceConverter.isBufferSource(data)) {
      return new PublicKey(data);
    } else {
      throw new TypeError("Unsupported PublicKeyType");
    }
  }
  constructor(param) {
    if (PemData.isAsnEncoded(param)) {
      super(param, SubjectPublicKeyInfo);
    } else {
      super(param);
    }
    this.tag = PemConverter.PublicKeyTag;
  }
  async export(...args) {
    let crypto2;
    let keyUsages = ["verify"];
    let algorithm = {
      hash: "SHA-256",
      ...this.algorithm
    };
    if (args.length > 1) {
      algorithm = args[0] || algorithm;
      keyUsages = args[1] || keyUsages;
      crypto2 = args[2] || cryptoProvider.get();
    } else {
      crypto2 = args[0] || cryptoProvider.get();
    }
    let raw = this.rawData;
    const asnSpki = AsnConvert.parse(this.rawData, SubjectPublicKeyInfo);
    if (asnSpki.algorithm.algorithm === id_RSASSA_PSS) {
      raw = convertSpkiToRsaPkcs1(asnSpki, raw);
    }
    return crypto2.subtle.importKey("spki", raw, algorithm, true, keyUsages);
  }
  onInit(asn) {
    const algProv = instance.resolve(diAlgorithmProvider);
    const algorithm = this.algorithm = algProv.toWebAlgorithm(asn.algorithm);
    switch (asn.algorithm.algorithm) {
      case id_rsaEncryption: {
        const rsaPublicKey = AsnConvert.parse(asn.subjectPublicKey, RSAPublicKey);
        const modulus = BufferSourceConverter.toUint8Array(rsaPublicKey.modulus);
        algorithm.publicExponent = BufferSourceConverter.toUint8Array(rsaPublicKey.publicExponent);
        algorithm.modulusLength = (!modulus[0] ? modulus.slice(1) : modulus).byteLength << 3;
        break;
      }
    }
  }
  async getThumbprint(...args) {
    var _a3;
    let crypto2;
    let algorithm = "SHA-1";
    if (args.length >= 1 && !((_a3 = args[0]) === null || _a3 === void 0 ? void 0 : _a3.subtle)) {
      algorithm = args[0] || algorithm;
      crypto2 = args[1] || cryptoProvider.get();
    } else {
      crypto2 = args[0] || cryptoProvider.get();
    }
    return await crypto2.subtle.digest(algorithm, this.rawData);
  }
  async getKeyIdentifier(...args) {
    let crypto2;
    let algorithm = "SHA-1";
    if (args.length === 1) {
      if (typeof args[0] === "string") {
        algorithm = args[0];
        crypto2 = cryptoProvider.get();
      } else {
        crypto2 = args[0];
      }
    } else if (args.length === 2) {
      algorithm = args[0];
      crypto2 = args[1];
    } else {
      crypto2 = cryptoProvider.get();
    }
    const asn = AsnConvert.parse(this.rawData, SubjectPublicKeyInfo);
    return await crypto2.subtle.digest(algorithm, asn.subjectPublicKey);
  }
  toTextObject() {
    const obj = this.toTextObjectEmpty();
    const asn = AsnConvert.parse(this.rawData, SubjectPublicKeyInfo);
    obj["Algorithm"] = TextConverter.serializeAlgorithm(asn.algorithm);
    switch (asn.algorithm.algorithm) {
      case id_ecPublicKey:
        obj["EC Point"] = asn.subjectPublicKey;
        break;
      case id_rsaEncryption:
      default:
        obj["Raw Data"] = asn.subjectPublicKey;
    }
    return obj;
  }
}
function convertSpkiToRsaPkcs1(asnSpki, raw) {
  asnSpki.algorithm = new AlgorithmIdentifier({
    algorithm: id_rsaEncryption,
    parameters: null
  });
  raw = AsnConvert.serialize(asnSpki);
  return raw;
}
class AuthorityKeyIdentifierExtension extends Extension {
  static async create(param, critical = false, crypto2 = cryptoProvider.get()) {
    if ("name" in param && "serialNumber" in param) {
      return new AuthorityKeyIdentifierExtension(param, critical);
    }
    const key = await PublicKey.create(param, crypto2);
    const id = await key.getKeyIdentifier(crypto2);
    return new AuthorityKeyIdentifierExtension(Convert.ToHex(id), critical);
  }
  constructor(...args) {
    if (BufferSourceConverter.isBufferSource(args[0])) {
      super(args[0]);
    } else if (typeof args[0] === "string") {
      const value = new AuthorityKeyIdentifier({ keyIdentifier: new KeyIdentifier(Convert.FromHex(args[0])) });
      super(id_ce_authorityKeyIdentifier, args[1], AsnConvert.serialize(value));
    } else {
      const certId = args[0];
      const certIdName = certId.name instanceof GeneralNames2 ? AsnConvert.parse(certId.name.rawData, GeneralNames$1) : certId.name;
      const value = new AuthorityKeyIdentifier({
        authorityCertIssuer: certIdName,
        authorityCertSerialNumber: Convert.FromHex(certId.serialNumber)
      });
      super(id_ce_authorityKeyIdentifier, args[1], AsnConvert.serialize(value));
    }
  }
  onInit(asn) {
    super.onInit(asn);
    const aki = AsnConvert.parse(asn.extnValue, AuthorityKeyIdentifier);
    if (aki.keyIdentifier) {
      this.keyId = Convert.ToHex(aki.keyIdentifier);
    }
    if (aki.authorityCertIssuer || aki.authorityCertSerialNumber) {
      this.certId = {
        name: aki.authorityCertIssuer || [],
        serialNumber: aki.authorityCertSerialNumber ? Convert.ToHex(aki.authorityCertSerialNumber) : ""
      };
    }
  }
  toTextObject() {
    const obj = this.toTextObjectWithoutValue();
    const asn = AsnConvert.parse(this.value, AuthorityKeyIdentifier);
    if (asn.authorityCertIssuer) {
      obj["Authority Issuer"] = new GeneralNames2(asn.authorityCertIssuer).toTextObject();
    }
    if (asn.authorityCertSerialNumber) {
      obj["Authority Serial Number"] = asn.authorityCertSerialNumber;
    }
    if (asn.keyIdentifier) {
      obj[""] = asn.keyIdentifier;
    }
    return obj;
  }
}
AuthorityKeyIdentifierExtension.NAME = "Authority Key Identifier";
class BasicConstraintsExtension extends Extension {
  constructor(...args) {
    if (BufferSourceConverter.isBufferSource(args[0])) {
      super(args[0]);
      const value = AsnConvert.parse(this.value, BasicConstraints);
      this.ca = value.cA;
      this.pathLength = value.pathLenConstraint;
    } else {
      const value = new BasicConstraints({
        cA: args[0],
        pathLenConstraint: args[1]
      });
      super(id_ce_basicConstraints, args[2], AsnConvert.serialize(value));
      this.ca = args[0];
      this.pathLength = args[1];
    }
  }
  toTextObject() {
    const obj = this.toTextObjectWithoutValue();
    if (this.ca) {
      obj["CA"] = this.ca;
    }
    if (this.pathLength !== void 0) {
      obj["Path Length"] = this.pathLength;
    }
    return obj;
  }
}
BasicConstraintsExtension.NAME = "Basic Constraints";
var ExtendedKeyUsage2;
(function(ExtendedKeyUsage3) {
  ExtendedKeyUsage3["serverAuth"] = "1.3.6.1.5.5.7.3.1";
  ExtendedKeyUsage3["clientAuth"] = "1.3.6.1.5.5.7.3.2";
  ExtendedKeyUsage3["codeSigning"] = "1.3.6.1.5.5.7.3.3";
  ExtendedKeyUsage3["emailProtection"] = "1.3.6.1.5.5.7.3.4";
  ExtendedKeyUsage3["timeStamping"] = "1.3.6.1.5.5.7.3.8";
  ExtendedKeyUsage3["ocspSigning"] = "1.3.6.1.5.5.7.3.9";
})(ExtendedKeyUsage2 || (ExtendedKeyUsage2 = {}));
class ExtendedKeyUsageExtension extends Extension {
  constructor(...args) {
    if (BufferSourceConverter.isBufferSource(args[0])) {
      super(args[0]);
      const value = AsnConvert.parse(this.value, ExtendedKeyUsage$1);
      this.usages = value.map((o) => o);
    } else {
      const value = new ExtendedKeyUsage$1(args[0]);
      super(id_ce_extKeyUsage, args[1], AsnConvert.serialize(value));
      this.usages = args[0];
    }
  }
  toTextObject() {
    const obj = this.toTextObjectWithoutValue();
    obj[""] = this.usages.map((o) => OidSerializer.toString(o)).join(", ");
    return obj;
  }
}
ExtendedKeyUsageExtension.NAME = "Extended Key Usages";
var KeyUsageFlags;
(function(KeyUsageFlags2) {
  KeyUsageFlags2[KeyUsageFlags2["digitalSignature"] = 1] = "digitalSignature";
  KeyUsageFlags2[KeyUsageFlags2["nonRepudiation"] = 2] = "nonRepudiation";
  KeyUsageFlags2[KeyUsageFlags2["keyEncipherment"] = 4] = "keyEncipherment";
  KeyUsageFlags2[KeyUsageFlags2["dataEncipherment"] = 8] = "dataEncipherment";
  KeyUsageFlags2[KeyUsageFlags2["keyAgreement"] = 16] = "keyAgreement";
  KeyUsageFlags2[KeyUsageFlags2["keyCertSign"] = 32] = "keyCertSign";
  KeyUsageFlags2[KeyUsageFlags2["cRLSign"] = 64] = "cRLSign";
  KeyUsageFlags2[KeyUsageFlags2["encipherOnly"] = 128] = "encipherOnly";
  KeyUsageFlags2[KeyUsageFlags2["decipherOnly"] = 256] = "decipherOnly";
})(KeyUsageFlags || (KeyUsageFlags = {}));
class KeyUsagesExtension extends Extension {
  constructor(...args) {
    if (BufferSourceConverter.isBufferSource(args[0])) {
      super(args[0]);
      const value = AsnConvert.parse(this.value, KeyUsage);
      this.usages = value.toNumber();
    } else {
      const value = new KeyUsage(args[0]);
      super(id_ce_keyUsage, args[1], AsnConvert.serialize(value));
      this.usages = args[0];
    }
  }
  toTextObject() {
    const obj = this.toTextObjectWithoutValue();
    const asn = AsnConvert.parse(this.value, KeyUsage);
    obj[""] = asn.toJSON().join(", ");
    return obj;
  }
}
KeyUsagesExtension.NAME = "Key Usages";
class SubjectKeyIdentifierExtension extends Extension {
  static async create(publicKey, critical = false, crypto2 = cryptoProvider.get()) {
    const key = await PublicKey.create(publicKey, crypto2);
    const id = await key.getKeyIdentifier(crypto2);
    return new SubjectKeyIdentifierExtension(Convert.ToHex(id), critical);
  }
  constructor(...args) {
    if (BufferSourceConverter.isBufferSource(args[0])) {
      super(args[0]);
      const value = AsnConvert.parse(this.value, SubjectKeyIdentifier);
      this.keyId = Convert.ToHex(value);
    } else {
      const identifier = typeof args[0] === "string" ? Convert.FromHex(args[0]) : args[0];
      const value = new SubjectKeyIdentifier(identifier);
      super(id_ce_subjectKeyIdentifier, args[1], AsnConvert.serialize(value));
      this.keyId = Convert.ToHex(identifier);
    }
  }
  toTextObject() {
    const obj = this.toTextObjectWithoutValue();
    const asn = AsnConvert.parse(this.value, SubjectKeyIdentifier);
    obj[""] = asn;
    return obj;
  }
}
SubjectKeyIdentifierExtension.NAME = "Subject Key Identifier";
class SubjectAlternativeNameExtension extends Extension {
  constructor(...args) {
    if (BufferSourceConverter.isBufferSource(args[0])) {
      super(args[0]);
    } else {
      super(id_ce_subjectAltName, args[1], new GeneralNames2(args[0] || []).rawData);
    }
  }
  onInit(asn) {
    super.onInit(asn);
    const value = AsnConvert.parse(asn.extnValue, SubjectAlternativeName);
    this.names = new GeneralNames2(value);
  }
  toTextObject() {
    const obj = this.toTextObjectWithoutValue();
    const namesObj = this.names.toTextObject();
    for (const key in namesObj) {
      obj[key] = namesObj[key];
    }
    return obj;
  }
}
SubjectAlternativeNameExtension.NAME = "Subject Alternative Name";
class ExtensionFactory {
  static register(id, type) {
    this.items.set(id, type);
  }
  static create(data) {
    const extension = new Extension(data);
    const Type = this.items.get(extension.type);
    if (Type) {
      return new Type(data);
    }
    return extension;
  }
}
ExtensionFactory.items = /* @__PURE__ */ new Map();
class CertificatePolicyExtension extends Extension {
  constructor(...args) {
    var _a3;
    if (BufferSourceConverter.isBufferSource(args[0])) {
      super(args[0]);
      const asnPolicies = AsnConvert.parse(this.value, CertificatePolicies);
      this.policies = asnPolicies.map((o) => o.policyIdentifier);
    } else {
      const policies = args[0];
      const critical = (_a3 = args[1]) !== null && _a3 !== void 0 ? _a3 : false;
      const value = new CertificatePolicies(policies.map((o) => new PolicyInformation({ policyIdentifier: o })));
      super(id_ce_certificatePolicies, critical, AsnConvert.serialize(value));
      this.policies = policies;
    }
  }
  toTextObject() {
    const obj = this.toTextObjectWithoutValue();
    obj["Policy"] = this.policies.map((o) => new TextObject("", {}, OidSerializer.toString(o)));
    return obj;
  }
}
CertificatePolicyExtension.NAME = "Certificate Policies";
ExtensionFactory.register(id_ce_certificatePolicies, CertificatePolicyExtension);
class CRLDistributionPointsExtension extends Extension {
  constructor(...args) {
    var _a3;
    if (BufferSourceConverter.isBufferSource(args[0])) {
      super(args[0]);
    } else if (Array.isArray(args[0]) && typeof args[0][0] === "string") {
      const urls = args[0];
      const dps = urls.map((url) => {
        return new DistributionPoint({
          distributionPoint: new DistributionPointName({ fullName: [new GeneralName$1({ uniformResourceIdentifier: url })] })
        });
      });
      const value = new CRLDistributionPoints(dps);
      super(id_ce_cRLDistributionPoints, args[1], AsnConvert.serialize(value));
    } else {
      const value = new CRLDistributionPoints(args[0]);
      super(id_ce_cRLDistributionPoints, args[1], AsnConvert.serialize(value));
    }
    (_a3 = this.distributionPoints) !== null && _a3 !== void 0 ? _a3 : this.distributionPoints = [];
  }
  onInit(asn) {
    super.onInit(asn);
    const crlExt = AsnConvert.parse(asn.extnValue, CRLDistributionPoints);
    this.distributionPoints = crlExt;
  }
  toTextObject() {
    const obj = this.toTextObjectWithoutValue();
    obj["Distribution Point"] = this.distributionPoints.map((dp) => {
      var _a3;
      const dpObj = {};
      if (dp.distributionPoint) {
        dpObj[""] = (_a3 = dp.distributionPoint.fullName) === null || _a3 === void 0 ? void 0 : _a3.map((name) => new GeneralName2(name).toString()).join(", ");
      }
      if (dp.reasons) {
        dpObj["Reasons"] = dp.reasons.toString();
      }
      if (dp.cRLIssuer) {
        dpObj["CRL Issuer"] = dp.cRLIssuer.map((issuer) => issuer.toString()).join(", ");
      }
      return dpObj;
    });
    return obj;
  }
}
CRLDistributionPointsExtension.NAME = "CRL Distribution Points";
class AuthorityInfoAccessExtension extends Extension {
  constructor(...args) {
    var _a3, _b, _c, _d;
    if (BufferSourceConverter.isBufferSource(args[0])) {
      super(args[0]);
    } else if (args[0] instanceof AuthorityInfoAccessSyntax) {
      const value = new AuthorityInfoAccessSyntax(args[0]);
      super(id_pe_authorityInfoAccess, args[1], AsnConvert.serialize(value));
    } else {
      const params = args[0];
      const value = new AuthorityInfoAccessSyntax();
      addAccessDescriptions(value, params, id_ad_ocsp, "ocsp");
      addAccessDescriptions(value, params, id_ad_caIssuers, "caIssuers");
      addAccessDescriptions(value, params, id_ad_timeStamping, "timeStamping");
      addAccessDescriptions(value, params, id_ad_caRepository, "caRepository");
      super(id_pe_authorityInfoAccess, args[1], AsnConvert.serialize(value));
    }
    (_a3 = this.ocsp) !== null && _a3 !== void 0 ? _a3 : this.ocsp = [];
    (_b = this.caIssuers) !== null && _b !== void 0 ? _b : this.caIssuers = [];
    (_c = this.timeStamping) !== null && _c !== void 0 ? _c : this.timeStamping = [];
    (_d = this.caRepository) !== null && _d !== void 0 ? _d : this.caRepository = [];
  }
  onInit(asn) {
    super.onInit(asn);
    this.ocsp = [];
    this.caIssuers = [];
    this.timeStamping = [];
    this.caRepository = [];
    const aia = AsnConvert.parse(asn.extnValue, AuthorityInfoAccessSyntax);
    aia.forEach((accessDescription) => {
      switch (accessDescription.accessMethod) {
        case id_ad_ocsp:
          this.ocsp.push(new GeneralName2(accessDescription.accessLocation));
          break;
        case id_ad_caIssuers:
          this.caIssuers.push(new GeneralName2(accessDescription.accessLocation));
          break;
        case id_ad_timeStamping:
          this.timeStamping.push(new GeneralName2(accessDescription.accessLocation));
          break;
        case id_ad_caRepository:
          this.caRepository.push(new GeneralName2(accessDescription.accessLocation));
          break;
      }
    });
  }
  toTextObject() {
    const obj = this.toTextObjectWithoutValue();
    if (this.ocsp.length) {
      addUrlsToObject(obj, "OCSP", this.ocsp);
    }
    if (this.caIssuers.length) {
      addUrlsToObject(obj, "CA Issuers", this.caIssuers);
    }
    if (this.timeStamping.length) {
      addUrlsToObject(obj, "Time Stamping", this.timeStamping);
    }
    if (this.caRepository.length) {
      addUrlsToObject(obj, "CA Repository", this.caRepository);
    }
    return obj;
  }
}
AuthorityInfoAccessExtension.NAME = "Authority Info Access";
function addUrlsToObject(obj, key, urls) {
  if (urls.length === 1) {
    obj[key] = urls[0].toTextObject();
  } else {
    const names2 = new TextObject("");
    urls.forEach((name, index) => {
      const nameObj = name.toTextObject();
      const indexedKey = `${nameObj[TextObject.NAME]} ${index + 1}`;
      let field = names2[indexedKey];
      if (!Array.isArray(field)) {
        field = [];
        names2[indexedKey] = field;
      }
      field.push(nameObj);
    });
    obj[key] = names2;
  }
}
function addAccessDescriptions(value, params, method, key) {
  const items = params[key];
  if (items) {
    const array = Array.isArray(items) ? items : [items];
    array.forEach((url) => {
      if (typeof url === "string") {
        url = new GeneralName2("url", url);
      }
      value.push(new AccessDescription({
        accessMethod: method,
        accessLocation: AsnConvert.parse(url.rawData, GeneralName$1)
      }));
    });
  }
}
class IssuerAlternativeNameExtension extends Extension {
  constructor(...args) {
    if (BufferSourceConverter.isBufferSource(args[0])) {
      super(args[0]);
    } else {
      super(id_ce_issuerAltName, args[1], new GeneralNames2(args[0] || []).rawData);
    }
  }
  onInit(asn) {
    super.onInit(asn);
    const value = AsnConvert.parse(asn.extnValue, GeneralNames$1);
    this.names = new GeneralNames2(value);
  }
  toTextObject() {
    const obj = this.toTextObjectWithoutValue();
    const namesObj = this.names.toTextObject();
    for (const key in namesObj) {
      obj[key] = namesObj[key];
    }
    return obj;
  }
}
IssuerAlternativeNameExtension.NAME = "Issuer Alternative Name";
class Attribute3 extends AsnData {
  constructor(...args) {
    let raw;
    if (BufferSourceConverter.isBufferSource(args[0])) {
      raw = BufferSourceConverter.toArrayBuffer(args[0]);
    } else {
      const type = args[0];
      const values = Array.isArray(args[1]) ? args[1].map((o) => BufferSourceConverter.toArrayBuffer(o)) : [];
      raw = AsnConvert.serialize(new Attribute$2({
        type,
        values
      }));
    }
    super(raw, Attribute$2);
  }
  onInit(asn) {
    this.type = asn.type;
    this.values = asn.values;
  }
  toTextObject() {
    const obj = this.toTextObjectWithoutValue();
    obj["Value"] = this.values.map((o) => new TextObject("", { "": o }));
    return obj;
  }
  toTextObjectWithoutValue() {
    const obj = this.toTextObjectEmpty();
    if (obj[TextObject.NAME] === Attribute3.NAME) {
      obj[TextObject.NAME] = OidSerializer.toString(this.type);
    }
    return obj;
  }
}
Attribute3.NAME = "Attribute";
class ChallengePasswordAttribute extends Attribute3 {
  constructor(...args) {
    var _a3;
    if (BufferSourceConverter.isBufferSource(args[0])) {
      super(args[0]);
    } else {
      const value = new ChallengePassword({ printableString: args[0] });
      super(id_pkcs9_at_challengePassword, [AsnConvert.serialize(value)]);
    }
    (_a3 = this.password) !== null && _a3 !== void 0 ? _a3 : this.password = "";
  }
  onInit(asn) {
    super.onInit(asn);
    if (this.values[0]) {
      const value = AsnConvert.parse(this.values[0], ChallengePassword);
      this.password = value.toString();
    }
  }
  toTextObject() {
    const obj = this.toTextObjectWithoutValue();
    obj[TextObject.VALUE] = this.password;
    return obj;
  }
}
ChallengePasswordAttribute.NAME = "Challenge Password";
class ExtensionsAttribute extends Attribute3 {
  constructor(...args) {
    var _a3;
    if (BufferSourceConverter.isBufferSource(args[0])) {
      super(args[0]);
    } else {
      const extensions = args[0];
      const value = new Extensions();
      for (const extension of extensions) {
        value.push(AsnConvert.parse(extension.rawData, Extension$1));
      }
      super(id_pkcs9_at_extensionRequest, [AsnConvert.serialize(value)]);
    }
    (_a3 = this.items) !== null && _a3 !== void 0 ? _a3 : this.items = [];
  }
  onInit(asn) {
    super.onInit(asn);
    if (this.values[0]) {
      const value = AsnConvert.parse(this.values[0], Extensions);
      this.items = value.map((o) => ExtensionFactory.create(AsnConvert.serialize(o)));
    }
  }
  toTextObject() {
    const obj = this.toTextObjectWithoutValue();
    const extensions = this.items.map((o) => o.toTextObject());
    for (const extension of extensions) {
      obj[extension[TextObject.NAME]] = extension;
    }
    return obj;
  }
}
ExtensionsAttribute.NAME = "Extensions";
class AttributeFactory {
  static register(id, type) {
    this.items.set(id, type);
  }
  static create(data) {
    const attribute = new Attribute3(data);
    const Type = this.items.get(attribute.type);
    if (Type) {
      return new Type(data);
    }
    return attribute;
  }
}
AttributeFactory.items = /* @__PURE__ */ new Map();
const diAsnSignatureFormatter = "crypto.signatureFormatter";
class AsnDefaultSignatureFormatter {
  toAsnSignature(algorithm, signature) {
    return BufferSourceConverter.toArrayBuffer(signature);
  }
  toWebSignature(algorithm, signature) {
    return BufferSourceConverter.toArrayBuffer(signature);
  }
}
var RsaAlgorithm_1;
let RsaAlgorithm = RsaAlgorithm_1 = class RsaAlgorithm2 {
  static createPssParams(hash, saltLength) {
    const hashAlgorithm = RsaAlgorithm_1.getHashAlgorithm(hash);
    if (!hashAlgorithm) {
      return null;
    }
    return new RsaSaPssParams({
      hashAlgorithm,
      maskGenAlgorithm: new AlgorithmIdentifier({
        algorithm: id_mgf1,
        parameters: AsnConvert.serialize(hashAlgorithm)
      }),
      saltLength
    });
  }
  static getHashAlgorithm(alg) {
    const algProv = instance.resolve(diAlgorithmProvider);
    if (typeof alg === "string") {
      return algProv.toAsnAlgorithm({ name: alg });
    }
    if (typeof alg === "object" && alg && "name" in alg) {
      return algProv.toAsnAlgorithm(alg);
    }
    return null;
  }
  toAsnAlgorithm(alg) {
    switch (alg.name.toLowerCase()) {
      case "rsassa-pkcs1-v1_5":
        if ("hash" in alg) {
          let hash;
          if (typeof alg.hash === "string") {
            hash = alg.hash;
          } else if (alg.hash && typeof alg.hash === "object" && "name" in alg.hash && typeof alg.hash.name === "string") {
            hash = alg.hash.name.toUpperCase();
          } else {
            throw new Error("Cannot get hash algorithm name");
          }
          switch (hash.toLowerCase()) {
            case "sha-1":
              return new AlgorithmIdentifier({
                algorithm: id_sha1WithRSAEncryption,
                parameters: null
              });
            case "sha-256":
              return new AlgorithmIdentifier({
                algorithm: id_sha256WithRSAEncryption,
                parameters: null
              });
            case "sha-384":
              return new AlgorithmIdentifier({
                algorithm: id_sha384WithRSAEncryption,
                parameters: null
              });
            case "sha-512":
              return new AlgorithmIdentifier({
                algorithm: id_sha512WithRSAEncryption,
                parameters: null
              });
          }
        } else {
          return new AlgorithmIdentifier({
            algorithm: id_rsaEncryption,
            parameters: null
          });
        }
        break;
      case "rsa-pss":
        if ("hash" in alg) {
          if (!("saltLength" in alg && typeof alg.saltLength === "number")) {
            throw new Error("Cannot get 'saltLength' from 'alg' argument");
          }
          const pssParams = RsaAlgorithm_1.createPssParams(alg.hash, alg.saltLength);
          if (!pssParams) {
            throw new Error("Cannot create PSS parameters");
          }
          return new AlgorithmIdentifier({
            algorithm: id_RSASSA_PSS,
            parameters: AsnConvert.serialize(pssParams)
          });
        } else {
          return new AlgorithmIdentifier({
            algorithm: id_RSASSA_PSS,
            parameters: null
          });
        }
    }
    return null;
  }
  toWebAlgorithm(alg) {
    switch (alg.algorithm) {
      case id_rsaEncryption:
        return { name: "RSASSA-PKCS1-v1_5" };
      case id_sha1WithRSAEncryption:
        return {
          name: "RSASSA-PKCS1-v1_5",
          hash: { name: "SHA-1" }
        };
      case id_sha256WithRSAEncryption:
        return {
          name: "RSASSA-PKCS1-v1_5",
          hash: { name: "SHA-256" }
        };
      case id_sha384WithRSAEncryption:
        return {
          name: "RSASSA-PKCS1-v1_5",
          hash: { name: "SHA-384" }
        };
      case id_sha512WithRSAEncryption:
        return {
          name: "RSASSA-PKCS1-v1_5",
          hash: { name: "SHA-512" }
        };
      case id_RSASSA_PSS:
        if (alg.parameters) {
          const pssParams = AsnConvert.parse(alg.parameters, RsaSaPssParams);
          const algProv = instance.resolve(diAlgorithmProvider);
          const hashAlg = algProv.toWebAlgorithm(pssParams.hashAlgorithm);
          return {
            name: "RSA-PSS",
            hash: hashAlg,
            saltLength: pssParams.saltLength
          };
        } else {
          return { name: "RSA-PSS" };
        }
    }
    return null;
  }
};
RsaAlgorithm = RsaAlgorithm_1 = __decorate([
  injectable()
], RsaAlgorithm);
instance.registerSingleton(diAlgorithm, RsaAlgorithm);
let ShaAlgorithm = class ShaAlgorithm2 {
  toAsnAlgorithm(alg) {
    switch (alg.name.toLowerCase()) {
      case "sha-1":
        return new AlgorithmIdentifier({ algorithm: id_sha1 });
      case "sha-256":
        return new AlgorithmIdentifier({ algorithm: id_sha256 });
      case "sha-384":
        return new AlgorithmIdentifier({ algorithm: id_sha384 });
      case "sha-512":
        return new AlgorithmIdentifier({ algorithm: id_sha512 });
    }
    return null;
  }
  toWebAlgorithm(alg) {
    switch (alg.algorithm) {
      case id_sha1:
        return { name: "SHA-1" };
      case id_sha256:
        return { name: "SHA-256" };
      case id_sha384:
        return { name: "SHA-384" };
      case id_sha512:
        return { name: "SHA-512" };
    }
    return null;
  }
};
ShaAlgorithm = __decorate([
  injectable()
], ShaAlgorithm);
instance.registerSingleton(diAlgorithm, ShaAlgorithm);
class AsnEcSignatureFormatter {
  addPadding(pointSize, data) {
    const bytes = BufferSourceConverter.toUint8Array(data);
    const res = new Uint8Array(pointSize);
    res.set(bytes, pointSize - bytes.length);
    return res.buffer;
  }
  removePadding(data, positive = false) {
    let bytes = BufferSourceConverter.toUint8Array(data);
    for (let i = 0; i < bytes.length; i++) {
      if (!bytes[i]) {
        continue;
      }
      bytes = bytes.slice(i);
      break;
    }
    if (positive && bytes[0] > 127) {
      const result = new Uint8Array(bytes.length + 1);
      result.set(bytes, 1);
      return result.buffer;
    }
    return bytes.buffer;
  }
  toAsnSignature(algorithm, signature) {
    if (algorithm.name === "ECDSA") {
      const namedCurve = algorithm.namedCurve;
      const pointSize = AsnEcSignatureFormatter.namedCurveSize.get(namedCurve) || AsnEcSignatureFormatter.defaultNamedCurveSize;
      const ecSignature = new ECDSASigValue();
      const uint8Signature = BufferSourceConverter.toUint8Array(signature);
      ecSignature.r = this.removePadding(uint8Signature.slice(0, pointSize), true);
      ecSignature.s = this.removePadding(uint8Signature.slice(pointSize, pointSize + pointSize), true);
      return AsnConvert.serialize(ecSignature);
    }
    return null;
  }
  toWebSignature(algorithm, signature) {
    if (algorithm.name === "ECDSA") {
      const ecSigValue = AsnConvert.parse(signature, ECDSASigValue);
      const namedCurve = algorithm.namedCurve;
      const pointSize = AsnEcSignatureFormatter.namedCurveSize.get(namedCurve) || AsnEcSignatureFormatter.defaultNamedCurveSize;
      const r = this.addPadding(pointSize, this.removePadding(ecSigValue.r));
      const s = this.addPadding(pointSize, this.removePadding(ecSigValue.s));
      return combine(r, s);
    }
    return null;
  }
}
AsnEcSignatureFormatter.namedCurveSize = /* @__PURE__ */ new Map();
AsnEcSignatureFormatter.defaultNamedCurveSize = 32;
const idX25519 = "1.3.101.110";
const idX448 = "1.3.101.111";
const idEd25519 = "1.3.101.112";
const idEd448 = "1.3.101.113";
let EdAlgorithm = class EdAlgorithm2 {
  toAsnAlgorithm(alg) {
    let algorithm = null;
    switch (alg.name.toLowerCase()) {
      case "ed25519":
        algorithm = idEd25519;
        break;
      case "x25519":
        algorithm = idX25519;
        break;
      case "eddsa":
        switch (alg.namedCurve.toLowerCase()) {
          case "ed25519":
            algorithm = idEd25519;
            break;
          case "ed448":
            algorithm = idEd448;
            break;
        }
        break;
      case "ecdh-es":
        switch (alg.namedCurve.toLowerCase()) {
          case "x25519":
            algorithm = idX25519;
            break;
          case "x448":
            algorithm = idX448;
            break;
        }
    }
    if (algorithm) {
      return new AlgorithmIdentifier({ algorithm });
    }
    return null;
  }
  toWebAlgorithm(alg) {
    switch (alg.algorithm) {
      case idEd25519:
        return { name: "Ed25519" };
      case idEd448:
        return {
          name: "EdDSA",
          namedCurve: "Ed448"
        };
      case idX25519:
        return { name: "X25519" };
      case idX448:
        return {
          name: "ECDH-ES",
          namedCurve: "X448"
        };
    }
    return null;
  }
};
EdAlgorithm = __decorate([
  injectable()
], EdAlgorithm);
instance.registerSingleton(diAlgorithm, EdAlgorithm);
var _Pkcs10CertificateRequest_tbs, _Pkcs10CertificateRequest_subjectName, _Pkcs10CertificateRequest_subject, _Pkcs10CertificateRequest_signatureAlgorithm, _Pkcs10CertificateRequest_signature, _Pkcs10CertificateRequest_publicKey, _Pkcs10CertificateRequest_attributes, _Pkcs10CertificateRequest_extensions;
class Pkcs10CertificateRequest extends PemData {
  get subjectName() {
    if (!__classPrivateFieldGet(this, _Pkcs10CertificateRequest_subjectName, "f")) {
      __classPrivateFieldSet(this, _Pkcs10CertificateRequest_subjectName, new Name2(this.asn.certificationRequestInfo.subject), "f");
    }
    return __classPrivateFieldGet(this, _Pkcs10CertificateRequest_subjectName, "f");
  }
  get subject() {
    if (!__classPrivateFieldGet(this, _Pkcs10CertificateRequest_subject, "f")) {
      __classPrivateFieldSet(this, _Pkcs10CertificateRequest_subject, this.subjectName.toString(), "f");
    }
    return __classPrivateFieldGet(this, _Pkcs10CertificateRequest_subject, "f");
  }
  get signatureAlgorithm() {
    if (!__classPrivateFieldGet(this, _Pkcs10CertificateRequest_signatureAlgorithm, "f")) {
      const algProv = instance.resolve(diAlgorithmProvider);
      __classPrivateFieldSet(this, _Pkcs10CertificateRequest_signatureAlgorithm, algProv.toWebAlgorithm(this.asn.signatureAlgorithm), "f");
    }
    return __classPrivateFieldGet(this, _Pkcs10CertificateRequest_signatureAlgorithm, "f");
  }
  get signature() {
    if (!__classPrivateFieldGet(this, _Pkcs10CertificateRequest_signature, "f")) {
      __classPrivateFieldSet(this, _Pkcs10CertificateRequest_signature, this.asn.signature, "f");
    }
    return __classPrivateFieldGet(this, _Pkcs10CertificateRequest_signature, "f");
  }
  get publicKey() {
    if (!__classPrivateFieldGet(this, _Pkcs10CertificateRequest_publicKey, "f")) {
      __classPrivateFieldSet(this, _Pkcs10CertificateRequest_publicKey, new PublicKey(this.asn.certificationRequestInfo.subjectPKInfo), "f");
    }
    return __classPrivateFieldGet(this, _Pkcs10CertificateRequest_publicKey, "f");
  }
  get attributes() {
    if (!__classPrivateFieldGet(this, _Pkcs10CertificateRequest_attributes, "f")) {
      __classPrivateFieldSet(this, _Pkcs10CertificateRequest_attributes, this.asn.certificationRequestInfo.attributes.map((o) => AttributeFactory.create(AsnConvert.serialize(o))), "f");
    }
    return __classPrivateFieldGet(this, _Pkcs10CertificateRequest_attributes, "f");
  }
  get extensions() {
    if (!__classPrivateFieldGet(this, _Pkcs10CertificateRequest_extensions, "f")) {
      __classPrivateFieldSet(this, _Pkcs10CertificateRequest_extensions, [], "f");
      const extensions = this.getAttribute(id_pkcs9_at_extensionRequest);
      if (extensions instanceof ExtensionsAttribute) {
        __classPrivateFieldSet(this, _Pkcs10CertificateRequest_extensions, extensions.items, "f");
      }
    }
    return __classPrivateFieldGet(this, _Pkcs10CertificateRequest_extensions, "f");
  }
  get tbs() {
    if (!__classPrivateFieldGet(this, _Pkcs10CertificateRequest_tbs, "f")) {
      __classPrivateFieldSet(this, _Pkcs10CertificateRequest_tbs, this.asn.certificationRequestInfoRaw || AsnConvert.serialize(this.asn.certificationRequestInfo), "f");
    }
    return __classPrivateFieldGet(this, _Pkcs10CertificateRequest_tbs, "f");
  }
  constructor(param) {
    const args = PemData.isAsnEncoded(param) ? [param, CertificationRequest] : [param];
    super(args[0], args[1]);
    _Pkcs10CertificateRequest_tbs.set(this, void 0);
    _Pkcs10CertificateRequest_subjectName.set(this, void 0);
    _Pkcs10CertificateRequest_subject.set(this, void 0);
    _Pkcs10CertificateRequest_signatureAlgorithm.set(this, void 0);
    _Pkcs10CertificateRequest_signature.set(this, void 0);
    _Pkcs10CertificateRequest_publicKey.set(this, void 0);
    _Pkcs10CertificateRequest_attributes.set(this, void 0);
    _Pkcs10CertificateRequest_extensions.set(this, void 0);
    this.tag = PemConverter.CertificateRequestTag;
  }
  onInit(_asn) {
  }
  getAttribute(type) {
    for (const attr of this.attributes) {
      if (attr.type === type) {
        return attr;
      }
    }
    return null;
  }
  getAttributes(type) {
    return this.attributes.filter((o) => o.type === type);
  }
  getExtension(type) {
    for (const ext of this.extensions) {
      if (ext.type === type) {
        return ext;
      }
    }
    return null;
  }
  getExtensions(type) {
    return this.extensions.filter((o) => o.type === type);
  }
  async verify(crypto2 = cryptoProvider.get()) {
    const algorithm = {
      ...this.publicKey.algorithm,
      ...this.signatureAlgorithm
    };
    const publicKey = await this.publicKey.export(algorithm, ["verify"], crypto2);
    const signatureFormatters = instance.resolveAll(diAsnSignatureFormatter).reverse();
    let signature = null;
    for (const signatureFormatter of signatureFormatters) {
      signature = signatureFormatter.toWebSignature(algorithm, this.signature);
      if (signature) {
        break;
      }
    }
    if (!signature) {
      throw Error("Cannot convert WebCrypto signature value to ASN.1 format");
    }
    const ok = await crypto2.subtle.verify(this.signatureAlgorithm, publicKey, signature, this.tbs);
    return ok;
  }
  toTextObject() {
    const obj = this.toTextObjectEmpty();
    const req = AsnConvert.parse(this.rawData, CertificationRequest);
    const tbs = req.certificationRequestInfo;
    const data = new TextObject("", {
      Version: `${Version$1[tbs.version]} (${tbs.version})`,
      Subject: this.subject,
      "Subject Public Key Info": this.publicKey
    });
    if (this.attributes.length) {
      const attrs = new TextObject("");
      for (const ext of this.attributes) {
        const attrObj = ext.toTextObject();
        attrs[attrObj[TextObject.NAME]] = attrObj;
      }
      data["Attributes"] = attrs;
    }
    obj["Data"] = data;
    obj["Signature"] = new TextObject("", {
      Algorithm: TextConverter.serializeAlgorithm(req.signatureAlgorithm),
      "": req.signature
    });
    return obj;
  }
}
_Pkcs10CertificateRequest_tbs = /* @__PURE__ */ new WeakMap(), _Pkcs10CertificateRequest_subjectName = /* @__PURE__ */ new WeakMap(), _Pkcs10CertificateRequest_subject = /* @__PURE__ */ new WeakMap(), _Pkcs10CertificateRequest_signatureAlgorithm = /* @__PURE__ */ new WeakMap(), _Pkcs10CertificateRequest_signature = /* @__PURE__ */ new WeakMap(), _Pkcs10CertificateRequest_publicKey = /* @__PURE__ */ new WeakMap(), _Pkcs10CertificateRequest_attributes = /* @__PURE__ */ new WeakMap(), _Pkcs10CertificateRequest_extensions = /* @__PURE__ */ new WeakMap();
Pkcs10CertificateRequest.NAME = "PKCS#10 Certificate Request";
var _X509Certificate_tbs, _X509Certificate_serialNumber, _X509Certificate_subjectName, _X509Certificate_subject, _X509Certificate_issuerName, _X509Certificate_issuer, _X509Certificate_notBefore, _X509Certificate_notAfter, _X509Certificate_signatureAlgorithm, _X509Certificate_signature, _X509Certificate_extensions, _X509Certificate_publicKey;
class X509Certificate extends PemData {
  get publicKey() {
    if (!__classPrivateFieldGet(this, _X509Certificate_publicKey, "f")) {
      __classPrivateFieldSet(this, _X509Certificate_publicKey, new PublicKey(this.asn.tbsCertificate.subjectPublicKeyInfo), "f");
    }
    return __classPrivateFieldGet(this, _X509Certificate_publicKey, "f");
  }
  get serialNumber() {
    if (!__classPrivateFieldGet(this, _X509Certificate_serialNumber, "f")) {
      const tbs = this.asn.tbsCertificate;
      let serialNumberBytes = new Uint8Array(tbs.serialNumber);
      if (serialNumberBytes.length > 1 && serialNumberBytes[0] === 0 && serialNumberBytes[1] > 127) {
        serialNumberBytes = serialNumberBytes.slice(1);
      }
      __classPrivateFieldSet(this, _X509Certificate_serialNumber, Convert.ToHex(serialNumberBytes), "f");
    }
    return __classPrivateFieldGet(this, _X509Certificate_serialNumber, "f");
  }
  get subjectName() {
    if (!__classPrivateFieldGet(this, _X509Certificate_subjectName, "f")) {
      __classPrivateFieldSet(this, _X509Certificate_subjectName, new Name2(this.asn.tbsCertificate.subject), "f");
    }
    return __classPrivateFieldGet(this, _X509Certificate_subjectName, "f");
  }
  get subject() {
    if (!__classPrivateFieldGet(this, _X509Certificate_subject, "f")) {
      __classPrivateFieldSet(this, _X509Certificate_subject, this.subjectName.toString(), "f");
    }
    return __classPrivateFieldGet(this, _X509Certificate_subject, "f");
  }
  get issuerName() {
    if (!__classPrivateFieldGet(this, _X509Certificate_issuerName, "f")) {
      __classPrivateFieldSet(this, _X509Certificate_issuerName, new Name2(this.asn.tbsCertificate.issuer), "f");
    }
    return __classPrivateFieldGet(this, _X509Certificate_issuerName, "f");
  }
  get issuer() {
    if (!__classPrivateFieldGet(this, _X509Certificate_issuer, "f")) {
      __classPrivateFieldSet(this, _X509Certificate_issuer, this.issuerName.toString(), "f");
    }
    return __classPrivateFieldGet(this, _X509Certificate_issuer, "f");
  }
  get notBefore() {
    if (!__classPrivateFieldGet(this, _X509Certificate_notBefore, "f")) {
      const notBefore = this.asn.tbsCertificate.validity.notBefore.utcTime || this.asn.tbsCertificate.validity.notBefore.generalTime;
      if (!notBefore) {
        throw new Error("Cannot get 'notBefore' value");
      }
      __classPrivateFieldSet(this, _X509Certificate_notBefore, notBefore, "f");
    }
    return __classPrivateFieldGet(this, _X509Certificate_notBefore, "f");
  }
  get notAfter() {
    if (!__classPrivateFieldGet(this, _X509Certificate_notAfter, "f")) {
      const notAfter = this.asn.tbsCertificate.validity.notAfter.utcTime || this.asn.tbsCertificate.validity.notAfter.generalTime;
      if (!notAfter) {
        throw new Error("Cannot get 'notAfter' value");
      }
      __classPrivateFieldSet(this, _X509Certificate_notAfter, notAfter, "f");
    }
    return __classPrivateFieldGet(this, _X509Certificate_notAfter, "f");
  }
  get signatureAlgorithm() {
    if (!__classPrivateFieldGet(this, _X509Certificate_signatureAlgorithm, "f")) {
      const algProv = instance.resolve(diAlgorithmProvider);
      __classPrivateFieldSet(this, _X509Certificate_signatureAlgorithm, algProv.toWebAlgorithm(this.asn.signatureAlgorithm), "f");
    }
    return __classPrivateFieldGet(this, _X509Certificate_signatureAlgorithm, "f");
  }
  get signature() {
    if (!__classPrivateFieldGet(this, _X509Certificate_signature, "f")) {
      __classPrivateFieldSet(this, _X509Certificate_signature, this.asn.signatureValue, "f");
    }
    return __classPrivateFieldGet(this, _X509Certificate_signature, "f");
  }
  get extensions() {
    if (!__classPrivateFieldGet(this, _X509Certificate_extensions, "f")) {
      __classPrivateFieldSet(this, _X509Certificate_extensions, [], "f");
      if (this.asn.tbsCertificate.extensions) {
        __classPrivateFieldSet(this, _X509Certificate_extensions, this.asn.tbsCertificate.extensions.map((o) => ExtensionFactory.create(AsnConvert.serialize(o))), "f");
      }
    }
    return __classPrivateFieldGet(this, _X509Certificate_extensions, "f");
  }
  get tbs() {
    if (!__classPrivateFieldGet(this, _X509Certificate_tbs, "f")) {
      __classPrivateFieldSet(this, _X509Certificate_tbs, this.asn.tbsCertificateRaw || AsnConvert.serialize(this.asn.tbsCertificate), "f");
    }
    return __classPrivateFieldGet(this, _X509Certificate_tbs, "f");
  }
  constructor(param) {
    const args = PemData.isAsnEncoded(param) ? [param, Certificate] : [param];
    super(args[0], args[1]);
    _X509Certificate_tbs.set(this, void 0);
    _X509Certificate_serialNumber.set(this, void 0);
    _X509Certificate_subjectName.set(this, void 0);
    _X509Certificate_subject.set(this, void 0);
    _X509Certificate_issuerName.set(this, void 0);
    _X509Certificate_issuer.set(this, void 0);
    _X509Certificate_notBefore.set(this, void 0);
    _X509Certificate_notAfter.set(this, void 0);
    _X509Certificate_signatureAlgorithm.set(this, void 0);
    _X509Certificate_signature.set(this, void 0);
    _X509Certificate_extensions.set(this, void 0);
    _X509Certificate_publicKey.set(this, void 0);
    this.tag = PemConverter.CertificateTag;
  }
  onInit(_asn) {
  }
  getExtension(type) {
    for (const ext of this.extensions) {
      if (typeof type === "string") {
        if (ext.type === type) {
          return ext;
        }
      } else {
        if (ext instanceof type) {
          return ext;
        }
      }
    }
    return null;
  }
  getExtensions(type) {
    return this.extensions.filter((o) => {
      if (typeof type === "string") {
        return o.type === type;
      } else {
        return o instanceof type;
      }
    });
  }
  async verify(params = {}, crypto2 = cryptoProvider.get()) {
    let keyAlgorithm;
    let publicKey;
    const paramsKey = params.publicKey;
    try {
      if (!paramsKey) {
        keyAlgorithm = {
          ...this.publicKey.algorithm,
          ...this.signatureAlgorithm
        };
        publicKey = await this.publicKey.export(keyAlgorithm, ["verify"], crypto2);
      } else if ("publicKey" in paramsKey) {
        keyAlgorithm = {
          ...paramsKey.publicKey.algorithm,
          ...this.signatureAlgorithm
        };
        publicKey = await paramsKey.publicKey.export(keyAlgorithm, ["verify"], crypto2);
      } else if (paramsKey instanceof PublicKey) {
        keyAlgorithm = {
          ...paramsKey.algorithm,
          ...this.signatureAlgorithm
        };
        publicKey = await paramsKey.export(keyAlgorithm, ["verify"], crypto2);
      } else if (BufferSourceConverter.isBufferSource(paramsKey)) {
        const key = new PublicKey(paramsKey);
        keyAlgorithm = {
          ...key.algorithm,
          ...this.signatureAlgorithm
        };
        publicKey = await key.export(keyAlgorithm, ["verify"], crypto2);
      } else {
        keyAlgorithm = {
          ...paramsKey.algorithm,
          ...this.signatureAlgorithm
        };
        publicKey = paramsKey;
      }
    } catch {
      return false;
    }
    const signatureFormatters = instance.resolveAll(diAsnSignatureFormatter).reverse();
    let signature = null;
    for (const signatureFormatter of signatureFormatters) {
      signature = signatureFormatter.toWebSignature(keyAlgorithm, this.signature);
      if (signature) {
        break;
      }
    }
    if (!signature) {
      throw Error("Cannot convert ASN.1 signature value to WebCrypto format");
    }
    const ok = await crypto2.subtle.verify(this.signatureAlgorithm, publicKey, signature, this.tbs);
    if (params.signatureOnly) {
      return ok;
    } else {
      const date = params.date || /* @__PURE__ */ new Date();
      const time = date.getTime();
      return ok && this.notBefore.getTime() < time && time < this.notAfter.getTime();
    }
  }
  async getThumbprint(...args) {
    let crypto2;
    let algorithm = "SHA-1";
    if (args[0]) {
      if (!args[0].subtle) {
        algorithm = args[0] || algorithm;
        crypto2 = args[1];
      } else {
        crypto2 = args[0];
      }
    }
    crypto2 !== null && crypto2 !== void 0 ? crypto2 : crypto2 = cryptoProvider.get();
    return await crypto2.subtle.digest(algorithm, this.rawData);
  }
  async isSelfSigned(crypto2 = cryptoProvider.get()) {
    return this.subject === this.issuer && await this.verify({ signatureOnly: true }, crypto2);
  }
  toTextObject() {
    const obj = this.toTextObjectEmpty();
    const cert = AsnConvert.parse(this.rawData, Certificate);
    const tbs = cert.tbsCertificate;
    const data = new TextObject("", {
      Version: `${Version$1[tbs.version]} (${tbs.version})`,
      "Serial Number": tbs.serialNumber,
      "Signature Algorithm": TextConverter.serializeAlgorithm(tbs.signature),
      Issuer: this.issuer,
      Validity: new TextObject("", {
        "Not Before": tbs.validity.notBefore.getTime(),
        "Not After": tbs.validity.notAfter.getTime()
      }),
      Subject: this.subject,
      "Subject Public Key Info": this.publicKey
    });
    if (tbs.issuerUniqueID) {
      data["Issuer Unique ID"] = tbs.issuerUniqueID;
    }
    if (tbs.subjectUniqueID) {
      data["Subject Unique ID"] = tbs.subjectUniqueID;
    }
    if (this.extensions.length) {
      const extensions = new TextObject("");
      for (const ext of this.extensions) {
        const extObj = ext.toTextObject();
        extensions[extObj[TextObject.NAME]] = extObj;
      }
      data["Extensions"] = extensions;
    }
    obj["Data"] = data;
    obj["Signature"] = new TextObject("", {
      Algorithm: TextConverter.serializeAlgorithm(cert.signatureAlgorithm),
      "": cert.signatureValue
    });
    return obj;
  }
}
_X509Certificate_tbs = /* @__PURE__ */ new WeakMap(), _X509Certificate_serialNumber = /* @__PURE__ */ new WeakMap(), _X509Certificate_subjectName = /* @__PURE__ */ new WeakMap(), _X509Certificate_subject = /* @__PURE__ */ new WeakMap(), _X509Certificate_issuerName = /* @__PURE__ */ new WeakMap(), _X509Certificate_issuer = /* @__PURE__ */ new WeakMap(), _X509Certificate_notBefore = /* @__PURE__ */ new WeakMap(), _X509Certificate_notAfter = /* @__PURE__ */ new WeakMap(), _X509Certificate_signatureAlgorithm = /* @__PURE__ */ new WeakMap(), _X509Certificate_signature = /* @__PURE__ */ new WeakMap(), _X509Certificate_extensions = /* @__PURE__ */ new WeakMap(), _X509Certificate_publicKey = /* @__PURE__ */ new WeakMap();
X509Certificate.NAME = "Certificate";
function generateCertificateSerialNumber(input, crypto2 = cryptoProvider.get()) {
  const inputView = BufferSourceConverter.toUint8Array(Convert.FromHex(input || ""));
  let serialNumber = inputView && inputView.length && inputView.some((o) => o > 0) ? new Uint8Array(inputView) : void 0;
  if (!serialNumber) {
    serialNumber = crypto2.getRandomValues(new Uint8Array(16));
  }
  let firstNonZero = 0;
  while (firstNonZero < serialNumber.length - 1 && serialNumber[firstNonZero] === 0) {
    firstNonZero++;
  }
  serialNumber = serialNumber.slice(firstNonZero);
  if (serialNumber[0] > 127) {
    const newSerialNumber = new Uint8Array(serialNumber.length + 1);
    newSerialNumber[0] = 0;
    newSerialNumber.set(serialNumber, 1);
    serialNumber = newSerialNumber;
  }
  return serialNumber.buffer;
}
class X509CertificateGenerator {
  static async createSelfSigned(params, crypto2 = cryptoProvider.get()) {
    if (!params.keys.privateKey) {
      throw new Error("Bad field 'keys' in 'params' argument. 'privateKey' is empty");
    }
    if (!params.keys.publicKey) {
      throw new Error("Bad field 'keys' in 'params' argument. 'publicKey' is empty");
    }
    return this.create({
      serialNumber: params.serialNumber,
      subject: params.name,
      issuer: params.name,
      notBefore: params.notBefore,
      notAfter: params.notAfter,
      publicKey: params.keys.publicKey,
      signingKey: params.keys.privateKey,
      signingAlgorithm: params.signingAlgorithm,
      extensions: params.extensions
    }, crypto2);
  }
  static async create(params, crypto2 = cryptoProvider.get()) {
    var _a3;
    let spki;
    if (params.publicKey instanceof PublicKey) {
      spki = params.publicKey.rawData;
    } else if ("publicKey" in params.publicKey) {
      spki = params.publicKey.publicKey.rawData;
    } else if (BufferSourceConverter.isBufferSource(params.publicKey)) {
      spki = params.publicKey;
    } else {
      spki = await crypto2.subtle.exportKey("spki", params.publicKey);
    }
    const serialNumber = generateCertificateSerialNumber(params.serialNumber, crypto2);
    const notBefore = params.notBefore || /* @__PURE__ */ new Date();
    const notAfter = params.notAfter || new Date(notBefore.getTime() + 31536e6);
    const asnX509 = new Certificate({
      tbsCertificate: new TBSCertificate({
        version: Version$1.v3,
        serialNumber,
        validity: new Validity({
          notBefore,
          notAfter
        }),
        extensions: new Extensions(((_a3 = params.extensions) === null || _a3 === void 0 ? void 0 : _a3.map((o) => AsnConvert.parse(o.rawData, Extension$1))) || []),
        subjectPublicKeyInfo: AsnConvert.parse(spki, SubjectPublicKeyInfo)
      })
    });
    if (params.subject) {
      const name = params.subject instanceof Name2 ? params.subject : new Name2(params.subject);
      asnX509.tbsCertificate.subject = AsnConvert.parse(name.toArrayBuffer(), Name$1);
    }
    if (params.issuer) {
      const name = params.issuer instanceof Name2 ? params.issuer : new Name2(params.issuer);
      asnX509.tbsCertificate.issuer = AsnConvert.parse(name.toArrayBuffer(), Name$1);
    }
    const defaultSigningAlgorithm = { hash: "SHA-256" };
    const signatureAlgorithm = "signingKey" in params ? {
      ...defaultSigningAlgorithm,
      ...params.signingAlgorithm,
      ...params.signingKey.algorithm
    } : {
      ...defaultSigningAlgorithm,
      ...params.signingAlgorithm
    };
    const algProv = instance.resolve(diAlgorithmProvider);
    asnX509.tbsCertificate.signature = asnX509.signatureAlgorithm = algProv.toAsnAlgorithm(signatureAlgorithm);
    const tbs = AsnConvert.serialize(asnX509.tbsCertificate);
    const signatureValue = "signingKey" in params ? await crypto2.subtle.sign(signatureAlgorithm, params.signingKey, tbs) : params.signature;
    const signatureFormatters = instance.resolveAll(diAsnSignatureFormatter).reverse();
    let asnSignature = null;
    for (const signatureFormatter of signatureFormatters) {
      asnSignature = signatureFormatter.toAsnSignature(signatureAlgorithm, signatureValue);
      if (asnSignature) {
        break;
      }
    }
    if (!asnSignature) {
      throw Error("Cannot convert ASN.1 signature value to WebCrypto format");
    }
    asnX509.signatureValue = asnSignature;
    return new X509Certificate(AsnConvert.serialize(asnX509));
  }
}
var X509CrlReason;
(function(X509CrlReason2) {
  X509CrlReason2[X509CrlReason2["unspecified"] = 0] = "unspecified";
  X509CrlReason2[X509CrlReason2["keyCompromise"] = 1] = "keyCompromise";
  X509CrlReason2[X509CrlReason2["cACompromise"] = 2] = "cACompromise";
  X509CrlReason2[X509CrlReason2["affiliationChanged"] = 3] = "affiliationChanged";
  X509CrlReason2[X509CrlReason2["superseded"] = 4] = "superseded";
  X509CrlReason2[X509CrlReason2["cessationOfOperation"] = 5] = "cessationOfOperation";
  X509CrlReason2[X509CrlReason2["certificateHold"] = 6] = "certificateHold";
  X509CrlReason2[X509CrlReason2["removeFromCRL"] = 8] = "removeFromCRL";
  X509CrlReason2[X509CrlReason2["privilegeWithdrawn"] = 9] = "privilegeWithdrawn";
  X509CrlReason2[X509CrlReason2["aACompromise"] = 10] = "aACompromise";
})(X509CrlReason || (X509CrlReason = {}));
ExtensionFactory.register(id_ce_basicConstraints, BasicConstraintsExtension);
ExtensionFactory.register(id_ce_extKeyUsage, ExtendedKeyUsageExtension);
ExtensionFactory.register(id_ce_keyUsage, KeyUsagesExtension);
ExtensionFactory.register(id_ce_subjectKeyIdentifier, SubjectKeyIdentifierExtension);
ExtensionFactory.register(id_ce_authorityKeyIdentifier, AuthorityKeyIdentifierExtension);
ExtensionFactory.register(id_ce_subjectAltName, SubjectAlternativeNameExtension);
ExtensionFactory.register(id_ce_cRLDistributionPoints, CRLDistributionPointsExtension);
ExtensionFactory.register(id_pe_authorityInfoAccess, AuthorityInfoAccessExtension);
ExtensionFactory.register(id_ce_issuerAltName, IssuerAlternativeNameExtension);
AttributeFactory.register(id_pkcs9_at_challengePassword, ChallengePasswordAttribute);
AttributeFactory.register(id_pkcs9_at_extensionRequest, ExtensionsAttribute);
instance.registerSingleton(diAsnSignatureFormatter, AsnDefaultSignatureFormatter);
instance.registerSingleton(diAsnSignatureFormatter, AsnEcSignatureFormatter);
AsnEcSignatureFormatter.namedCurveSize.set("P-256", 32);
AsnEcSignatureFormatter.namedCurveSize.set("K-256", 32);
AsnEcSignatureFormatter.namedCurveSize.set("P-384", 48);
AsnEcSignatureFormatter.namedCurveSize.set("P-521", 66);
function requireNode$1(moduleName) {
  const proc = globalThis.process;
  if (typeof (proc == null ? void 0 : proc.getBuiltinModule) === "function") {
    const builtin = proc.getBuiltinModule(moduleName);
    if (builtin) {
      return builtin;
    }
  }
  if (typeof require === "function") {
    return require(moduleName);
  }
  throw new Error(`buckyos cert cannot load builtin module ${moduleName} in this runtime`);
}
function getCrypto() {
  const webcrypto = globalThis.crypto;
  if (webcrypto == null ? void 0 : webcrypto.subtle) {
    return webcrypto;
  }
  const nodeCrypto = requireNode$1("node:crypto");
  return nodeCrypto.webcrypto;
}
const CA_SIGNING_ALG = {
  name: "RSASSA-PKCS1-v1_5",
  hash: "SHA-256",
  publicExponent: new Uint8Array([1, 0, 1]),
  modulusLength: 4096
};
const SERVER_SIGNING_ALG = {
  ...CA_SIGNING_ALG,
  modulusLength: 2048
};
const CA_VALIDITY_DAYS = 3650;
const CERT_VALIDITY_DAYS = 365;
const DEFAULT_BUCKYOS_ROOT = "/opt/buckyos";
const X509_METADATA_SCHEMA = "buckyos.identity.x509.metadata.v1";
const IDENTITY_USAGES = [
  "server",
  "client",
  "authentication",
  "assertion",
  "key-agreement",
  "capability"
];
const IDENTITY_MATERIALS = [
  "did-json",
  "did-meta",
  "cert",
  "chain",
  "fullchain",
  "ca",
  "public",
  "csr",
  "meta",
  "private",
  "keyref",
  "verification-method"
];
function randomSerialNumber() {
  const bytes = new Uint8Array(16);
  getCrypto().getRandomValues(bytes);
  bytes[0] &= 127;
  bytes[0] |= 1;
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function daysFromNow(days) {
  return new Date(Date.now() + days * 24 * 3600 * 1e3);
}
async function exportPrivateKeyPem(key) {
  const der = new Uint8Array(await getCrypto().subtle.exportKey("pkcs8", key));
  return PemConverter.encode(der, "PRIVATE KEY");
}
function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function sha256Fingerprint(bytes) {
  const digest = await getCrypto().subtle.digest("SHA-256", bytes);
  return `sha256:${bytesToHex(new Uint8Array(digest))}`;
}
function encodeUtf8(value) {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(value);
  }
  const buffer = requireNode$1("node:buffer").Buffer;
  return new Uint8Array(buffer.from(value, "utf8"));
}
function encodeIdentityDirName(rawHostUri) {
  const keep = (byte) => byte >= 65 && byte <= 90 || byte >= 97 && byte <= 122 || byte >= 48 && byte <= 57 || byte === 46 || byte === 95 || byte === 45;
  let encoded = "";
  for (const byte of encodeUtf8(rawHostUri)) {
    if (keep(byte)) {
      encoded += String.fromCharCode(byte);
    } else {
      encoded += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  if (!encoded || encoded === "." || encoded === ".." || /[\\/]/.test(encoded) || encoded.includes("\0")) {
    throw new Error(`Invalid encoded identity directory name for raw host URI: ${rawHostUri}`);
  }
  return encoded;
}
function normalizeWildcardInput(didOrHostname) {
  if (didOrHostname.startsWith("did:web:*.")) {
    return `did:web:_.${didOrHostname.slice("did:web:*.".length)}`;
  }
  if (didOrHostname.startsWith("*.")) {
    return `_.${didOrHostname.slice(2)}`;
  }
  return didOrHostname;
}
function canonicalIdentityDid(didOrHostname) {
  const trimmed = didOrHostname.trim();
  if (!trimmed) {
    throw new Error("identity DID or hostname is empty");
  }
  return DID.fromStr(normalizeWildcardInput(trimmed));
}
function identityRawHostUri(didOrHostname) {
  return canonicalIdentityDid(didOrHostname).toRawHostUri();
}
function identityDirName(didOrHostname) {
  return encodeIdentityDirName(identityRawHostUri(didOrHostname));
}
function didWebDocumentUrl(didOrHostname) {
  const did = canonicalIdentityDid(didOrHostname);
  if (did.method !== "web") {
    return null;
  }
  const host = did.toRawHostName();
  const pathFromId = did.getPathFromId();
  if (pathFromId) {
    return `https://${host}/${pathFromId}/did.json`;
  }
  return `https://${host}/.well-known/did.json`;
}
function assertIdentityUsage(usage) {
  if (!IDENTITY_USAGES.includes(usage)) {
    throw new Error(`Unsupported identity usage: ${usage}`);
  }
}
function assertIdentityMaterial(material) {
  if (!IDENTITY_MATERIALS.includes(material)) {
    throw new Error(`Unsupported identity material: ${material}`);
  }
}
function identityFileName(usage, material) {
  assertIdentityUsage(usage);
  assertIdentityMaterial(material);
  switch (material) {
    case "did-json":
      return "did.json";
    case "did-meta":
      return "did.meta.json";
    case "cert":
      return `${usage}.cert.pem`;
    case "chain":
      return `${usage}.chain.pem`;
    case "fullchain":
      return `${usage}.fullchain.pem`;
    case "ca":
      return `${usage}.ca.pem`;
    case "public":
      return usage === "server" || usage === "client" ? `${usage}.public.pem` : `${usage}.public.jwk`;
    case "csr":
      return `${usage}.csr.pem`;
    case "meta":
      return `${usage}.meta.json`;
    case "private":
      return `${usage}.private.pem`;
    case "keyref":
      return `${usage}.keyref.json`;
    case "verification-method":
      return `${usage}.verification-method.json`;
  }
}
function getProcessEnv() {
  const runtimeProcess = globalThis.process;
  return (runtimeProcess == null ? void 0 : runtimeProcess.env) ?? {};
}
function trimToNull(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
function x509PathsForDirs(publicDir, securityDir, usage) {
  const path = requireNode$1("node:path");
  return {
    cert: path.join(publicDir, identityFileName(usage, "cert")),
    chain: path.join(publicDir, identityFileName(usage, "chain")),
    fullchain: path.join(publicDir, identityFileName(usage, "fullchain")),
    ca: path.join(publicDir, identityFileName(usage, "ca")),
    metadata: path.join(publicDir, identityFileName(usage, "meta")),
    keyref: path.join(securityDir, identityFileName(usage, "keyref")),
    privateKey: path.join(securityDir, identityFileName(usage, "private"))
  };
}
class IdentityRoots {
  constructor(publicRoot, securityRoot) {
    const path = requireNode$1("node:path");
    this.publicRoot = path.resolve(publicRoot);
    this.securityRoot = path.resolve(securityRoot);
  }
  static fromEnvOrBuckyosRoot(options = {}) {
    const path = requireNode$1("node:path");
    const env = getProcessEnv();
    const buckyosRoot = trimToNull(options.buckyosRoot) ?? trimToNull(env.BUCKYOS_ROOT) ?? DEFAULT_BUCKYOS_ROOT;
    const publicRoot = trimToNull(options.publicRoot) ?? trimToNull(env.BUCKYOS_IDENTITY_ROOT) ?? path.join(buckyosRoot, "local", "identity");
    const securityRoot = trimToNull(options.securityRoot) ?? trimToNull(env.BUCKYOS_SECURITY_ROOT) ?? path.join(buckyosRoot, "security");
    return new IdentityRoots(publicRoot, securityRoot);
  }
  rawHostUri(didOrHostname) {
    return identityRawHostUri(didOrHostname);
  }
  dirName(didOrHostname) {
    return identityDirName(didOrHostname);
  }
  publicDir(didOrHostname) {
    const path = requireNode$1("node:path");
    return path.join(this.publicRoot, this.dirName(didOrHostname));
  }
  securityDir(didOrHostname) {
    const path = requireNode$1("node:path");
    return path.join(this.securityRoot, this.dirName(didOrHostname));
  }
  publicFile(didOrHostname, usage, material) {
    const path = requireNode$1("node:path");
    return path.join(this.publicDir(didOrHostname), identityFileName(usage, material));
  }
  securityFile(didOrHostname, usage, material) {
    const path = requireNode$1("node:path");
    return path.join(this.securityDir(didOrHostname), identityFileName(usage, material));
  }
  x509Paths(didOrHostname, usage = "server") {
    return x509PathsForDirs(this.publicDir(didOrHostname), this.securityDir(didOrHostname), usage);
  }
  identityDirMatch(didOrHostname) {
    const rawHostUri = this.rawHostUri(didOrHostname);
    const dirName = encodeIdentityDirName(rawHostUri);
    return {
      type: rawHostUri.startsWith("_.") ? "wildcard" : "exact",
      rawHostUri,
      dirName,
      publicDir: this.publicDir(didOrHostname),
      securityDir: this.securityDir(didOrHostname),
      ...rawHostUri.startsWith("_.") ? { hostPattern: `*.${rawHostUri.slice(2)}` } : { host: rawHostUri }
    };
  }
  findX509Paths(didOrHostname, usage = "server") {
    const fs = requireNode$1("node:fs");
    const exact = this.identityDirMatch(didOrHostname);
    const exactPaths = x509PathsForDirs(exact.publicDir, exact.securityDir, usage);
    if (fs.existsSync(exactPaths.fullchain) || fs.existsSync(exactPaths.cert)) {
      return { match: exact, paths: exactPaths };
    }
    const did = canonicalIdentityDid(didOrHostname);
    if (did.method !== "web") {
      return null;
    }
    const host = did.toRawHostName();
    const labels = host.split(".");
    if (labels.length < 3) {
      return null;
    }
    const wildcardHost = `_.${labels.slice(1).join(".")}`;
    const wildcardDirName = encodeIdentityDirName(wildcardHost);
    const path = requireNode$1("node:path");
    const publicDir = path.join(this.publicRoot, wildcardDirName);
    const securityDir = path.join(this.securityRoot, wildcardDirName);
    const wildcardPaths = x509PathsForDirs(publicDir, securityDir, usage);
    if (!fs.existsSync(wildcardPaths.fullchain) && !fs.existsSync(wildcardPaths.cert)) {
      return null;
    }
    return {
      match: {
        type: "wildcard",
        rawHostUri: wildcardHost,
        dirName: wildcardDirName,
        publicDir,
        securityDir,
        hostPattern: `*.${labels.slice(1).join(".")}`
      },
      paths: wildcardPaths
    };
  }
}
async function importRsaPrivateKeyPem(pem) {
  const crypto2 = getCrypto();
  if (pem.includes("BEGIN RSA PRIVATE KEY")) {
    const pkcs1 = new Uint8Array(PemConverter.decode(pem)[0]);
    const pkcs8 = wrapRsaPkcs1InPkcs8(pkcs1);
    return crypto2.subtle.importKey("pkcs8", pkcs8, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  }
  const der = new Uint8Array(PemConverter.decode(pem)[0]);
  return crypto2.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}
function wrapRsaPkcs1InPkcs8(pkcs1) {
  const algorithmIdentifier = new Uint8Array([
    48,
    13,
    6,
    9,
    42,
    134,
    72,
    134,
    247,
    13,
    1,
    1,
    1,
    5,
    0
  ]);
  const version = new Uint8Array([2, 1, 0]);
  const octetString = derTlv(4, pkcs1);
  const body = new Uint8Array(version.length + algorithmIdentifier.length + octetString.length);
  body.set(version, 0);
  body.set(algorithmIdentifier, version.length);
  body.set(octetString, version.length + algorithmIdentifier.length);
  return derTlv(48, body);
}
function derTlv(tag, value) {
  let header;
  if (value.length < 128) {
    header = [tag, value.length];
  } else if (value.length < 256) {
    header = [tag, 129, value.length];
  } else {
    header = [tag, 130, value.length >> 8, value.length & 255];
  }
  const result = new Uint8Array(header.length + value.length);
  result.set(header, 0);
  result.set(value, header.length);
  return result;
}
function getCaValidationFailure(cert) {
  const basicConstraints = cert.extensions.find(
    (extension) => extension instanceof BasicConstraintsExtension
  );
  if (!(basicConstraints == null ? void 0 : basicConstraints.ca)) {
    return "missing basicConstraints CA:TRUE";
  }
  const keyUsages = cert.extensions.find(
    (extension) => extension instanceof KeyUsagesExtension
  );
  if (keyUsages && (keyUsages.usages & KeyUsageFlags.keyCertSign) === 0) {
    return "keyUsage does not allow certificate signing";
  }
  return void 0;
}
function getCaPemValidationFailure(pem) {
  try {
    return getCaValidationFailure(new X509Certificate(pem));
  } catch (error) {
    return error instanceof Error ? `cannot parse CA certificate: ${error.message}` : "cannot parse CA certificate";
  }
}
async function createCa(outputDir, name = "devtest") {
  const fs = requireNode$1("node:fs");
  const path = requireNode$1("node:path");
  const crypto2 = getCrypto();
  cryptoProvider.set(crypto2);
  fs.mkdirSync(outputDir, { recursive: true });
  const caKeyPath = path.join(outputDir, `${name}_ca_key.pem`);
  const caCertPath = path.join(outputDir, `${name}_ca_cert.pem`);
  const organization = `${name}'s Dev Test Environment`;
  const subject = `C=US, ST=California, L=San Jose, O=${organization}, OU=Test, CN=${name}`;
  const keys = await crypto2.subtle.generateKey(CA_SIGNING_ALG, true, ["sign", "verify"]);
  const cert = await X509CertificateGenerator.createSelfSigned({
    serialNumber: randomSerialNumber(),
    name: subject,
    notBefore: /* @__PURE__ */ new Date(),
    notAfter: daysFromNow(CA_VALIDITY_DAYS),
    signingAlgorithm: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    keys,
    extensions: [
      new BasicConstraintsExtension(true, void 0, true),
      new KeyUsagesExtension(
        KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign | KeyUsageFlags.digitalSignature,
        true
      ),
      await SubjectKeyIdentifierExtension.create(keys.publicKey)
    ]
  });
  fs.writeFileSync(caKeyPath, await exportPrivateKeyPem(keys.privateKey));
  fs.writeFileSync(caCertPath, cert.toString("pem"));
  console.log(`CA certificate created: ${caCertPath}`);
  return { caCertPath, caKeyPath };
}
async function ensureCa(caDir, name = "devtest") {
  const fs = requireNode$1("node:fs");
  const path = requireNode$1("node:path");
  const caCertPath = path.join(caDir, `${name}_ca_cert.pem`);
  const caKeyPath = path.join(caDir, `${name}_ca_key.pem`);
  if (fs.existsSync(caCertPath) && fs.existsSync(caKeyPath)) {
    const validationFailure = getCaPemValidationFailure(fs.readFileSync(caCertPath, "utf8"));
    if (validationFailure) {
      console.log(`Existing CA at ${caCertPath} is invalid (${validationFailure}); regenerating`);
      return createCa(caDir, name);
    }
    console.log(`Use existing CA at: ${caCertPath}`);
    return { caCertPath, caKeyPath };
  }
  return createCa(caDir, name);
}
function findCaFiles(caDir) {
  const fs = requireNode$1("node:fs");
  const path = requireNode$1("node:path");
  const certFiles = fs.readdirSync(caDir).filter((f) => f.endsWith("_ca_cert.pem"));
  if (certFiles.length === 0) {
    throw new Error(`No CA certificate found matching *_ca_cert.pem pattern in ${caDir}`);
  }
  if (certFiles.length > 1) {
    throw new Error(`Multiple CA certificates found in ${caDir}: ${certFiles.join(", ")}`);
  }
  const caCertPath = path.join(caDir, certFiles[0]);
  const caKeyPath = path.join(caDir, certFiles[0].replace("_ca_cert.pem", "_ca_key.pem"));
  if (!fs.existsSync(caKeyPath)) {
    throw new Error(`CA key not found: ${caKeyPath}`);
  }
  return { caCertPath, caKeyPath };
}
async function issueX509CertFromCa(caDir, dnsNames, uriSans = [], usage = "server") {
  const fs = requireNode$1("node:fs");
  const crypto2 = getCrypto();
  cryptoProvider.set(crypto2);
  const { caCertPath, caKeyPath } = findCaFiles(caDir);
  const caCertPem = fs.readFileSync(caCertPath, "utf8");
  const caCert = new X509Certificate(caCertPem);
  const validationFailure = getCaValidationFailure(caCert);
  if (validationFailure) {
    throw new Error(`Invalid CA certificate at ${caCertPath}: ${validationFailure}`);
  }
  const caKey = await importRsaPrivateKeyPem(fs.readFileSync(caKeyPath, "utf8"));
  const commonName = dnsNames[0];
  if (!commonName) {
    throw new Error("At least one DNS SAN is required when creating an X.509 certificate");
  }
  const keys = await crypto2.subtle.generateKey(SERVER_SIGNING_ALG, true, ["sign", "verify"]);
  const spki = new Uint8Array(await crypto2.subtle.exportKey("spki", keys.publicKey));
  const publicKeyFingerprint = await sha256Fingerprint(spki);
  const sanNames = [
    ...dnsNames.map((dns) => ({ type: "dns", value: dns })),
    ...uriSans.map((uri) => ({ type: "url", value: uri }))
  ];
  const cert = await X509CertificateGenerator.create({
    serialNumber: randomSerialNumber(),
    subject: `CN=${commonName}`,
    issuer: caCert.subject,
    notBefore: /* @__PURE__ */ new Date(),
    notAfter: daysFromNow(CERT_VALIDITY_DAYS),
    signingAlgorithm: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    publicKey: keys.publicKey,
    signingKey: caKey,
    extensions: [
      new KeyUsagesExtension(
        KeyUsageFlags.digitalSignature | KeyUsageFlags.keyEncipherment,
        true
      ),
      new ExtendedKeyUsageExtension([
        usage === "client" ? ExtendedKeyUsage2.clientAuth : ExtendedKeyUsage2.serverAuth
      ]),
      new SubjectAlternativeNameExtension(sanNames),
      await SubjectKeyIdentifierExtension.create(keys.publicKey),
      await AuthorityKeyIdentifierExtension.create(caCert)
    ]
  });
  return {
    cert,
    certPem: cert.toString("pem"),
    privateKeyPem: await exportPrivateKeyPem(keys.privateKey),
    caCertPem,
    publicKeyFingerprint
  };
}
async function createCertFromCa(caDir, hostname, targetDir, hostnames) {
  const fs = requireNode$1("node:fs");
  const path = requireNode$1("node:path");
  const dnsNames = hostnames && hostnames.length > 0 ? hostnames : [hostname];
  const commonName = dnsNames[0];
  const safeHostname = commonName.replace(/\*/g, "wildcard").replace(/\./g, "_");
  fs.mkdirSync(targetDir, { recursive: true });
  const certPath = path.join(targetDir, `${safeHostname}.crt`);
  const keyPath = path.join(targetDir, `${safeHostname}.key`);
  const issued = await issueX509CertFromCa(caDir, dnsNames);
  fs.writeFileSync(keyPath, issued.privateKeyPem);
  fs.writeFileSync(certPath, issued.certPem);
  console.log(`Certificate created: ${certPath}`);
  return { certPath, keyPath };
}
function normalizePem(pem) {
  return `${pem.trimEnd()}
`;
}
function writeFileAtomicSync(filePath, content, mode) {
  const fs = requireNode$1("node:fs");
  const path = requireNode$1("node:path");
  const dir = path.dirname(filePath);
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  try {
    fs.writeFileSync(tempPath, content, mode === void 0 ? void 0 : { mode });
    try {
      const fd = fs.openSync(tempPath, "r");
      try {
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    } catch {
    }
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
    }
    throw error;
  }
}
function writeJsonAtomicSync(filePath, value, mode) {
  writeFileAtomicSync(filePath, `${JSON.stringify(value, null, 2)}
`, mode);
}
function resolveIdentityRoots(roots) {
  return roots instanceof IdentityRoots ? roots : IdentityRoots.fromEnvOrBuckyosRoot(roots);
}
function x509DnsNameForDid(did) {
  const rawHostName = did.toRawHostName();
  if (rawHostName.startsWith("_.")) {
    return `*.${rawHostName.slice(2)}`;
  }
  return rawHostName;
}
function getSubjectAlternativeNames(cert) {
  const sanExtension = cert.extensions.find(
    (extension) => extension instanceof SubjectAlternativeNameExtension
  );
  const names2 = (sanExtension == null ? void 0 : sanExtension.names.toJSON()) ?? [];
  return {
    dns: names2.filter((name) => name.type === "dns").map((name) => name.value),
    uri: names2.filter((name) => name.type === "url").map((name) => name.value)
  };
}
async function certificateFingerprint(cert) {
  const thumbprint = await cert.getThumbprint("SHA-256", getCrypto());
  return `sha256:${bytesToHex(new Uint8Array(thumbprint))}`;
}
function buildDidBinding(did) {
  if (did.method !== "web" || did.toRawHostName().startsWith("_.")) {
    return void 0;
  }
  const didString = did.toString();
  return {
    type: "did-web-domain",
    did: didString,
    web_origin: `https://${did.toRawHostName()}`,
    did_document_url: didWebDocumentUrl(didString)
  };
}
async function buildX509Metadata(did, usage, rawHostUri, dirName, issued) {
  const san = getSubjectAlternativeNames(issued.cert);
  const certFingerprint = await certificateFingerprint(issued.cert);
  const isWildcard = rawHostUri.startsWith("_.");
  const updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  return {
    schema: X509_METADATA_SCHEMA,
    did: did.toString(),
    raw_host_uri: rawHostUri,
    dir_name: dirName,
    usage,
    match: isWildcard ? { type: "wildcard", host_pattern: `*.${rawHostUri.slice(2)}` } : { type: "exact", host: rawHostUri },
    certificate: {
      serial_number: issued.cert.serialNumber,
      issuer: issued.cert.issuer,
      subject: issued.cert.subject,
      not_before: issued.cert.notBefore.toISOString(),
      not_after: issued.cert.notAfter.toISOString(),
      fingerprint_sha256: certFingerprint,
      public_key_fingerprint: issued.publicKeyFingerprint
    },
    san,
    paths: {
      cert: identityFileName(usage, "cert"),
      chain: identityFileName(usage, "chain"),
      fullchain: identityFileName(usage, "fullchain"),
      ca: identityFileName(usage, "ca")
    },
    did_binding: buildDidBinding(did),
    updated_at: updatedAt,
    generation: `${updatedAt.replace(/[-:.]/g, "")}-${certFingerprint}`
  };
}
async function createIdentityCertFromCa(caDir, didOrHostname, rootsInput, options = {}) {
  const fs = requireNode$1("node:fs");
  const roots = resolveIdentityRoots(rootsInput);
  const usage = options.usage ?? "server";
  const did = canonicalIdentityDid(didOrHostname);
  const rawHostUri = did.toRawHostUri();
  const dirName = encodeIdentityDirName(rawHostUri);
  const publicDir = roots.publicDir(did.toString());
  const securityDir = roots.securityDir(did.toString());
  const paths = x509PathsForDirs(publicDir, securityDir, usage);
  const dnsNames = options.hostnames && options.hostnames.length > 0 ? options.hostnames : [x509DnsNameForDid(did)];
  const uriSans = options.uriSans ?? [did.toString()];
  fs.mkdirSync(publicDir, { recursive: true, mode: 493 });
  fs.mkdirSync(securityDir, { recursive: true, mode: 448 });
  const issued = await issueX509CertFromCa(caDir, dnsNames, uriSans, usage);
  const certPem = normalizePem(issued.certPem);
  const caPem = normalizePem(issued.caCertPem);
  const chainPem = caPem;
  const fullchainPem = `${certPem}${chainPem}`;
  writeFileAtomicSync(paths.privateKey, issued.privateKeyPem, 384);
  writeFileAtomicSync(paths.cert, certPem, 420);
  writeFileAtomicSync(paths.chain, chainPem, 420);
  writeFileAtomicSync(paths.fullchain, fullchainPem, 420);
  writeFileAtomicSync(paths.ca, caPem, 420);
  writeJsonAtomicSync(paths.metadata, await buildX509Metadata(did, usage, rawHostUri, dirName, issued), 420);
  console.log(`Identity certificate created: ${paths.fullchain}`);
  return {
    did: did.toString(),
    rawHostUri,
    dirName,
    paths,
    certPath: paths.cert,
    chainPath: paths.chain,
    fullchainPath: paths.fullchain,
    caPath: paths.ca,
    keyPath: paths.privateKey,
    metadataPath: paths.metadata
  };
}
const DEV_TEST_MNEMONIC = "test test test test test test test test test test test junk";
const DEV_TEST_EVM_SEED_SENDER_INDEX = 0;
const HARDENED_OFFSET = 2147483648;
const BUC_KEY_PURPOSE = 9777;
const BUC_KEY_COIN = 0;
const SECP256K1_N = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
const MASK_64 = (1n << 64n) - 1n;
const KECCAK_ROUNDS = [
  0x0000000000000001n,
  0x0000000000008082n,
  0x800000000000808an,
  0x8000000080008000n,
  0x000000000000808bn,
  0x0000000080000001n,
  0x8000000080008081n,
  0x8000000000008009n,
  0x000000000000008an,
  0x0000000000000088n,
  0x0000000080008009n,
  0x000000008000000an,
  0x000000008000808bn,
  0x800000000000008bn,
  0x8000000000008089n,
  0x8000000000008003n,
  0x8000000000008002n,
  0x8000000000000080n,
  0x000000000000800an,
  0x800000008000000an,
  0x8000000080008081n,
  0x8000000000008080n,
  0x0000000080000001n,
  0x8000000080008008n
];
const KECCAK_ROTATION = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14]
];
function mnemonicToSeed(mnemonic, passphrase = "") {
  return pbkdf2Sync(
    Buffer$1.from(mnemonic.normalize("NFKD"), "utf8"),
    Buffer$1.from(`mnemonic${passphrase}`.normalize("NFKD"), "utf8"),
    2048,
    64,
    "sha512"
  );
}
function hmacSha512(key, data) {
  return createHmac("sha512", key).update(data).digest();
}
function ser32(value) {
  const out = Buffer$1.alloc(4);
  out.writeUInt32BE(value >>> 0, 0);
  return out;
}
function pkcs8PemFromEd25519Seed(seed) {
  const pkcs8 = Buffer$1.concat([
    Buffer$1.from("302e020100300506032b657004220420", "hex"),
    seed
  ]);
  return `-----BEGIN PRIVATE KEY-----
${pkcs8.toString("base64")}
-----END PRIVATE KEY-----
`;
}
function getEd25519PublicKeyX(privateKeyPem) {
  const jwk = createPublicKey(createPrivateKey(privateKeyPem)).export({
    format: "jwk"
  });
  if (!jwk.x) {
    throw new Error("failed to derive Ed25519 public key x");
  }
  return jwk.x;
}
function slip10MasterKey(seed) {
  const result = hmacSha512("ed25519 seed", seed);
  return {
    key: result.subarray(0, 32),
    chainCode: result.subarray(32)
  };
}
function slip10DeriveHardened(parentKey, parentChainCode, index) {
  const data = Buffer$1.concat([
    Buffer$1.from([0]),
    parentKey,
    ser32(index + HARDENED_OFFSET)
  ]);
  const result = hmacSha512(parentChainCode, data);
  return {
    key: result.subarray(0, 32),
    chainCode: result.subarray(32)
  };
}
function deriveBuckyEd25519Seed(mnemonic, passphrase, index) {
  let node = slip10MasterKey(mnemonicToSeed(mnemonic, passphrase));
  for (const segment of [BUC_KEY_PURPOSE, BUC_KEY_COIN, index]) {
    node = slip10DeriveHardened(node.key, node.chainCode, segment);
  }
  return Buffer$1.from(node.key);
}
function deriveDevTestKeyPairFromMnemonic(mnemonic, passphrase, index) {
  const seed = deriveBuckyEd25519Seed(mnemonic, passphrase ?? "", index);
  const privateKeyPem = pkcs8PemFromEd25519Seed(seed);
  return {
    privateKeyPem,
    publicKeyX: getEd25519PublicKeyX(privateKeyPem)
  };
}
function deriveDevTestKeyPair(index) {
  return deriveDevTestKeyPairFromMnemonic(DEV_TEST_MNEMONIC, void 0, index);
}
function bigintTo32(value) {
  const hex = value.toString(16).padStart(64, "0");
  return Buffer$1.from(hex, "hex");
}
function bufferToBigint(value) {
  return BigInt(`0x${value.toString("hex")}`);
}
function secp256k1PublicKey(privateKey, compressed) {
  const ecdh = createECDH("secp256k1");
  ecdh.setPrivateKey(privateKey);
  return ecdh.getPublicKey(void 0, compressed ? "compressed" : "uncompressed");
}
function secp256k1MasterKey(seed) {
  const result = hmacSha512("Bitcoin seed", seed);
  const privateKey = result.subarray(0, 32);
  const privateKeyInt = bufferToBigint(privateKey);
  if (privateKeyInt <= 0n || privateKeyInt >= SECP256K1_N) {
    throw new Error("invalid secp256k1 master key");
  }
  return {
    privateKey: Buffer$1.from(privateKey),
    chainCode: result.subarray(32)
  };
}
function secp256k1ChildKey(parentPrivateKey, parentChainCode, index) {
  const hardened = index >= HARDENED_OFFSET;
  const data = hardened ? Buffer$1.concat([Buffer$1.from([0]), parentPrivateKey, ser32(index)]) : Buffer$1.concat([secp256k1PublicKey(parentPrivateKey, true), ser32(index)]);
  const result = hmacSha512(parentChainCode, data);
  const tweak = bufferToBigint(result.subarray(0, 32));
  if (tweak >= SECP256K1_N) {
    throw new Error(`invalid secp256k1 child tweak at index ${index}`);
  }
  const childPrivateKeyInt = (tweak + bufferToBigint(parentPrivateKey)) % SECP256K1_N;
  if (childPrivateKeyInt === 0n) {
    throw new Error(`invalid secp256k1 child key at index ${index}`);
  }
  return {
    privateKey: bigintTo32(childPrivateKeyInt),
    chainCode: result.subarray(32)
  };
}
function evmDerivationPath(index) {
  return [
    44 + HARDENED_OFFSET,
    60 + HARDENED_OFFSET,
    HARDENED_OFFSET,
    0,
    index
  ];
}
function evmDerivationPathString(index) {
  return `m/44'/60'/0'/0/${index}`;
}
function rotl64(value, shift) {
  if (shift === 0) {
    return value & MASK_64;
  }
  const n = BigInt(shift);
  return (value << n | value >> 64n - n) & MASK_64;
}
function keccakF1600(state) {
  for (const round of KECCAK_ROUNDS) {
    const c = new Array(5);
    const d = new Array(5);
    const b = new Array(25).fill(0n);
    for (let x = 0; x < 5; x += 1) {
      c[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    }
    for (let x = 0; x < 5; x += 1) {
      d[x] = c[(x + 4) % 5] ^ rotl64(c[(x + 1) % 5], 1);
    }
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        state[x + 5 * y] = (state[x + 5 * y] ^ d[x]) & MASK_64;
      }
    }
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl64(
          state[x + 5 * y],
          KECCAK_ROTATION[x][y]
        );
      }
    }
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        state[x + 5 * y] = (b[x + 5 * y] ^ ~b[(x + 1) % 5 + 5 * y] & MASK_64 & b[(x + 2) % 5 + 5 * y]) & MASK_64;
      }
    }
    state[0] = (state[0] ^ round) & MASK_64;
  }
}
function devTestKeccak256(data) {
  const rate = 136;
  const state = new Array(25).fill(0n);
  const padded = Buffer$1.concat([
    data,
    Buffer$1.from([1]),
    Buffer$1.alloc((rate - (data.length + 1) % rate) % rate)
  ]);
  padded[padded.length - 1] ^= 128;
  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let i = 0; i < rate; i += 1) {
      state[Math.floor(i / 8)] ^= BigInt(padded[offset + i]) << BigInt(i % 8 * 8);
    }
    keccakF1600(state);
  }
  const out = Buffer$1.alloc(32);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number(state[Math.floor(i / 8)] >> BigInt(i % 8 * 8) & 0xffn);
  }
  return out;
}
function eip55Address(addr20) {
  const lowerHex = addr20.toString("hex");
  const hash = devTestKeccak256(Buffer$1.from(lowerHex, "ascii"));
  let out = "0x";
  for (let i = 0; i < lowerHex.length; i += 1) {
    const ch = lowerHex[i];
    const nibble = hash[Math.floor(i / 2)] >> 4 * (1 - i % 2) & 15;
    out += /[a-f]/.test(ch) && nibble > 7 ? ch.toUpperCase() : ch;
  }
  return out;
}
function deriveDevTestEvmAccountFromMnemonic(mnemonic, passphrase, index) {
  let node = secp256k1MasterKey(mnemonicToSeed(mnemonic, passphrase ?? ""));
  for (const segment of evmDerivationPath(index)) {
    node = secp256k1ChildKey(node.privateKey, node.chainCode, segment);
  }
  const uncompressed = secp256k1PublicKey(node.privateKey, false);
  const compressed = secp256k1PublicKey(node.privateKey, true);
  const addressHash = devTestKeccak256(uncompressed.subarray(1));
  const privateKeyHex = node.privateKey.toString("hex");
  return {
    derivationPath: evmDerivationPathString(index),
    privateKey: `0x${privateKeyHex}`,
    privateKeyHex,
    publicKeyCompressedHex: compressed.toString("hex"),
    publicKeyUncompressedHex: uncompressed.toString("hex"),
    address: eip55Address(addressHash.subarray(12))
  };
}
function deriveDevTestEvmAccount(index) {
  return deriveDevTestEvmAccountFromMnemonic(DEV_TEST_MNEMONIC, void 0, index);
}
const DEV_TEST_KEY_INDEXES = {
  devtest: 0,
  alice: 1,
  bob: 2,
  charlie: 3,
  dave: 4,
  sn_owner: 5,
  devtests: 5,
  "devtest.ood1": 100,
  devtest_ood1: 100,
  "devtest.node1": 101,
  devtest_node1: 101,
  "alice.ood1": 102,
  alice_ood1: 102,
  "bob.ood1": 103,
  bob_ood1: 103,
  "charlie.ood1": 104,
  charlie_ood1: 104,
  "dave.ood1": 105,
  dave_ood1: 105,
  sn: 106,
  sn_server: 106,
  "devtests.ood1": 107,
  devtests_ood1: 107,
  sn_web: 107
};
const DEV_TEST_EVM_USER_INDEXES = {
  alice: 1,
  bob: 2,
  charlie: 3,
  dave: 4
};
const DEV_TEST_KEYS = Object.fromEntries(
  Object.entries(DEV_TEST_KEY_INDEXES).map(([id, index]) => [id, deriveDevTestKeyPair(index)])
);
const DEV_TEST_EVM_ACCOUNTS = Object.fromEntries(
  Object.entries(DEV_TEST_EVM_USER_INDEXES).map(([username, index]) => [
    username,
    deriveDevTestEvmAccount(index)
  ])
);
const DEV_TEST_EVM_SEED_SENDER = deriveDevTestEvmAccount(DEV_TEST_EVM_SEED_SENDER_INDEX);
function getDevTestKeyPairByIndex(index) {
  return deriveDevTestKeyPair(index);
}
function getDevTestKeyPairById(id) {
  const keyPair = DEV_TEST_KEYS[id];
  if (!keyPair) {
    throw new Error(`unknown dev test key pair id: ${id}`);
  }
  return keyPair;
}
function getDevTestEvmAccountByIndex(index) {
  return deriveDevTestEvmAccount(index);
}
function getDevTestEvmAccountByUsername(username) {
  const account = DEV_TEST_EVM_ACCOUNTS[username];
  if (!account) {
    throw new Error(`no deterministic EVM account for seed user ${username}; register it in DEV_TEST_EVM_USER_INDEXES`);
  }
  return account;
}
const PROVISION_BASE_TIME = 1743478939;
const DEFAULT_EXP_YEARS = 10;
const PROVISION_DEFAULT_EXP = PROVISION_BASE_TIME + 3600 * 24 * 365 * DEFAULT_EXP_YEARS;
const ADMIN_PASSWORD_HASH = "o8XyToejrbCYou84h/VkF4Tht0BeQQbuX3XKG+8+GQ4=";
const MIN_NODE_MAJOR = 22;
const MIN_NODE_MINOR = 13;
function parseVersion(version) {
  const parts = version.split(".");
  return [Number(parts[0]) || 0, Number(parts[1]) || 0];
}
function assertProvisionRuntime() {
  var _a3, _b, _c, _d;
  const globals = globalThis;
  const denoVersion = (_b = (_a3 = globals.Deno) == null ? void 0 : _a3.version) == null ? void 0 : _b.deno;
  if (denoVersion) {
    const [major, minor] = parseVersion(denoVersion);
    if (major > 2 || major === 2 && minor >= 2) {
      return;
    }
    throw new Error(`buckyos provision requires Deno >= 2.2 (node:sqlite), current: ${denoVersion}`);
  }
  const nodeVersion = (_d = (_c = globals.process) == null ? void 0 : _c.versions) == null ? void 0 : _d.node;
  if (nodeVersion) {
    const [major, minor] = parseVersion(nodeVersion);
    if (major > MIN_NODE_MAJOR || major === MIN_NODE_MAJOR && minor >= MIN_NODE_MINOR) {
      return;
    }
    throw new Error(`buckyos provision requires Node >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} (node:sqlite), current: ${nodeVersion}`);
  }
  throw new Error("buckyos provision requires a Node >= 22.13 or Deno >= 2.2 runtime (browser is not supported)");
}
function requireNode(moduleName) {
  assertProvisionRuntime();
  const proc = globalThis.process;
  if (typeof (proc == null ? void 0 : proc.getBuiltinModule) === "function") {
    const builtin = proc.getBuiltinModule(moduleName);
    if (builtin) {
      return builtin;
    }
  }
  if (typeof require === "function") {
    return require(moduleName);
  }
  throw new Error(`buckyos provision cannot load builtin module ${moduleName} in this runtime`);
}
function writeFileWithLog(filePath, content) {
  const fs = requireNode("node:fs");
  const path = requireNode("node:path");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  console.log(`# Write file: ${filePath}`);
}
function writeJsonWithLog(filePath, data) {
  writeFileWithLog(filePath, JSON.stringify(data, null, 2));
}
function readJson(filePath) {
  const fs = requireNode("node:fs");
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
function sortKeysDeep(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeysDeep(value[key]);
    }
    return sorted;
  }
  return value;
}
function resolveOwnerKeyPair(username, override) {
  if (override) {
    return override;
  }
  if (DEV_TEST_KEYS[username]) {
    return DEV_TEST_KEYS[username];
  }
  if (DEV_TEST_KEYS[`${username}.owner`]) {
    return DEV_TEST_KEYS[`${username}.owner`];
  }
  console.log(`Warning: Key pair for user ${username} not found, using devtest key pair`);
  return getDevTestKeyPairById("devtest");
}
function resolveDeviceKeyPair(username, deviceName, override) {
  if (override) {
    return override;
  }
  return getDevTestKeyPairById(`${username}.${deviceName}`);
}
async function createUserEnv(params) {
  assertProvisionRuntime();
  const path = requireNode("node:path");
  const rtcpPort = params.rtcpPort ?? 2980;
  const userDir = params.outputDir;
  const exp = PROVISION_DEFAULT_EXP;
  const keyPair = resolveOwnerKeyPair(params.username, params.ownerKeyPair);
  const ownerDid = new DID("bns", params.username);
  let zoneDid = new DID("web", params.hostname);
  let snHost;
  if (params.snBaseHost && params.snBaseHost.includes(".")) {
    const web3Bns = `web3.${params.snBaseHost}`;
    zoneDid = DID.fromHostNameByBridge(params.hostname, "bns", web3Bns);
    snHost = `sn.${params.snBaseHost}`;
  }
  writeFileWithLog(path.join(userDir, "user_private_key.pem"), keyPair.privateKeyPem);
  const ownerJwk = createJwkByX(keyPair.publicKeyX);
  const ownerDoc = newOwnerDocument({
    did: ownerDid,
    name: params.username,
    displayName: params.username,
    publicKeyJwk: ownerJwk
  });
  writeJsonWithLog(path.join(userDir, "user_config.json"), ownerDocumentToOrderedJson(ownerDoc));
  console.log(`Created owner config for ${params.username}`);
  const ood = parseOODDescription(params.oodName);
  const deviceKeyPair = resolveDeviceKeyPair(params.username, ood.name, params.deviceKeyPair);
  let ddnsSnUrl;
  let realSnHost = snHost;
  if (ood.netId) {
    if (ood.netId.startsWith("wan")) {
      realSnHost = void 0;
    }
    if (ood.netId.startsWith("wan_dyn") && snHost) {
      ddnsSnUrl = `https://${snHost}/kapi/sn`;
    }
  }
  const oodString = oodDescriptionToString(ood);
  const zoneBoot = newZoneBootDocument({ oods: [oodString], sn: realSnHost, exp });
  const zoneHostName = zoneDid.toRawHostName();
  writeJsonWithLog(path.join(userDir, `${zoneHostName}.zone.json`), zoneBoot);
  zoneBoot.id = zoneDid.toString();
  const zoneDoc = newZoneDocument({ id: zoneDid, ownerDid, publicKeyJwk: ownerJwk });
  const bootJwt = await encodeZoneBootDocument(zoneBoot, keyPair.privateKeyPem);
  zoneDoc.boot_jwt = bootJwt;
  zoneDoc.id = zoneBoot.id;
  zoneDoc.oods = [...zoneBoot.oods];
  if (zoneBoot.sn !== void 0) {
    zoneDoc.sn = zoneBoot.sn;
  } else {
    delete zoneDoc.sn;
  }
  zoneDoc.exp = zoneBoot.exp;
  zoneDoc.iat = zoneBoot.exp - DEFAULT_EXPIRE_TIME;
  zoneDoc.version_seq = 0;
  zoneDoc.owner = zoneBoot.owner ?? DID.undefined().toString();
  if (zoneBoot.owner_key !== void 0) {
    zoneDoc.verificationMethod[0].publicKeyJwk = zoneBoot.owner_key;
  }
  writeJsonWithLog(path.join(userDir, "zone_config.json"), zoneDocumentToOrderedJson(zoneDoc));
  const pkx = keyPair.publicKeyX;
  console.log(`=> ${zoneHostName} TXT Record(${bootJwt.length + 6}): BOOT=${bootJwt};`);
  console.log(`=> ${zoneHostName} TXT Record(${pkx.length + 5}): PKX=${pkx};`);
  const realRtcpPort = rtcpPort === 2980 ? void 0 : rtcpPort;
  const miniDoc = newDeviceMiniDocument({
    name: ood.name,
    x: deviceKeyPair.publicKeyX,
    rtcpPort: realRtcpPort,
    exp
  });
  const miniJwt = await deviceMiniDocumentToJwt(miniDoc, keyPair.privateKeyPem);
  console.log(`=> ${zoneHostName} TXT Record(${miniJwt.length + 5}): DEV=${miniJwt};`);
  const deviceDid = buildDeviceDid(ood.name, zoneDid);
  const deviceDoc = newDeviceDocumentByJwkWithDid(ood.name, createJwkByX(deviceKeyPair.publicKeyX), deviceDid);
  deviceDoc.support_container = true;
  if (ood.netId !== void 0) {
    deviceDoc.net_id = ood.netId;
  }
  deviceDoc.owner = ownerDid.toString();
  deviceDoc.zone_did = zoneDid.toString();
  if (ddnsSnUrl !== void 0) {
    deviceDoc.ddns_sn_url = ddnsSnUrl;
  }
  console.log(`${ood.name} device config: ${JSON.stringify(deviceDocumentToOrderedJson(deviceDoc), null, 2)}`);
  const zoneTxtRecord = {
    boot_config_jwt: bootJwt,
    device_mini_doc_jwt: miniJwt,
    pkx
  };
  writeJsonWithLog(path.join(userDir, "zone_txt_record.json"), zoneTxtRecord);
  console.log(`Successfully created user environment configuration: ${params.username}`);
  return zoneTxtRecord;
}
function nodeTestIdentityRoots(nodeDir) {
  const path = requireNode("node:path");
  return new IdentityRoots(path.join(nodeDir, "local", "identity"), path.join(nodeDir, "security"));
}
async function createNodeConfigs(params) {
  assertProvisionRuntime();
  const path = requireNode("node:path");
  const rootDir = params.envDir;
  const userConfig = readJson(path.join(rootDir, "user_config.json"));
  const username = userConfig.name;
  if (typeof username !== "string" || !username) {
    throw new Error("user_config.json missing name field");
  }
  const zoneConfig = readJson(path.join(rootDir, "zone_config.json"));
  const zoneDid = DID.fromStr(zoneConfig.id);
  const keyPair = resolveOwnerKeyPair(username, params.ownerKeyPair);
  const deviceKeyPair = resolveDeviceKeyPair(username, params.deviceName, params.deviceKeyPair);
  const nodeDir = path.join(rootDir, params.deviceName);
  const ownerDid = new DID("bns", username);
  const deviceDid = buildDeviceDid(params.deviceName, zoneDid);
  const deviceDoc = newDeviceDocumentByJwkWithDid(
    params.deviceName,
    createJwkByX(deviceKeyPair.publicKeyX),
    deviceDid,
    params.now
  );
  deviceDoc.support_container = true;
  delete deviceDoc.support_container;
  if (params.netId !== void 0) {
    deviceDoc.net_id = params.netId;
  }
  deviceDoc.owner = ownerDid.toString();
  deviceDoc.zone_did = zoneDid.toString();
  console.log(`input net_id: ${params.netId}, device_config.net_id: ${deviceDoc.net_id}`);
  const deviceJwt = await encodeDeviceDocument(deviceDoc, keyPair.privateKeyPem);
  console.log(`${params.deviceName} device jwt: ${deviceJwt}`);
  const deviceMiniDoc = newDeviceMiniDocumentByDeviceDocument(deviceDoc);
  const deviceMiniJwt = await deviceMiniDocumentToJwt(deviceMiniDoc, keyPair.privateKeyPem);
  writeFileWithLog(path.join(nodeDir, "device_mini_config.jwt"), deviceMiniJwt);
  const identityConfig = newLocalNodeIdentityConfig({
    zoneDid,
    ownerDid,
    ownerPublicKey: createJwkByX(keyPair.publicKeyX),
    deviceName: params.deviceName,
    deviceDid,
    zoneIat: PROVISION_BASE_TIME
  });
  const roots = nodeTestIdentityRoots(nodeDir);
  saveLocalDeviceIdentityForRoots(
    nodeDir,
    roots,
    identityConfig,
    deviceDoc,
    deviceJwt,
    deviceMiniJwt,
    deviceKeyPair.privateKeyPem
  );
  if (params.deviceName.startsWith("ood")) {
    const startConfig = sortKeysDeep({
      admin_password_hash: ADMIN_PASSWORD_HASH,
      device_private_key: deviceKeyPair.privateKeyPem,
      device_public_key: createJwkByX(deviceKeyPair.publicKeyX),
      ood_jwt: deviceJwt,
      friend_passcode: "sdfsdfsdf",
      gateway_type: "PortForward",
      guest_access: true,
      private_key: keyPair.privateKeyPem,
      public_key: createJwkByX(keyPair.publicKeyX),
      user_name: username,
      zone_name: zoneDid.toHostName(),
      BUCKYOS_ROOT: "/opt/buckyos"
    });
    writeJsonWithLog(path.join(nodeDir, "start_config.json"), startConfig);
  }
  console.log(`Successfully created node configuration: ${username}.${params.deviceName}`);
  return encodeDeviceDocument(deviceDoc, deviceKeyPair.privateKeyPem);
}
class DevSnDb {
  constructor(dbPath) {
    assertProvisionRuntime();
    this.dbPath = dbPath;
  }
  connect() {
    const { DatabaseSync } = requireNode("node:sqlite");
    return new DatabaseSync(this.dbPath);
  }
  // Schema is byte-for-byte the SQL used by Rust DevSnDb::initialize_database.
  initializeDatabase() {
    const db = this.connect();
    try {
      db.exec(
        `CREATE TABLE IF NOT EXISTS activation_codes (code TEXT PRIMARY KEY, used INTEGER);
             CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, state TEXT, public_key TEXT, activation_code TEXT, zone_config TEXT, self_cert boolean, user_domain TEXT, sn_ips TEXT);
             CREATE TABLE IF NOT EXISTS user_auth_v2 (username TEXT PRIMARY KEY, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, password_algo TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_login_at INTEGER NULL);
             CREATE TABLE IF NOT EXISTS devices (owner TEXT, device_name TEXT, did TEXT PRIMARY KEY, ip TEXT, description TEXT, mini_config_jwt TEXT, created_at INTEGER, updated_at INTEGER);
             CREATE TABLE IF NOT EXISTS user_dns_records (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT, domain TEXT, record_type TEXT, record TEXT, ttl INTEGER, created_at INTEGER, updated_at INTEGER);
             CREATE UNIQUE INDEX IF NOT EXISTS idx_user_domain_record_type ON user_dns_records (owner, domain, record_type);
             CREATE INDEX IF NOT EXISTS user_dns_records_domain_index ON user_dns_records (domain, id);
             CREATE TABLE IF NOT EXISTS user_domain_history (domain TEXT PRIMARY KEY, owner TEXT NOT NULL, created_at INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS did_documents (id INTEGER PRIMARY KEY AUTOINCREMENT, obj_id TEXT, owner_user TEXT, obj_name TEXT, did_document TEXT, doc_type TEXT, update_time INTEGER);
             CREATE INDEX IF NOT EXISTS idx_did_documents_owner_obj ON did_documents (owner_user, obj_name, update_time);`
      );
    } finally {
      db.close();
    }
  }
  insertActivationCode(code) {
    const db = this.connect();
    try {
      db.prepare("INSERT INTO activation_codes (code, used) VALUES (?, 0)").run(code);
    } finally {
      db.close();
    }
  }
  // Mirror register_user_directly: state="active", activation_code="DIRECT", self_cert=true.
  registerUserDirectly(username, publicKey, zoneConfig, userDomain) {
    const db = this.connect();
    try {
      db.prepare(
        "INSERT INTO users (username, state, public_key, activation_code, zone_config, user_domain, self_cert, sn_ips) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(username, "active", publicKey, "DIRECT", zoneConfig, userDomain ?? null, 1, null);
    } finally {
      db.close();
    }
  }
  registerDevice(username, deviceName, did, miniConfigJwt, ip, description) {
    const now = buckyosGetUnixTimestamp();
    const db = this.connect();
    try {
      db.prepare(
        "INSERT INTO devices (owner, device_name, did, ip, description, mini_config_jwt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(username, deviceName, did, ip, description, miniConfigJwt, now, now);
    } finally {
      db.close();
    }
  }
}
async function createSnConfigs(params) {
  assertProvisionRuntime();
  const path = requireNode("node:path");
  const snDir = path.join(params.outputDir, "sn_server");
  const ownerKeys = getDevTestKeyPairById("sn_owner");
  const deviceKeys = getDevTestKeyPairById("sn_server");
  const exp = PROVISION_DEFAULT_EXP;
  writeFileWithLog(path.join(snDir, ".buckycli", "user_private_key.pem"), ownerKeys.privateKeyPem);
  const ownerDoc = newOwnerDocument({
    did: new DID("bns", "sn"),
    name: "root",
    displayName: "sn admin",
    publicKeyJwk: createJwkByX(ownerKeys.publicKeyX)
  });
  writeJsonWithLog(path.join(snDir, ".buckycli", "user_config.json"), ownerDocumentToOrderedJson(ownerDoc));
  console.log("- Created owner config for sn admin.");
  const miniDoc = newDeviceMiniDocument({ name: "sn", x: deviceKeys.publicKeyX, exp });
  const miniJwt = await deviceMiniDocumentToJwt(miniDoc, ownerKeys.privateKeyPem);
  const deviceDoc = newDeviceDocumentByMiniDocument(miniJwt, miniDoc, "did:web:sn.devtests.org", "did:bns:sn");
  deviceDoc.net_id = "wan";
  writeJsonWithLog(path.join(snDir, "sn_device_config.json"), deviceDocumentToOrderedJson(deviceDoc));
  writeFileWithLog(path.join(snDir, "sn_private_key.pem"), deviceKeys.privateKeyPem);
  console.log("- Created sn device config & private key.");
  const zoneBoot = newZoneBootDocument({ oods: ["sn"], exp });
  const zoneBootJwt = await encodeZoneBootDocument(zoneBoot, ownerKeys.privateKeyPem);
  const paramsJson = sortKeysDeep({
    params: {
      sn_boot_jwt: zoneBootJwt,
      sn_owner_pk: ownerKeys.publicKeyX,
      sn_device_jwt: miniJwt,
      sn_host: params.snBaseHost,
      sn_ip: params.snIp,
      sn_cer: "fullchain.cert",
      sn_pem: "fullchain.pem",
      web3_cer: "fullchain.cert",
      web3_pem: "fullchain.pem"
    }
  });
  writeJsonWithLog(path.join(snDir, "params.json"), paramsJson);
  console.log("- Created params.json.");
  const db = new DevSnDb(path.join(snDir, "sn_db.sqlite3"));
  db.initializeDatabase();
  for (let i = 0; i < 9; i++) {
    const code = `sndevtest${i}`;
    console.log(`insert activation code: ${code}`);
    db.insertActivationCode(code);
  }
  console.log("- Created SN database.");
  console.log("Successfully created SN configuration");
}
async function registerUserToSn(rootDir, userZoneId, snDbPath) {
  assertProvisionRuntime();
  const path = requireNode("node:path");
  const userConfig = readJson(path.join(rootDir, userZoneId, "user_config.json"));
  const username = userConfig.name;
  if (typeof username !== "string" || !username) {
    throw new Error("user_config.json missing name field");
  }
  const zoneConfig = readJson(path.join(rootDir, userZoneId, "zone_config.json"));
  const zoneDid = DID.fromStr(zoneConfig.id);
  let userDomain;
  if (zoneDid.method !== "bns") {
    userDomain = zoneDid.toHostName();
  }
  const zoneRecord = readJson(path.join(rootDir, userZoneId, "zone_txt_record.json"));
  const db = new DevSnDb(snDbPath);
  const publicKeyJson = JSON.stringify(sortKeysDeep({ kty: "OKP", crv: "Ed25519", x: zoneRecord.pkx }));
  db.registerUserDirectly(username, publicKeyJson, zoneRecord.boot_config_jwt, userDomain);
  console.log(`Successfully registered user ${username}@${userZoneId} to SN database at ${snDbPath}`);
}
function currentArch() {
  var _a3;
  const arch = ((_a3 = globalThis.process) == null ? void 0 : _a3.arch) ?? "";
  if (arch === "x64")
    return "amd64";
  if (arch === "arm64")
    return "aarch64";
  return arch;
}
function currentOsType() {
  var _a3;
  const platform = ((_a3 = globalThis.process) == null ? void 0 : _a3.platform) ?? "";
  if (platform === "darwin")
    return "apple";
  if (platform === "win32")
    return "windows";
  return platform;
}
function collectLocalIps() {
  const os = requireNode("node:os");
  const result = [];
  const interfaces = os.networkInterfaces();
  for (const list of Object.values(interfaces)) {
    for (const item of list ?? []) {
      if (item.internal)
        continue;
      if (item.family === "IPv6" && item.address.startsWith("fe80"))
        continue;
      if (!result.includes(item.address)) {
        result.push(item.address);
      }
    }
  }
  return result;
}
async function registerDeviceToSn(rootDir, userZoneId, deviceName, snDbPath) {
  assertProvisionRuntime();
  const path = requireNode("node:path");
  const fs = requireNode("node:fs");
  const os = requireNode("node:os");
  const deviceDir = path.join(rootDir, userZoneId, deviceName);
  const nodeIdentityPath = path.join(deviceDir, "node_identity.json");
  if (!fs.existsSync(nodeIdentityPath)) {
    throw new Error(`Device config not found: ${nodeIdentityPath}`);
  }
  const nodeIdentity = loadLocalNodeIdentityConfig(nodeIdentityPath);
  const username = DID.fromStr(nodeIdentity.owner_did).id;
  const identityPaths = deviceIdentityPathsForRoots(nodeTestIdentityRoots(deviceDir), nodeIdentity.device_did);
  const deviceDocJwt = fs.readFileSync(identityPaths.deviceDocJwt, "utf8");
  const deviceMiniDocJwt = fs.readFileSync(identityPaths.deviceMiniDocJwt, "utf8");
  const deviceDoc = await verifyJwtEdDSA(deviceDocJwt, nodeIdentity.owner_public_key);
  const deviceDid = deviceDoc.id;
  let oodDesc;
  try {
    oodDesc = parseOODDescription(deviceName);
  } catch {
    oodDesc = { name: deviceName, nodeType: "Device" };
  }
  try {
    const zoneConfig = readJson(path.join(rootDir, userZoneId, "zone_config.json"));
    const matched = zoneConfig.oods.map(parseOODDescription).find((item) => item.name === deviceName);
    if (matched) {
      oodDesc = matched;
    }
  } catch {
  }
  const allIp = collectLocalIps();
  const baseDevice = {
    ...deviceDoc
  };
  if (oodDesc.ip) {
    baseDevice.ips = [oodDesc.ip];
  }
  if (oodDesc.netId !== void 0) {
    baseDevice.net_id = oodDesc.netId;
  }
  const deviceInfo = {
    ...baseDevice,
    arch: currentArch(),
    os: currentOsType(),
    update_time: buckyosGetUnixTimestamp(),
    state: "Ready",
    sys_hostname: os.hostname(),
    base_os_info: `${os.type()} ${os.release()}`,
    all_ip: allIp,
    cpu_num: os.cpus().length,
    total_mem: os.totalmem(),
    mem_usage: os.totalmem() - os.freemem()
  };
  let deviceIp = "127.0.0.1";
  if (allIp.length > 0) {
    deviceIp = allIp[0];
  }
  if (oodDesc.ip) {
    deviceIp = oodDesc.ip;
  }
  const db = new DevSnDb(snDbPath);
  db.registerDevice(
    username,
    deviceName,
    deviceDid,
    deviceMiniDocJwt,
    deviceIp,
    JSON.stringify(deviceInfo, null, 2)
  );
  console.log(`Successfully registered device ${username}.${deviceName} (DID: ${deviceDid}) to SN database at ${snDbPath}`);
}
function versionToInt(version) {
  const buildPos = version.search(/[-+]/);
  const versionCore = buildPos >= 0 ? version.slice(0, buildPos) : version;
  const parts = versionCore.split(".");
  if (parts.length < 1 || parts.length > 4) {
    throw new Error(`invalid version format: ${version}`);
  }
  if (parts.length === 3 && buildPos >= 0) {
    parts.push(version.slice(buildPos));
  }
  const leadingDigits = (value) => {
    if (value === void 0)
      return 0n;
    const digitsOnly = value.replace(/^[^0-9]*/, "");
    const match = digitsOnly.match(/^\d+/);
    if (!match)
      return 0n;
    return BigInt(match[0]);
  };
  const parseNum = (value) => {
    if (value === void 0)
      return 0n;
    return /^\d+$/.test(value) ? BigInt(value) : 0n;
  };
  const major = leadingDigits(parts[0]);
  if (major > 0xffn)
    throw new Error(`major version out of range: ${version}`);
  const minor = parseNum(parts[1]);
  if (minor > 0xffffn)
    throw new Error(`minor version out of range: ${version}`);
  const patch = parseNum(parts[2]);
  if (patch > 0xffffn)
    throw new Error(`patch version out of range: ${version}`);
  const build = leadingDigits(parts[3]);
  if (build > 0xffffffn)
    throw new Error(`build number out of range: ${version}`);
  return major << 56n | minor << 40n | patch << 24n | build;
}
function normalizePackageMetaForObjId(meta) {
  const normalized = { ...meta };
  const dropIf = (key, shouldDrop) => {
    if (key in normalized && shouldDrop(normalized[key])) {
      delete normalized[key];
    }
  };
  dropIf("did", (v) => v === null || v === void 0);
  dropIf("name", (v) => v === "");
  dropIf("author", (v) => v === "");
  dropIf("owner", (v) => v === null || v === void 0 || v === "did:undefined:undefined");
  dropIf("copyright", (v) => v === null || v === void 0);
  dropIf("tags", (v) => Array.isArray(v) && v.length === 0);
  dropIf("categories", (v) => Array.isArray(v) && v.length === 0);
  dropIf("base_on", (v) => v === null || v === void 0);
  dropIf("directory", (v) => v && typeof v === "object" && Object.keys(v).length === 0);
  dropIf("references", (v) => v && typeof v === "object" && Object.keys(v).length === 0);
  dropIf("exp", (v) => v === 0);
  dropIf("size", (v) => v === 0);
  dropIf("content", (v) => v === "");
  dropIf("version_tag", (v) => v === null || v === void 0);
  dropIf("deps", (v) => v && typeof v === "object" && Object.keys(v).length === 0);
  return normalized;
}
function calcPkgMetaObjId(metaJson) {
  const normalized = normalizePackageMetaForObjId(metaJson);
  const [objId] = buildNamedObjectByJson("pkg", normalized);
  return objId.toString();
}
class MetaIndexDb {
  constructor(dbPath) {
    assertProvisionRuntime();
    this.dbPath = dbPath;
  }
  connect() {
    const { DatabaseSync } = requireNode("node:sqlite");
    return new DatabaseSync(this.dbPath);
  }
  // Unlike make_config.py-era flows, the TS implementation always creates the
  // tables itself (schema identical to package-lib meta_index_db.rs).
  initializeDatabase() {
    const db = this.connect();
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS pkg_metas (
                metaobjid TEXT PRIMARY KEY,
                pkg_meta TEXT NOT NULL,
                author TEXT NOT NULL,
                author_pk TEXT NOT NULL,
                update_time INTEGER NOT NULL
            )`);
      db.exec(`CREATE TABLE IF NOT EXISTS pkg_versions (
                pkg_name TEXT NOT NULL,
                author TEXT ,
                version TEXT NOT NULL,
                version_int INTEGER NOT NULL,
                metaobjid TEXT NOT NULL,
                tag TEXT,
                update_time INTEGER NOT NULL,
                PRIMARY KEY (pkg_name, version)
            )`);
      db.exec(`CREATE TABLE IF NOT EXISTS author_info (
                author_name TEXT PRIMARY KEY,
                author_owner_config TEXT,
                author_zone_config TEXT
            )`);
      db.exec("CREATE INDEX IF NOT EXISTS idx_pkg_versions_pkgname ON pkg_versions (pkg_name)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_pkg_metas_author ON pkg_metas (author)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_pkg_versions_version_int ON pkg_versions (pkg_name, version_int)");
    } finally {
      db.close();
    }
  }
  // Mirror add_pkg_meta_batch: writes BOTH pkg_metas and pkg_versions in one
  // transaction (insert-or-replace meta, insert-or-update version row).
  addPkgMetaBatch(pkgMetaMap) {
    const db = this.connect();
    try {
      const currentTime = buckyosGetUnixTimestamp();
      db.exec("BEGIN");
      try {
        for (const [metaObjId, metaNode] of Object.entries(pkgMetaMap)) {
          db.prepare(
            "INSERT OR REPLACE INTO pkg_metas (metaobjid, pkg_meta, author, author_pk, update_time) VALUES (?, ?, ?, ?, ?)"
          ).run(metaObjId, metaNode.metaJwt, metaNode.author, metaNode.authorPk, currentTime);
          const versionInt = versionToInt(metaNode.version);
          const exists = db.prepare(
            "SELECT 1 FROM pkg_versions WHERE pkg_name = ? AND author = ? AND version = ?"
          ).get(metaNode.pkgName, metaNode.author, metaNode.version);
          if (exists) {
            db.prepare(
              "UPDATE pkg_versions SET metaobjid = ?, tag = ?, update_time = ? WHERE pkg_name = ? AND author = ? AND version = ?"
            ).run(metaObjId, metaNode.tag ?? null, currentTime, metaNode.pkgName, metaNode.author, metaNode.version);
          } else {
            db.prepare(
              "INSERT INTO pkg_versions (pkg_name, author, version, version_int, metaobjid, tag, update_time) VALUES (?, ?, ?, ?, ?, ?, ?)"
            ).run(metaNode.pkgName, metaNode.author, metaNode.version, versionInt, metaObjId, metaNode.tag ?? null, currentTime);
          }
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    } finally {
      db.close();
    }
  }
}
async function setPkgMeta(metaPath, dbPath) {
  assertProvisionRuntime();
  const fs = requireNode("node:fs");
  if (!fs.existsSync(metaPath)) {
    throw new Error(`meta_path ${metaPath} does not exist`);
  }
  if (!fs.existsSync(dbPath)) {
    throw new Error(`db_path ${dbPath} does not exist`);
  }
  const metaContent = fs.readFileSync(metaPath, "utf8");
  const metaJson = metaContent.trimStart().startsWith("{") ? JSON.parse(metaContent) : decodeJwtClaimWithoutVerify(metaContent.trim());
  const metaObjId = calcPkgMetaObjId(metaJson);
  const metaDb = new MetaIndexDb(dbPath);
  metaDb.initializeDatabase();
  metaDb.addPkgMetaBatch({
    [metaObjId]: {
      metaJwt: metaContent,
      pkgName: metaJson.name,
      version: metaJson.version,
      tag: metaJson.version_tag ?? void 0,
      author: metaJson.author,
      authorPk: ""
    }
  });
  return metaObjId;
}
const KERNEL_SERVICE_TEMPLATES = [
  { uniqueId: "verify-hub", showName: "Verify Hub", description: "Verify Hub", selectorType: "random" },
  { uniqueId: "scheduler", showName: "Scheduler", description: "Scheduler", selectorType: "single" },
  { uniqueId: "smb-service", showName: "Samba Service", description: "Samba Service", selectorType: "random" },
  { uniqueId: "msg-center", showName: "Message Center", description: "Message Center", selectorType: "single" },
  { uniqueId: "opendan", showName: "OpenDAN Runtime", description: "OpenDAN Runtime", selectorType: "single" },
  { uniqueId: "workflow", showName: "Workflow Service", description: "Workflow Service", selectorType: "single" }
];
const KERNEL_SERVICE_DOC_VERSION = "0.7.0";
function uniqueNameToDid(uniqueName) {
  const parts = uniqueName.split("_");
  if (parts.length === 2) {
    return DID.fromStr(`did:bns:${parts[1]}.${parts[0]}`);
  }
  return DID.fromStr(`did:bns:${uniqueName}`);
}
function buildDidDocs(outputDir, options) {
  assertProvisionRuntime();
  const path = requireNode("node:path");
  const version = (options == null ? void 0 : options.version) ?? KERNEL_SERVICE_DOC_VERSION;
  const now = (options == null ? void 0 : options.now) ?? buckyosGetUnixTimestamp();
  const written = [];
  for (const template of KERNEL_SERVICE_TEMPLATES) {
    const did = uniqueNameToDid(template.uniqueId);
    const doc = sortKeysDeep({
      name: template.uniqueId,
      show_name: template.showName,
      version,
      author: "did:bns:buckyos",
      owner: "did:bns:buckyos",
      create_time: now,
      last_update_time: now,
      description: { detail: { en: template.description } },
      categories: ["service"],
      selector_type: template.selectorType,
      install_config_tips: {
        data_mount_point: [],
        local_cache_mount_point: [],
        rdb_instances: {},
        service_ports: {}
      },
      pkg_list: {}
    });
    const filePath = path.join(outputDir, `${did.toRawHostName()}.doc.json`);
    writeJsonWithLog(filePath, doc);
    written.push(filePath);
  }
  return written;
}
export {
  DEVICE_DOC_JWT_FILE_NAME,
  DEVICE_MINI_DOC_JWT_FILE_NAME,
  DEV_TEST_EVM_ACCOUNTS,
  DEV_TEST_EVM_SEED_SENDER,
  DEV_TEST_EVM_SEED_SENDER_INDEX,
  DEV_TEST_EVM_USER_INDEXES,
  DEV_TEST_KEYS,
  DEV_TEST_KEY_INDEXES,
  DEV_TEST_MNEMONIC,
  DevSnDb,
  IDENTITY_MATERIALS,
  IDENTITY_USAGES,
  IdentityRoots,
  KERNEL_SERVICE_DOC_VERSION,
  MetaIndexDb,
  NODE_GATEWAY_PARAMS_FILE_NAME,
  NODE_IDENTITY_SCHEMA_V2,
  PROVISION_BASE_TIME,
  PROVISION_DEFAULT_EXP,
  assertProvisionRuntime,
  bindDeviceDocumentDid,
  buildDeviceDid,
  buildDidDocs,
  calcPkgMetaObjId,
  createCa,
  createCertFromCa,
  createIdentityCertFromCa,
  createNodeConfigs,
  createSnConfigs,
  createUserEnv,
  decodeDeviceDocumentWithoutVerify,
  deriveDevTestEvmAccount,
  deriveDevTestEvmAccountFromMnemonic,
  deriveDevTestKeyPair,
  deriveDevTestKeyPairFromMnemonic,
  devTestKeccak256,
  deviceIdentityPathsForRoots,
  didWebDocumentUrl,
  encodeIdentityDirName,
  ensureCa,
  getDevTestEvmAccountByIndex,
  getDevTestEvmAccountByUsername,
  getDevTestKeyPairById,
  getDevTestKeyPairByIndex,
  identityDirName,
  identityFileName,
  identityRawHostUri,
  loadDeviceDocJwtForRoots,
  loadDeviceMiniDocJwtForRoots,
  loadLocalDeviceDocumentForRoots,
  loadLocalNodeIdentityConfig,
  newDeviceDocumentByJwkWithDid,
  newLocalNodeIdentityConfig,
  nodeTestIdentityRoots,
  normalizePackageMetaForObjId,
  registerDeviceToSn,
  registerUserToSn,
  saveLocalDeviceIdentityForRoots,
  saveNodeGatewayParams,
  setPkgMeta,
  uniqueNameToDid,
  versionToInt
};
//# sourceMappingURL=provision.mjs.map
