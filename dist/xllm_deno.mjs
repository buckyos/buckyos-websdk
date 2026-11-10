var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
import { n as canonicalJson, i as isObject, X as XllmError, m as cloneJson, p as providerError, A as AiccLlmClient } from "./aicc-67851c41.mjs";
import { aB as normalizePath, aq as MemoryHintLedger, ao as HINT_NS_DEDUP, T as ToolDispatchException, ab as toHost, ay as taskStateObservation, a6 as envelopeObservation, ar as applyHints, aC as PLANNED_RUNTIME_KINDS, s as shellSettings, aD as BUILTIN_TOOL_GROUP_BASH, u as unresolvedReason, d as describeToolSource, aE as BUILTIN_TOOL_GROUP_BASH_CORE, aF as resolveConfigPath, g as generateRunId, R as RUN_RECORD_VERSION, Y as REFUSED_CREDENTIALS, q as mergeConfigLayers, w as parseLlmContextJson, G as MemoryRunStore, $ as XllmTask, a2 as isTerminal, _ as XllmRun } from "./site_manager-11a7a468.mjs";
import { O as OpenAiLlmClient } from "./openai-ae2978de.mjs";
import "./krpc_client-673448e5.mjs";
function deno() {
  const d = globalThis.Deno;
  if (!d)
    throw new Error("the xllm Deno host needs the Deno runtime");
  return d;
}
function isNotFound(e) {
  return e instanceof deno().errors.NotFound;
}
function isAlreadyExists(e) {
  return e instanceof deno().errors.AlreadyExists;
}
function errorText(e) {
  return e instanceof Error ? e.message : String(e);
}
function homeDir() {
  const env = deno().env;
  return env.get("HOME") ?? env.get("USERPROFILE");
}
function joinPath(...parts) {
  let out = "";
  for (const p of parts) {
    if (!p)
      continue;
    if (p.startsWith("/") || !out)
      out = p;
    else
      out = out.endsWith("/") ? out + p : `${out}/${p}`;
  }
  return out;
}
function parentDir(p) {
  const t = p.replace(/\/+$/, "");
  const i = t.lastIndexOf("/");
  return i < 0 ? "." : i === 0 ? "/" : t.slice(0, i);
}
async function isDir(p) {
  try {
    return (await deno().stat(p)).isDirectory;
  } catch {
    return false;
  }
}
async function writeFileSynced(path, bytes) {
  const f = await deno().open(path, { write: true, create: true, truncate: true });
  try {
    let off = 0;
    while (off < bytes.length)
      off += await f.write(bytes.subarray(off));
    await f.sync();
  } finally {
    f.close();
  }
}
async function syncDir(dir) {
  if (deno().build.os === "windows")
    return;
  const f = await deno().open(dir, { read: true });
  try {
    await f.sync();
  } finally {
    f.close();
  }
}
const fromNumH = (n) => n / 2 ** 32 | 0;
const fromNumL = (n) => n >>> 0;
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
}
const atitle = (title) => title ? `"${title}" ` : "";
function anumber(n, title = "") {
  if (typeof n !== "number")
    throw new TypeError(atitle(title) + "expected number, got " + typeof n);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError(atitle(title) + "expected integer >= 0, got " + n);
  return n;
}
function abytes(value, length, title = "") {
  if (isBytes(value) && (length === void 0 || value.length === length))
    return value;
  if (length !== void 0)
    anumber(length, "length");
  const bytes = isBytes(value);
  const ofLen = length !== void 0 ? ` of length ${length}` : "";
  const got = bytes ? `length=${value.length}` : `type=${typeof value}`;
  const message = atitle(title) + "expected Uint8Array" + ofLen + ", got " + got;
  if (!bytes)
    throw new TypeError(message);
  throw new RangeError(message);
}
function copyBytes(bytes) {
  return Uint8Array.from(abytes(bytes));
}
const aobject = (value, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError((label === "object" ? "" : `"${label}" `) + "expected object, got type=" + typeof value);
};
const aopts = (value, label) => {
  aobject(value, label);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null)
    throw new TypeError(`"${label}" expected plain object`);
  if (Object.hasOwn(value, "__proto__"))
    throw new TypeError(`"${label}.__proto__" is not allowed`);
};
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("hash was destroyed");
  if (checkFinished && instance.finished)
    throw new Error("digest() was already called");
}
function aoutput(out, instance) {
  abytes(out, void 0, "output");
  const min = instance.outputLen;
  if (!(out.length >= min)) {
    throw new RangeError('"output" expected length >= ' + min);
  }
}
function u8(arr) {
  return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
}
function u32(arr) {
  return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
}
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function rotr(word, shift) {
  return word << 32 - shift | word >>> shift;
}
const isLE = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
function byteSwap(word) {
  return word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
}
const swap8IfBE = isLE ? (n) => n : (n) => byteSwap(n) >>> 0;
function byteSwap32(arr) {
  for (let i = 0; i < arr.length; i++) {
    arr[i] = byteSwap(arr[i]);
  }
  return arr;
}
const swap32IfBE = isLE ? (u) => u : byteSwap32;
const hasHexBuiltin = /* @__PURE__ */ (() => (
  // @ts-ignore
  typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function"
))();
const hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
function bytesToHex(bytes) {
  abytes(bytes);
  if (hasHexBuiltin)
    return bytes.toHex();
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += hexes[bytes[i]];
  }
  return hex;
}
function checkOpts(defaults, opts, title = "opts") {
  aopts(defaults, "defaults");
  if (opts !== void 0)
    aopts(opts, title);
  const merged = Object.assign(/* @__PURE__ */ Object.create(null), defaults, opts);
  return merged;
}
function createHasher(hashCons, info = {}) {
  if (typeof hashCons !== "function")
    throw new TypeError('"hashCons" expected function, got type=' + typeof hashCons);
  info = checkOpts({}, info, "info");
  const hashC = (msg, opts) => hashCons(opts).update(msg).digest();
  const tmp = hashCons(void 0);
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.canXOF = tmp.canXOF;
  hashC.create = (opts) => hashCons(opts);
  Object.assign(hashC, info);
  return Object.freeze(hashC);
}
const SHA256_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);
function G1s(a, b, c, d, x) {
  a = a + b + x | 0;
  d = rotr(d ^ a, 16);
  c = c + d | 0;
  b = rotr(b ^ c, 12);
  return { a, b, c, d };
}
function G2s(a, b, c, d, x) {
  a = a + b + x | 0;
  d = rotr(d ^ a, 8);
  c = c + d | 0;
  b = rotr(b ^ c, 7);
  return { a, b, c, d };
}
class _BLAKE2 {
  constructor(blockLen, outputLen) {
    __publicField(this, "buffer");
    __publicField(this, "buffer32");
    __publicField(this, "finished", false);
    __publicField(this, "destroyed", false);
    __publicField(this, "length", 0);
    __publicField(this, "pos", 0);
    __publicField(this, "blockLen");
    __publicField(this, "outputLen");
    __publicField(this, "canXOF", false);
    anumber(blockLen);
    anumber(outputLen);
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.buffer = new Uint8Array(blockLen);
    this.buffer32 = u32(this.buffer);
  }
  update(data) {
    aexists(this);
    abytes(data);
    const { blockLen, buffer, buffer32 } = this;
    const len = data.length;
    const offset = data.byteOffset;
    const buf = data.buffer;
    for (let pos = 0; pos < len; ) {
      if (this.pos === blockLen) {
        swap32IfBE(buffer32);
        this.compress(buffer32, 0, false);
        swap32IfBE(buffer32);
        this.pos = 0;
      }
      const take = Math.min(blockLen - this.pos, len - pos);
      const dataOffset = offset + pos;
      if (take === blockLen && !(dataOffset % 4) && pos + take < len) {
        const data32 = new Uint32Array(buf, dataOffset, Math.floor((len - pos) / 4));
        swap32IfBE(data32);
        for (let pos32 = 0; pos + blockLen < len; pos32 += buffer32.length, pos += blockLen) {
          this.length += blockLen;
          this.compress(data32, pos32, false);
        }
        swap32IfBE(data32);
        continue;
      }
      buffer.set(pos === 0 && take === len ? data : data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      this.length += take;
      pos += take;
    }
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    if (out.byteOffset & 3)
      throw new RangeError('"output" expected 4-byte aligned byteOffset, got ' + out.byteOffset);
    const { pos, buffer32 } = this;
    this.finished = true;
    this.buffer.fill(0, pos);
    swap32IfBE(buffer32);
    this.compress(buffer32, 0, true);
    swap32IfBE(buffer32);
    const state = this.get();
    const out32 = out === this.buffer ? buffer32 : u32(out);
    const full = Math.floor(this.outputLen / 4);
    for (let i = 0; i < full; i++)
      out32[i] = swap8IfBE(state[i]);
    const tail = this.outputLen % 4;
    if (!tail)
      return;
    const off = full * 4;
    const word = state[full];
    for (let i = 0; i < tail; i++)
      out[off + i] = word >>> 8 * i;
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneInto(to) {
    const { buffer, length, finished, destroyed, outputLen, pos } = this;
    to || (to = new this.constructor({ dkLen: outputLen }));
    to.set(...this.get());
    to.buffer.set(buffer);
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length;
    to.pos = pos;
    to.outputLen = outputLen;
    return to;
  }
  clone() {
    return this._cloneInto();
  }
}
function _compress(s, offset, msg, rounds, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15) {
  let j = 0;
  for (let i = 0; i < rounds; i++) {
    ({ a: v0, b: v4, c: v8, d: v12 } = G1s(v0, v4, v8, v12, msg[offset + s[j++]]));
    ({ a: v0, b: v4, c: v8, d: v12 } = G2s(v0, v4, v8, v12, msg[offset + s[j++]]));
    ({ a: v1, b: v5, c: v9, d: v13 } = G1s(v1, v5, v9, v13, msg[offset + s[j++]]));
    ({ a: v1, b: v5, c: v9, d: v13 } = G2s(v1, v5, v9, v13, msg[offset + s[j++]]));
    ({ a: v2, b: v6, c: v10, d: v14 } = G1s(v2, v6, v10, v14, msg[offset + s[j++]]));
    ({ a: v2, b: v6, c: v10, d: v14 } = G2s(v2, v6, v10, v14, msg[offset + s[j++]]));
    ({ a: v3, b: v7, c: v11, d: v15 } = G1s(v3, v7, v11, v15, msg[offset + s[j++]]));
    ({ a: v3, b: v7, c: v11, d: v15 } = G2s(v3, v7, v11, v15, msg[offset + s[j++]]));
    ({ a: v0, b: v5, c: v10, d: v15 } = G1s(v0, v5, v10, v15, msg[offset + s[j++]]));
    ({ a: v0, b: v5, c: v10, d: v15 } = G2s(v0, v5, v10, v15, msg[offset + s[j++]]));
    ({ a: v1, b: v6, c: v11, d: v12 } = G1s(v1, v6, v11, v12, msg[offset + s[j++]]));
    ({ a: v1, b: v6, c: v11, d: v12 } = G2s(v1, v6, v11, v12, msg[offset + s[j++]]));
    ({ a: v2, b: v7, c: v8, d: v13 } = G1s(v2, v7, v8, v13, msg[offset + s[j++]]));
    ({ a: v2, b: v7, c: v8, d: v13 } = G2s(v2, v7, v8, v13, msg[offset + s[j++]]));
    ({ a: v3, b: v4, c: v9, d: v14 } = G1s(v3, v4, v9, v14, msg[offset + s[j++]]));
    ({ a: v3, b: v4, c: v9, d: v14 } = G2s(v3, v4, v9, v14, msg[offset + s[j++]]));
  }
  return { v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15 };
}
const B3_Flags = {
  CHUNK_START: 1,
  CHUNK_END: 2,
  PARENT: 4,
  ROOT: 8,
  KEYED_HASH: 16,
  DERIVE_KEY_CONTEXT: 32,
  DERIVE_KEY_MATERIAL: 64
};
const B3_IV = /* @__PURE__ */ SHA256_IV.slice();
const B3_SIGMA = /* @__PURE__ */ (() => {
  const Id = Array.from({ length: 16 }, (_, i) => i);
  const permute = (arr) => [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8].map((i) => arr[i]);
  const res = [];
  for (let i = 0, v = Id; i < 7; i++, v = permute(v))
    res.push(...v);
  return Uint8Array.from(res);
})();
class _BLAKE3 extends _BLAKE2 {
  constructor(opts = {}, flags = 0) {
    opts = checkOpts({}, opts);
    super(64, opts.dkLen === void 0 ? 32 : opts.dkLen);
    __publicField(this, "canXOF", true);
    __publicField(this, "chunkPos", 0);
    // Position of current block in chunk
    // How many chunks we already have; exact while this stays within
    // JS's safe-integer range.
    __publicField(this, "chunksDone", 0);
    __publicField(this, "flags", 0 | 0);
    __publicField(this, "IV");
    __publicField(this, "state");
    __publicField(this, "stack", []);
    // Output
    __publicField(this, "posOut", 0);
    __publicField(this, "bufferOut32", new Uint32Array(16));
    __publicField(this, "bufferOut");
    // Index of output chunk; exact while this stays within JS's
    // safe-integer range.
    __publicField(this, "chunkOut", 0);
    __publicField(this, "enableXOF", true);
    const { key, context } = opts;
    const hasContext = context !== void 0;
    if (key !== void 0) {
      if (hasContext)
        throw new Error('cannot use both "key" and "context"');
      abytes(key, 32, "key");
      const k = copyBytes(key);
      this.IV = u32(k);
      swap32IfBE(this.IV);
      this.flags = flags | B3_Flags.KEYED_HASH;
    } else if (hasContext) {
      abytes(context, void 0, "context");
      const ctx = context;
      const contextKey = new _BLAKE3({ dkLen: 32 }, B3_Flags.DERIVE_KEY_CONTEXT).update(ctx).digest();
      this.IV = u32(contextKey);
      swap32IfBE(this.IV);
      this.flags = flags | B3_Flags.DERIVE_KEY_MATERIAL;
    } else {
      this.IV = B3_IV;
      this.flags = flags;
    }
    this.state = this.IV.slice();
    this.bufferOut = u8(this.bufferOut32);
  }
  // _BLAKE2's scalar-state hooks are unused here: BLAKE3 keeps its tree/XOF state in arrays and
  // copies it directly in _cloneInto().
  get() {
    return [];
  }
  set() {
  }
  // Truncated chunk/parent compression: seed v8..v15 as IV[0..3], t0, t1,
  // block length, and flags, then keep only the first 8 output words.
  b2Compress(counter, flags, buf, bufPos = 0) {
    const { state: s, pos } = this;
    const t0 = fromNumL(counter);
    const t1 = fromNumH(counter);
    const { v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15 } = _compress(B3_SIGMA, bufPos, buf, 7, s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], B3_IV[0], B3_IV[1], B3_IV[2], B3_IV[3], t0, t1, pos, flags);
    s[0] = v0 ^ v8;
    s[1] = v1 ^ v9;
    s[2] = v2 ^ v10;
    s[3] = v3 ^ v11;
    s[4] = v4 ^ v12;
    s[5] = v5 ^ v13;
    s[6] = v6 ^ v14;
    s[7] = v7 ^ v15;
  }
  compress(buf, bufPos = 0, isLast = false) {
    let flags = this.flags;
    if (!this.chunkPos)
      flags |= B3_Flags.CHUNK_START;
    if (this.chunkPos === 15 || isLast)
      flags |= B3_Flags.CHUNK_END;
    if (!isLast)
      this.pos = this.blockLen;
    this.b2Compress(this.chunksDone, flags, buf, bufPos);
    this.chunkPos += 1;
    if (this.chunkPos === 16 || isLast) {
      let chunk = this.state;
      this.state = this.IV.slice();
      for (let last, chunks = this.chunksDone + 1; isLast || !(chunks & 1); chunks = Math.floor(chunks / 2)) {
        if (!(last = this.stack.pop()))
          break;
        this.buffer32.set(last, 0);
        this.buffer32.set(chunk, 8);
        this.pos = this.blockLen;
        this.b2Compress(0, this.flags | B3_Flags.PARENT, this.buffer32, 0);
        chunk = this.state;
        this.state = this.IV.slice();
      }
      this.chunksDone++;
      this.chunkPos = 0;
      this.stack.push(chunk);
    }
    this.pos = 0;
  }
  // Overriding hides _BLAKE2's flat implementation, which would otherwise be inherited
  // and silently miss the tree state (CV stack, chunk counters; get()/set() are stubs here).
  _cloneInto(to) {
    const staleOutput = !!to && to.finished && !to.destroyed;
    to = super._cloneInto(to);
    const { IV, flags, state, chunkPos, posOut, chunkOut, stack, chunksDone } = this;
    to.state.set(state);
    to.stack = stack.map((i) => Uint32Array.from(i));
    if (IV === B3_IV) {
      if (to.IV !== B3_IV)
        clean(to.IV);
      to.IV = B3_IV;
    } else if (to.IV === B3_IV) {
      to.IV = IV.slice();
    } else {
      to.IV.set(IV);
    }
    to.flags = flags;
    to.chunkPos = chunkPos;
    to.chunksDone = chunksDone;
    to.posOut = posOut;
    to.chunkOut = chunkOut;
    to.enableXOF = this.enableXOF;
    if (this.finished) {
      to.bufferOut32.set(this.bufferOut32);
    } else if (staleOutput) {
      clean(to.bufferOut32);
    }
    return to;
  }
  destroy() {
    this.destroyed = true;
    clean(this.state, this.buffer32, this.bufferOut32);
    if (this.IV !== B3_IV)
      clean(this.IV);
    clean(...this.stack);
  }
  // Root/XOF compression: rerun the same ROOT inputs with incrementing output
  // counter `t` and materialize all 16 output words.
  // Same as b2Compress, but doesn't modify state and returns 16 u32 array (instead of 8)
  b2CompressOut() {
    const { state: s, pos, flags, buffer32, bufferOut32: out32 } = this;
    const outCounter = this.chunkOut++;
    const t0 = fromNumL(outCounter);
    const t1 = fromNumH(outCounter);
    swap32IfBE(buffer32);
    const { v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15 } = _compress(B3_SIGMA, 0, buffer32, 7, s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], B3_IV[0], B3_IV[1], B3_IV[2], B3_IV[3], t0, t1, pos, flags);
    out32[0] = v0 ^ v8;
    out32[1] = v1 ^ v9;
    out32[2] = v2 ^ v10;
    out32[3] = v3 ^ v11;
    out32[4] = v4 ^ v12;
    out32[5] = v5 ^ v13;
    out32[6] = v6 ^ v14;
    out32[7] = v7 ^ v15;
    out32[8] = s[0] ^ v8;
    out32[9] = s[1] ^ v9;
    out32[10] = s[2] ^ v10;
    out32[11] = s[3] ^ v11;
    out32[12] = s[4] ^ v12;
    out32[13] = s[5] ^ v13;
    out32[14] = s[6] ^ v14;
    out32[15] = s[7] ^ v15;
    swap32IfBE(buffer32);
    swap32IfBE(out32);
    this.posOut = 0;
  }
  finish() {
    if (this.finished)
      return;
    this.finished = true;
    this.buffer.fill(0, this.pos);
    let flags = this.flags | B3_Flags.ROOT;
    if (this.stack.length) {
      flags |= B3_Flags.PARENT;
      swap32IfBE(this.buffer32);
      this.compress(this.buffer32, 0, true);
      swap32IfBE(this.buffer32);
      this.chunksDone = 0;
      this.pos = this.blockLen;
    } else {
      flags |= (!this.chunkPos ? B3_Flags.CHUNK_START : 0) | B3_Flags.CHUNK_END;
    }
    this.flags = flags;
    this.b2CompressOut();
  }
  writeInto(out) {
    aexists(this, false);
    abytes(out);
    this.finish();
    const { blockLen, bufferOut } = this;
    for (let pos = 0, len = out.length; pos < len; ) {
      if (this.posOut >= blockLen)
        this.b2CompressOut();
      const take = Math.min(blockLen - this.posOut, len - pos);
      out.set(bufferOut.subarray(this.posOut, this.posOut + take), pos);
      this.posOut += take;
      pos += take;
    }
    return out;
  }
  xofInto(out) {
    if (!this.enableXOF)
      throw new Error("no XOF after digest()");
    return this.writeInto(out);
  }
  xof(bytes) {
    anumber(bytes);
    return this.xofInto(new Uint8Array(bytes));
  }
  digestInto(out) {
    aoutput(out, this);
    if (this.finished)
      throw new Error("digest() was already called");
    this.enableXOF = false;
    this.writeInto(out.length === this.outputLen ? out : out.subarray(0, this.outputLen));
    this.destroy();
  }
  digest() {
    const out = new Uint8Array(this.outputLen);
    this.digestInto(out);
    return out;
  }
}
const blake3 = /* @__PURE__ */ createHasher((opts = {}) => new _BLAKE3(opts));
const HOST_ID_ENV = "AGENT_TOOL_HOST_ID";
function blake3Hex(text) {
  return bytesToHex(blake3(new TextEncoder().encode(text)));
}
async function readText$1(path) {
  try {
    return await deno().readTextFile(path);
  } catch {
    return null;
  }
}
function nativeHostIdFrom(i) {
  var _a;
  const id = (_a = i.agent_tool_host_id) == null ? void 0 : _a.trim();
  if (id)
    return `host:${id}:`;
  const host = i.etc_hostname ?? i.hostname_env ?? "unknown";
  return `host:${host.trim()}:${(i.machine_id ?? "").trim()}`;
}
async function nativeHostId() {
  const env = deno().env.get(HOST_ID_ENV) ?? null;
  if (env == null ? void 0 : env.trim())
    return nativeHostIdFrom({ agent_tool_host_id: env, etc_hostname: null, hostname_env: null, machine_id: null });
  return nativeHostIdFrom({
    agent_tool_host_id: env,
    etc_hostname: await readText$1("/etc/hostname"),
    hostname_env: deno().env.get("HOSTNAME") ?? null,
    machine_id: await readText$1("/etc/machine-id")
  });
}
function nativeTarget(hostId, uid) {
  return { host: hostId, uid };
}
function targetText(target) {
  return canonicalJson(target);
}
function deriveRuntimeId(configuredId, kind, target) {
  return configuredId ?? runtimeIdOf(kind, target);
}
function runtimeIdOf(kind, target) {
  return `${kind}:${blake3Hex(targetText(target)).slice(0, 24)}`;
}
function workdirLockPath(lockDir, workdir) {
  return joinPath(lockDir, `${blake3Hex(workdir).slice(0, 24)}.lock`);
}
const TOOL_READ_FILE = "read_file";
const TOOL_WRITE_FILE = "write_file";
const TOOL_EDIT_FILE = "edit_file";
const TOOL_SHELL = "shell";
const BASH_GROUP_TOOLS = [TOOL_READ_FILE, TOOL_WRITE_FILE, TOOL_EDIT_FILE, TOOL_SHELL];
const EXEC_MAX_OUTPUT_BYTES = 64 * 1024;
const OUTPUT_TAIL_BYTES = 2048;
const TIMEOUT_EXIT_CODE = 124;
const ENV_CALL_ID = "XLLM_CALL_ID";
const ENV_RUN_ID = "XLLM_RUN_ID";
const LOCAL_ENGINE = "native";
const READ_FILE_PREVIEW_MAX_LINES = 200;
const CMD_PARAM_PREVIEW_KEEP_CHARS = 32;
const HISTORY_COMPACT_CMD_MAX_CHARS = 96;
class NativeToolError extends Error {
  constructor(kind, detail, effectUnknown = false) {
    super(kind === "invalid_args" ? `invalid args: ${detail}` : kind === "exec_failed" ? `execution failed: ${detail}` : kind === "timeout" ? "timeout" : kind === "transport" ? `runtime transport: ${detail}` : `cancelled: ${detail}`);
    this.kind = kind;
    this.detail = detail;
    this.effectUnknown = effectUnknown;
    this.name = "NativeToolError";
  }
}
const invalidArgs = (m) => new NativeToolError("invalid_args", m);
const execFailed = (m) => new NativeToolError("exec_failed", m);
function tokenizeBashCommandLine(line) {
  const tokens = [];
  let cur = "";
  let single = false;
  let double = false;
  const chars = [...line];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === "'" && !double)
      single = !single;
    else if (ch === '"' && !single)
      double = !double;
    else if (ch === "\\" && !single) {
      if (i + 1 < chars.length)
        cur += chars[++i];
    } else if (/\s/.test(ch) && !single && !double) {
      if (cur) {
        tokens.push(cur);
        cur = "";
      }
    } else
      cur += ch;
  }
  if (single || double)
    return void 0;
  if (cur)
    tokens.push(cur);
  return tokens;
}
function truncateText(text, max) {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max).join("")}...[TRUNCATED]`;
}
function defaultTitle(r) {
  var _a;
  const line = r.cmd_name !== void 0 ? ((_a = r.cmd_args) == null ? void 0 : _a.trim()) ? `${r.cmd_name} ${r.cmd_args.trim()}` : r.cmd_name : void 0;
  const cmd = (line !== void 0 ? truncateText(line.trim(), HISTORY_COMPACT_CMD_MAX_CHARS) : "") || "action";
  const status = r.status === "pending" ? r.pending_reason !== void 0 ? `pending (${r.pending_reason})` : "pending" : r.status;
  return `${cmd} => ${status}`;
}
function builtinResult(tool, detail, cmdLine, summary) {
  const r = { agent_tool_protocol: "1", tool, status: "success", summary, detail };
  const tokens = tokenizeBashCommandLine(cmdLine);
  const parts = tokens && tokens.length ? tokens : cmdLine.split(/\s+/).filter(Boolean);
  if (parts.length) {
    r.cmd_name = parts[0];
    if (parts.length > 1)
      r.cmd_args = parts.slice(1).join(" ");
  }
  r.title = defaultTitle(r);
  return r;
}
function withOutput(r, output) {
  if (output.trim())
    r.output = output;
  else
    delete r.output;
  return r;
}
function pathStartsWith(p, root) {
  if (root === "/")
    return p.startsWith("/");
  return p === root || p.startsWith(`${root}/`);
}
function checkAllowed(path, roots) {
  if (roots.length === 0 || roots.some((r) => pathStartsWith(path, r)))
    return;
  throw invalidArgs(`path not allowed by policy: ${path}`);
}
async function canonicalMissing(path) {
  let ancestor = path.replace(/\/+$/, "") || "/";
  const missing = [];
  for (; ; ) {
    try {
      const real = await deno().realPath(ancestor);
      return normalizePath(joinPath(real, ...missing.slice().reverse()));
    } catch (e) {
      if (!isNotFound(e))
        throw execFailed(errorText(e));
      try {
        await deno().lstat(ancestor);
        throw invalidArgs(`dangling symlink: ${ancestor}`);
      } catch (le) {
        if (le instanceof NativeToolError)
          throw le;
      }
      const name = ancestor.slice(ancestor.lastIndexOf("/") + 1);
      if (!name || name === "..")
        throw invalidArgs(`cannot resolve ${path}`);
      if (name !== ".")
        missing.push(name);
      const parent = parentDir(ancestor);
      if (parent === ancestor || ancestor === "/")
        throw invalidArgs("path has no existing ancestor");
      ancestor = parent;
    }
  }
}
async function resolvePath(root, raw, allowed) {
  if (!raw.trim())
    throw invalidArgs("path cannot be empty");
  const candidate = raw.startsWith("/") ? raw : joinPath(root, raw);
  checkAllowed(normalizePath(candidate), allowed);
  const real = await canonicalMissing(candidate);
  const roots = await Promise.all(allowed.map(canonicalMissing));
  checkAllowed(real, roots);
  return real;
}
function encodeObjSegment(seg) {
  let out = "";
  for (const b of new TextEncoder().encode(seg)) {
    const c = String.fromCharCode(b);
    out += /[A-Za-z0-9\-._~!$&'()*+,;=:@]/.test(c) ? c : `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}
function cyfsUrl(dfsRoot, abs) {
  if (!dfsRoot)
    return void 0;
  const root = normalizePath(dfsRoot);
  if (!pathStartsWith(abs, root))
    return void 0;
  const rel = abs.slice(root.length).split("/").filter((s) => s && s !== ".");
  return `cyfs://${["", ...rel].map(encodeObjSegment).join("/") || "/"}`;
}
function serdeKind(v) {
  if (v === null)
    return "null";
  if (typeof v === "boolean")
    return `boolean \`${v}\``;
  if (typeof v === "number")
    return Number.isInteger(v) ? `integer \`${v}\`` : `floating point \`${v}\``;
  if (typeof v === "string")
    return `string ${JSON.stringify(v)}`;
  if (Array.isArray(v))
    return "sequence";
  return "map";
}
function argError(tool, reason) {
  return invalidArgs(`invalid args for \`${tool}\`: ${reason}`);
}
function reqString(tool, args, key) {
  const v = args[key];
  if (v === void 0)
    throw argError(tool, `missing field \`${key}\``);
  if (typeof v !== "string")
    throw argError(tool, `invalid type: ${serdeKind(v)}, expected a string`);
  return v;
}
function optString(tool, args, key) {
  const v = args[key];
  if (v === void 0 || v === null)
    return void 0;
  if (typeof v !== "string")
    throw argError(tool, `invalid type: ${serdeKind(v)}, expected a string`);
  return v;
}
const utf8 = new TextEncoder();
function byteLength(s) {
  return utf8.encode(s).length;
}
function decodeLossy(bytes) {
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
}
function splitLinesPreserveEnding(content) {
  if (!content)
    return [];
  return content.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}
function strLines(s) {
  if (!s)
    return [];
  const parts = s.split("\n");
  if (parts[parts.length - 1] === "")
    parts.pop();
  return parts.map((l) => l.endsWith("\r") ? l.slice(0, -1) : l);
}
function trimEndLineBreaks(s) {
  return s.replace(/[\r\n]+$/, "");
}
function compactCmdParamPreview(raw) {
  const escaped = raw.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n");
  const totalLines = raw ? Math.max(strLines(raw).length, 1) : 0;
  const chars = [...escaped];
  if (chars.length <= CMD_PARAM_PREVIEW_KEEP_CHARS * 2)
    return escaped;
  return `${chars.slice(0, CMD_PARAM_PREVIEW_KEEP_CHARS).join("")}...(total ${totalLines} lines)...${chars.slice(-CMD_PARAM_PREVIEW_KEEP_CHARS).join("")}`;
}
function buildSimpleDiff(path, before, after) {
  const a = strLines(before);
  const b = strLines(after);
  const body = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const o = a[i];
    const n = b[i];
    if (o !== void 0 && n !== void 0) {
      if (o === n)
        body.push(` ${o}`);
      else
        body.push(`-${o}`, `+${n}`);
    } else if (o !== void 0)
      body.push(`-${o}`);
    else if (n !== void 0)
      body.push(`+${n}`);
  }
  return [`--- a/${path}`, `+++ b/${path}`, `@@ -1,${a.length} +1,${b.length} @@`, ...body].join("\n");
}
function parseMarkerToken(raw, rangeText) {
  const t = raw.trim();
  if (t === "$")
    return "end";
  if (t.startsWith("+") || !/^-?\d+$/.test(t))
    throw invalidArgs(`invalid range text \`${rangeText}\``);
  const v = Number(t);
  if (v === 0)
    throw invalidArgs("range must be 1-based, zero is invalid");
  return v;
}
function parseCountText(raw, rangeText) {
  const t = raw.trim();
  if (!t.startsWith("+"))
    throw invalidArgs(`invalid range text \`${rangeText}\``);
  const c = t.slice(1).trim();
  if (!/^\d+$/.test(c))
    throw invalidArgs(`invalid range text \`${rangeText}\``);
  const n = Number(c);
  if (n === 0)
    throw invalidArgs("range count must be positive integer");
  return n;
}
function parseMarkerJson(v, name) {
  if (typeof v === "string")
    return parseMarkerToken(v, name);
  if (typeof v === "number" && Number.isInteger(v)) {
    if (v === 0)
      throw invalidArgs(`${name} must be non-zero integer`);
    return v;
  }
  throw invalidArgs(`${name} must be integer or \`$\``);
}
function parseCountJson(v, name) {
  if (typeof v !== "number" || !Number.isInteger(v) || v <= 0)
    throw invalidArgs(`${name} must be positive integer`);
  return v;
}
function parseRangeText(raw) {
  const text = raw.trim();
  if (!text || text === "-")
    return void 0;
  if (text.includes(",") || text.includes(":")) {
    if (text.includes(",") && text.includes(":"))
      throw invalidArgs(`invalid range text \`${raw}\``);
    const parts = text.split(text.includes(",") ? "," : ":");
    if (parts.length !== 2)
      throw invalidArgs(`invalid range text \`${raw}\``);
    const start = parts[0].trim() ? parseMarkerToken(parts[0].trim(), raw) : void 0;
    const endText = parts[1].trim();
    if (endText.startsWith("+")) {
      if (start === void 0)
        throw invalidArgs(`range \`${raw}\` with \`+count\` requires start`);
      return { start, count: parseCountText(endText, raw), defaultEnd: "same_as_start" };
    }
    return { start, end: endText ? parseMarkerToken(endText, raw) : void 0, defaultEnd: "end" };
  }
  const dash = text.indexOf("-");
  if (dash >= 0) {
    const left = text.slice(0, dash).trim();
    const right = text.slice(dash + 1).trim();
    if (left && right && /^\d+$/.test(left) && /^\d+$/.test(right)) {
      return { start: parseMarkerToken(left, raw), end: parseMarkerToken(right, raw), defaultEnd: "same_as_start" };
    }
  }
  return { start: parseMarkerToken(text, raw), defaultEnd: "same_as_start" };
}
function parseRangeSpec(raw) {
  if (raw === void 0 || raw === null)
    return void 0;
  if (isObject(raw)) {
    const start = raw.start !== void 0 ? parseMarkerJson(raw.start, "range.start") : void 0;
    const end = raw.end !== void 0 ? parseMarkerJson(raw.end, "range.end") : void 0;
    const count = raw.count !== void 0 ? parseCountJson(raw.count, "range.count") : void 0;
    if (count !== void 0 && end !== void 0)
      throw invalidArgs("range cannot set both `end` and `count`");
    if (count !== void 0 && start === void 0)
      throw invalidArgs("range.count requires range.start");
    if (start === void 0 && end === void 0 && count === void 0) {
      throw invalidArgs("range object must contain at least one of start/end/count");
    }
    return { start, end, count, defaultEnd: "tail_if_start_negative" };
  }
  if (Array.isArray(raw)) {
    if (raw.length === 0 || raw.length > 2)
      throw invalidArgs("range array must be [start] or [start,end]");
    return {
      start: parseMarkerJson(raw[0], "range[0]"),
      end: raw.length === 2 ? parseMarkerJson(raw[1], "range[1]") : void 0,
      defaultEnd: "same_as_start"
    };
  }
  if (typeof raw === "number" && Number.isInteger(raw))
    return { start: parseMarkerJson(raw, "range"), defaultEnd: "same_as_start" };
  if (typeof raw === "string")
    return parseRangeText(raw);
  throw invalidArgs("range must be string/number/array/object");
}
function resolveMarker(m, total) {
  if (m === "end")
    return total;
  return m > 0 ? m : total + m + 1;
}
function resolveRange(spec, total) {
  const startMarker = spec.start ?? 1;
  const startRaw = resolveMarker(startMarker, total);
  let endRaw;
  if (spec.count !== void 0)
    endRaw = startRaw + spec.count - 1;
  else if (spec.end !== void 0)
    endRaw = resolveMarker(spec.end, total);
  else if (spec.defaultEnd === "same_as_start")
    endRaw = startRaw;
  else if (spec.defaultEnd === "end")
    endRaw = total;
  else
    endRaw = typeof startMarker === "number" && startMarker < 0 ? total : startRaw;
  return [Math.min(Math.max(startRaw, 1), total + 1), Math.min(Math.max(endRaw, 0), total)];
}
function readCmdLine(path, firstChunk, range) {
  let cmd = `${TOOL_READ_FILE} ${path}`;
  if (firstChunk !== void 0)
    cmd += ` first_chunk="${compactCmdParamPreview(firstChunk)}"`;
  if (range !== void 0 && range !== null) {
    const text = typeof range === "string" ? range : canonicalJson(range);
    if (text.trim())
      cmd += ` range=${text}`;
  }
  return cmd;
}
const READ_FILE_SPEC = {
  name: TOOL_READ_FILE,
  description: `Read a text file. range selects 1-based lines ("120-200", "120:$", "120:+20", "-50:$" for the last 50); first_chunk starts the read at the first occurrence of that text. Paths are relative to the working directory; paths outside it only where the run's filesystem policy allows.`,
  args_schema: {
    properties: {
      first_chunk: { description: "Start the read at the first occurrence of this text (range then counts from there).", type: "string" },
      path: { description: "File to read, relative to the working directory.", type: "string" },
      range: { description: '1-based line range: "120-200", "120:$" (to the end), "120:+20" (20 lines from 120); negative numbers count from the end ("-50:$").' }
    },
    required: ["path"],
    type: "object"
  }
};
const WRITE_FILE_SPEC = {
  name: TOOL_WRITE_FILE,
  description: `Write a text file: mode "write" (default) creates or overwrites it, "append" adds to its end, "new" creates it and fails if it exists. Parent directories are created. Paths are relative to the working directory; paths outside it only where the run's filesystem policy allows.`,
  args_schema: {
    properties: {
      content: { description: "The text to write.", type: "string" },
      mode: { description: "`write` (default): create or overwrite; `append`: add to the end; `new`: create, fail if the file exists.", type: "string" },
      path: { description: "File to write, relative to the working directory.", type: "string" }
    },
    required: ["content", "path"],
    type: "object"
  }
};
const EDIT_FILE_SPEC = {
  name: TOOL_EDIT_FILE,
  description: "Replace the one exact occurrence of old_string with new_string in a text file. Fails when old_string is absent or occurs more than once: include enough surrounding text to make it unique. Paths are relative to the working directory; paths outside it only where the run's filesystem policy allows.",
  args_schema: {
    properties: {
      new_string: { description: "The replacement text.", type: "string" },
      old_string: { description: "The exact text to replace; it must occur exactly once.", type: "string" },
      path: { description: "File to edit, relative to the working directory.", type: "string" }
    },
    required: ["new_string", "old_string", "path"],
    type: "object"
  }
};
async function readText(path) {
  try {
    return decodeLossy(await deno().readFile(path));
  } catch (e) {
    throw execFailed(`read file failed: ${errorText(e)}`);
  }
}
async function writeText(path, text) {
  try {
    await deno().mkdir(parentDir(path), { recursive: true });
  } catch (e) {
    throw execFailed(errorText(e));
  }
  try {
    await deno().writeFile(path, utf8.encode(text));
  } catch (e) {
    throw execFailed(`write file failed: ${errorText(e)}`);
  }
}
async function exists(path) {
  try {
    await deno().stat(path);
    return true;
  } catch (e) {
    if (isNotFound(e))
      return false;
    throw execFailed(errorText(e));
  }
}
function readFileTool(cfg) {
  return {
    spec: READ_FILE_SPEC,
    idempotent: true,
    cancellable: false,
    async call(args) {
      const rawPath = reqString(TOOL_READ_FILE, args, "path");
      const firstChunk = optString(TOOL_READ_FILE, args, "first_chunk");
      const range = args.range === null ? void 0 : args.range;
      const filePath = rawPath.trim();
      if (!filePath)
        throw invalidArgs("missing required arg `path`");
      const abs = await resolvePath(cfg.root, filePath, cfg.allowedRead);
      const full = await readText(abs);
      let chunk;
      let matched = true;
      let chunkStart = 1;
      if (firstChunk !== void 0) {
        const pos = full.indexOf(firstChunk);
        if (pos >= 0) {
          chunk = full.slice(pos);
          chunkStart = (full.slice(0, pos).match(/\n/g) ?? []).length + 1;
        } else {
          chunk = "";
          matched = false;
        }
      } else
        chunk = full;
      const lines = splitLinesPreserveEnding(chunk);
      const total = lines.length;
      const spec = parseRangeSpec(range);
      let start;
      let end;
      let label = "";
      if (spec) {
        [start, end] = resolveRange(spec, total);
        label = `${start}-${end}`;
      } else if (total === 0) {
        start = 1;
        end = 0;
      } else {
        start = 1;
        end = total;
      }
      const si = Math.min(Math.max(start - 1, 0), total);
      const ei = Math.min(end, total);
      const selected = si < ei ? lines.slice(si, ei) : [];
      const content = selected.join("");
      const count = selected.length;
      const startLine = count === 0 ? null : chunkStart + si;
      const endLine = startLine === null ? null : startLine + Math.max(count - 1, 0);
      let preview = "";
      if (startLine !== null) {
        preview = selected.slice(0, READ_FILE_PREVIEW_MAX_LINES).map((l, i) => `${startLine + i}: ${trimEndLineBreaks(l)}`).join("\n");
        if (selected.length > READ_FILE_PREVIEW_MAX_LINES)
          preview += `${preview ? "\n" : ""}... truncated to ${READ_FILE_PREVIEW_MAX_LINES} lines`;
      }
      const bytes = byteLength(content);
      const cmdLine = readCmdLine(filePath, firstChunk, range);
      let summary;
      if (matched) {
        const linesText = startLine !== null && endLine !== null ? startLine === endLine ? `1 line at ${startLine}` : `${count} lines at ${startLine}-${endLine}` : "0 lines";
        const base = `succeeded, read ${bytes} bytes across ${linesText}`;
        summary = preview ? `${base}
\`\`\`content
${preview}
\`\`\`` : base;
      } else {
        summary = "succeeded, first_chunk was not found, read 0 bytes across 0 lines";
      }
      const detail = {};
      const url = cyfsUrl(cfg.dfsRoot, abs);
      if (url !== void 0)
        detail.cyfs_url = url;
      Object.assign(detail, {
        content,
        matched,
        line_range: label,
        bytes,
        line_count: count,
        start_line: startLine,
        end_line: endLine,
        preview_truncated: count > READ_FILE_PREVIEW_MAX_LINES
      });
      const result = builtinResult(TOOL_READ_FILE, detail, cmdLine, summary);
      result.title = `${cmdLine} => ${matched ? "success" : "anchor not found"}`;
      return withReadDedup(result, filePath, canonicalJson(Object.fromEntries(Object.entries(args).filter(([k]) => k !== "path"))));
    }
  };
}
function withReadDedup(result, what, window) {
  var _a;
  if (result.status !== "success")
    return result;
  const text = ((_a = result.output) == null ? void 0 : _a.trim()) ? result.output : result.summary.trim() ? result.summary : canonicalJson(result.detail);
  result.dedup = {
    key: `read:${what}#${window}:${blake3Hex(text).slice(0, 16)}`,
    hint: `\`${what}\` is unchanged since you read it earlier in this run; use that content.`
  };
  return result;
}
function normalizeWriteMode(raw) {
  const m = (raw ?? "write").trim().toLowerCase();
  if (m === "new" || m === "create")
    return "new";
  if (m === "append")
    return "append";
  if (m === "" || m === "write" || m === "overwrite")
    return "write";
  throw invalidArgs(`invalid write mode \`${m}\`, expected new/append/write`);
}
function writeFileTool(cfg) {
  return {
    spec: WRITE_FILE_SPEC,
    idempotent: false,
    cancellable: false,
    async call(args) {
      const rawPath = reqString(TOOL_WRITE_FILE, args, "path");
      const content = reqString(TOOL_WRITE_FILE, args, "content");
      const rawMode = optString(TOOL_WRITE_FILE, args, "mode");
      let cmdMode;
      try {
        cmdMode = normalizeWriteMode(rawMode);
      } catch {
        cmdMode = "write";
      }
      const cmdLine = `${TOOL_WRITE_FILE} ${rawPath} mode=${cmdMode}`;
      const filePath = rawPath.trim();
      if (!filePath)
        throw invalidArgs("missing required arg `path`");
      const mode = normalizeWriteMode(rawMode);
      const abs = await resolvePath(cfg.root, filePath, cfg.allowedWrite);
      const present = await exists(abs);
      if (mode === "new" && present)
        throw invalidArgs(`write mode \`new\` requires target file not exist: ${filePath}`);
      const original = present ? await readText(abs) : "";
      const operation = mode === "append" ? "append" : mode === "new" ? "new" : present ? "write" : "create";
      const updated = mode === "append" ? `${original}${content}` : content;
      await writeText(abs, updated);
      const lineCount = splitLinesPreserveEnding(content).length;
      const detail = {};
      const url = cyfsUrl(cfg.dfsRoot, abs);
      if (url !== void 0)
        detail.cyfs_url = url;
      const bytesAfter = byteLength(updated);
      Object.assign(detail, { created: !present, changed: original !== updated, bytes_written: bytesAfter, line_count: lineCount });
      const verb = operation === "append" ? "appended" : operation === "new" || operation === "create" ? "created" : "wrote";
      const summary = `${verb} ${filePath}, wrote ${byteLength(content)} bytes across ${lineCount === 1 ? "1 line" : `${lineCount} lines`}`;
      const result = builtinResult(TOOL_WRITE_FILE, detail, cmdLine, summary);
      const label = operation === "append" ? "append" : operation === "new" || operation === "create" ? "new" : "write";
      result.title = `${TOOL_WRITE_FILE} ${filePath} mode=${label} => success (${bytesAfter} bytes)`;
      return result;
    }
  };
}
function editFileTool(cfg) {
  return {
    spec: EDIT_FILE_SPEC,
    idempotent: false,
    cancellable: false,
    async call(args) {
      const rawPath = reqString(TOOL_EDIT_FILE, args, "path");
      const oldString = reqString(TOOL_EDIT_FILE, args, "old_string");
      const newString = reqString(TOOL_EDIT_FILE, args, "new_string");
      const cmdLine = `${TOOL_EDIT_FILE} ${rawPath} old_string="${compactCmdParamPreview(oldString)}"`;
      const filePath = rawPath.trim();
      if (!filePath)
        throw invalidArgs("missing required arg `path`");
      if (!oldString)
        throw invalidArgs("missing required arg `old_string`");
      if (oldString === newString)
        throw invalidArgs("`new_string` must be different from `old_string`");
      const abs = await resolvePath(cfg.root, filePath, cfg.allowedWrite);
      const original = await readText(abs);
      const matches = [];
      for (let at = original.indexOf(oldString); at >= 0; at = original.indexOf(oldString, at + oldString.length))
        matches.push(at);
      if (matches.length === 0)
        throw invalidArgs("`old_string` was not found in the file");
      if (matches.length > 1)
        throw invalidArgs(`\`old_string\` must match exactly once, found ${matches.length} matches`);
      const pos = matches[0];
      const updated = original.slice(0, pos) + newString + original.slice(pos + oldString.length);
      const changed = original !== updated;
      if (changed)
        await writeText(abs, updated);
      const diff = buildSimpleDiff(filePath, original, updated);
      const line = (original.slice(0, pos).match(/\n/g) ?? []).length + 1;
      const detail = {};
      const url = cyfsUrl(cfg.dfsRoot, abs);
      if (url !== void 0)
        detail.cyfs_url = url;
      Object.assign(detail, { matched: true, changed, mode: "replace", line, diff, diff_truncated: false });
      const summary = changed ? diff.trim() ? `edited ${filePath} with replace at line ${line}
\`\`\`diff
${diff}
\`\`\`` : `edited ${filePath} with replace at line ${line}` : `edit ${filePath} made no change`;
      const result = builtinResult(TOOL_EDIT_FILE, detail, cmdLine, summary);
      result.title = `${TOOL_EDIT_FILE} ${filePath} => ${changed ? `success (line ${line})` : "no change"}`;
      return result;
    }
  };
}
const NATIVE_WRAPPER = `if [ "$#" -ge 2 ]; then export PATH="$2"; fi
printf '%s\\n' "$0" > "$1/command"
"$BASH" -c "$0" </dev/null >"$1/stdout" 2>"$1/stderr"
__llm_ec=$?
printf '%s\\n' "$__llm_ec" > "$1/exit.tmp" && command -p mv -f "$1/exit.tmp" "$1/exit"
exit $__llm_ec`;
const SYSTEM_PATH_ENTRIES = ["/usr/local/sbin", "/usr/local/bin", "/usr/sbin", "/usr/bin", "/sbin", "/bin"];
function sanitizeCallId(callId) {
  const s = [...callId].map((c) => /[A-Za-z0-9\-_.]/.test(c) ? c : "_").join("");
  return !s || s.startsWith(".") ? `c_${s}` : s;
}
function execDirFor(runDir, callId) {
  if (!runDir || !callId)
    return void 0;
  return joinPath(runDir, "exec", sanitizeCallId(callId));
}
function fmtElapsed(ms) {
  const s = Math.floor(ms / 1e3);
  if (s < 60)
    return `${s}s`;
  if (s < 3600)
    return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h${String(Math.floor(s % 3600 / 60)).padStart(2, "0")}m`;
}
function boundedText(bytes, max) {
  const headCap = Math.floor(max / 4);
  const tailCap = max - headCap;
  const head = bytes.subarray(0, Math.min(headCap, bytes.length));
  const rest = bytes.subarray(head.length);
  const tail = rest.subarray(Math.max(0, rest.length - tailCap));
  const truncated = bytes.length > head.length + tail.length;
  if (!truncated)
    return [decodeLossy(head) + decodeLossy(tail), false];
  return [`${decodeLossy(head)}
…[${bytes.length - head.length - tail.length} bytes omitted]…
${decodeLossy(tail)}`, true];
}
async function readBytes(path) {
  try {
    return await deno().readFile(path);
  } catch {
    return void 0;
  }
}
async function readFileBounded(path, max) {
  const bytes = await readBytes(path);
  return bytes ? boundedText(bytes, Math.max(max, 16)) : ["", false];
}
async function readFileTail(path, max) {
  const bytes = await readBytes(path);
  return bytes ? decodeLossy(bytes.subarray(Math.max(0, bytes.length - max))) : "";
}
async function readExitFile(dir) {
  try {
    const t = (await deno().readTextFile(joinPath(dir, "exit"))).trim();
    return /^[+-]?\d+$/.test(t) ? Number(t) : void 0;
  } catch {
    return void 0;
  }
}
async function outputFromExecDir(dir, exitCode, timedOut, elapsedMs, max, cwd) {
  const [stdout, outTrunc] = await readFileBounded(joinPath(dir, "stdout"), max);
  const [stderr, errTrunc] = await readFileBounded(joinPath(dir, "stderr"), max);
  let output = stdout;
  if (stderr) {
    if (output && !output.endsWith("\n"))
      output += "\n";
    output += stderr;
  }
  return { exit_code: exitCode, stdout, stderr, output, output_truncated: outTrunc || errTrunc, timed_out: timedOut, duration_ms: Math.floor(elapsedMs), cwd };
}
const SIGNALS = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGQUIT: 3,
  SIGILL: 4,
  SIGTRAP: 5,
  SIGABRT: 6,
  SIGBUS: 7,
  SIGFPE: 8,
  SIGKILL: 9,
  SIGUSR1: 10,
  SIGSEGV: 11,
  SIGUSR2: 12,
  SIGPIPE: 13,
  SIGALRM: 14,
  SIGTERM: 15
};
function exitCodeOf(status) {
  if (status.signal)
    return 128 + (SIGNALS[status.signal] ?? 0);
  return status.code;
}
function commandHasShellOperator(command) {
  let single = false;
  let double = false;
  let escaped = false;
  for (const ch of command) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\" && !single)
      escaped = true;
    else if (ch === "'" && !double)
      single = !single;
    else if (ch === '"' && !single)
      double = !double;
    else if ("|;&><\n\r".includes(ch) && !single && !double)
      return true;
  }
  return false;
}
const RESULT_STRING_FIELDS = ["tool", "cmd_name", "task_id", "pending_reason", "estimated_wait", "title", "summary", "cmd_args", "partial_output", "output"];
function forwardInnerResult(command, out) {
  var _a;
  if (commandHasShellOperator(command) || !((_a = tokenizeBashCommandLine(command)) == null ? void 0 : _a.length))
    return void 0;
  const stdout = out.stdout.trim();
  if (!stdout)
    return void 0;
  let v;
  try {
    v = JSON.parse(stdout);
  } catch {
    return void 0;
  }
  if (!isObject(v) || v.agent_tool_protocol !== "1")
    return void 0;
  const status = v.status ?? "success";
  if (status !== "success" && status !== "error" && status !== "pending")
    return void 0;
  for (const k of RESULT_STRING_FIELDS)
    if (v[k] !== void 0 && v[k] !== null && typeof v[k] !== "string")
      return void 0;
  if (status === "pending" && typeof v.task_id !== "string")
    return void 0;
  const r = { ...v, status, summary: typeof v.summary === "string" ? v.summary : "", detail: v.detail === void 0 ? {} : v.detail };
  if (r.return_code === void 0 && out.exit_code !== 0)
    r.return_code = out.exit_code;
  return r;
}
function shellSpec(cfg) {
  const max = cfg.maxTimeoutMs;
  const description = `Run a command in this run's runtime (native) with bash syntax. It starts in the working directory unless cwd is given; it is not sandboxed and runs with the current user's permissions. The command is a child process of this executor: an interrupt or a timeout ends its process group; processes it leaves behind after returning are not managed. Waits for the command to finish. Default timeout ${Math.floor(cfg.timeoutMs / 1e3)}s${max === 0 ? ", no upper limit" : `, max ${Math.floor(max / 1e3)}s`}; on timeout the command is stopped and the output so far is returned. Start a long-lived service with nohup / setsid and return at once; on Unix, processes started with \`&\` / nohup in the foreground command's process group also end when that command is interrupted or times out. Long output keeps its beginning and end.`;
  const timeout = {
    description: `Timeout in milliseconds (default ${cfg.timeoutMs}${max === 0 ? "" : `, max ${max}`}). Set it explicitly for long builds, tests or media commands.`,
    minimum: 1,
    type: "integer"
  };
  if (max !== 0)
    timeout.maximum = max;
  return {
    name: TOOL_SHELL,
    description,
    args_schema: {
      properties: {
        command: { description: "bash command to execute", type: "string" },
        cwd: {
          description: cfg.restrictCwd ? "Working directory, relative to or within the configured workspace. Defaults to the workspace." : "Working directory, absolute or relative to the default working directory. Defaults to that directory; outside paths are allowed subject to OS permissions.",
          type: "string"
        },
        timeout_ms: timeout
      },
      required: ["command"],
      type: "object"
    }
  };
}
function parseMs(raw, name) {
  if (raw === void 0 || raw === null)
    return void 0;
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0)
    return raw;
  if (typeof raw === "string" && /^\d+$/.test(raw.trim()))
    return Number(raw.trim());
  throw invalidArgs(`\`${name}\` must be a non-negative integer`);
}
function parseEnv(raw) {
  if (raw === void 0 || raw === null)
    return [];
  if (!isObject(raw))
    throw invalidArgs("`env` must be an object of string=>string");
  const out = [];
  for (const [k, v] of Object.entries(raw)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k))
      throw invalidArgs(`invalid env key \`${k}\` (must match [A-Za-z_][A-Za-z0-9_]*)`);
    if (typeof v === "string")
      out.push([k, v]);
    else if (typeof v === "number" || typeof v === "boolean")
      out.push([k, String(v)]);
    else if (v === null)
      out.push([k, ""]);
    else
      throw invalidArgs(`env value for \`${k}\` must be string/number/bool, got ${canonicalJson(v)}`);
  }
  return out;
}
function appendPathEntry(entry, base) {
  if (!base)
    return entry;
  return base.split(":").includes(entry) ? base : `${base}:${entry}`;
}
let localSeq = 0;
function sleepOrStop(ms) {
  let timer;
  const done = new Promise((resolve) => {
    timer = setTimeout(() => resolve("timeout"), Math.min(ms, 2 ** 31 - 1));
  });
  return { done, stop: () => clearTimeout(timer) };
}
function causeText(cause) {
  return cause === "finishing" ? "the run is finishing" : cause === "deadline" ? "the run's total time limit was reached" : "the run was interrupted";
}
function shellTool(cfg) {
  const resolveTimeout = (raw) => {
    const c = raw ?? cfg.timeoutMs;
    return cfg.maxTimeoutMs === 0 ? c : Math.min(Math.max(c, 1), cfg.maxTimeoutMs);
  };
  return {
    spec: shellSpec(cfg),
    idempotent: false,
    cancellable: true,
    async call(args, ctx) {
      const command = typeof args.command === "string" ? args.command.trim() : "";
      if (!command)
        throw invalidArgs("`command` is required and must be non-empty");
      const rawCwd = typeof args.cwd === "string" ? args.cwd : void 0;
      const root = normalizePath(cfg.workspace);
      const cwd = await resolvePath(root, rawCwd ?? ".", cfg.restrictCwd ? [root] : []);
      if (!await isDir(cwd))
        throw invalidArgs(`cwd does not exist: ${cwd}`);
      const userEnv = parseEnv(args.env);
      const timeoutRaw = parseMs(args.timeout_ms, "timeout_ms");
      if (timeoutRaw === 0 && cfg.maxTimeoutMs !== 0)
        throw invalidArgs("`timeout_ms` must be a positive integer");
      const timeoutMs = resolveTimeout(timeoutRaw);
      parseMs(args.wait_ms, "wait_ms");
      const reqEnv = new Map(userEnv);
      let path = (reqEnv.get("PATH") ?? deno().env.get("PATH") ?? "").trim();
      for (const e of SYSTEM_PATH_ENTRIES)
        path = appendPathEntry(e, path);
      reqEnv.set("PATH", path);
      if (ctx.call_id)
        reqEnv.set(ENV_CALL_ID, ctx.call_id);
      if (ctx.run_id)
        reqEnv.set(ENV_RUN_ID, ctx.run_id);
      const env = { ...cfg.env, ...Object.fromEntries(reqEnv) };
      env.PATH = [...new Set(path.split(":").filter(Boolean))].join(":");
      const bound = execDirFor(ctx.run_dir, ctx.call_id);
      const temp = bound === void 0;
      const dir = bound ?? joinPath(deno().env.get("TMPDIR") || "/tmp", `llm-shell-${deno().pid}-${++localSeq}`);
      try {
        await deno().mkdir(dir, { recursive: true, mode: 448 });
      } catch (e) {
        throw execFailed(`execution directory: ${errorText(e)}`);
      }
      for (const stale of ["exit", "exit.tmp"])
        await deno().remove(joinPath(dir, stale)).catch(() => void 0);
      let child;
      const started = performance.now();
      try {
        child = new (deno()).Command("/bin/bash", {
          args: ["-c", NATIVE_WRAPPER, command, dir],
          cwd,
          env,
          stdin: "null",
          stdout: "null",
          stderr: "null"
        }).spawn();
      } catch (e) {
        throw execFailed(`spawn shell failed: ${errorText(e)}`);
      }
      const cleanup = async () => {
        if (temp)
          await deno().remove(dir, { recursive: true }).catch(() => void 0);
      };
      const kill = async () => {
        try {
          child.kill("SIGKILL");
        } catch {
        }
        const t = sleepOrStop(5e3);
        await Promise.race([child.status, t.done]);
        t.stop();
        const out2 = await outputFromExecDir(dir, TIMEOUT_EXIT_CODE, true, performance.now() - started, EXEC_MAX_OUTPUT_BYTES, cwd);
        await cleanup();
        return out2;
      };
      const timer = sleepOrStop(timeoutMs === 0 ? 365 * 24 * 3600 * 1e3 : timeoutMs);
      const first = await Promise.race([
        child.status.then((s) => ({ exited: s })),
        timer.done.then(() => ({ timeout: true })),
        ctx.call.cancelled().then((cause) => ({ cancel: cause }))
      ]);
      timer.stop();
      let out;
      if ("exited" in first) {
        out = await outputFromExecDir(dir, exitCodeOf(first.exited), false, performance.now() - started, EXEC_MAX_OUTPUT_BYTES, cwd);
        await cleanup();
      } else if ("timeout" in first) {
        out = await kill();
      } else {
        const tail = (await readFileTail(joinPath(dir, "stdout"), OUTPUT_TAIL_BYTES)).trimEnd();
        const stopped = await kill();
        throw new NativeToolError(
          "cancelled",
          `shell (native): \`${command}\` was stopped after ${stopped.duration_ms}ms because ${causeText(first.cancel)}. It may have had partial side effects; check before repeating it.${tail.trim() ? `
--- output so far (tail) ---
${tail}` : ""}`
        );
      }
      return shellFinishedResult(command, out, timeoutMs, cfg.maxTimeoutMs);
    }
  };
}
function shellFinishedResult(command, out, timeoutMs, maxTimeoutMs) {
  if (!out.timed_out) {
    const inner = forwardInnerResult(command, out);
    if (inner)
      return inner;
  }
  const summary = out.timed_out ? `timed out after ${out.duration_ms}ms (timeout_ms=${timeoutMs}); the command was stopped. Retry with a larger timeout_ms${maxTimeoutMs === 0 ? "" : ` (max ${maxTimeoutMs})`}, or start a long-lived service with nohup / setsid and return at once.` : `exit=${out.exit_code} in ${out.duration_ms}ms`;
  const detail = {
    command,
    cwd: out.cwd,
    exit_code: out.exit_code,
    stdout: out.stdout,
    stderr: out.stderr,
    output: out.output,
    output_truncated: out.output_truncated,
    timed_out: out.timed_out,
    duration_ms: out.duration_ms,
    engine: LOCAL_ENGINE,
    runtime: "native"
  };
  const r = builtinResult(TOOL_SHELL, detail, `${TOOL_SHELL} ${command}`, summary);
  r.status = out.exit_code === 0 && !out.timed_out ? "success" : "error";
  r.return_code = out.exit_code;
  r.title = defaultTitle(r);
  return withOutput(r, out.output);
}
const NATIVE_KIND = "native";
const LOCAL_PROBE = `set -e
command -v bash >/dev/null
machine_id="$(cat /etc/machine-id 2>/dev/null || true)"
[ -n "$machine_id" ] || machine_id="$(hostname)"
printf '%s\\0' "$machine_id" "$(hostname)" "$(id -u)" "$(uname -s | tr '[:upper:]' '[:lower:]')" "$(uname -m)" "$(command -v bash)" "$(pwd -P)" "\${PATH}" "$(date +%Y-%m-%dT%H:%M:%S%z)" "$(date +%Z%z)"
for tool in bash realpath base64; do if command -v "$tool" >/dev/null; then printf '%s\\0' "$tool"; fi; done
`;
function parseProbe(bytes) {
  let text = new TextDecoder().decode(bytes);
  if (text.endsWith("\0"))
    text = text.slice(0, -1);
  const p = text.split("\0");
  if (p.length < 10 || p.slice(0, 10).some((f) => f === ""))
    throw XllmError.capability("execution environment probe returned incomplete data");
  return {
    machine: p[0],
    hostname: p[1],
    uid: p[2],
    os: p[3],
    arch: p[4],
    shell: p[5],
    cwd: p[6],
    path: p[7],
    current_time: p[8],
    timezone: p[9],
    tools: p.slice(10, 42)
  };
}
async function localProbe(cwd, env) {
  if (deno().build.os === "windows")
    throw XllmError.capability("the Deno host's native runtime needs bash (Linux / macOS); Windows PowerShell runtimes are Rust-only");
  let out;
  try {
    out = await new (deno()).Command("/bin/bash", {
      args: ["-c", LOCAL_PROBE],
      cwd,
      env,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      signal: AbortSignal.timeout(1e4)
    }).output();
  } catch (e) {
    throw XllmError.capability(errorText(e));
  }
  if (!out.success)
    throw XllmError.capability(`native capability probe failed: ${new TextDecoder().decode(out.stderr)}`);
  return parseProbe(out.stdout);
}
function configError(reason) {
  return XllmError.config(".llm_context", "runtime", reason);
}
function validateConfig(c) {
  const kind = c.kind ?? NATIVE_KIND;
  if (PLANNED_RUNTIME_KINDS.includes(kind))
    throw XllmError.capability(`runtime \`${kind}\` is planned but not implemented`);
  if (kind === "site")
    throw XllmError.capability("runtime `site` is built by a website (createSiteRuntime); the Deno host runs `native`");
  if (kind === "remote_ssh" || kind === "remote_node")
    throw XllmError.capability(`runtime \`${kind}\` is not available on the Deno host (only \`native\`)`);
  if (kind !== NATIVE_KIND)
    throw configError(`unknown runtime kind \`${kind}\``);
  if (c.remote_ssh && c.kind !== void 0)
    throw configError("remote_ssh connection block requires kind: remote_ssh");
  if (c.remote_node && c.kind !== void 0)
    throw configError("remote_node connection block requires kind: remote_node");
  if (c.remote_ssh || c.remote_node)
    throw configError("connection block does not match runtime kind");
  validateEnv(c.env ?? {});
  if (c.id !== void 0 && !c.id.trim())
    throw configError("id cannot be empty");
  if (c.task_wait_ms === 0)
    throw configError("task_wait_ms must be positive");
}
function validateEnv(env) {
  for (const [k, v] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || v.includes("\0"))
      throw configError(`invalid env key or value \`${k}\``);
  }
}
function infoOf(probe, id, target, baseline) {
  const os = probe.os.toLowerCase();
  const shellName = probe.shell.split(/[/\\]/).pop() ?? "";
  return {
    id,
    kind: NATIVE_KIND,
    os: probe.os,
    arch: probe.arch,
    hostname: probe.hostname,
    shell: probe.shell,
    cwd: probe.cwd,
    tools: probe.tools,
    current_time: probe.current_time,
    timezone: probe.timezone,
    target,
    platform: os === "darwin" || os === "macos" ? "macos" : os,
    shell_kind: shellName.replace(/\.exe$/, "").replace(/\.EXE$/, "").toLowerCase(),
    baseline: baseline ?? ""
  };
}
const INTENT_ARG = "intent";
const INTENT_OPTIONAL_DESCRIPTION = "Optional: why you make this call now and what you expect it to give you, in one short sentence. Shown as the progress of your work.";
function withOptionalIntent(spec) {
  const s = cloneJson(spec);
  let schema = s.args_schema;
  if (typeof schema !== "object" || schema === null || Array.isArray(schema))
    schema = s.args_schema = { type: "object" };
  if (typeof schema.properties !== "object" || schema.properties === null || Array.isArray(schema.properties))
    schema.properties = {};
  schema.properties[INTENT_ARG] = { type: "string", description: INTENT_OPTIONAL_DESCRIPTION };
  if (Array.isArray(schema.required))
    schema.required = schema.required.filter((r) => r !== INTENT_ARG);
  return s;
}
function causeName(cause) {
  return cause === "deadline" ? "Deadline" : cause === "finishing" ? "Finishing" : "Interrupted";
}
class NativeToolManager {
  constructor(tools, workdir, advertised) {
    this.tools = tools;
    this.workdir = workdir;
    this.advertised = advertised;
    this.binding = { run_id: "" };
    this.ledger = new MemoryHintLedger();
    this.written = [];
  }
  bindRun(binding) {
    this.binding = { ...binding };
  }
  setRecovering(callId, reason) {
    this.recovering = { callId, reason };
  }
  artifacts() {
    return [...this.written];
  }
  has(name) {
    return this.tools.has(name);
  }
  hintLedger() {
    return this.ledger;
  }
  clearDedup() {
    this.ledger.clear(HINT_NS_DEDUP);
  }
  taskResolver() {
    return void 0;
  }
  listToolSpecs() {
    const specs = this.advertised ? [...this.advertised.values()] : [...this.tools.values()].map((t) => t.spec);
    return specs.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).map((s) => BASH_GROUP_TOOLS.includes(s.name) ? withOptionalIntent(s) : cloneJson(s));
  }
  names() {
    return [...this.tools.keys()].sort().join(", ");
  }
  async callTool(call, ctx) {
    var _a, _b;
    const callId = call.call_id;
    const tool = this.tools.get(call.name);
    if (!tool)
      return { kind: "error", call_id: callId, message: `tool \`${call.name}\` is not available in this run (available: ${this.names()})` };
    const args = { ...call.args ?? {} };
    if (BASH_GROUP_TOOLS.includes(call.name))
      delete args[INTENT_ARG];
    if (((_a = this.recovering) == null ? void 0 : _a.callId) === callId) {
      const reason = this.recovering.reason;
      this.recovering = void 0;
      if (!tool.idempotent)
        return { kind: "unresolved", call_id: callId, reason, effect_unknown: true };
    }
    const running = tool.call(args, { call_id: callId, run_id: this.binding.run_id, run_dir: this.binding.run_dir, call: ctx }).then((ok) => ({ ok }), (err) => ({ err }));
    let settled;
    if (tool.cancellable) {
      settled = await running;
    } else {
      const first = await Promise.race([running, ctx.cancelledHard().then((cause) => ({ cancelled: cause }))]);
      if ("cancelled" in first) {
        return {
          kind: "cancelled",
          call_id: callId,
          reason: `tool \`${call.name}\` was abandoned while running (${causeName(first.cancelled)}); it cannot be cancelled, so its effect is unknown`,
          effect_unknown: true
        };
      }
      settled = first;
    }
    if ("err" in settled) {
      const e = settled.err;
      if (e instanceof NativeToolError) {
        if (e.kind === "transport")
          throw new ToolDispatchException(e.detail, e.effectUnknown);
        if (e.kind === "cancelled")
          return { kind: "cancelled", call_id: callId, reason: e.detail, effect_unknown: e.effectUnknown };
        return { kind: "error", call_id: callId, message: e.message };
      }
      return { kind: "error", call_id: callId, message: `execution failed: ${errorText(e)}` };
    }
    const result = settled.ok;
    if (result.status === "success" && (call.name === TOOL_WRITE_FILE || call.name === TOOL_EDIT_FILE)) {
      const p = args.path;
      if (typeof p === "string") {
        const abs = p.startsWith("/") ? p : normalizePath(joinPath(this.workdir, p));
        if (!this.written.includes(abs))
          this.written.push(abs);
      }
    }
    if (result.status === "pending") {
      const taskId = (_b = result.task_id) == null ? void 0 : _b.trim();
      if (!taskId)
        return { kind: "error", call_id: callId, message: `tool \`${call.name}\` returned a pending result without a task_id`, host: toHost(result) };
      return taskStateObservation(callId, taskId, { kind: "unknown", reason: "this runtime has no task backend" }, { kind: "tools" });
    }
    return envelopeObservation(callId, result, applyHints(result, this.ledger));
  }
}
function nativeDescriptor(runtimeId, target, probe) {
  return {
    runtime_id: runtimeId,
    kind: NATIVE_KIND,
    host: target.host,
    target,
    workdir: probe.cwd,
    capabilities: { tools: Object.fromEntries(probe.tools.map((t) => [t, "available"])), network: true, os: probe.os }
  };
}
function shellNeedsTasks(shell) {
  return shell.wait_ms < shell.timeout_ms;
}
async function createNativeRuntime(options = {}) {
  const configured = cloneJson(options.config ?? { env: {} });
  configured.env = configured.env ?? {};
  validateConfig(configured);
  const rawCwd = configured.workdir ?? options.workdir ?? deno().cwd();
  let cwd;
  try {
    cwd = await deno().realPath(rawCwd);
  } catch (e) {
    throw XllmError.capability(`runtime cwd ${rawCwd}: ${errorText(e)}`);
  }
  if (!await isDir(cwd))
    throw XllmError.capability("runtime workdir must be a directory");
  const probe = await localProbe(cwd, configured.env);
  const target = nativeTarget(await nativeHostId(), probe.uid);
  const id = deriveRuntimeId(configured.id, NATIVE_KIND, target);
  const info = infoOf(probe, id, target, configured.baseline);
  const config = { ...configured, kind: NATIVE_KIND, id, workdir: info.cwd };
  const descriptor = nativeDescriptor(id, target, probe);
  const dfsRoot = joinPath(deno().env.get("BUCKYOS_ROOT") || "/opt/buckyos", "data");
  const expand = (sources, field, shell, fsPolicy, env, tools) => {
    const out = [];
    for (const src of sources) {
      const desc = describeToolSource(src);
      if (src.kind === "mcp")
        throw XllmError.capability(`${field}: \`${desc}\`: MCP tools are not available on the Deno host`);
      if (src.kind === "named")
        throw XllmError.capability(`${field}: \`${desc}\`: named host tools are not available on the Deno host (only the \`bash\` group)`);
      if (src.groupname === BUILTIN_TOOL_GROUP_BASH_CORE || src.groupname === "executor") {
        throw XllmError.capability(`${field}: \`${desc}\` needs a host task CLI / executor that the Deno host does not provide (use \`bash\`)`);
      }
      if (src.groupname !== BUILTIN_TOOL_GROUP_BASH) {
        throw XllmError.tools(`unknown builtin tool group \`${src.groupname}\` (available: ${BUILTIN_TOOL_GROUP_BASH}, ${BUILTIN_TOOL_GROUP_BASH_CORE}, executor)`);
      }
      if (shellNeedsTasks(shell)) {
        throw XllmError.capability(`${field}: \`shell\` would hand commands still running after runtime.task_wait_ms (${shell.wait_ms} ms) to a task backend, which the Deno host does not have; set runtime.task_wait_ms to at least tools.shell.timeout_ms (${shell.timeout_ms} ms) so \`shell\` waits for its command`);
      }
      const restrict = fsPolicy === "workspace";
      const fileCfg = {
        root: info.cwd,
        allowedRead: restrict ? [info.cwd] : [],
        allowedWrite: restrict ? [info.cwd] : [],
        dfsRoot
      };
      const group = [
        readFileTool(fileCfg),
        writeFileTool(fileCfg),
        editFileTool(fileCfg),
        shellTool({ workspace: info.cwd, restrictCwd: restrict, timeoutMs: shell.timeout_ms, maxTimeoutMs: shell.max_timeout_ms, env })
      ];
      for (const t of group) {
        if (tools.has(t.spec.name)) {
          throw XllmError.tools(`tool name \`${t.spec.name}\` from ${desc} conflicts with an already expanded tool of the same name`);
        }
        tools.set(t.spec.name, t);
        out.push({ name: t.spec.name, description: t.spec.description, args_schema: cloneJson(t.spec.args_schema), source: desc });
      }
    }
    return out;
  };
  let openedNames;
  const runtime = {
    kind: NATIVE_KIND,
    probe,
    descriptor: () => cloneJson(descriptor),
    config: () => cloneJson(config),
    // After `open`, the info of the opened tool set (Rust prompts read the manager's: probed
    // commands and the run's tool names, sorted, at most 32).
    async info() {
      const now = await localProbe(info.cwd, config.env);
      const tools = openedNames ? [.../* @__PURE__ */ new Set([...info.tools, ...openedNames])].sort().slice(0, 32) : info.tools;
      return { ...cloneJson(info), tools, current_time: now.current_time, timezone: now.timezone };
    },
    // deno-lint-ignore require-await
    async open(ctx, requested) {
      validateEnv(ctx.env);
      const env = { ...config.env, ...ctx.env };
      env.PATH = env.PATH ?? probe.path;
      const take = options.takeover && options.takeover.run_id === ctx.run_id ? options.takeover.tools : void 0;
      const cfg = take ? {
        enabled: take.enabled,
        filesystem_policy: take.filesystem_policy,
        tools2actions: take.tools2actions,
        tools: take.tool_sources,
        actions: take.action_sources,
        bash_tools: take.bash_tools,
        shell: { timeout_ms: take.shell.timeout_ms, max_timeout_ms: take.shell.max_timeout_ms }
      } : requested;
      const enabled = cfg.enabled ?? false;
      const fsPolicy = cfg.filesystem_policy ?? "workspace";
      const tools2actions = cfg.tools2actions ?? false;
      const shell = shellSettings(cfg.shell, ctx.task_wait_ms);
      const loop = ctx.loop_model;
      const eff = {
        enabled,
        filesystem_policy: fsPolicy,
        tools2actions,
        tool_sources: cloneJson(cfg.tools ?? []),
        action_sources: cloneJson(cfg.actions ?? []),
        native: [],
        actions: [],
        bash_tools: cloneJson(cfg.bash_tools ?? []),
        shell,
        exec_enabled: false,
        sources: { ...ctx.sources }
      };
      if (loop === "function_call") {
        if (tools2actions) {
          throw XllmError.capability("`tools2actions: true` requires `loop_model: behavior`; function_call cannot convert tools into actions");
        }
        if ((cfg.actions ?? []).length > 0) {
          throw XllmError.capability("`actions` are configured but `loop_model` is function_call; use `loop_model: behavior` or remove `actions`");
        }
      }
      const tools = /* @__PURE__ */ new Map();
      if (enabled) {
        const toolSources = cfg.tools ?? [{ kind: "group", groupname: BUILTIN_TOOL_GROUP_BASH }];
        eff.tool_sources = cloneJson(toolSources);
        const native = expand(toolSources, "tools.tools", shell, fsPolicy, env, tools);
        const explicit = expand(eff.action_sources, "tools.actions", shell, fsPolicy, env, tools);
        if (loop === "behavior" && tools2actions) {
          eff.actions = [...native, ...explicit];
        } else {
          eff.native = native;
          eff.actions = explicit;
        }
        eff.exec_enabled = tools.has(TOOL_SHELL) && [...eff.native, ...eff.actions].some((t) => t.name === TOOL_SHELL);
      }
      let advertised;
      if (take) {
        advertised = /* @__PURE__ */ new Map();
        for (const t of [...take.native, ...take.actions]) {
          if (tools.has(t.name))
            advertised.set(t.name, { name: t.name, description: t.description, args_schema: cloneJson(t.args_schema) });
        }
      }
      openedNames = [...eff.native, ...eff.actions].map((t) => t.name);
      return { tools: eff, manager: new NativeToolManager(tools, info.cwd, advertised) };
    },
    async describeInterrupted(run, call) {
      if (call.name !== TOOL_SHELL)
        return unresolvedReason(call.name);
      const dir = execDirFor(run.run_dir, call.call_id);
      if (dir === void 0)
        return interruptedShellText(call, void 0, "(no execution directory)");
      return interruptedShellText(call, await readExecDir(dir), dir);
    }
  };
  return runtime;
}
async function readExecDir(dir) {
  let started;
  try {
    const m = (await deno().stat(joinPath(dir, "command"))).mtime;
    if (m)
      started = Math.floor(m.getTime());
  } catch {
    started = void 0;
  }
  return {
    exit_code: await readExitFile(dir),
    stdout_tail: await readFileTail(joinPath(dir, "stdout"), OUTPUT_TAIL_BYTES),
    stderr_tail: await readFileTail(joinPath(dir, "stderr"), OUTPUT_TAIL_BYTES),
    exists: await isDir(dir),
    started_at_ms: started
  };
}
function shellCommandOf(call) {
  var _a;
  const c = (_a = call.args) == null ? void 0 : _a.command;
  if (typeof c !== "string")
    return "";
  const one = c.split(/\s+/).filter(Boolean).join(" ");
  const chars = [...one];
  return chars.length > 160 ? `${chars.slice(0, 160).join("")}…` : one;
}
function tails(f) {
  let s = "";
  if (f.stdout_tail.trim())
    s += `
--- stdout (tail) ---
${f.stdout_tail.trimEnd()}`;
  if (f.stderr_tail.trim())
    s += `
--- stderr (tail) ---
${f.stderr_tail.trimEnd()}`;
  return s;
}
function interruptedShellText(call, facts, location) {
  const command = shellCommandOf(call);
  const started = (facts == null ? void 0 : facts.started_at_ms) !== void 0 ? `started ${fmtElapsed(Math.max(0, Date.now() - facts.started_at_ms))} ago (at ${facts.started_at_ms} ms since epoch)` : "start time unknown";
  if ((facts == null ? void 0 : facts.exit_code) !== void 0) {
    return `shell (native): the previous executor exited while \`${command}\` was running (${started}). The command has since ended with exit code ${facts.exit_code} (read from ${location}); its result was never returned, so review it before deciding whether to repeat anything.${tails(facts)}`;
  }
  return `shell (native): the previous executor exited while \`${command}\` was running (${started}). The command may have partly executed; it usually ended together with the executor, but not necessarily (e.g. after kill -9 it may still be running). Background processes it started are unaffected. Check the actual state before repeating it.${facts ? tails(facts) : ""}`;
}
const DEFAULT_RUNS_DIR = "~/.xllm/runs";
const DEFAULT_LOCK_DIR = "~/.xllm/locks";
function resolveHostPath(raw, baseDir) {
  return resolveConfigPath(raw, baseDir, homeDir());
}
function runsDirOf(setting, origin) {
  if ((setting == null ? void 0 : setting.kind) === "disabled")
    return void 0;
  const raw = (setting == null ? void 0 : setting.kind) === "path" ? setting.path : DEFAULT_RUNS_DIR;
  return resolveHostPath(raw, parentDir(origin.startsWith("/") ? origin : joinPath(deno().cwd(), origin)));
}
class FileLock {
  constructor(file, path) {
    this.file = file;
    this.path = path;
    this.released = false;
  }
  /** Non-blocking (`FileLock::try_acquire`): `null` when another open file holds it. */
  static async tryAcquire(path) {
    try {
      await deno().mkdir(parentDir(path), { recursive: true });
    } catch (e) {
      throw XllmError.storage(`cannot create lock directory ${parentDir(path)}: ${errorText(e)}`);
    }
    let file;
    try {
      file = await deno().open(path, { read: true, write: true, create: true });
    } catch (e) {
      throw XllmError.storage(`cannot open lock ${path}: ${errorText(e)}`);
    }
    if (!await file.tryLock(true)) {
      file.close();
      return null;
    }
    try {
      await deno().writeTextFile(path, `${deno().pid}
`);
    } catch {
    }
    return new FileLock(file, path);
  }
  async release() {
    if (this.released)
      return;
    this.released = true;
    try {
      await this.file.unlock();
    } finally {
      this.file.close();
    }
  }
}
async function isLocked(path) {
  let file;
  try {
    file = await deno().open(path, { read: true, write: true, create: true });
  } catch {
    return false;
  }
  try {
    if (await file.tryLock(true)) {
      await file.unlock();
      return false;
    }
    return true;
  } finally {
    file.close();
  }
}
let tmpCounter = 0;
function pad4(n) {
  return String(n).padStart(4, "0");
}
class FileRunStore {
  /** `runsDir`: absolute, or relative to the current directory; `~` is the home directory. */
  constructor(runsDir) {
    this.persistent = true;
    this.dir = resolveHostPath(runsDir, deno().cwd());
  }
  runsDir() {
    return this.dir;
  }
  runDir(runId) {
    return joinPath(this.dir, runId);
  }
  /** The runs directory can be created and written (`ensure_writable`). */
  async ensureWritable() {
    try {
      await deno().mkdir(this.dir, { recursive: true });
    } catch (e) {
      throw XllmError.storage(`runs directory ${this.dir} cannot be created: ${errorText(e)}`);
    }
    const probe = joinPath(this.dir, `.probe-${deno().pid}`);
    try {
      await deno().writeFile(probe, new Uint8Array());
    } catch (e) {
      throw XllmError.storage(`runs directory ${this.dir} is not writable: ${errorText(e)}`);
    }
    await deno().remove(probe).catch(() => void 0);
  }
  async createRun() {
    await this.ensureWritable();
    for (let i = 0; i < 8; i++) {
      const runId = generateRunId();
      const dir = this.runDir(runId);
      try {
        await deno().mkdir(dir);
      } catch (e) {
        if (isAlreadyExists(e))
          continue;
        throw XllmError.storage(`cannot create run directory ${dir}: ${errorText(e)}`);
      }
      await deno().mkdir(joinPath(dir, "snapshots"), { recursive: true });
      return runId;
    }
    throw XllmError.storage("cannot allocate a unique run id");
  }
  async writeRecord(record) {
    const dir = this.runDir(record.run_id);
    const path = joinPath(dir, "run.json");
    const tmp = joinPath(dir, `run.json.tmp-${deno().pid}-${tmpCounter++}`);
    try {
      await deno().mkdir(dir, { recursive: true });
      await writeFileSynced(tmp, new TextEncoder().encode(JSON.stringify(record, null, 2)));
    } catch (e) {
      throw XllmError.storage(`write ${tmp}: ${errorText(e)}`);
    }
    try {
      await deno().rename(tmp, path);
    } catch (e) {
      throw XllmError.storage(`commit ${path}: ${errorText(e)}`);
    }
    try {
      await syncDir(dir);
    } catch (e) {
      throw XllmError.storage(`sync ${dir}: ${errorText(e)}`);
    }
  }
  /** Rejects with `run_not_found`, `not_resumable` (another record version, like Rust) or `corrupted_run`. */
  async readRecord(runId) {
    const path = joinPath(this.runDir(runId), "run.json");
    let text;
    try {
      text = await deno().readTextFile(path);
    } catch (e) {
      if (isNotFound(e))
        throw new XllmError({ kind: "run_not_found", run_id: runId, runs_dir: this.dir });
      throw XllmError.storage(`read ${path}: ${errorText(e)}`);
    }
    let value;
    try {
      value = JSON.parse(text);
    } catch (e) {
      throw new XllmError({ kind: "corrupted_run", run_id: runId, reason: errorText(e) });
    }
    const v = value;
    if ((v == null ? void 0 : v.version) !== RUN_RECORD_VERSION)
      throw XllmError.notResumable(runId, "unsupported run record version");
    if (typeof v.run_id !== "string" || typeof v.status !== "string" || typeof v.config !== "object" || typeof v.prompt !== "object") {
      throw new XllmError({ kind: "corrupted_run", run_id: runId, reason: "run.json unreadable: missing run_id / status / config / prompt" });
    }
    return value;
  }
  async listRecords() {
    const out = [];
    let entries;
    try {
      entries = deno().readDir(this.dir);
      for await (const entry of entries) {
        if (!entry.isDirectory)
          continue;
        try {
          const rec = JSON.parse(await deno().readTextFile(joinPath(this.dir, entry.name, "run.json")));
          if (rec && typeof rec.run_id === "string")
            out.push(rec);
        } catch {
        }
      }
    } catch (e) {
      if (isNotFound(e))
        return out;
      throw XllmError.storage(`read runs directory ${this.dir}: ${errorText(e)}`);
    }
    return out;
  }
  async putSnapshot(runId, snapshot) {
    const dir = joinPath(this.runDir(runId), "snapshots");
    try {
      await deno().mkdir(dir, { recursive: true });
      const idxs = await this.listSnapshots(runId);
      const next = idxs.length ? idxs[idxs.length - 1] + 1 : 1;
      const path = joinPath(dir, `${pad4(next)}.json`);
      const tmp = joinPath(dir, `${pad4(next)}.json.tmp`);
      await writeFileSynced(tmp, new TextEncoder().encode(JSON.stringify(snapshot)));
      await deno().rename(tmp, path);
      await syncDir(dir);
      return next;
    } catch (e) {
      if (e instanceof XllmError)
        throw e;
      throw XllmError.storage(`write snapshot of ${runId}: ${errorText(e)}`);
    }
  }
  async getSnapshot(runId, idx) {
    const path = joinPath(this.runDir(runId), "snapshots", `${pad4(idx)}.json`);
    let text;
    try {
      text = await deno().readTextFile(path);
    } catch (e) {
      throw new XllmError({ kind: "corrupted_run", run_id: runId, reason: `snapshot ${idx} missing at ${path}: ${errorText(e)}` });
    }
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new XllmError({ kind: "corrupted_run", run_id: runId, reason: `snapshot ${idx} unreadable: ${errorText(e)}` });
    }
  }
  async listSnapshots(runId) {
    const dir = joinPath(this.runDir(runId), "snapshots");
    const idxs = [];
    try {
      for await (const entry of deno().readDir(dir)) {
        const m = /^(\d+)\.json$/.exec(entry.name);
        if (m)
          idxs.push(Number(m[1]));
      }
    } catch (e) {
      if (isNotFound(e))
        return [];
      throw e;
    }
    return idxs.sort((a, b) => a - b);
  }
  /** The run's execution lock (`<run>/.lock`), `null` when another process (or open file) holds it. */
  lockRun(runId) {
    return FileLock.tryAcquire(joinPath(this.runDir(runId), ".lock"));
  }
  /** Some process holds the run's `.lock` (`is_run_live`). */
  async isRunLive(runId) {
    if (!await isDir(this.runDir(runId)))
      return false;
    return isLocked(joinPath(this.runDir(runId), ".lock"));
  }
  /** Delete the run directory; the caller holds its lock and has nothing unreconciled in flight. */
  async removeRun(runId) {
    const dir = this.runDir(runId);
    try {
      await deno().remove(dir, { recursive: true });
    } catch (e) {
      if (!isNotFound(e))
        throw XllmError.storage(`remove ${dir}: ${errorText(e)}`);
    }
    await syncDir(this.dir).catch(() => void 0);
  }
  /** Write a run exported from another store: same id, same snapshot indices. */
  async importRun(run) {
    const id = run.record.run_id;
    if (await this.isRunLive(id))
      throw new XllmError({ kind: "run_busy", run_id: id });
    const dir = this.runDir(id);
    await deno().mkdir(joinPath(dir, "snapshots"), { recursive: true });
    for (const [idx, snapshot] of run.snapshots) {
      const path = joinPath(dir, "snapshots", `${pad4(idx)}.json`);
      const tmp = `${path}.tmp`;
      await writeFileSynced(tmp, new TextEncoder().encode(JSON.stringify(snapshot)));
      await deno().rename(tmp, path);
    }
    await syncDir(joinPath(dir, "snapshots"));
    await this.writeRecord(run.record);
  }
}
function workdirLocker(lockDir = DEFAULT_LOCK_DIR) {
  const dir = resolveHostPath(lockDir, deno().cwd());
  return async (workdir, runId) => {
    const lock = await FileLock.tryAcquire(workdirLockPath(dir, workdir));
    if (lock)
      await deno().writeTextFile(lock.path, `${runId}
`).catch(() => void 0);
    return lock;
  };
}
function workdirExists(workdir) {
  return isDir(workdir);
}
const SESSION_TOKEN_ENV = "BUCKYOS_APPCLIENT_SESSION_TOKEN";
async function resolveSecret(ref) {
  if (ref.kind === "env") {
    const v = deno().env.get(ref.name);
    if (v === void 0)
      throw XllmError.capability(`environment variable \`${ref.name}\` is not set`);
    return v;
  }
  let raw;
  try {
    raw = await deno().readTextFile(ref.path);
  } catch (e) {
    throw XllmError.capability(`cannot re-read credential source ${ref.path}:${ref.field}: ${errorText(e)}`);
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (e) {
    throw XllmError.capability(`cannot parse credential source ${ref.path} (the Deno host reads JSON configuration): ${errorText(e)}`);
  }
  let cur = doc;
  for (const seg of ref.field.split(".")) {
    if (!isObject(cur) || !(seg in cur))
      throw XllmError.capability(`credential field \`${ref.field}\` no longer exists in ${ref.path}`);
    cur = cur[seg];
  }
  if (typeof cur !== "string" || !cur.trim())
    throw XllmError.capability(`credential field \`${ref.field}\` in ${ref.path} is empty or not a string`);
  return cur;
}
function credentialsRefusedClient(message) {
  return {
    // deno-lint-ignore require-await
    async infer() {
      throw providerError({ refused: { code: REFUSED_CREDENTIALS } }, message);
    }
  };
}
async function loadNodeSdk() {
  const url = new URL("./node.mjs", self.location).href;
  return await import(
    /* @vite-ignore */
    url
  );
}
async function createLlmClient(provider) {
  var _a, _b, _c;
  if ((provider.kind ?? "buckyos") === "openai") {
    const key = provider.api_key ? await resolveSecret(provider.api_key) : deno().env.get("OPENAI_API_KEY");
    if (!(key == null ? void 0 : key.trim())) {
      throw XllmError.capability("openai provider: no API key; set `provider.api_key`, `provider.api_key_env` or the OPENAI_API_KEY environment variable");
    }
    return new OpenAiLlmClient({ baseUrl: provider.base_url, apiKey: key, headers: provider.headers });
  }
  if (provider.on_behalf_of !== void 0 && provider.on_behalf_of !== null) {
    throw XllmError.capability("buckyos provider: `on_behalf_of` (a system service paying for a user) is not available on the Deno host");
  }
  const token = provider.session_token ? await resolveSecret(provider.session_token) : (_a = deno().env.get(SESSION_TOKEN_ENV)) == null ? void 0 : _a.trim();
  if (!token) {
    return credentialsRefusedClient(`buckyos provider: no BuckyOS session on this host (set ${SESSION_TOKEN_ENV}), sign in and resume`);
  }
  const appId = ((_b = deno().env.get("BUCKYOS_APP_ID")) == null ? void 0 : _b.trim()) || "buckycli";
  const sdk = new (await loadNodeSdk()).BuckyOSSDK("node");
  try {
    await sdk.initBuckyOS(appId, {
      zoneHost: ((_c = deno().env.get("BUCKYOS_ZONE_HOST")) == null ? void 0 : _c.trim()) ?? "",
      appId,
      defaultProtocol: "https://",
      runtimeType: "AppClient",
      sessionToken: token,
      privateKeySearchPaths: [],
      autoRenew: false
    });
  } catch (e) {
    throw XllmError.capability(`buckyos provider: cannot initialize the BuckyOS runtime (check zone/session setup): ${errorText(e)}`);
  }
  return new AiccLlmClient(sdk.getAiccClient());
}
function nativeDeps(runtime, store, llm, options = {}) {
  const deps = {
    llm,
    runtime,
    store,
    pid: deno().pid,
    lockWorkdir: workdirLocker(options.lockDir),
    workdirExists
  };
  if (options.observer)
    deps.observer = options.observer;
  if (options.tokenizer)
    deps.tokenizer = options.tokenizer;
  return deps;
}
const pendingLlm = {
  infer() {
    throw XllmError.other("the model client is created after the task is prepared");
  }
};
async function prepareNativeTask(llmContext, origin, input, overrides, options = {}) {
  const merged = mergeConfigLayers([{ path: origin, file: parseLlmContextJson(origin, llmContext ?? null) }]);
  const runtime = await createNativeRuntime({ config: merged.runtime, workdir: options.workdir });
  let store = options.store;
  if (!store) {
    const dir = runsDirOf(merged.runs_dir, origin);
    store = dir === void 0 ? new MemoryRunStore() : new FileRunStore(dir);
  }
  const draft = nativeDeps(runtime, store, options.llm ?? pendingLlm, options);
  const task = await XllmTask.prepare(llmContext, origin, input, overrides, draft);
  return { task, deps: { ...draft, llm: options.llm ?? await createLlmClient(task.config.provider) } };
}
function unavailableRuntime(error) {
  const err = error instanceof XllmError ? error : XllmError.capability(error instanceof Error ? error.message : String(error));
  const fail = () => {
    throw err;
  };
  const rejected = () => Promise.reject(err);
  return { descriptor: fail, config: fail, info: rejected, open: rejected, describeInterrupted: rejected };
}
async function resumeNativeRun(store, runId, limits = {}, options = {}) {
  const record = await store.readRecord(runId);
  let runtime;
  let llm = options.llm;
  if (isTerminal(record.status)) {
    runtime = unavailableRuntime(XllmError.other("a terminal run is not executed"));
  } else {
    try {
      runtime = await createNativeRuntime({
        config: record.config.runtime,
        workdir: record.workdir,
        takeover: { run_id: record.run_id, tools: record.config.tools }
      });
    } catch (e) {
      runtime = unavailableRuntime(e);
    }
    llm = llm ?? await createLlmClient(record.config.provider);
  }
  return XllmRun.resume(store, runId, limits, nativeDeps(runtime, store, llm ?? pendingLlm, options));
}
export {
  BASH_GROUP_TOOLS,
  DEFAULT_LOCK_DIR,
  DEFAULT_RUNS_DIR,
  EDIT_FILE_SPEC,
  EXEC_MAX_OUTPUT_BYTES,
  FileLock,
  FileRunStore,
  HOST_ID_ENV,
  LOCAL_PROBE,
  NATIVE_KIND,
  NATIVE_WRAPPER,
  NativeToolManager,
  READ_FILE_SPEC,
  SESSION_TOKEN_ENV,
  WRITE_FILE_SPEC,
  blake3Hex,
  createLlmClient,
  createNativeRuntime,
  credentialsRefusedClient,
  deriveRuntimeId,
  execDirFor,
  fmtElapsed,
  interruptedShellText,
  isLocked,
  localProbe,
  nativeDeps,
  nativeDescriptor,
  nativeHostId,
  nativeHostIdFrom,
  nativeTarget,
  parseProbe,
  prepareNativeTask,
  readExecDir,
  resolveHostPath,
  resolveSecret,
  resumeNativeRun,
  runsDirOf,
  runtimeIdOf,
  sanitizeCallId,
  shellSpec,
  targetText,
  workdirExists,
  workdirLockPath,
  workdirLocker
};
//# sourceMappingURL=xllm_deno.mjs.map
