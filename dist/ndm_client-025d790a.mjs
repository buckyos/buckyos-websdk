class RPCError extends Error {
  constructor(message) {
    super(message);
    this.name = "RPCError";
  }
}
const defaultFetcher = async (input, init) => {
  if (typeof window !== "undefined" && typeof window.fetch === "function") {
    return window.fetch(input, init);
  }
  if (typeof globalThis !== "undefined" && typeof globalThis.fetch === "function") {
    return globalThis.fetch(input, init);
  }
  throw new RPCError("fetch is not available in this runtime");
};
class kRPCClient {
  constructor(url, token = null, seq = null, options = {}) {
    this.serverUrl = url;
    this.protocolType = "HttpPostJson";
    this.seq = seq ?? Date.now();
    this.sessionToken = token || null;
    this.initToken = token || null;
    this.fetcher = options.fetcher ?? defaultFetcher;
    this.sessionTokenProvider = options.sessionTokenProvider ?? null;
    this.onSessionTokenChanged = options.onSessionTokenChanged ?? null;
  }
  async call(method, params) {
    return this._call(method, params);
  }
  setSeq(seq) {
    this.seq = seq;
  }
  resetSessionToken() {
    this.sessionToken = this.initToken;
  }
  setSessionToken(token) {
    this.sessionToken = token;
  }
  getSessionToken() {
    return this.sessionToken;
  }
  buildRequest(method, params, seq) {
    const sys = this.sessionToken ? [seq, this.sessionToken] : [seq];
    return {
      method,
      params,
      sys
    };
  }
  parseSys(sys, currentSeq) {
    if (sys === void 0 || sys === null) {
      return null;
    }
    if (!Array.isArray(sys)) {
      throw new RPCError("sys is not array");
    }
    if (sys.length < 1) {
      throw new RPCError("sys is empty");
    }
    const responseSeq = sys[0];
    if (typeof responseSeq !== "number") {
      throw new RPCError("sys[0] is not number");
    }
    if (responseSeq !== currentSeq) {
      throw new RPCError(`seq not match: ${responseSeq}!=${currentSeq}`);
    }
    if (sys.length >= 2) {
      const token = sys[1];
      if (typeof token !== "string") {
        throw new RPCError("sys[1] is not string");
      }
      return token;
    }
    return null;
  }
  async _call(method, params) {
    if (this.sessionTokenProvider) {
      const preparedToken = await this.sessionTokenProvider();
      if (preparedToken !== void 0) {
        this.sessionToken = preparedToken || null;
      }
    }
    const currentSeq = this.seq;
    this.seq += 1;
    const requestBody = this.buildRequest(method, params, currentSeq);
    try {
      const response = await this.fetcher(this.serverUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      });
      if (!response.ok) {
        throw new RPCError(`RPC call error: ${response.status}`);
      }
      const rpcResponse = await response.json();
      const updatedToken = this.parseSys(rpcResponse.sys, currentSeq);
      if (updatedToken) {
        this.sessionToken = updatedToken;
        if (this.onSessionTokenChanged) {
          this.onSessionTokenChanged(updatedToken);
        }
      }
      if ("error" in rpcResponse && rpcResponse.error) {
        throw new RPCError(`RPC call error: ${rpcResponse.error}`);
      }
      if (!("result" in rpcResponse) || rpcResponse.result === void 0) {
        throw new RPCError("RPC response missing result");
      }
      return rpcResponse.result;
    } catch (error) {
      if (error instanceof RPCError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new RPCError(`RPC call failed: ${message}`);
    }
  }
}
function ensureSSOEnvironment() {
  if (typeof window === "undefined" || typeof window.location === "undefined") {
    throw new Error("AuthClient can only be created in browser SSO environments");
  }
}
class AuthClient {
  constructor(zoneBaseUrl, appId, options = {}) {
    ensureSSOEnvironment();
    this.zoneHostname = zoneBaseUrl;
    this.clientId = appId;
    this.navigate = options.navigate ?? ((url) => {
      window.location.assign(url);
    });
  }
  buildLoginURL(redirectUri = null) {
    ensureSSOEnvironment();
    const redirectTarget = redirectUri ?? window.location.href;
    const ssoURL = `${window.location.protocol}//sys.${this.zoneHostname}/login`;
    return `${ssoURL}?client_id=${this.clientId}&redirect_url=${encodeURIComponent(redirectTarget)}`;
  }
  async login(redirectUri = null) {
    const authURL = this.buildLoginURL(redirectUri);
    this.navigate(authURL);
  }
}
const t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", n = "ARRAYBUFFER not supported by this environment", e = "UINT8ARRAY not supported by this environment";
function r(t2, n2, e2, r2) {
  let i2, s2, o2;
  const h2 = n2 || [0], u2 = (e2 = e2 || 0) >>> 3, w2 = -1 === r2 ? 3 : 0;
  for (i2 = 0; i2 < t2.length; i2 += 1)
    o2 = i2 + u2, s2 = o2 >>> 2, h2.length <= s2 && h2.push(0), h2[s2] |= t2[i2] << 8 * (w2 + r2 * (o2 % 4));
  return { value: h2, binLen: 8 * t2.length + e2 };
}
function i(i2, s2, o2) {
  switch (s2) {
    case "UTF8":
    case "UTF16BE":
    case "UTF16LE":
      break;
    default:
      throw new Error("encoding must be UTF8, UTF16BE, or UTF16LE");
  }
  switch (i2) {
    case "HEX":
      return function(t2, n2, e2) {
        return function(t3, n3, e3, r2) {
          let i3, s3, o3, h2;
          if (0 != t3.length % 2)
            throw new Error("String of HEX type must be in byte increments");
          const u2 = n3 || [0], w2 = (e3 = e3 || 0) >>> 3, c2 = -1 === r2 ? 3 : 0;
          for (i3 = 0; i3 < t3.length; i3 += 2) {
            if (s3 = parseInt(t3.substr(i3, 2), 16), isNaN(s3))
              throw new Error("String of HEX type contains invalid characters");
            for (h2 = (i3 >>> 1) + w2, o3 = h2 >>> 2; u2.length <= o3; )
              u2.push(0);
            u2[o3] |= s3 << 8 * (c2 + r2 * (h2 % 4));
          }
          return { value: u2, binLen: 4 * t3.length + e3 };
        }(t2, n2, e2, o2);
      };
    case "TEXT":
      return function(t2, n2, e2) {
        return function(t3, n3, e3, r2, i3) {
          let s3, o3, h2, u2, w2, c2, f2, a2, l2 = 0;
          const A2 = e3 || [0], E2 = (r2 = r2 || 0) >>> 3;
          if ("UTF8" === n3)
            for (f2 = -1 === i3 ? 3 : 0, h2 = 0; h2 < t3.length; h2 += 1)
              for (s3 = t3.charCodeAt(h2), o3 = [], 128 > s3 ? o3.push(s3) : 2048 > s3 ? (o3.push(192 | s3 >>> 6), o3.push(128 | 63 & s3)) : 55296 > s3 || 57344 <= s3 ? o3.push(224 | s3 >>> 12, 128 | s3 >>> 6 & 63, 128 | 63 & s3) : (h2 += 1, s3 = 65536 + ((1023 & s3) << 10 | 1023 & t3.charCodeAt(h2)), o3.push(240 | s3 >>> 18, 128 | s3 >>> 12 & 63, 128 | s3 >>> 6 & 63, 128 | 63 & s3)), u2 = 0; u2 < o3.length; u2 += 1) {
                for (c2 = l2 + E2, w2 = c2 >>> 2; A2.length <= w2; )
                  A2.push(0);
                A2[w2] |= o3[u2] << 8 * (f2 + i3 * (c2 % 4)), l2 += 1;
              }
          else
            for (f2 = -1 === i3 ? 2 : 0, a2 = "UTF16LE" === n3 && 1 !== i3 || "UTF16LE" !== n3 && 1 === i3, h2 = 0; h2 < t3.length; h2 += 1) {
              for (s3 = t3.charCodeAt(h2), true === a2 && (u2 = 255 & s3, s3 = u2 << 8 | s3 >>> 8), c2 = l2 + E2, w2 = c2 >>> 2; A2.length <= w2; )
                A2.push(0);
              A2[w2] |= s3 << 8 * (f2 + i3 * (c2 % 4)), l2 += 2;
            }
          return { value: A2, binLen: 8 * l2 + r2 };
        }(t2, s2, n2, e2, o2);
      };
    case "B64":
      return function(n2, e2, r2) {
        return function(n3, e3, r3, i3) {
          let s3, o3, h2, u2, w2, c2, f2, a2 = 0;
          const l2 = e3 || [0], A2 = (r3 = r3 || 0) >>> 3, E2 = -1 === i3 ? 3 : 0, H2 = n3.indexOf("=");
          if (-1 === n3.search(/^[a-zA-Z0-9=+/]+$/))
            throw new Error("Invalid character in base-64 string");
          if (n3 = n3.replace(/=/g, ""), -1 !== H2 && H2 < n3.length)
            throw new Error("Invalid '=' found in base-64 string");
          for (o3 = 0; o3 < n3.length; o3 += 4) {
            for (w2 = n3.substr(o3, 4), u2 = 0, h2 = 0; h2 < w2.length; h2 += 1)
              s3 = t.indexOf(w2.charAt(h2)), u2 |= s3 << 18 - 6 * h2;
            for (h2 = 0; h2 < w2.length - 1; h2 += 1) {
              for (f2 = a2 + A2, c2 = f2 >>> 2; l2.length <= c2; )
                l2.push(0);
              l2[c2] |= (u2 >>> 16 - 8 * h2 & 255) << 8 * (E2 + i3 * (f2 % 4)), a2 += 1;
            }
          }
          return { value: l2, binLen: 8 * a2 + r3 };
        }(n2, e2, r2, o2);
      };
    case "BYTES":
      return function(t2, n2, e2) {
        return function(t3, n3, e3, r2) {
          let i3, s3, o3, h2;
          const u2 = n3 || [0], w2 = (e3 = e3 || 0) >>> 3, c2 = -1 === r2 ? 3 : 0;
          for (s3 = 0; s3 < t3.length; s3 += 1)
            i3 = t3.charCodeAt(s3), h2 = s3 + w2, o3 = h2 >>> 2, u2.length <= o3 && u2.push(0), u2[o3] |= i3 << 8 * (c2 + r2 * (h2 % 4));
          return { value: u2, binLen: 8 * t3.length + e3 };
        }(t2, n2, e2, o2);
      };
    case "ARRAYBUFFER":
      try {
        new ArrayBuffer(0);
      } catch (t2) {
        throw new Error(n);
      }
      return function(t2, n2, e2) {
        return function(t3, n3, e3, i3) {
          return r(new Uint8Array(t3), n3, e3, i3);
        }(t2, n2, e2, o2);
      };
    case "UINT8ARRAY":
      try {
        new Uint8Array(0);
      } catch (t2) {
        throw new Error(e);
      }
      return function(t2, n2, e2) {
        return r(t2, n2, e2, o2);
      };
    default:
      throw new Error("format must be HEX, TEXT, B64, BYTES, ARRAYBUFFER, or UINT8ARRAY");
  }
}
function s(r2, i2, s2, o2) {
  switch (r2) {
    case "HEX":
      return function(t2) {
        return function(t3, n2, e2, r3) {
          const i3 = "0123456789abcdef";
          let s3, o3, h2 = "";
          const u2 = n2 / 8, w2 = -1 === e2 ? 3 : 0;
          for (s3 = 0; s3 < u2; s3 += 1)
            o3 = t3[s3 >>> 2] >>> 8 * (w2 + e2 * (s3 % 4)), h2 += i3.charAt(o3 >>> 4 & 15) + i3.charAt(15 & o3);
          return r3.outputUpper ? h2.toUpperCase() : h2;
        }(t2, i2, s2, o2);
      };
    case "B64":
      return function(n2) {
        return function(n3, e2, r3, i3) {
          let s3, o3, h2, u2, w2, c2 = "";
          const f2 = e2 / 8, a2 = -1 === r3 ? 3 : 0;
          for (s3 = 0; s3 < f2; s3 += 3)
            for (u2 = s3 + 1 < f2 ? n3[s3 + 1 >>> 2] : 0, w2 = s3 + 2 < f2 ? n3[s3 + 2 >>> 2] : 0, h2 = (n3[s3 >>> 2] >>> 8 * (a2 + r3 * (s3 % 4)) & 255) << 16 | (u2 >>> 8 * (a2 + r3 * ((s3 + 1) % 4)) & 255) << 8 | w2 >>> 8 * (a2 + r3 * ((s3 + 2) % 4)) & 255, o3 = 0; o3 < 4; o3 += 1)
              c2 += 8 * s3 + 6 * o3 <= e2 ? t.charAt(h2 >>> 6 * (3 - o3) & 63) : i3.b64Pad;
          return c2;
        }(n2, i2, s2, o2);
      };
    case "BYTES":
      return function(t2) {
        return function(t3, n2, e2) {
          let r3, i3, s3 = "";
          const o3 = n2 / 8, h2 = -1 === e2 ? 3 : 0;
          for (r3 = 0; r3 < o3; r3 += 1)
            i3 = t3[r3 >>> 2] >>> 8 * (h2 + e2 * (r3 % 4)) & 255, s3 += String.fromCharCode(i3);
          return s3;
        }(t2, i2, s2);
      };
    case "ARRAYBUFFER":
      try {
        new ArrayBuffer(0);
      } catch (t2) {
        throw new Error(n);
      }
      return function(t2) {
        return function(t3, n2, e2) {
          let r3;
          const i3 = n2 / 8, s3 = new ArrayBuffer(i3), o3 = new Uint8Array(s3), h2 = -1 === e2 ? 3 : 0;
          for (r3 = 0; r3 < i3; r3 += 1)
            o3[r3] = t3[r3 >>> 2] >>> 8 * (h2 + e2 * (r3 % 4)) & 255;
          return s3;
        }(t2, i2, s2);
      };
    case "UINT8ARRAY":
      try {
        new Uint8Array(0);
      } catch (t2) {
        throw new Error(e);
      }
      return function(t2) {
        return function(t3, n2, e2) {
          let r3;
          const i3 = n2 / 8, s3 = -1 === e2 ? 3 : 0, o3 = new Uint8Array(i3);
          for (r3 = 0; r3 < i3; r3 += 1)
            o3[r3] = t3[r3 >>> 2] >>> 8 * (s3 + e2 * (r3 % 4)) & 255;
          return o3;
        }(t2, i2, s2);
      };
    default:
      throw new Error("format must be HEX, B64, BYTES, ARRAYBUFFER, or UINT8ARRAY");
  }
}
const o = 4294967296, h = [1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221, 3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580, 3835390401, 4022224774, 264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986, 2554220882, 2821834349, 2952996808, 3210313671, 3336571891, 3584528711, 113926993, 338241895, 666307205, 773529912, 1294757372, 1396182291, 1695183700, 1986661051, 2177026350, 2456956037, 2730485921, 2820302411, 3259730800, 3345764771, 3516065817, 3600352804, 4094571909, 275423344, 430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063, 1747873779, 1955562222, 2024104815, 2227730452, 2361852424, 2428436474, 2756734187, 3204031479, 3329325298], u = [3238371032, 914150663, 812702999, 4144912697, 4290775857, 1750603025, 1694076839, 3204075428], w = [1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225], c = "Chosen SHA variant is not supported", f = "Cannot set numRounds with MAC";
function a(t2, n2) {
  let e2, r2;
  const i2 = t2.binLen >>> 3, s2 = n2.binLen >>> 3, o2 = i2 << 3, h2 = 4 - i2 << 3;
  if (i2 % 4 != 0) {
    for (e2 = 0; e2 < s2; e2 += 4)
      r2 = i2 + e2 >>> 2, t2.value[r2] |= n2.value[e2 >>> 2] << o2, t2.value.push(0), t2.value[r2 + 1] |= n2.value[e2 >>> 2] >>> h2;
    return (t2.value.length << 2) - 4 >= s2 + i2 && t2.value.pop(), { value: t2.value, binLen: t2.binLen + n2.binLen };
  }
  return { value: t2.value.concat(n2.value), binLen: t2.binLen + n2.binLen };
}
function l(t2) {
  const n2 = { outputUpper: false, b64Pad: "=", outputLen: -1 }, e2 = t2 || {}, r2 = "Output length must be a multiple of 8";
  if (n2.outputUpper = e2.outputUpper || false, e2.b64Pad && (n2.b64Pad = e2.b64Pad), e2.outputLen) {
    if (e2.outputLen % 8 != 0)
      throw new Error(r2);
    n2.outputLen = e2.outputLen;
  } else if (e2.shakeLen) {
    if (e2.shakeLen % 8 != 0)
      throw new Error(r2);
    n2.outputLen = e2.shakeLen;
  }
  if ("boolean" != typeof n2.outputUpper)
    throw new Error("Invalid outputUpper formatting option");
  if ("string" != typeof n2.b64Pad)
    throw new Error("Invalid b64Pad formatting option");
  return n2;
}
function A(t2, n2, e2, r2) {
  const s2 = t2 + " must include a value and format";
  if (!n2) {
    if (!r2)
      throw new Error(s2);
    return r2;
  }
  if (void 0 === n2.value || !n2.format)
    throw new Error(s2);
  return i(n2.format, n2.encoding || "UTF8", e2)(n2.value);
}
class E {
  constructor(t2, n2, e2) {
    const r2 = e2 || {};
    if (this.t = n2, this.i = r2.encoding || "UTF8", this.numRounds = r2.numRounds || 1, isNaN(this.numRounds) || this.numRounds !== parseInt(this.numRounds, 10) || 1 > this.numRounds)
      throw new Error("numRounds must a integer >= 1");
    this.o = t2, this.h = [], this.u = 0, this.l = false, this.A = 0, this.H = false, this.S = [], this.p = [];
  }
  update(t2) {
    let n2, e2 = 0;
    const r2 = this.m >>> 5, i2 = this.C(t2, this.h, this.u), s2 = i2.binLen, o2 = i2.value, h2 = s2 >>> 5;
    for (n2 = 0; n2 < h2; n2 += r2)
      e2 + this.m <= s2 && (this.U = this.v(o2.slice(n2, n2 + r2), this.U), e2 += this.m);
    return this.A += e2, this.h = o2.slice(e2 >>> 5), this.u = s2 % this.m, this.l = true, this;
  }
  getHash(t2, n2) {
    let e2, r2, i2 = this.R;
    const o2 = l(n2);
    if (this.K) {
      if (-1 === o2.outputLen)
        throw new Error("Output length must be specified in options");
      i2 = o2.outputLen;
    }
    const h2 = s(t2, i2, this.T, o2);
    if (this.H && this.g)
      return h2(this.g(o2));
    for (r2 = this.F(this.h.slice(), this.u, this.A, this.L(this.U), i2), e2 = 1; e2 < this.numRounds; e2 += 1)
      this.K && i2 % 32 != 0 && (r2[r2.length - 1] &= 16777215 >>> 24 - i2 % 32), r2 = this.F(r2, i2, 0, this.B(this.o), i2);
    return h2(r2);
  }
  setHMACKey(t2, n2, e2) {
    if (!this.M)
      throw new Error("Variant does not support HMAC");
    if (this.l)
      throw new Error("Cannot set MAC key after calling update");
    const r2 = i(n2, (e2 || {}).encoding || "UTF8", this.T);
    this.k(r2(t2));
  }
  k(t2) {
    const n2 = this.m >>> 3, e2 = n2 / 4 - 1;
    let r2;
    if (1 !== this.numRounds)
      throw new Error(f);
    if (this.H)
      throw new Error("MAC key already set");
    for (n2 < t2.binLen / 8 && (t2.value = this.F(t2.value, t2.binLen, 0, this.B(this.o), this.R)); t2.value.length <= e2; )
      t2.value.push(0);
    for (r2 = 0; r2 <= e2; r2 += 1)
      this.S[r2] = 909522486 ^ t2.value[r2], this.p[r2] = 1549556828 ^ t2.value[r2];
    this.U = this.v(this.S, this.U), this.A = this.m, this.H = true;
  }
  getHMAC(t2, n2) {
    const e2 = l(n2);
    return s(t2, this.R, this.T, e2)(this.Y());
  }
  Y() {
    let t2;
    if (!this.H)
      throw new Error("Cannot call getHMAC without first setting MAC key");
    const n2 = this.F(this.h.slice(), this.u, this.A, this.L(this.U), this.R);
    return t2 = this.v(this.p, this.B(this.o)), t2 = this.F(n2, this.R, this.m, t2, this.R), t2;
  }
}
function H(t2, n2) {
  return t2 << n2 | t2 >>> 32 - n2;
}
function S(t2, n2) {
  return t2 >>> n2 | t2 << 32 - n2;
}
function b(t2, n2) {
  return t2 >>> n2;
}
function p(t2, n2, e2) {
  return t2 ^ n2 ^ e2;
}
function d(t2, n2, e2) {
  return t2 & n2 ^ ~t2 & e2;
}
function m(t2, n2, e2) {
  return t2 & n2 ^ t2 & e2 ^ n2 & e2;
}
function C(t2) {
  return S(t2, 2) ^ S(t2, 13) ^ S(t2, 22);
}
function y(t2, n2) {
  const e2 = (65535 & t2) + (65535 & n2);
  return (65535 & (t2 >>> 16) + (n2 >>> 16) + (e2 >>> 16)) << 16 | 65535 & e2;
}
function U(t2, n2, e2, r2) {
  const i2 = (65535 & t2) + (65535 & n2) + (65535 & e2) + (65535 & r2);
  return (65535 & (t2 >>> 16) + (n2 >>> 16) + (e2 >>> 16) + (r2 >>> 16) + (i2 >>> 16)) << 16 | 65535 & i2;
}
function v(t2, n2, e2, r2, i2) {
  const s2 = (65535 & t2) + (65535 & n2) + (65535 & e2) + (65535 & r2) + (65535 & i2);
  return (65535 & (t2 >>> 16) + (n2 >>> 16) + (e2 >>> 16) + (r2 >>> 16) + (i2 >>> 16) + (s2 >>> 16)) << 16 | 65535 & s2;
}
function R(t2) {
  return S(t2, 7) ^ S(t2, 18) ^ b(t2, 3);
}
function K(t2) {
  return S(t2, 6) ^ S(t2, 11) ^ S(t2, 25);
}
function T(t2) {
  return [1732584193, 4023233417, 2562383102, 271733878, 3285377520];
}
function g(t2, n2) {
  let e2, r2, i2, s2, o2, h2, u2;
  const w2 = [];
  for (e2 = n2[0], r2 = n2[1], i2 = n2[2], s2 = n2[3], o2 = n2[4], u2 = 0; u2 < 80; u2 += 1)
    w2[u2] = u2 < 16 ? t2[u2] : H(w2[u2 - 3] ^ w2[u2 - 8] ^ w2[u2 - 14] ^ w2[u2 - 16], 1), h2 = u2 < 20 ? v(H(e2, 5), d(r2, i2, s2), o2, 1518500249, w2[u2]) : u2 < 40 ? v(H(e2, 5), p(r2, i2, s2), o2, 1859775393, w2[u2]) : u2 < 60 ? v(H(e2, 5), m(r2, i2, s2), o2, 2400959708, w2[u2]) : v(H(e2, 5), p(r2, i2, s2), o2, 3395469782, w2[u2]), o2 = s2, s2 = i2, i2 = H(r2, 30), r2 = e2, e2 = h2;
  return n2[0] = y(e2, n2[0]), n2[1] = y(r2, n2[1]), n2[2] = y(i2, n2[2]), n2[3] = y(s2, n2[3]), n2[4] = y(o2, n2[4]), n2;
}
function F(t2, n2, e2, r2) {
  let i2;
  const s2 = 15 + (n2 + 65 >>> 9 << 4), h2 = n2 + e2;
  for (; t2.length <= s2; )
    t2.push(0);
  for (t2[n2 >>> 5] |= 128 << 24 - n2 % 32, t2[s2] = 4294967295 & h2, t2[s2 - 1] = h2 / o | 0, i2 = 0; i2 < t2.length; i2 += 16)
    r2 = g(t2.slice(i2, i2 + 16), r2);
  return r2;
}
let L = class extends E {
  constructor(t2, n2, e2) {
    if ("SHA-1" !== t2)
      throw new Error(c);
    super(t2, n2, e2);
    const r2 = e2 || {};
    this.M = true, this.g = this.Y, this.T = -1, this.C = i(this.t, this.i, this.T), this.v = g, this.L = function(t3) {
      return t3.slice();
    }, this.B = T, this.F = F, this.U = [1732584193, 4023233417, 2562383102, 271733878, 3285377520], this.m = 512, this.R = 160, this.K = false, r2.hmacKey && this.k(A("hmacKey", r2.hmacKey, this.T));
  }
};
function B(t2) {
  let n2;
  return n2 = "SHA-224" == t2 ? u.slice() : w.slice(), n2;
}
function M(t2, n2) {
  let e2, r2, i2, s2, o2, u2, w2, c2, f2, a2, l2;
  const A2 = [];
  for (e2 = n2[0], r2 = n2[1], i2 = n2[2], s2 = n2[3], o2 = n2[4], u2 = n2[5], w2 = n2[6], c2 = n2[7], l2 = 0; l2 < 64; l2 += 1)
    A2[l2] = l2 < 16 ? t2[l2] : U(S(E2 = A2[l2 - 2], 17) ^ S(E2, 19) ^ b(E2, 10), A2[l2 - 7], R(A2[l2 - 15]), A2[l2 - 16]), f2 = v(c2, K(o2), d(o2, u2, w2), h[l2], A2[l2]), a2 = y(C(e2), m(e2, r2, i2)), c2 = w2, w2 = u2, u2 = o2, o2 = y(s2, f2), s2 = i2, i2 = r2, r2 = e2, e2 = y(f2, a2);
  var E2;
  return n2[0] = y(e2, n2[0]), n2[1] = y(r2, n2[1]), n2[2] = y(i2, n2[2]), n2[3] = y(s2, n2[3]), n2[4] = y(o2, n2[4]), n2[5] = y(u2, n2[5]), n2[6] = y(w2, n2[6]), n2[7] = y(c2, n2[7]), n2;
}
let k = class extends E {
  constructor(t2, n2, e2) {
    if ("SHA-224" !== t2 && "SHA-256" !== t2)
      throw new Error(c);
    super(t2, n2, e2);
    const r2 = e2 || {};
    this.g = this.Y, this.M = true, this.T = -1, this.C = i(this.t, this.i, this.T), this.v = M, this.L = function(t3) {
      return t3.slice();
    }, this.B = B, this.F = function(n3, e3, r3, i2) {
      return function(t3, n4, e4, r4, i3) {
        let s2, h2;
        const u2 = 15 + (n4 + 65 >>> 9 << 4), w2 = n4 + e4;
        for (; t3.length <= u2; )
          t3.push(0);
        for (t3[n4 >>> 5] |= 128 << 24 - n4 % 32, t3[u2] = 4294967295 & w2, t3[u2 - 1] = w2 / o | 0, s2 = 0; s2 < t3.length; s2 += 16)
          r4 = M(t3.slice(s2, s2 + 16), r4);
        return h2 = "SHA-224" === i3 ? [r4[0], r4[1], r4[2], r4[3], r4[4], r4[5], r4[6]] : r4, h2;
      }(n3, e3, r3, i2, t2);
    }, this.U = B(t2), this.m = 512, this.R = "SHA-224" === t2 ? 224 : 256, this.K = false, r2.hmacKey && this.k(A("hmacKey", r2.hmacKey, this.T));
  }
};
class Y {
  constructor(t2, n2) {
    this.N = t2, this.I = n2;
  }
}
function N(t2, n2) {
  let e2;
  return n2 > 32 ? (e2 = 64 - n2, new Y(t2.I << n2 | t2.N >>> e2, t2.N << n2 | t2.I >>> e2)) : 0 !== n2 ? (e2 = 32 - n2, new Y(t2.N << n2 | t2.I >>> e2, t2.I << n2 | t2.N >>> e2)) : t2;
}
function I(t2, n2) {
  let e2;
  return n2 < 32 ? (e2 = 32 - n2, new Y(t2.N >>> n2 | t2.I << e2, t2.I >>> n2 | t2.N << e2)) : (e2 = 64 - n2, new Y(t2.I >>> n2 | t2.N << e2, t2.N >>> n2 | t2.I << e2));
}
function X(t2, n2) {
  return new Y(t2.N >>> n2, t2.I >>> n2 | t2.N << 32 - n2);
}
function z(t2, n2, e2) {
  return new Y(t2.N & n2.N ^ t2.N & e2.N ^ n2.N & e2.N, t2.I & n2.I ^ t2.I & e2.I ^ n2.I & e2.I);
}
function x(t2) {
  const n2 = I(t2, 28), e2 = I(t2, 34), r2 = I(t2, 39);
  return new Y(n2.N ^ e2.N ^ r2.N, n2.I ^ e2.I ^ r2.I);
}
function _(t2, n2) {
  let e2, r2;
  e2 = (65535 & t2.I) + (65535 & n2.I), r2 = (t2.I >>> 16) + (n2.I >>> 16) + (e2 >>> 16);
  const i2 = (65535 & r2) << 16 | 65535 & e2;
  e2 = (65535 & t2.N) + (65535 & n2.N) + (r2 >>> 16), r2 = (t2.N >>> 16) + (n2.N >>> 16) + (e2 >>> 16);
  return new Y((65535 & r2) << 16 | 65535 & e2, i2);
}
function O(t2, n2, e2, r2) {
  let i2, s2;
  i2 = (65535 & t2.I) + (65535 & n2.I) + (65535 & e2.I) + (65535 & r2.I), s2 = (t2.I >>> 16) + (n2.I >>> 16) + (e2.I >>> 16) + (r2.I >>> 16) + (i2 >>> 16);
  const o2 = (65535 & s2) << 16 | 65535 & i2;
  i2 = (65535 & t2.N) + (65535 & n2.N) + (65535 & e2.N) + (65535 & r2.N) + (s2 >>> 16), s2 = (t2.N >>> 16) + (n2.N >>> 16) + (e2.N >>> 16) + (r2.N >>> 16) + (i2 >>> 16);
  return new Y((65535 & s2) << 16 | 65535 & i2, o2);
}
function P(t2, n2, e2, r2, i2) {
  let s2, o2;
  s2 = (65535 & t2.I) + (65535 & n2.I) + (65535 & e2.I) + (65535 & r2.I) + (65535 & i2.I), o2 = (t2.I >>> 16) + (n2.I >>> 16) + (e2.I >>> 16) + (r2.I >>> 16) + (i2.I >>> 16) + (s2 >>> 16);
  const h2 = (65535 & o2) << 16 | 65535 & s2;
  s2 = (65535 & t2.N) + (65535 & n2.N) + (65535 & e2.N) + (65535 & r2.N) + (65535 & i2.N) + (o2 >>> 16), o2 = (t2.N >>> 16) + (n2.N >>> 16) + (e2.N >>> 16) + (r2.N >>> 16) + (i2.N >>> 16) + (s2 >>> 16);
  return new Y((65535 & o2) << 16 | 65535 & s2, h2);
}
function V(t2, n2) {
  return new Y(t2.N ^ n2.N, t2.I ^ n2.I);
}
function Z(t2) {
  const n2 = I(t2, 19), e2 = I(t2, 61), r2 = X(t2, 6);
  return new Y(n2.N ^ e2.N ^ r2.N, n2.I ^ e2.I ^ r2.I);
}
function j(t2) {
  const n2 = I(t2, 1), e2 = I(t2, 8), r2 = X(t2, 7);
  return new Y(n2.N ^ e2.N ^ r2.N, n2.I ^ e2.I ^ r2.I);
}
function q(t2) {
  const n2 = I(t2, 14), e2 = I(t2, 18), r2 = I(t2, 41);
  return new Y(n2.N ^ e2.N ^ r2.N, n2.I ^ e2.I ^ r2.I);
}
const D = [new Y(h[0], 3609767458), new Y(h[1], 602891725), new Y(h[2], 3964484399), new Y(h[3], 2173295548), new Y(h[4], 4081628472), new Y(h[5], 3053834265), new Y(h[6], 2937671579), new Y(h[7], 3664609560), new Y(h[8], 2734883394), new Y(h[9], 1164996542), new Y(h[10], 1323610764), new Y(h[11], 3590304994), new Y(h[12], 4068182383), new Y(h[13], 991336113), new Y(h[14], 633803317), new Y(h[15], 3479774868), new Y(h[16], 2666613458), new Y(h[17], 944711139), new Y(h[18], 2341262773), new Y(h[19], 2007800933), new Y(h[20], 1495990901), new Y(h[21], 1856431235), new Y(h[22], 3175218132), new Y(h[23], 2198950837), new Y(h[24], 3999719339), new Y(h[25], 766784016), new Y(h[26], 2566594879), new Y(h[27], 3203337956), new Y(h[28], 1034457026), new Y(h[29], 2466948901), new Y(h[30], 3758326383), new Y(h[31], 168717936), new Y(h[32], 1188179964), new Y(h[33], 1546045734), new Y(h[34], 1522805485), new Y(h[35], 2643833823), new Y(h[36], 2343527390), new Y(h[37], 1014477480), new Y(h[38], 1206759142), new Y(h[39], 344077627), new Y(h[40], 1290863460), new Y(h[41], 3158454273), new Y(h[42], 3505952657), new Y(h[43], 106217008), new Y(h[44], 3606008344), new Y(h[45], 1432725776), new Y(h[46], 1467031594), new Y(h[47], 851169720), new Y(h[48], 3100823752), new Y(h[49], 1363258195), new Y(h[50], 3750685593), new Y(h[51], 3785050280), new Y(h[52], 3318307427), new Y(h[53], 3812723403), new Y(h[54], 2003034995), new Y(h[55], 3602036899), new Y(h[56], 1575990012), new Y(h[57], 1125592928), new Y(h[58], 2716904306), new Y(h[59], 442776044), new Y(h[60], 593698344), new Y(h[61], 3733110249), new Y(h[62], 2999351573), new Y(h[63], 3815920427), new Y(3391569614, 3928383900), new Y(3515267271, 566280711), new Y(3940187606, 3454069534), new Y(4118630271, 4000239992), new Y(116418474, 1914138554), new Y(174292421, 2731055270), new Y(289380356, 3203993006), new Y(460393269, 320620315), new Y(685471733, 587496836), new Y(852142971, 1086792851), new Y(1017036298, 365543100), new Y(1126000580, 2618297676), new Y(1288033470, 3409855158), new Y(1501505948, 4234509866), new Y(1607167915, 987167468), new Y(1816402316, 1246189591)];
function G(t2) {
  return "SHA-384" === t2 ? [new Y(3418070365, u[0]), new Y(1654270250, u[1]), new Y(2438529370, u[2]), new Y(355462360, u[3]), new Y(1731405415, u[4]), new Y(41048885895, u[5]), new Y(3675008525, u[6]), new Y(1203062813, u[7])] : [new Y(w[0], 4089235720), new Y(w[1], 2227873595), new Y(w[2], 4271175723), new Y(w[3], 1595750129), new Y(w[4], 2917565137), new Y(w[5], 725511199), new Y(w[6], 4215389547), new Y(w[7], 327033209)];
}
function J(t2, n2) {
  let e2, r2, i2, s2, o2, h2, u2, w2, c2, f2, a2, l2;
  const A2 = [];
  for (e2 = n2[0], r2 = n2[1], i2 = n2[2], s2 = n2[3], o2 = n2[4], h2 = n2[5], u2 = n2[6], w2 = n2[7], a2 = 0; a2 < 80; a2 += 1)
    a2 < 16 ? (l2 = 2 * a2, A2[a2] = new Y(t2[l2], t2[l2 + 1])) : A2[a2] = O(Z(A2[a2 - 2]), A2[a2 - 7], j(A2[a2 - 15]), A2[a2 - 16]), c2 = P(w2, q(o2), (H2 = h2, S2 = u2, new Y((E2 = o2).N & H2.N ^ ~E2.N & S2.N, E2.I & H2.I ^ ~E2.I & S2.I)), D[a2], A2[a2]), f2 = _(x(e2), z(e2, r2, i2)), w2 = u2, u2 = h2, h2 = o2, o2 = _(s2, c2), s2 = i2, i2 = r2, r2 = e2, e2 = _(c2, f2);
  var E2, H2, S2;
  return n2[0] = _(e2, n2[0]), n2[1] = _(r2, n2[1]), n2[2] = _(i2, n2[2]), n2[3] = _(s2, n2[3]), n2[4] = _(o2, n2[4]), n2[5] = _(h2, n2[5]), n2[6] = _(u2, n2[6]), n2[7] = _(w2, n2[7]), n2;
}
let Q = class extends E {
  constructor(t2, n2, e2) {
    if ("SHA-384" !== t2 && "SHA-512" !== t2)
      throw new Error(c);
    super(t2, n2, e2);
    const r2 = e2 || {};
    this.g = this.Y, this.M = true, this.T = -1, this.C = i(this.t, this.i, this.T), this.v = J, this.L = function(t3) {
      return t3.slice();
    }, this.B = G, this.F = function(n3, e3, r3, i2) {
      return function(t3, n4, e4, r4, i3) {
        let s2, h2;
        const u2 = 31 + (n4 + 129 >>> 10 << 5), w2 = n4 + e4;
        for (; t3.length <= u2; )
          t3.push(0);
        for (t3[n4 >>> 5] |= 128 << 24 - n4 % 32, t3[u2] = 4294967295 & w2, t3[u2 - 1] = w2 / o | 0, s2 = 0; s2 < t3.length; s2 += 32)
          r4 = J(t3.slice(s2, s2 + 32), r4);
        return h2 = "SHA-384" === i3 ? [r4[0].N, r4[0].I, r4[1].N, r4[1].I, r4[2].N, r4[2].I, r4[3].N, r4[3].I, r4[4].N, r4[4].I, r4[5].N, r4[5].I] : [r4[0].N, r4[0].I, r4[1].N, r4[1].I, r4[2].N, r4[2].I, r4[3].N, r4[3].I, r4[4].N, r4[4].I, r4[5].N, r4[5].I, r4[6].N, r4[6].I, r4[7].N, r4[7].I], h2;
      }(n3, e3, r3, i2, t2);
    }, this.U = G(t2), this.m = 1024, this.R = "SHA-384" === t2 ? 384 : 512, this.K = false, r2.hmacKey && this.k(A("hmacKey", r2.hmacKey, this.T));
  }
};
const W = [new Y(0, 1), new Y(0, 32898), new Y(2147483648, 32906), new Y(2147483648, 2147516416), new Y(0, 32907), new Y(0, 2147483649), new Y(2147483648, 2147516545), new Y(2147483648, 32777), new Y(0, 138), new Y(0, 136), new Y(0, 2147516425), new Y(0, 2147483658), new Y(0, 2147516555), new Y(2147483648, 139), new Y(2147483648, 32905), new Y(2147483648, 32771), new Y(2147483648, 32770), new Y(2147483648, 128), new Y(0, 32778), new Y(2147483648, 2147483658), new Y(2147483648, 2147516545), new Y(2147483648, 32896), new Y(0, 2147483649), new Y(2147483648, 2147516424)], $ = [[0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61], [28, 55, 25, 21, 56], [27, 20, 39, 8, 14]];
function tt(t2) {
  let n2;
  const e2 = [];
  for (n2 = 0; n2 < 5; n2 += 1)
    e2[n2] = [new Y(0, 0), new Y(0, 0), new Y(0, 0), new Y(0, 0), new Y(0, 0)];
  return e2;
}
function nt(t2) {
  let n2;
  const e2 = [];
  for (n2 = 0; n2 < 5; n2 += 1)
    e2[n2] = t2[n2].slice();
  return e2;
}
function et(t2, n2) {
  let e2, r2, i2, s2;
  const o2 = [], h2 = [];
  if (null !== t2)
    for (r2 = 0; r2 < t2.length; r2 += 2)
      n2[(r2 >>> 1) % 5][(r2 >>> 1) / 5 | 0] = V(n2[(r2 >>> 1) % 5][(r2 >>> 1) / 5 | 0], new Y(t2[r2 + 1], t2[r2]));
  for (e2 = 0; e2 < 24; e2 += 1) {
    for (s2 = tt(), r2 = 0; r2 < 5; r2 += 1)
      o2[r2] = (u2 = n2[r2][0], w2 = n2[r2][1], c2 = n2[r2][2], f2 = n2[r2][3], a2 = n2[r2][4], new Y(u2.N ^ w2.N ^ c2.N ^ f2.N ^ a2.N, u2.I ^ w2.I ^ c2.I ^ f2.I ^ a2.I));
    for (r2 = 0; r2 < 5; r2 += 1)
      h2[r2] = V(o2[(r2 + 4) % 5], N(o2[(r2 + 1) % 5], 1));
    for (r2 = 0; r2 < 5; r2 += 1)
      for (i2 = 0; i2 < 5; i2 += 1)
        n2[r2][i2] = V(n2[r2][i2], h2[r2]);
    for (r2 = 0; r2 < 5; r2 += 1)
      for (i2 = 0; i2 < 5; i2 += 1)
        s2[i2][(2 * r2 + 3 * i2) % 5] = N(n2[r2][i2], $[r2][i2]);
    for (r2 = 0; r2 < 5; r2 += 1)
      for (i2 = 0; i2 < 5; i2 += 1)
        n2[r2][i2] = V(s2[r2][i2], new Y(~s2[(r2 + 1) % 5][i2].N & s2[(r2 + 2) % 5][i2].N, ~s2[(r2 + 1) % 5][i2].I & s2[(r2 + 2) % 5][i2].I));
    n2[0][0] = V(n2[0][0], W[e2]);
  }
  var u2, w2, c2, f2, a2;
  return n2;
}
function rt(t2) {
  let n2, e2, r2 = 0;
  const i2 = [0, 0], s2 = [4294967295 & t2, t2 / o & 2097151];
  for (n2 = 6; n2 >= 0; n2--)
    e2 = s2[n2 >> 2] >>> 8 * n2 & 255, 0 === e2 && 0 === r2 || (i2[r2 + 1 >> 2] |= e2 << 8 * (r2 + 1), r2 += 1);
  return r2 = 0 !== r2 ? r2 : 1, i2[0] |= r2, { value: r2 + 1 > 4 ? i2 : [i2[0]], binLen: 8 + 8 * r2 };
}
function it(t2) {
  return a(rt(t2.binLen), t2);
}
function st(t2, n2) {
  let e2, r2 = rt(n2);
  r2 = a(r2, t2);
  const i2 = n2 >>> 2, s2 = (i2 - r2.value.length % i2) % i2;
  for (e2 = 0; e2 < s2; e2++)
    r2.value.push(0);
  return r2.value;
}
let ot = class extends E {
  constructor(t2, n2, e2) {
    let r2 = 6, s2 = 0;
    super(t2, n2, e2);
    const o2 = e2 || {};
    if (1 !== this.numRounds) {
      if (o2.kmacKey || o2.hmacKey)
        throw new Error(f);
      if ("CSHAKE128" === this.o || "CSHAKE256" === this.o)
        throw new Error("Cannot set numRounds for CSHAKE variants");
    }
    switch (this.T = 1, this.C = i(this.t, this.i, this.T), this.v = et, this.L = nt, this.B = tt, this.U = tt(), this.K = false, t2) {
      case "SHA3-224":
        this.m = s2 = 1152, this.R = 224, this.M = true, this.g = this.Y;
        break;
      case "SHA3-256":
        this.m = s2 = 1088, this.R = 256, this.M = true, this.g = this.Y;
        break;
      case "SHA3-384":
        this.m = s2 = 832, this.R = 384, this.M = true, this.g = this.Y;
        break;
      case "SHA3-512":
        this.m = s2 = 576, this.R = 512, this.M = true, this.g = this.Y;
        break;
      case "SHAKE128":
        r2 = 31, this.m = s2 = 1344, this.R = -1, this.K = true, this.M = false, this.g = null;
        break;
      case "SHAKE256":
        r2 = 31, this.m = s2 = 1088, this.R = -1, this.K = true, this.M = false, this.g = null;
        break;
      case "KMAC128":
        r2 = 4, this.m = s2 = 1344, this.X(e2), this.R = -1, this.K = true, this.M = false, this.g = this._;
        break;
      case "KMAC256":
        r2 = 4, this.m = s2 = 1088, this.X(e2), this.R = -1, this.K = true, this.M = false, this.g = this._;
        break;
      case "CSHAKE128":
        this.m = s2 = 1344, r2 = this.O(e2), this.R = -1, this.K = true, this.M = false, this.g = null;
        break;
      case "CSHAKE256":
        this.m = s2 = 1088, r2 = this.O(e2), this.R = -1, this.K = true, this.M = false, this.g = null;
        break;
      default:
        throw new Error(c);
    }
    this.F = function(t3, n3, e3, i2, o3) {
      return function(t4, n4, e4, r3, i3, s3, o4) {
        let h2, u2, w2 = 0;
        const c2 = [], f2 = i3 >>> 5, a2 = n4 >>> 5;
        for (h2 = 0; h2 < a2 && n4 >= i3; h2 += f2)
          r3 = et(t4.slice(h2, h2 + f2), r3), n4 -= i3;
        for (t4 = t4.slice(h2), n4 %= i3; t4.length < f2; )
          t4.push(0);
        for (h2 = n4 >>> 3, t4[h2 >> 2] ^= s3 << h2 % 4 * 8, t4[f2 - 1] ^= 2147483648, r3 = et(t4, r3); 32 * c2.length < o4 && (u2 = r3[w2 % 5][w2 / 5 | 0], c2.push(u2.I), !(32 * c2.length >= o4)); )
          c2.push(u2.N), w2 += 1, 0 == 64 * w2 % i3 && (et(null, r3), w2 = 0);
        return c2;
      }(t3, n3, 0, i2, s2, r2, o3);
    }, o2.hmacKey && this.k(A("hmacKey", o2.hmacKey, this.T));
  }
  O(t2, n2) {
    const e2 = function(t3) {
      const n3 = t3 || {};
      return { funcName: A("funcName", n3.funcName, 1, { value: [], binLen: 0 }), customization: A("Customization", n3.customization, 1, { value: [], binLen: 0 }) };
    }(t2 || {});
    n2 && (e2.funcName = n2);
    const r2 = a(it(e2.funcName), it(e2.customization));
    if (0 !== e2.customization.binLen || 0 !== e2.funcName.binLen) {
      const t3 = st(r2, this.m >>> 3);
      for (let n3 = 0; n3 < t3.length; n3 += this.m >>> 5)
        this.U = this.v(t3.slice(n3, n3 + (this.m >>> 5)), this.U), this.A += this.m;
      return 4;
    }
    return 31;
  }
  X(t2) {
    const n2 = function(t3) {
      const n3 = t3 || {};
      return { kmacKey: A("kmacKey", n3.kmacKey, 1), funcName: { value: [1128353099], binLen: 32 }, customization: A("Customization", n3.customization, 1, { value: [], binLen: 0 }) };
    }(t2 || {});
    this.O(t2, n2.funcName);
    const e2 = st(it(n2.kmacKey), this.m >>> 3);
    for (let t3 = 0; t3 < e2.length; t3 += this.m >>> 5)
      this.U = this.v(e2.slice(t3, t3 + (this.m >>> 5)), this.U), this.A += this.m;
    this.H = true;
  }
  _(t2) {
    const n2 = a({ value: this.h.slice(), binLen: this.u }, function(t3) {
      let n3, e2, r2 = 0;
      const i2 = [0, 0], s2 = [4294967295 & t3, t3 / o & 2097151];
      for (n3 = 6; n3 >= 0; n3--)
        e2 = s2[n3 >> 2] >>> 8 * n3 & 255, 0 === e2 && 0 === r2 || (i2[r2 >> 2] |= e2 << 8 * r2, r2 += 1);
      return r2 = 0 !== r2 ? r2 : 1, i2[r2 >> 2] |= r2 << 8 * r2, { value: r2 + 1 > 4 ? i2 : [i2[0]], binLen: 8 + 8 * r2 };
    }(t2.outputLen));
    return this.F(n2.value, n2.binLen, this.A, this.L(this.U), t2.outputLen);
  }
};
class ht {
  constructor(t2, n2, e2) {
    if ("SHA-1" == t2)
      this.P = new L(t2, n2, e2);
    else if ("SHA-224" == t2 || "SHA-256" == t2)
      this.P = new k(t2, n2, e2);
    else if ("SHA-384" == t2 || "SHA-512" == t2)
      this.P = new Q(t2, n2, e2);
    else {
      if ("SHA3-224" != t2 && "SHA3-256" != t2 && "SHA3-384" != t2 && "SHA3-512" != t2 && "SHAKE128" != t2 && "SHAKE256" != t2 && "CSHAKE128" != t2 && "CSHAKE256" != t2 && "KMAC128" != t2 && "KMAC256" != t2)
        throw new Error(c);
      this.P = new ot(t2, n2, e2);
    }
  }
  update(t2) {
    return this.P.update(t2), this;
  }
  getHash(t2, n2) {
    return this.P.getHash(t2, n2);
  }
  setHMACKey(t2, n2, e2) {
    this.P.setHMACKey(t2, n2, e2);
  }
  getHMAC(t2, n2) {
    return this.P.getHMAC(t2, n2);
  }
}
const LEGACY_ACCOUNT_STORAGE_KEY = "buckyos.account_info";
const BROWSER_USER_INFO_STORAGE_KEY = "user_info";
function getAccountStorageKey(appId) {
  return `buckyos.account_info.${appId}`;
}
function parseAccountInfo(raw) {
  if (raw == null) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function parseBrowserUserInfo(raw) {
  if (raw == null) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    const userId = typeof parsed.user_id === "string" ? parsed.user_id.trim() : "";
    const userType = typeof parsed.user_type === "string" ? parsed.user_type.trim() : "";
    const userNameCandidate = typeof parsed.user_name === "string" ? parsed.user_name.trim() : typeof parsed.show_name === "string" ? parsed.show_name.trim() : "";
    if (!userId || !userType) {
      return null;
    }
    return {
      user_name: userNameCandidate || userId,
      user_id: userId,
      user_type: userType
    };
  } catch {
    return null;
  }
}
function parseTokenAppId(sessionToken) {
  const parts = sessionToken.split(".");
  if (parts.length < 2) {
    return null;
  }
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
    const payload = JSON.parse(atob(padded));
    if (typeof payload.appid === "string" && payload.appid.trim().length > 0) {
      return payload.appid;
    }
  } catch {
    return null;
  }
  return null;
}
function hashPassword(username, password, nonce = null) {
  const shaObj = new ht("SHA-256", "TEXT", { encoding: "UTF8" });
  shaObj.update(password + username + ".buckyos");
  let org_password_hash_str = shaObj.getHash("B64");
  if (nonce == null) {
    return org_password_hash_str;
  }
  const shaObj2 = new ht("SHA-256", "TEXT", { encoding: "UTF8" });
  let salt = org_password_hash_str + nonce.toString();
  shaObj2.update(salt);
  let result = shaObj2.getHash("B64");
  return result;
}
function cleanLocalAccountInfo(appId) {
  localStorage.removeItem(getAccountStorageKey(appId));
  localStorage.removeItem(BROWSER_USER_INFO_STORAGE_KEY);
  const legacy = parseAccountInfo(localStorage.getItem(LEGACY_ACCOUNT_STORAGE_KEY));
  if ((legacy == null ? void 0 : legacy.session_token) && parseTokenAppId(legacy.session_token) === appId) {
    localStorage.removeItem(LEGACY_ACCOUNT_STORAGE_KEY);
  }
  let cookie_options = {
    path: "/",
    expires: /* @__PURE__ */ new Date(0),
    secure: true,
    sameSite: "Lax"
  };
  document.cookie = `${appId}_token=; ${Object.entries(cookie_options).map(([key, value]) => `${key}=${value}`).join("; ")}`;
}
function saveLocalAccountInfo(appId, account_info) {
  if (account_info.session_token == null) {
    console.error("session_token is null,can't save account info");
    return;
  }
  localStorage.setItem(getAccountStorageKey(appId), JSON.stringify(account_info));
  let cookie_options = {
    path: "/",
    expires: new Date(Date.now() + 1e3 * 60 * 60 * 24 * 30),
    // 30天
    secure: true,
    sameSite: "Lax"
  };
  document.cookie = `${appId}_token=${account_info.session_token}; ${Object.entries(cookie_options).map(([key, value]) => `${key}=${value}`).join("; ")}`;
}
function saveBrowserUserInfo(userInfo) {
  localStorage.setItem(BROWSER_USER_INFO_STORAGE_KEY, JSON.stringify(userInfo));
}
function getBrowserUserInfo() {
  return parseBrowserUserInfo(localStorage.getItem(BROWSER_USER_INFO_STORAGE_KEY));
}
class VerifyHubClient {
  constructor(rpcClient) {
    this.rpcClient = rpcClient;
  }
  setSeq(seq) {
    this.rpcClient.setSeq(seq);
  }
  async loginByJwt(params) {
    this.rpcClient.resetSessionToken();
    const payload = {
      type: "jwt",
      jwt: params.jwt
    };
    if (params.login_params) {
      Object.assign(payload, params.login_params);
    }
    return this.rpcClient.call("login_by_jwt", payload);
  }
  async loginByPassword(params) {
    this.rpcClient.resetSessionToken();
    const payload = {
      type: "password",
      username: params.username,
      password: params.password,
      appid: params.appid
    };
    if (params.source_url) {
      payload.source_url = params.source_url;
    }
    return this.rpcClient.call("login_by_password", payload);
  }
  async refreshToken(params) {
    return this.rpcClient.call("refresh_token", params);
  }
  async verifyToken(params) {
    return this.rpcClient.call("verify_token", params);
  }
  static normalizeLoginResponse(response) {
    if ("user_info" in response) {
      return {
        user_name: response.user_info.show_name,
        user_id: response.user_info.user_id,
        user_type: response.user_info.user_type,
        session_token: response.session_token,
        refresh_token: response.refresh_token
      };
    }
    if (!response.session_token) {
      throw new RPCError("login_by_password response missing session_token");
    }
    return response;
  }
}
function parseTaskStatus(status) {
  switch (status) {
    case "Pending":
      return "Pending";
    case "Running":
      return "Running";
    case "Paused":
      return "Paused";
    case "Completed":
      return "Completed";
    case "Failed":
      return "Failed";
    case "Canceled":
      return "Canceled";
    case "WaitingForApproval":
      return "WaitingForApproval";
    default:
      throw new RPCError(`Invalid task status: ${status}`);
  }
}
function isTerminalTaskStatus(status) {
  return status === "Completed" || status === "Failed" || status === "Canceled";
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function asRecord$3(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RPCError("Invalid RPC response format");
  }
  return value;
}
function parseTask(value) {
  const record = asRecord$3(value);
  const id = record.id;
  const status = record.status;
  if (typeof id !== "number") {
    throw new RPCError("Invalid task payload: missing id");
  }
  if (typeof status !== "string") {
    throw new RPCError("Invalid task payload: missing status");
  }
  return {
    ...record,
    status: parseTaskStatus(status)
  };
}
function parseTasks(value) {
  if (!Array.isArray(value)) {
    throw new RPCError("Invalid tasks payload: expected array");
  }
  return value.map((task) => parseTask(task));
}
function parseTaskListResult(value) {
  if (Array.isArray(value)) {
    return parseTasks(value);
  }
  const parsed = asRecord$3(value);
  if ("tasks" in parsed) {
    return parseTasks(parsed.tasks);
  }
  throw new RPCError("Expected tasks in response");
}
class TaskManagerClient {
  constructor(rpcClient) {
    this.rpcClient = rpcClient;
  }
  setSeq(seq) {
    this.rpcClient.setSeq(seq);
  }
  async createTask(params) {
    const options = params.options ?? {};
    const req = {
      name: params.name,
      task_type: params.taskType,
      data: params.data,
      permissions: options.permissions,
      parent_id: options.parent_id,
      root_id: options.root_id,
      priority: options.priority,
      user_id: params.userId,
      app_id: params.appId,
      app_name: params.appId || void 0
    };
    const result = await this.rpcClient.call("create_task", req);
    const parsed = asRecord$3(result);
    if ("task" in parsed) {
      return parseTask(parsed.task);
    }
    const taskId = parsed.task_id;
    if (typeof taskId === "number") {
      return this.getTask(taskId);
    }
    throw new RPCError("Expected CreateTaskResult response");
  }
  async getTask(id) {
    const req = { id };
    const result = await this.rpcClient.call("get_task", req);
    const parsed = asRecord$3(result);
    if ("task" in parsed) {
      return parseTask(parsed.task);
    }
    return parseTask(result);
  }
  async waitForTaskEnd(id) {
    return this.waitForTaskEndWithInterval(id, 500);
  }
  async waitForTaskEndWithInterval(id, pollIntervalMs) {
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
      throw new RPCError("pollIntervalMs must be greater than 0");
    }
    while (true) {
      const task = await this.getTask(id);
      if (isTerminalTaskStatus(task.status)) {
        return task.status;
      }
      await sleep(pollIntervalMs);
    }
  }
  async listTasks(params = {}) {
    const filter = params.filter ?? {};
    const req = {
      app_id: filter.app_id,
      task_type: filter.task_type,
      status: filter.status,
      parent_id: filter.parent_id,
      root_id: filter.root_id,
      source_user_id: params.sourceUserId,
      source_app_id: params.sourceAppId
    };
    const result = await this.rpcClient.call("list_tasks", req);
    return parseTaskListResult(result);
  }
  async listTasksByTimeRange(params) {
    const req = {
      app_id: params.appId,
      task_type: params.taskType,
      source_user_id: params.sourceUserId,
      source_app_id: params.sourceAppId,
      start_time: params.startTime,
      end_time: params.endTime
    };
    const result = await this.rpcClient.call("list_tasks_by_time_range", req);
    return parseTaskListResult(result);
  }
  async updateTask(payload) {
    const req = {
      id: payload.id,
      status: payload.status,
      progress: payload.progress,
      message: payload.message,
      data: payload.data
    };
    await this.rpcClient.call("update_task", req);
  }
  async cancelTask(id, recursive = false) {
    const req = { id, recursive };
    await this.rpcClient.call("cancel_task", req);
  }
  async getSubtasks(parentId) {
    const req = { parent_id: parentId };
    const result = await this.rpcClient.call("get_subtasks", req);
    return parseTaskListResult(result);
  }
  async updateTaskStatus(id, status) {
    const req = { id, status };
    await this.rpcClient.call("update_task_status", req);
  }
  async updateTaskProgress(id, completedItems, totalItems) {
    const req = {
      id,
      completed_items: completedItems,
      total_items: totalItems
    };
    await this.rpcClient.call("update_task_progress", req);
  }
  async updateTaskError(id, errorMessage) {
    const req = { id, error_message: errorMessage };
    await this.rpcClient.call("update_task_error", req);
  }
  async updateTaskData(id, data) {
    const req = { id, data };
    await this.rpcClient.call("update_task_data", req);
  }
  async deleteTask(id) {
    const req = { id };
    await this.rpcClient.call("delete_task", req);
  }
  async createDownloadTask(downloadUrl, userId, appId, options = {}, objid, downloadOptions) {
    const req = {
      download_url: downloadUrl,
      objid,
      download_options: downloadOptions,
      parent_id: options.parent_id,
      permissions: options.permissions,
      root_id: options.root_id,
      priority: options.priority,
      user_id: userId,
      app_id: appId,
      app_name: appId || void 0
    };
    const result = await this.rpcClient.call("create_download_task", req);
    const parsed = asRecord$3(result);
    const taskId = parsed.task_id;
    if (typeof taskId !== "number") {
      throw new RPCError("Expected CreateDownloadTaskResult response");
    }
    return taskId;
  }
  async pauseTask(id) {
    await this.updateTaskStatus(
      id,
      "Paused"
      /* Paused */
    );
  }
  async resumeTask(id) {
    await this.updateTaskStatus(
      id,
      "Running"
      /* Running */
    );
  }
  async completeTask(id) {
    await this.updateTaskStatus(
      id,
      "Completed"
      /* Completed */
    );
  }
  async markTaskAsWaitingForApproval(id) {
    await this.updateTaskStatus(
      id,
      "WaitingForApproval"
      /* WaitingForApproval */
    );
  }
  async markTaskAsFailed(id, errorMessage) {
    await this.updateTaskError(id, errorMessage);
    await this.updateTaskStatus(
      id,
      "Failed"
      /* Failed */
    );
  }
  async pauseAllRunningTasks(options = {}) {
    const runningTasks = await this.listTasks({
      filter: {
        status: "Running"
        /* Running */
      },
      sourceUserId: options.sourceUserId,
      sourceAppId: options.sourceAppId
    });
    for (const task of runningTasks) {
      await this.pauseTask(task.id);
    }
  }
  async resumeLastPausedTask(options = {}) {
    const pausedTasks = await this.listTasks({
      filter: {
        status: "Paused"
        /* Paused */
      },
      sourceUserId: options.sourceUserId,
      sourceAppId: options.sourceAppId
    });
    const lastPausedTask = pausedTasks[pausedTasks.length - 1];
    if (!lastPausedTask) {
      throw new RPCError("No paused tasks found");
    }
    await this.resumeTask(lastPausedTask.id);
  }
}
const CONFIG_CACHE_TIME_SECONDS = 10;
const CACHE_KEY_PREFIXES = ["services/", "system/rbac/"];
class SystemConfigClient {
  constructor(serviceUrl, sessionToken = null, options = {}) {
    this.configCache = /* @__PURE__ */ new Map();
    this.rpcClient = new kRPCClient(serviceUrl, sessionToken, null, options);
  }
  setSeq(seq) {
    this.rpcClient.setSeq(seq);
  }
  async syncSessionToken(token) {
    this.rpcClient.setSessionToken(token);
  }
  getSessionToken() {
    return this.rpcClient.getSessionToken();
  }
  needCache(key) {
    return CACHE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
  }
  getUnixTimestamp() {
    return Math.floor(Date.now() / 1e3);
  }
  getConfigCache(key) {
    const cached = this.configCache.get(key);
    if (!cached) {
      return null;
    }
    if (cached.cachedAt + CONFIG_CACHE_TIME_SECONDS < this.getUnixTimestamp()) {
      this.configCache.delete(key);
      return null;
    }
    return cached;
  }
  setConfigCache(key, value, version) {
    if (!this.needCache(key)) {
      return true;
    }
    const previous = this.configCache.get(key);
    this.configCache.set(key, {
      value,
      version,
      cachedAt: this.getUnixTimestamp()
    });
    if (!previous) {
      return true;
    }
    return previous.value !== value || previous.version !== version;
  }
  removeConfigCache(key) {
    this.configCache.delete(key);
  }
  async get(key) {
    const cachedValue = this.getConfigCache(key);
    if (cachedValue != null) {
      return {
        value: cachedValue.value,
        version: cachedValue.version,
        is_changed: false
      };
    }
    const result = await this.rpcClient.call("sys_config_get", { key });
    if (result == null) {
      throw new Error(`system_config key not found: ${key}`);
    }
    if (typeof result.value !== "string" || typeof result.version !== "number") {
      throw new Error(`invalid sys_config_get response for key: ${key}`);
    }
    const isChanged = this.setConfigCache(key, result.value, result.version);
    return {
      value: result.value,
      version: result.version,
      is_changed: isChanged
    };
  }
  async set(key, value) {
    if (!key || !value) {
      throw new Error("key or value is empty");
    }
    if (key.includes(":")) {
      throw new Error("key can not contain ':'");
    }
    await this.rpcClient.call("sys_config_set", { key, value });
    this.removeConfigCache(key);
    return 0;
  }
  async setByJsonPath(key, jsonPath, value) {
    await this.rpcClient.call(
      "sys_config_set_by_json_path",
      { key, json_path: jsonPath, value }
    );
    this.removeConfigCache(key);
    return 0;
  }
  async create(key, value) {
    await this.rpcClient.call("sys_config_create", { key, value });
    this.removeConfigCache(key);
    return 0;
  }
  async delete(key) {
    await this.rpcClient.call("sys_config_delete", { key });
    this.removeConfigCache(key);
    return 0;
  }
  async append(key, value) {
    await this.rpcClient.call("sys_config_append", {
      key,
      append_value: value
    });
    this.removeConfigCache(key);
    return 0;
  }
  async list(key) {
    return this.rpcClient.call("sys_config_list", { key });
  }
  async execTx(actions, mainKey) {
    const params = { actions };
    if (mainKey) {
      params.main_key = `${mainKey[0]}:${mainKey[1]}`;
    }
    await this.rpcClient.call("sys_config_exec_tx", params);
    for (const key of Object.keys(actions)) {
      this.removeConfigCache(key);
    }
    return 0;
  }
  async dumpConfigsForScheduler() {
    return this.rpcClient.call("dump_configs_for_scheduler", {});
  }
  async refreshTrustKeys() {
    await this.rpcClient.call("sys_refresh_trust_keys", {});
  }
}
function asRecord$2(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RPCError("Invalid RPC response format");
  }
  return value;
}
class AiccClient {
  constructor(rpcClient) {
    this.rpcClient = rpcClient;
  }
  setSeq(seq) {
    this.rpcClient.setSeq(seq);
  }
  async complete(request) {
    if (!request.capability) {
      throw new RPCError("AiccCompleteRequest.capability is required");
    }
    if (!request.model || !request.model.alias) {
      throw new RPCError("AiccCompleteRequest.model.alias is required");
    }
    const result = await this.rpcClient.call("complete", request);
    const record = asRecord$2(result);
    if (typeof record.task_id !== "string") {
      throw new RPCError("AiccCompleteResponse missing task_id");
    }
    if (typeof record.status !== "string") {
      throw new RPCError("AiccCompleteResponse missing status");
    }
    return record;
  }
  async cancel(taskId) {
    if (!taskId) {
      throw new RPCError("AiccClient.cancel requires a non-empty task_id");
    }
    const result = await this.rpcClient.call("cancel", { task_id: taskId });
    const record = asRecord$2(result);
    if (typeof record.task_id !== "string" || typeof record.accepted !== "boolean") {
      throw new RPCError("Invalid cancel response");
    }
    return { task_id: record.task_id, accepted: record.accepted };
  }
}
const DEFAULT_QUEUE_CONFIG = {
  max_messages: null,
  retention_seconds: null,
  sync_write: false,
  other_app_can_read: true,
  other_app_can_write: false,
  other_user_can_read: false,
  other_user_can_write: false
};
function asNumber$1(value, what) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RPCError(`expected ${what} to be a number`);
  }
  return value;
}
function asString$1(value, what) {
  if (typeof value !== "string") {
    throw new RPCError(`expected ${what} to be a string`);
  }
  return value;
}
function asMessageList(value) {
  if (!Array.isArray(value)) {
    throw new RPCError("expected message list to be an array");
  }
  return value.map((entry, idx) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new RPCError(`message[${idx}] is not an object`);
    }
    const record = entry;
    return {
      index: asNumber$1(record.index, `message[${idx}].index`),
      created_at: asNumber$1(record.created_at, `message[${idx}].created_at`),
      payload: Array.isArray(record.payload) ? record.payload : [],
      headers: record.headers && typeof record.headers === "object" && !Array.isArray(record.headers) ? record.headers : {}
    };
  });
}
class MsgQueueClient {
  constructor(rpcClient) {
    this.rpcClient = rpcClient;
  }
  setSeq(seq) {
    this.rpcClient.setSeq(seq);
  }
  async createQueue(name, appid, appOwner, config = { ...DEFAULT_QUEUE_CONFIG }) {
    const result = await this.rpcClient.call("create_queue", {
      name,
      appid,
      app_owner: appOwner,
      config
    });
    return asString$1(result, "queue_urn");
  }
  async deleteQueue(queueUrn) {
    await this.rpcClient.call("delete_queue", {
      queue_urn: queueUrn
    });
  }
  async getQueueStats(queueUrn) {
    const result = await this.rpcClient.call("get_queue_stats", {
      queue_urn: queueUrn
    });
    if (!result || typeof result !== "object") {
      throw new RPCError("invalid get_queue_stats response");
    }
    const record = result;
    return {
      message_count: asNumber$1(record.message_count, "message_count"),
      first_index: asNumber$1(record.first_index, "first_index"),
      last_index: asNumber$1(record.last_index, "last_index"),
      size_bytes: asNumber$1(record.size_bytes, "size_bytes")
    };
  }
  async updateQueueConfig(queueUrn, config) {
    await this.rpcClient.call(
      "update_queue_config",
      { queue_urn: queueUrn, config }
    );
  }
  async postMessage(queueUrn, message) {
    const result = await this.rpcClient.call(
      "post_message",
      { queue_urn: queueUrn, message }
    );
    return asNumber$1(result, "msg_index");
  }
  async subscribe(params) {
    const result = await this.rpcClient.call("subscribe", {
      queue_urn: params.queueUrn,
      // Wire fields are `userid` / `appid` to match Rust serde rename rules
      // (#[serde(rename = "userid", alias = "user_id")]).
      userid: params.userId,
      appid: params.appId,
      sub_id: params.subId ?? null,
      position: params.position
    });
    return asString$1(result, "subscription_id");
  }
  async unsubscribe(subId) {
    await this.rpcClient.call("unsubscribe", { sub_id: subId });
  }
  async fetchMessages(subId, length, autoCommit) {
    const result = await this.rpcClient.call("fetch_messages", { sub_id: subId, length, auto_commit: autoCommit });
    return asMessageList(result);
  }
  async readMessage(queueUrn, cursor, length) {
    const result = await this.rpcClient.call("read_message", { queue_urn: queueUrn, cursor, length });
    return asMessageList(result);
  }
  async commitAck(subId, index) {
    await this.rpcClient.call(
      "commit_ack",
      { sub_id: subId, index }
    );
  }
  async seek(subId, index) {
    await this.rpcClient.call(
      "seek",
      { sub_id: subId, index }
    );
  }
  async deleteMessageBefore(queueUrn, index) {
    const result = await this.rpcClient.call(
      "delete_message_before",
      { queue_urn: queueUrn, index }
    );
    return asNumber$1(result, "deleted_count");
  }
}
function compact$1(input) {
  const out = {};
  for (const [k2, v2] of Object.entries(input)) {
    if (v2 !== void 0) {
      out[k2] = v2;
    }
  }
  return out;
}
function asRecord$1(value, what) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RPCError(`expected ${what} to be an object`);
  }
  return value;
}
function asArrayOf(value, what) {
  if (!Array.isArray(value)) {
    throw new RPCError(`expected ${what} to be an array`);
  }
  return value;
}
class MsgCenterClient {
  constructor(rpcClient) {
    this.rpcClient = rpcClient;
  }
  setSeq(seq) {
    this.rpcClient.setSeq(seq);
  }
  // ---- msg.* ---------------------------------------------------------------
  async dispatch(msg, ingressCtx, idempotencyKey) {
    const params = compact$1({
      msg,
      ingress_ctx: ingressCtx,
      idempotency_key: idempotencyKey
    });
    const result = await this.rpcClient.call("msg.dispatch", params);
    return asRecord$1(result, "DispatchResult");
  }
  async postSend(msg, sendCtx, idempotencyKey) {
    const params = compact$1({
      msg,
      send_ctx: sendCtx,
      idempotency_key: idempotencyKey
    });
    const result = await this.rpcClient.call("msg.post_send", params);
    return asRecord$1(result, "PostSendResult");
  }
  async getNext(req) {
    const result = await this.rpcClient.call(
      "msg.get_next",
      compact$1({ ...req })
    );
    if (result == null) {
      return null;
    }
    return asRecord$1(result, "MsgRecordWithObject");
  }
  async peekBox(req) {
    const result = await this.rpcClient.call(
      "msg.peek_box",
      compact$1({ ...req })
    );
    return asArrayOf(result, "Vec<MsgRecordWithObject>");
  }
  async listBoxByTime(req) {
    const result = await this.rpcClient.call(
      "msg.list_box_by_time",
      compact$1({ ...req })
    );
    const record = asRecord$1(result, "MsgRecordPage");
    return {
      items: Array.isArray(record.items) ? record.items : [],
      next_cursor_sort_key: typeof record.next_cursor_sort_key === "number" ? record.next_cursor_sort_key : void 0,
      next_cursor_record_id: typeof record.next_cursor_record_id === "string" ? record.next_cursor_record_id : void 0
    };
  }
  async updateRecordState(recordId, newState, reason) {
    const result = await this.rpcClient.call(
      "msg.update_record_state",
      compact$1({ record_id: recordId, new_state: newState, reason })
    );
    return asRecord$1(result, "MsgRecord");
  }
  async updateRecordSession(recordId, sessionId) {
    const result = await this.rpcClient.call(
      "msg.update_record_session",
      { record_id: recordId, session_id: sessionId }
    );
    return asRecord$1(result, "MsgRecord");
  }
  async reportDelivery(recordId, result) {
    const response = await this.rpcClient.call(
      "msg.report_delivery",
      { record_id: recordId, result }
    );
    return asRecord$1(response, "MsgRecord");
  }
  async setReadState(req) {
    const result = await this.rpcClient.call(
      "msg.set_read_state",
      compact$1({ ...req })
    );
    return asRecord$1(result, "MsgReceiptObj");
  }
  async listReadReceipts(req) {
    const result = await this.rpcClient.call(
      "msg.list_read_receipts",
      compact$1({ ...req })
    );
    return asArrayOf(result, "Vec<MsgReceiptObj>");
  }
  async getRecord(recordId, withObject) {
    const result = await this.rpcClient.call(
      "msg.get_record",
      compact$1({ record_id: recordId, with_object: withObject })
    );
    if (result == null) {
      return null;
    }
    return asRecord$1(result, "MsgRecordWithObject");
  }
  async getMessage(msgId) {
    const result = await this.rpcClient.call(
      "msg.get_message",
      { msg_id: msgId }
    );
    if (result == null) {
      return null;
    }
    return asRecord$1(result, "MsgObject");
  }
  // ---- contact.* -----------------------------------------------------------
  async resolveDid(platform, accountId, profileHint, contactMgrOwner) {
    const result = await this.rpcClient.call(
      "contact.resolve_did",
      compact$1({
        platform,
        account_id: accountId,
        profile_hint: profileHint,
        contact_mgr_owner: contactMgrOwner
      })
    );
    if (typeof result !== "string") {
      throw new RPCError("contact.resolve_did expected to return a DID string");
    }
    return result;
  }
  async getPreferredBinding(did, contactMgrOwner) {
    const result = await this.rpcClient.call(
      "contact.get_preferred_binding",
      compact$1({ did, contact_mgr_owner: contactMgrOwner })
    );
    return asRecord$1(result, "AccountBinding");
  }
  async checkAccessPermission(did, contextId, contactMgrOwner) {
    const result = await this.rpcClient.call(
      "contact.check_access_permission",
      compact$1({ did, context_id: contextId, contact_mgr_owner: contactMgrOwner })
    );
    return asRecord$1(result, "AccessDecision");
  }
  async grantTemporaryAccess(dids, contextId, durationSecs, contactMgrOwner) {
    const result = await this.rpcClient.call(
      "contact.grant_temporary_access",
      compact$1({
        dids,
        context_id: contextId,
        duration_secs: durationSecs,
        contact_mgr_owner: contactMgrOwner
      })
    );
    const record = asRecord$1(result, "GrantTemporaryAccessResult");
    return {
      updated: Array.isArray(record.updated) ? record.updated : []
    };
  }
  async blockContact(did, reason, contactMgrOwner) {
    await this.rpcClient.call(
      "contact.block_contact",
      compact$1({ did, reason, contact_mgr_owner: contactMgrOwner })
    );
  }
  async importContacts(contacts, upgradeToFriend, contactMgrOwner) {
    const result = await this.rpcClient.call(
      "contact.import_contacts",
      compact$1({
        contacts,
        upgrade_to_friend: upgradeToFriend,
        contact_mgr_owner: contactMgrOwner
      })
    );
    return asRecord$1(result, "ImportReport");
  }
  async mergeContacts(targetDid, sourceDid, contactMgrOwner) {
    const result = await this.rpcClient.call(
      "contact.merge_contacts",
      compact$1({ target_did: targetDid, source_did: sourceDid, contact_mgr_owner: contactMgrOwner })
    );
    return asRecord$1(result, "Contact");
  }
  async updateContact(did, patch, contactMgrOwner) {
    const result = await this.rpcClient.call(
      "contact.update_contact",
      compact$1({ did, patch, contact_mgr_owner: contactMgrOwner })
    );
    return asRecord$1(result, "Contact");
  }
  async getContact(did, contactMgrOwner) {
    const result = await this.rpcClient.call(
      "contact.get_contact",
      compact$1({ did, contact_mgr_owner: contactMgrOwner })
    );
    if (result == null) {
      return null;
    }
    return asRecord$1(result, "Contact");
  }
  async listContacts(query, contactMgrOwner) {
    const result = await this.rpcClient.call(
      "contact.list_contacts",
      compact$1({ query, contact_mgr_owner: contactMgrOwner })
    );
    return asArrayOf(result, "Vec<Contact>");
  }
  async getGroupSubscribers(groupId, limit, offset, contactMgrOwner) {
    const result = await this.rpcClient.call(
      "contact.get_group_subscribers",
      compact$1({ group_id: groupId, limit, offset, contact_mgr_owner: contactMgrOwner })
    );
    if (!Array.isArray(result)) {
      throw new RPCError("expected Vec<DID> response");
    }
    return result;
  }
  async setGroupSubscribers(groupId, subscribers, contactMgrOwner) {
    const result = await this.rpcClient.call(
      "contact.set_group_subscribers",
      compact$1({ group_id: groupId, subscribers, contact_mgr_owner: contactMgrOwner })
    );
    const record = asRecord$1(result, "SetGroupSubscribersResult");
    if (typeof record.group_id !== "string" || typeof record.subscriber_count !== "number") {
      throw new RPCError("Invalid SetGroupSubscribersResult");
    }
    return {
      group_id: record.group_id,
      subscriber_count: record.subscriber_count
    };
  }
}
function compact(input) {
  const out = {};
  for (const [k2, v2] of Object.entries(input)) {
    if (v2 !== void 0) {
      out[k2] = v2;
    }
  }
  return out;
}
function asString(value, what) {
  if (typeof value !== "string") {
    throw new RPCError(`expected ${what} to be a string`);
  }
  return value;
}
function asBoolean(value, what) {
  if (typeof value !== "boolean") {
    throw new RPCError(`expected ${what} to be a boolean`);
  }
  return value;
}
function asNumber(value, what) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RPCError(`expected ${what} to be a number`);
  }
  return value;
}
function asArray(value, what) {
  if (!Array.isArray(value)) {
    throw new RPCError(`expected ${what} to be an array`);
  }
  return value;
}
function asRecord(value, what) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RPCError(`expected ${what} to be an object`);
  }
  return value;
}
class RepoClient {
  constructor(rpcClient) {
    this.rpcClient = rpcClient;
  }
  setSeq(seq) {
    this.rpcClient.setSeq(seq);
  }
  async store(contentId) {
    const result = await this.rpcClient.call("store", {
      content_id: contentId
    });
    return asString(result, "ObjId");
  }
  async collect(contentMeta, referralProof) {
    const result = await this.rpcClient.call(
      "collect",
      compact({ content_meta: contentMeta, referral_proof: referralProof })
    );
    return asString(result, "content_id");
  }
  async pin(contentId, downloadProof) {
    const result = await this.rpcClient.call("pin", { content_id: contentId, download_proof: downloadProof });
    return asBoolean(result, "pin response");
  }
  async unpin(contentId, force = false) {
    const result = await this.rpcClient.call(
      "unpin",
      { content_id: contentId, force }
    );
    return asBoolean(result, "unpin response");
  }
  async uncollect(contentId, force = false) {
    const result = await this.rpcClient.call(
      "uncollect",
      { content_id: contentId, force }
    );
    return asBoolean(result, "uncollect response");
  }
  async addProof(proof) {
    const result = await this.rpcClient.call("add_proof", { proof });
    return asString(result, "proof_id");
  }
  async getProofs(contentId, filter) {
    const result = await this.rpcClient.call(
      "get_proofs",
      compact({ content_id: contentId, filter })
    );
    const arr = asArray(result, "Vec<RepoProof>");
    return arr.map((entry, idx) => {
      const record = asRecord(entry, `RepoProof[${idx}]`);
      if (record.kind !== "Action" && record.kind !== "Collection") {
        throw new RPCError(`RepoProof[${idx}] has unknown kind: ${String(record.kind)}`);
      }
      return record;
    });
  }
  async resolve(contentName) {
    const result = await this.rpcClient.call("resolve", {
      content_name: contentName
    });
    const arr = asArray(result, "Vec<ObjId>");
    return arr.map((entry, idx) => asString(entry, `ObjId[${idx}]`));
  }
  async list(filter) {
    const result = await this.rpcClient.call(
      "list",
      compact({ filter })
    );
    const arr = asArray(result, "Vec<RepoRecord>");
    return arr.map((entry, idx) => {
      const record = asRecord(entry, `RepoRecord[${idx}]`);
      return {
        content_id: asString(record.content_id, `RepoRecord[${idx}].content_id`),
        content_name: typeof record.content_name === "string" ? record.content_name : void 0,
        status: asString(record.status, `RepoRecord[${idx}].status`),
        origin: asString(record.origin, `RepoRecord[${idx}].origin`),
        meta: record.meta,
        owner_did: typeof record.owner_did === "string" ? record.owner_did : void 0,
        author: typeof record.author === "string" ? record.author : void 0,
        access_policy: asString(record.access_policy, `RepoRecord[${idx}].access_policy`),
        price: typeof record.price === "string" ? record.price : void 0,
        content_size: typeof record.content_size === "number" ? record.content_size : void 0,
        collected_at: typeof record.collected_at === "number" ? record.collected_at : void 0,
        pinned_at: typeof record.pinned_at === "number" ? record.pinned_at : void 0,
        updated_at: typeof record.updated_at === "number" ? record.updated_at : void 0
      };
    });
  }
  async stat() {
    const result = await this.rpcClient.call("stat", {});
    const record = asRecord(result, "RepoStat");
    return {
      total_objects: asNumber(record.total_objects, "RepoStat.total_objects"),
      collected_objects: asNumber(record.collected_objects, "RepoStat.collected_objects"),
      pinned_objects: asNumber(record.pinned_objects, "RepoStat.pinned_objects"),
      local_objects: asNumber(record.local_objects, "RepoStat.local_objects"),
      remote_objects: asNumber(record.remote_objects, "RepoStat.remote_objects"),
      total_content_bytes: asNumber(record.total_content_bytes, "RepoStat.total_content_bytes"),
      total_proofs: asNumber(record.total_proofs, "RepoStat.total_proofs")
    };
  }
  async serve(contentId, requestContext) {
    const result = await this.rpcClient.call("serve", { content_id: contentId, request_context: requestContext });
    const record = asRecord(result, "RepoServeResult");
    return {
      status: asString(record.status, "RepoServeResult.status"),
      content_ref: record.content_ref && typeof record.content_ref === "object" ? record.content_ref : void 0,
      download_proof: record.download_proof && typeof record.download_proof === "object" ? record.download_proof : void 0,
      reject_code: typeof record.reject_code === "string" ? record.reject_code : void 0,
      reject_reason: typeof record.reject_reason === "string" ? record.reject_reason : void 0
    };
  }
  async announce(contentId) {
    const result = await this.rpcClient.call("announce", {
      content_id: contentId
    });
    return asBoolean(result, "announce response");
  }
}
const DEFAULT_NODE_GATEWAY_PORT = 3180;
const DEFAULT_SESSION_TOKEN_TTL_SECONDS = 15 * 60;
const DEFAULT_RENEW_INTERVAL_MS = 5e3;
const BUCKYOS_HOST_GATEWAY_ENV = "BUCKYOS_HOST_GATEWAY";
const DEFAULT_DOCKER_HOST_GATEWAY = "host.docker.internal";
var RuntimeType = /* @__PURE__ */ ((RuntimeType2) => {
  RuntimeType2["Browser"] = "Browser";
  RuntimeType2["NodeJS"] = "NodeJS";
  RuntimeType2["AppRuntime"] = "AppRuntime";
  RuntimeType2["AppClient"] = "AppClient";
  RuntimeType2["AppService"] = "AppService";
  RuntimeType2["Unknown"] = "Unknown";
  return RuntimeType2;
})(RuntimeType || {});
const DEFAULT_CONFIG = {
  zoneHost: "",
  appId: "",
  defaultProtocol: "http://",
  runtimeType: "Unknown",
  ownerUserId: null,
  rootDir: "",
  sessionToken: null,
  refreshToken: null,
  privateKeySearchPaths: [],
  systemConfigServiceUrl: "",
  verifyHubServiceUrl: "",
  nodeGatewayPort: DEFAULT_NODE_GATEWAY_PORT,
  autoRenew: true,
  renewIntervalMs: DEFAULT_RENEW_INTERVAL_MS
};
function getProcessEnv() {
  const runtimeProcess = globalThis.process;
  return (runtimeProcess == null ? void 0 : runtimeProcess.env) ?? {};
}
function hasNodeRuntime() {
  var _a;
  const runtimeProcess = globalThis.process;
  return Boolean((_a = runtimeProcess == null ? void 0 : runtimeProcess.versions) == null ? void 0 : _a.node);
}
function hasBrowserStorage() {
  return typeof localStorage !== "undefined";
}
function hasFetchRuntime() {
  return typeof fetch === "function";
}
function ensureBuffer() {
  const bufferCtor = globalThis.Buffer;
  if (!bufferCtor || typeof bufferCtor !== "function") {
    throw new Error("Buffer is not available in this runtime");
  }
  return bufferCtor;
}
function base64UrlEncode(value) {
  const BufferCtor = ensureBuffer();
  const base64 = typeof value === "string" ? BufferCtor.from(value, "utf8").toString("base64") : BufferCtor.from(value).toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  if (typeof atob === "function") {
    return atob(padded);
  }
  const BufferCtor = ensureBuffer();
  return BufferCtor.from(padded, "base64").toString("utf8");
}
function parseSessionTokenClaims(token) {
  if (!token) {
    return null;
  }
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }
  try {
    return JSON.parse(base64UrlDecode(parts[1]));
  } catch {
    return null;
  }
}
function trimToNull$1(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
function normalizeServicePath(serviceName) {
  if (serviceName === "system-config") {
    return "system_config";
  }
  return serviceName;
}
function getFullAppId(appId, ownerUserId) {
  return `${ownerUserId}-${appId}`;
}
function getAppHostPrefix(appId, ownerUserId) {
  if (!ownerUserId) {
    return appId;
  }
  return `${appId}-${ownerUserId}`;
}
function getSessionTokenEnvKey(appFullId, isAppService) {
  const normalized = appFullId.toUpperCase().replace(/-/g, "_");
  return isAppService ? `${normalized}_TOKEN` : `${normalized}_SESSION_TOKEN`;
}
function parseAppIdentityFromInstanceConfig(appInstanceConfig) {
  var _a, _b, _c;
  try {
    const parsed = JSON.parse(appInstanceConfig);
    const appId = typeof ((_b = (_a = parsed.app_spec) == null ? void 0 : _a.app_doc) == null ? void 0 : _b.name) === "string" ? parsed.app_spec.app_doc.name.trim() : "";
    const ownerUserId = typeof ((_c = parsed.app_spec) == null ? void 0 : _c.user_id) === "string" ? parsed.app_spec.user_id.trim() : "";
    if (!appId || !ownerUserId) {
      return null;
    }
    return { appId, ownerUserId };
  } catch {
    return null;
  }
}
async function importNodeModule(moduleName) {
  if (hasNodeRuntime() && typeof require === "function") {
    return require(moduleName);
  }
  const dynamicImport = Function("name", "return import(name)");
  return dynamicImport(moduleName);
}
class BaseRuntimeProfile {
  async initialize(runtime) {
    runtime.resolveNodeIdentityFromEnv();
    await runtime.resolveZoneHostFromLocalConfig();
  }
  async login(runtime) {
    await runtime.initialize();
    runtime.startAutoRenewIfNeeded();
  }
  supportsManagedSessionRenewal() {
    return false;
  }
  shouldSkipVerifyHubRenewal(_runtime) {
    return false;
  }
  async getVerifyHubLoginJwt(_runtime, sessionToken) {
    return sessionToken;
  }
}
class BrowserRuntimeProfile extends BaseRuntimeProfile {
  getRelativeZoneServiceURL(servicePath) {
    return `/kapi/${servicePath}/`;
  }
  getRelativeSystemConfigServiceURL() {
    return "/kapi/system_config";
  }
  getServiceSettingsPath(runtime) {
    return `services/${runtime.getAppId()}/settings`;
  }
  getZoneServiceURL(_runtime, servicePath) {
    return this.getRelativeZoneServiceURL(servicePath);
  }
  getSystemConfigServiceURL(_runtime) {
    return this.getRelativeSystemConfigServiceURL();
  }
  getMySettingsPath(runtime) {
    return this.getServiceSettingsPath(runtime);
  }
}
class AppRuntimeProfile extends BrowserRuntimeProfile {
}
class ManagedSessionRuntimeProfile extends BaseRuntimeProfile {
  async login(runtime) {
    await runtime.initialize();
    await runtime.renewTokenFromVerifyHub();
    runtime.startAutoRenewIfNeeded();
  }
  supportsManagedSessionRenewal() {
    return true;
  }
}
class AppClientRuntimeProfile extends ManagedSessionRuntimeProfile {
  async initialize(runtime) {
    await super.initialize(runtime);
    await runtime.ensureAppClientSessionToken();
  }
  getScopedAppZoneServiceURL(runtime, servicePath) {
    const zoneHost = trimToNull$1(runtime.getZoneHostName());
    if (!zoneHost) {
      throw new Error("zoneHost is required in AppClient mode");
    }
    const appHostPrefix = getAppHostPrefix(runtime.getAppId(), runtime.getOwnerUserId());
    return `${runtime.getDefaultProtocol()}${appHostPrefix}.${zoneHost}/kapi/${servicePath}`;
  }
  getZoneSystemConfigURL(runtime) {
    const zoneHost = trimToNull$1(runtime.getZoneHostName());
    if (!zoneHost) {
      throw new Error("zoneHost is required in AppClient mode");
    }
    return `${runtime.getDefaultProtocol()}${zoneHost}/kapi/system_config`;
  }
  getZoneServiceURL(runtime, servicePath) {
    return this.getScopedAppZoneServiceURL(runtime, servicePath);
  }
  getSystemConfigServiceURL(runtime) {
    return this.getZoneSystemConfigURL(runtime);
  }
  getMySettingsPath() {
    throw new Error("AppClient not support getMySettingsPath");
  }
  shouldSkipVerifyHubRenewal(runtime) {
    return !trimToNull$1(runtime.getZoneHostName()) && !runtime.getConfiguredVerifyHubServiceUrl();
  }
  async getVerifyHubLoginJwt(runtime, _sessionToken) {
    return runtime.createAppClientSessionToken();
  }
}
class AppServiceRuntimeProfile extends ManagedSessionRuntimeProfile {
  async initialize(runtime) {
    await super.initialize(runtime);
    runtime.ensureAppServiceSessionToken();
  }
  getNodeGatewayServiceURL(runtime, servicePath) {
    const port = runtime.getNodeGatewayPort();
    return `http://${runtime.resolveAppServiceGatewayHost()}:${port}/kapi/${servicePath}`;
  }
  getNodeGatewaySystemConfigURL(runtime) {
    const port = runtime.getNodeGatewayPort();
    return `http://${runtime.resolveAppServiceGatewayHost()}:${port}/kapi/system_config`;
  }
  getUserAppSettingsPath(runtime) {
    const ownerUserId = runtime.getOwnerUserId();
    if (!ownerUserId) {
      throw new Error("ownerUserId is required for AppService settings");
    }
    return `users/${ownerUserId}/apps/${runtime.getAppId()}/settings`;
  }
  getZoneServiceURL(runtime, servicePath) {
    return this.getNodeGatewayServiceURL(runtime, servicePath);
  }
  getSystemConfigServiceURL(runtime) {
    return this.getNodeGatewaySystemConfigURL(runtime);
  }
  getMySettingsPath(runtime) {
    return this.getUserAppSettingsPath(runtime);
  }
}
function createRuntimeProfile(runtimeType) {
  switch (runtimeType) {
    case "AppClient":
      return new AppClientRuntimeProfile();
    case "AppService":
      return new AppServiceRuntimeProfile();
    case "AppRuntime":
      return new AppRuntimeProfile();
    case "Browser":
    case "NodeJS":
    case "Unknown":
    default:
      return new BrowserRuntimeProfile();
  }
}
class BuckyOSRuntime {
  constructor(config) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      appId: config.appId,
      zoneHost: config.zoneHost ?? "",
      defaultProtocol: config.defaultProtocol ?? DEFAULT_CONFIG.defaultProtocol
    };
    this.sessionToken = trimToNull$1(config.sessionToken);
    this.refreshToken = trimToNull$1(config.refreshToken);
    this.renewTimer = null;
    this.initialized = false;
    this.profile = createRuntimeProfile(this.config.runtimeType);
  }
  async initialize() {
    if (this.initialized) {
      return;
    }
    await this.profile.initialize(this);
    this.validateSessionToken();
    this.initialized = true;
  }
  async login() {
    await this.profile.login(this);
  }
  setConfig(config) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      appId: config.appId
    };
    this.profile = createRuntimeProfile(this.config.runtimeType);
  }
  getConfig() {
    return { ...this.config };
  }
  getAppId() {
    return this.config.appId;
  }
  getOwnerUserId() {
    return trimToNull$1(this.config.ownerUserId);
  }
  getFullAppId() {
    const ownerUserId = this.getOwnerUserId();
    if (!ownerUserId) {
      return this.config.appId;
    }
    return getFullAppId(this.config.appId, ownerUserId);
  }
  getZoneHostName() {
    return this.config.zoneHost;
  }
  getDefaultProtocol() {
    return this.config.defaultProtocol;
  }
  getNodeGatewayPort() {
    return this.config.nodeGatewayPort ?? DEFAULT_NODE_GATEWAY_PORT;
  }
  getConfiguredVerifyHubServiceUrl() {
    return trimToNull$1(this.config.verifyHubServiceUrl);
  }
  getZoneServiceURL(serviceName) {
    const servicePath = normalizeServicePath(serviceName);
    return this.profile.getZoneServiceURL(this, servicePath);
  }
  getSystemConfigServiceURL() {
    const configuredUrl = this.getConfiguredSystemConfigServiceUrl();
    if (configuredUrl) {
      return configuredUrl;
    }
    return this.profile.getSystemConfigServiceURL(this);
  }
  setSessionToken(token) {
    this.sessionToken = trimToNull$1(token);
  }
  setRefreshToken(token) {
    this.refreshToken = trimToNull$1(token);
  }
  getSessionToken() {
    return this.sessionToken;
  }
  getRefreshToken() {
    return this.refreshToken;
  }
  clearAuthState() {
    this.sessionToken = null;
    this.refreshToken = null;
    this.stopAutoRenew();
  }
  stopAutoRenew() {
    if (this.renewTimer) {
      clearInterval(this.renewTimer);
      this.renewTimer = null;
    }
  }
  getServiceRpcClient(serviceName) {
    return new kRPCClient(this.getZoneServiceURL(serviceName), this.sessionToken, null, {
      sessionTokenProvider: this.ensureSessionTokenReady.bind(this),
      onSessionTokenChanged: this.setSessionToken.bind(this)
    });
  }
  getSystemConfigClient() {
    return new SystemConfigClient(this.getSystemConfigServiceURL(), this.sessionToken, {
      sessionTokenProvider: this.ensureSessionTokenReady.bind(this),
      onSessionTokenChanged: this.setSessionToken.bind(this)
    });
  }
  getVerifyHubClient() {
    const configuredUrl = this.getConfiguredVerifyHubServiceUrl();
    const rpcClient = new kRPCClient(configuredUrl ?? this.getZoneServiceURL("verify-hub"), this.sessionToken);
    return new VerifyHubClient(rpcClient);
  }
  getTaskManagerClient() {
    const rpcClient = this.getServiceRpcClient("task-manager");
    return new TaskManagerClient(rpcClient);
  }
  getAiccClient() {
    return new AiccClient(this.getServiceRpcClient("aicc"));
  }
  getMsgQueueClient() {
    return new MsgQueueClient(this.getServiceRpcClient("kmsg"));
  }
  getMsgCenterClient() {
    return new MsgCenterClient(this.getServiceRpcClient("msg-center"));
  }
  getRepoClient() {
    return new RepoClient(this.getServiceRpcClient("repo-service"));
  }
  async getMySettings() {
    const settingsPath = this.getMySettingsPath();
    const settingsValue = await this.getSystemConfigClient().get(settingsPath);
    return JSON.parse(settingsValue.value);
  }
  async updateMySettings(jsonPath, settings) {
    const settingsPath = this.getMySettingsPath();
    const settingsValue = JSON.stringify(settings);
    await this.getSystemConfigClient().setByJsonPath(settingsPath, jsonPath, settingsValue);
  }
  async updateAllMySettings(settings) {
    const settingsPath = this.getMySettingsPath();
    const settingsValue = JSON.stringify(settings);
    await this.getSystemConfigClient().set(settingsPath, settingsValue);
  }
  async renewTokenFromVerifyHub() {
    if (!this.profile.supportsManagedSessionRenewal()) {
      return;
    }
    const sessionToken = this.sessionToken;
    if (!sessionToken) {
      return;
    }
    const claims = parseSessionTokenClaims(sessionToken);
    if (!claims || !this.needsRenew(claims)) {
      return;
    }
    if (this.profile.shouldSkipVerifyHubRenewal(this)) {
      return;
    }
    const verifyHubClient = this.getVerifyHubClient();
    const tokenPair = claims.iss === "verify-hub" ? this.refreshToken ? await verifyHubClient.refreshToken({ refresh_token: this.refreshToken }) : await verifyHubClient.loginByJwt({
      jwt: await this.profile.getVerifyHubLoginJwt(this, sessionToken)
    }) : await verifyHubClient.loginByJwt({ jwt: sessionToken });
    this.sessionToken = trimToNull$1(tokenPair.session_token);
    this.refreshToken = trimToNull$1(tokenPair.refresh_token);
    this.validateSessionToken();
  }
  async ensureSessionTokenReady() {
    if (this.config.runtimeType === "Browser") {
      return this.ensureBrowserSessionToken();
    }
    if (this.profile.supportsManagedSessionRenewal()) {
      await this.renewTokenFromVerifyHub();
    }
    return this.sessionToken;
  }
  ensureAppServiceSessionToken() {
    if (!this.sessionToken) {
      this.sessionToken = this.loadAppServiceSessionTokenFromEnv();
    }
  }
  async ensureAppClientSessionToken() {
    if (!this.sessionToken) {
      this.sessionToken = await this.createAppClientSessionToken();
    }
  }
  resolveNodeIdentityFromEnv() {
    if (!hasNodeRuntime()) {
      return;
    }
    if (this.config.runtimeType !== "AppService") {
      return;
    }
    const env = getProcessEnv();
    const appInstanceConfig = trimToNull$1(env.app_instance_config);
    if (!appInstanceConfig) {
      return;
    }
    const identity = parseAppIdentityFromInstanceConfig(appInstanceConfig);
    if (!identity) {
      return;
    }
    if (!this.config.appId) {
      this.config.appId = identity.appId;
    }
    if (!trimToNull$1(this.config.ownerUserId)) {
      this.config.ownerUserId = identity.ownerUserId;
    }
  }
  async resolveZoneHostFromLocalConfig() {
    if (!hasNodeRuntime()) {
      return;
    }
    if (trimToNull$1(this.config.zoneHost)) {
      return;
    }
    const roots = await this.getPrivateKeySearchRoots();
    const zoneHost = await this.tryResolveZoneHostFromSearchRoots(roots);
    if (zoneHost) {
      this.config.zoneHost = zoneHost;
    }
  }
  validateSessionToken() {
    if (!this.sessionToken) {
      return;
    }
    const claims = parseSessionTokenClaims(this.sessionToken);
    const tokenAppId = typeof (claims == null ? void 0 : claims.appid) === "string" ? claims.appid : typeof (claims == null ? void 0 : claims.aud) === "string" ? claims.aud : null;
    if (tokenAppId && tokenAppId !== this.config.appId) {
      throw new Error(`session token appid mismatch: ${tokenAppId} != ${this.config.appId}`);
    }
  }
  async ensureBrowserSessionToken() {
    const claims = parseSessionTokenClaims(this.sessionToken);
    if (this.sessionToken && claims && !this.needsRenew(claims)) {
      return this.sessionToken;
    }
    return this.refreshBrowserSessionToken();
  }
  normalizeBrowserUserInfo(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }
    const parsed = raw;
    const userId = typeof parsed.user_id === "string" ? parsed.user_id.trim() : "";
    const userType = typeof parsed.user_type === "string" ? parsed.user_type.trim() : "";
    const userName = typeof parsed.user_name === "string" ? parsed.user_name.trim() : typeof parsed.show_name === "string" ? parsed.show_name.trim() : "";
    if (!userId || !userType) {
      return null;
    }
    return {
      user_name: userName || userId,
      user_id: userId,
      user_type: userType
    };
  }
  async refreshBrowserSession() {
    const sessionToken = await this.refreshBrowserSessionToken();
    if (!sessionToken) {
      return null;
    }
    return hasBrowserStorage() ? getBrowserUserInfo() : null;
  }
  async refreshBrowserSessionToken() {
    if (!hasFetchRuntime()) {
      return this.sessionToken;
    }
    const cachedUserInfo = hasBrowserStorage() ? getBrowserUserInfo() : null;
    try {
      const response = await fetch("/sso_refresh", {
        method: "POST",
        credentials: "include",
        cache: "no-store"
      });
      if (!response.ok) {
        this.sessionToken = null;
        return null;
      }
      const payload = await response.json();
      const sessionToken = trimToNull$1(
        typeof payload.access_token === "string" ? payload.access_token : typeof payload.session_token === "string" ? payload.session_token : null
      );
      const userInfo = this.normalizeBrowserUserInfo(payload.user_info) ?? cachedUserInfo;
      if (!sessionToken || !userInfo) {
        this.sessionToken = null;
        return null;
      }
      this.sessionToken = sessionToken;
      this.refreshToken = null;
      saveBrowserUserInfo(userInfo);
      this.validateSessionToken();
      return this.sessionToken;
    } catch (error) {
      console.warn("BuckyOS browser sso_refresh failed:", error);
      this.sessionToken = null;
      return null;
    }
  }
  needsRenew(claims) {
    if (claims.iss && claims.iss !== "verify-hub") {
      return true;
    }
    if (typeof claims.exp !== "number") {
      return false;
    }
    const now = Math.floor(Date.now() / 1e3);
    return now >= claims.exp - 30;
  }
  startAutoRenewIfNeeded() {
    if (!this.profile.supportsManagedSessionRenewal() || this.config.autoRenew === false) {
      return;
    }
    if (this.renewTimer) {
      return;
    }
    const interval = this.config.renewIntervalMs ?? DEFAULT_RENEW_INTERVAL_MS;
    const tick = async () => {
      try {
        await this.renewTokenFromVerifyHub();
      } catch (error) {
        console.warn("BuckyOS token renew failed:", error);
      }
    };
    void tick();
    this.renewTimer = setInterval(() => {
      void tick();
    }, interval);
  }
  loadAppServiceSessionTokenFromEnv() {
    const env = getProcessEnv();
    const ownerUserId = this.getOwnerUserId();
    const sessionTokenKeys = [];
    if (ownerUserId) {
      sessionTokenKeys.push(getSessionTokenEnvKey(getFullAppId(this.config.appId, ownerUserId), true));
    }
    sessionTokenKeys.push(getSessionTokenEnvKey(this.config.appId, true));
    const uniqueKeys = Array.from(new Set(sessionTokenKeys));
    for (const key of uniqueKeys) {
      const token = trimToNull$1(env[key]);
      if (token) {
        return token;
      }
    }
    throw new Error(`failed to load app-service session token, tried keys: ${uniqueKeys.join(", ")}`);
  }
  async createAppClientSessionToken() {
    if (!hasNodeRuntime()) {
      throw new Error("AppClient mode requires Node.js");
    }
    const material = await this.loadLocalSigningMaterial();
    const now = Math.floor(Date.now() / 1e3);
    const claims = {
      token_type: "Normal",
      appid: this.config.appId,
      jti: String(now),
      session: now,
      sub: material.subject,
      userid: material.subject,
      iss: material.issuer,
      exp: now + DEFAULT_SESSION_TOKEN_TTL_SECONDS,
      extra: {}
    };
    return this.signJwtWithEd25519({
      alg: "EdDSA",
      kid: material.issuer
    }, claims, material.keyPem);
  }
  async loadLocalSigningMaterial() {
    const fs = await importNodeModule("node:fs/promises");
    const path = await importNodeModule("node:path");
    const env = getProcessEnv();
    const roots = await this.getPrivateKeySearchRoots();
    for (const root of roots) {
      const userKeyPath = root.endsWith(".pem") ? root : path.join(root, "user_private_key.pem");
      try {
        const keyPem = (await fs.readFile(userKeyPath, "utf8")).trim();
        if (keyPem) {
          return {
            keyPem,
            issuer: "root",
            subject: "root",
            sourcePath: userKeyPath
          };
        }
      } catch {
      }
    }
    const deviceName = trimToNull$1(env.BUCKYOS_DEVICE_NAME) ?? await this.tryResolveDeviceNameFromSearchRoots(roots);
    if (!deviceName) {
      throw new Error("failed to find user_private_key.pem and no device name is available for node_private_key.pem fallback");
    }
    for (const root of roots) {
      const deviceKeyPath = root.endsWith(".pem") ? root : path.join(root, "node_private_key.pem");
      try {
        const keyPem = (await fs.readFile(deviceKeyPath, "utf8")).trim();
        if (keyPem) {
          return {
            keyPem,
            issuer: deviceName,
            subject: deviceName,
            sourcePath: deviceKeyPath
          };
        }
      } catch {
      }
    }
    throw new Error(`failed to find private key in AppClient search roots: ${roots.join(", ")}`);
  }
  async getPrivateKeySearchRoots() {
    var _a;
    const env = getProcessEnv();
    const path = await importNodeModule("node:path");
    const os = await importNodeModule("node:os");
    const roots = [];
    for (const item of this.config.privateKeySearchPaths ?? []) {
      const trimmed = trimToNull$1(item);
      if (trimmed) {
        roots.push(trimmed);
      }
    }
    const explicitClientDir = trimToNull$1(env.BUCKYOS_APP_CLIENT_DIR);
    if (explicitClientDir) {
      roots.push(explicitClientDir);
    }
    const homeDir = trimToNull$1(env.HOME) ?? trimToNull$1(env.USERPROFILE) ?? trimToNull$1((_a = os.homedir) == null ? void 0 : _a.call(os));
    if (homeDir) {
      roots.push(path.join(homeDir, ".buckyos"));
      roots.push(path.join(homeDir, ".buckycli"));
    }
    const rootDir = trimToNull$1(this.config.rootDir) ?? trimToNull$1(env.BUCKYOS_ROOT) ?? "/opt/buckyos";
    roots.push(rootDir);
    roots.push(path.join(rootDir, "etc"));
    return Array.from(new Set(roots));
  }
  async tryResolveDeviceNameFromSearchRoots(roots) {
    const fs = await importNodeModule("node:fs/promises");
    const path = await importNodeModule("node:path");
    const env = getProcessEnv();
    const fromEnv = trimToNull$1(env.BUCKYOS_THIS_DEVICE_NAME);
    if (fromEnv) {
      return fromEnv;
    }
    for (const key of ["BUCKYOS_THIS_DEVICE", "BUCKYOS_THIS_DEVICE_INFO"]) {
      const raw = trimToNull$1(env[key]);
      if (!raw) {
        continue;
      }
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed.name === "string" && parsed.name.trim().length > 0) {
          return parsed.name.trim();
        }
      } catch {
      }
    }
    for (const root of roots) {
      const nodeIdentityPath = path.join(root, "node_identity.json");
      try {
        const raw = await fs.readFile(nodeIdentityPath, "utf8");
        const parsed = JSON.parse(raw);
        if (typeof parsed.device_doc_jwt !== "string") {
          continue;
        }
        const claims = parseSessionTokenClaims(parsed.device_doc_jwt);
        if (typeof (claims == null ? void 0 : claims.name) === "string" && claims.name.trim().length > 0) {
          return claims.name.trim();
        }
        if (typeof (claims == null ? void 0 : claims.sub) === "string" && claims.sub.trim().length > 0) {
          return claims.sub.trim();
        }
      } catch {
      }
    }
    return null;
  }
  async tryResolveZoneHostFromSearchRoots(roots) {
    const fs = await importNodeModule("node:fs/promises");
    const path = await importNodeModule("node:path");
    const env = getProcessEnv();
    const fromEnv = trimToNull$1(env.BUCKYOS_ZONE_HOST);
    if (fromEnv) {
      return fromEnv;
    }
    for (const root of roots) {
      const nodeIdentityPath = path.join(root, "node_identity.json");
      try {
        const raw = await fs.readFile(nodeIdentityPath, "utf8");
        const parsed = JSON.parse(raw);
        if (typeof parsed.zone_name === "string" && parsed.zone_name.trim().length > 0) {
          return parsed.zone_name.trim();
        }
        if (typeof parsed.zone_did !== "string") {
          continue;
        }
        if (parsed.zone_did.startsWith("did:web:")) {
          return parsed.zone_did.slice("did:web:".length).replace(/:/g, ".");
        }
        if (parsed.zone_did.startsWith("did:bns:")) {
          return parsed.zone_did.slice("did:bns:".length);
        }
      } catch {
      }
    }
    for (const root of roots) {
      const userConfigPath = path.join(root, "user_config.json");
      try {
        const raw = await fs.readFile(userConfigPath, "utf8");
        const parsed = JSON.parse(raw);
        const zoneDid = typeof parsed.default_zone_did === "string" ? parsed.default_zone_did.trim() : "";
        if (!zoneDid) {
          continue;
        }
        if (zoneDid.startsWith("did:web:")) {
          return zoneDid.slice("did:web:".length).replace(/:/g, ".");
        }
        if (zoneDid.startsWith("did:bns:")) {
          return zoneDid.slice("did:bns:".length);
        }
      } catch {
      }
    }
    return null;
  }
  getMySettingsPath() {
    return this.profile.getMySettingsPath(this);
  }
  getConfiguredSystemConfigServiceUrl() {
    return trimToNull$1(this.config.systemConfigServiceUrl);
  }
  resolveAppServiceGatewayHost() {
    return trimToNull$1(getProcessEnv()[BUCKYOS_HOST_GATEWAY_ENV]) ?? DEFAULT_DOCKER_HOST_GATEWAY;
  }
  async signJwtWithEd25519(header, payload, privateKeyPem) {
    const crypto = await importNodeModule("node:crypto");
    const BufferCtor = ensureBuffer();
    const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
    const signature = crypto.sign(
      null,
      BufferCtor.from(signingInput, "utf8"),
      crypto.createPrivateKey({
        key: privateKeyPem,
        format: "pem"
      })
    );
    return `${signingInput}.${base64UrlEncode(signature)}`;
  }
}
const WEB3_BRIDGE_HOST = "web3.buckyos.ai";
const BS_SERVICE_VERIFY_HUB = "verify-hub";
const BS_SERVICE_TASK_MANAGER = "task-manager";
const activeRuntimeContext = {
  runtime: null
};
function isBrowserRuntime() {
  return typeof window !== "undefined";
}
function getNodeEnv() {
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
function isBrowserStorageAvailable() {
  return typeof localStorage !== "undefined";
}
function getSettingsPathSegments(settingName) {
  if (!settingName) {
    return [];
  }
  return settingName.split(/[./]/).map((segment) => segment.trim()).filter((segment) => segment.length > 0);
}
function getSettingValue(settings, settingName) {
  const segments = getSettingsPathSegments(settingName);
  if (segments.length === 0) {
    return settings;
  }
  let current = settings;
  for (const segment of segments) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !(segment in current)) {
      return void 0;
    }
    current = current[segment];
  }
  return current;
}
function setSettingValue(settings, settingName, value) {
  const segments = getSettingsPathSegments(settingName);
  if (segments.length === 0) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("settingValue must be a JSON object when settingName is null");
    }
    return value;
  }
  const nextSettings = Array.isArray(settings) ? {} : { ...settings };
  let current = nextSettings;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const previous = current[segment];
    const next = previous && typeof previous === "object" && !Array.isArray(previous) ? { ...previous } : {};
    current[segment] = next;
    current = next;
  }
  current[segments[segments.length - 1]] = value;
  return nextSettings;
}
function parseSettingValue(settingValue) {
  try {
    return JSON.parse(settingValue);
  } catch {
    return settingValue;
  }
}
function inferNodeRuntimeType() {
  const env = getNodeEnv();
  if (trimToNull(env.app_instance_config)) {
    return RuntimeType.AppService;
  }
  return RuntimeType.AppClient;
}
function detectHostRuntimeType() {
  var _a;
  if (typeof window !== "undefined") {
    if (window.BuckyApi) {
      return RuntimeType.AppRuntime;
    }
    return RuntimeType.Browser;
  }
  const runtimeProcess = globalThis.process;
  if ((_a = runtimeProcess == null ? void 0 : runtimeProcess.versions) == null ? void 0 : _a.node) {
    return RuntimeType.NodeJS;
  }
  return RuntimeType.Unknown;
}
function toAbsoluteOrigin(url) {
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    return new URL(url, base).origin;
  } catch {
    return null;
  }
}
function setActiveRuntime(runtime) {
  activeRuntimeContext.runtime = runtime;
}
function getActiveRuntimeType() {
  var _a;
  return ((_a = activeRuntimeContext.runtime) == null ? void 0 : _a.getConfig().runtimeType) ?? detectHostRuntimeType();
}
function getActiveZoneGatewayOrigin() {
  var _a;
  const runtime = activeRuntimeContext.runtime;
  if (runtime) {
    return toAbsoluteOrigin(runtime.getSystemConfigServiceURL());
  }
  if (typeof window !== "undefined" && ((_a = window.location) == null ? void 0 : _a.origin)) {
    return window.location.origin;
  }
  return null;
}
async function getActiveSessionToken() {
  const runtime = activeRuntimeContext.runtime;
  if (!runtime) {
    return null;
  }
  return runtime.ensureSessionTokenReady();
}
class BuckyOSSDK {
  constructor(target) {
    this.currentRuntime = null;
    this.currentAccountInfo = null;
    this.target = target;
  }
  async initBuckyOS(appid, config = null) {
    var _a;
    const finalConfig = this.buildRuntimeConfig(appid, config);
    if (this.target !== "node" && isBrowserRuntime() && !config) {
      localStorage.removeItem("zone_host_name");
      let zoneHostName = localStorage.getItem("zone_host_name_v2");
      if (zoneHostName) {
        finalConfig.zoneHost = zoneHostName;
      } else {
        zoneHostName = await this.tryGetZoneHostName(appid, window.location.host, finalConfig.defaultProtocol);
        localStorage.setItem("zone_host_name_v2", zoneHostName);
        finalConfig.zoneHost = zoneHostName;
      }
    }
    (_a = this.currentRuntime) == null ? void 0 : _a.stopAutoRenew();
    this.currentRuntime = new BuckyOSRuntime(finalConfig);
    await this.currentRuntime.initialize();
    setActiveRuntime(this.currentRuntime);
    this.syncCurrentAccountInfoFromRuntime();
  }
  getBuckyOSConfig() {
    var _a;
    return ((_a = this.currentRuntime) == null ? void 0 : _a.getConfig()) ?? null;
  }
  getRuntimeType() {
    if (this.currentRuntime) {
      return this.currentRuntime.getConfig().runtimeType;
    }
    return this.detectEnvironmentRuntimeType();
  }
  getAppId() {
    if (this.currentRuntime) {
      return this.currentRuntime.getAppId();
    }
    console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    return null;
  }
  attachEvent(eventName, callback) {
  }
  removeEvent(cookieId) {
  }
  async getAccountInfo() {
    if (this.currentRuntime == null) {
      console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
      return null;
    }
    this.syncCurrentAccountInfoFromRuntime();
    if (this.currentRuntime.getConfig().runtimeType !== RuntimeType.Browser) {
      return this.currentAccountInfo;
    }
    const cachedUserInfo = isBrowserStorageAvailable() ? getBrowserUserInfo() : null;
    if (cachedUserInfo) {
      this.currentAccountInfo = {
        user_name: cachedUserInfo.user_name,
        user_id: cachedUserInfo.user_id,
        user_type: cachedUserInfo.user_type,
        session_token: this.currentRuntime.getSessionToken() ?? "",
        refresh_token: void 0
      };
      return this.currentAccountInfo;
    }
    const refreshedUserInfo = await this.currentRuntime.refreshBrowserSession();
    if (!refreshedUserInfo) {
      return null;
    }
    this.currentAccountInfo = {
      user_name: refreshedUserInfo.user_name,
      user_id: refreshedUserInfo.user_id,
      user_type: refreshedUserInfo.user_type,
      session_token: this.currentRuntime.getSessionToken() ?? "",
      refresh_token: void 0
    };
    return this.currentAccountInfo;
  }
  async loginByPassword(username, password) {
    var _a, _b;
    const appId = this.getAppId();
    if (appId == null) {
      console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
      return null;
    }
    const loginNonce = Date.now();
    const passwordHash = hashPassword(username, password, loginNonce);
    if (isBrowserStorageAvailable()) {
      localStorage.removeItem(`buckyos.account_info.${appId}`);
    }
    try {
      const verifyHubClient = this.getVerifyHubClient();
      verifyHubClient.setSeq(loginNonce);
      const accountResponse = await verifyHubClient.loginByPassword({
        username,
        password: passwordHash,
        appid: appId,
        source_url: typeof window !== "undefined" ? window.location.href : void 0
      });
      const normalized = VerifyHubClient.normalizeLoginResponse(accountResponse);
      const accountInfo = {
        user_name: normalized.user_name,
        user_id: normalized.user_id,
        user_type: normalized.user_type,
        session_token: normalized.session_token,
        refresh_token: normalized.refresh_token
      };
      if (isBrowserStorageAvailable()) {
        saveLocalAccountInfo(appId, accountInfo);
        saveBrowserUserInfo({
          user_name: accountInfo.user_name,
          user_id: accountInfo.user_id,
          user_type: accountInfo.user_type
        });
      }
      this.currentAccountInfo = accountInfo;
      (_a = this.currentRuntime) == null ? void 0 : _a.setSessionToken(accountInfo.session_token);
      (_b = this.currentRuntime) == null ? void 0 : _b.setRefreshToken(accountInfo.refresh_token ?? null);
      return accountInfo;
    } catch (error) {
      console.error("login failed: ", error);
      throw error;
    }
  }
  async loginByRuntimeSession() {
    const runtime = this.currentRuntime;
    if (runtime == null) {
      console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
      return null;
    }
    await runtime.login();
    this.syncCurrentAccountInfoFromRuntime();
    return this.currentAccountInfo;
  }
  async loginByBrowserSSO() {
    const runtime = this.currentRuntime;
    if (runtime == null) {
      console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
      return;
    }
    const appId = this.getAppId();
    if (appId == null) {
      console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
      return;
    }
    if (isBrowserStorageAvailable()) {
      cleanLocalAccountInfo(appId);
    }
    const zoneHostName = this.getZoneHostName();
    if (zoneHostName == null) {
      console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
      return;
    }
    try {
      const authClient = new AuthClient(zoneHostName, appId);
      await authClient.login();
    } catch (error) {
      console.error("login failed: ", error);
      throw error;
    }
  }
  async login() {
    if (this.usesRuntimeManagedSession()) {
      return this.loginByRuntimeSession();
    }
    await this.loginByBrowserSSO();
    return this.currentAccountInfo;
  }
  logout(cleanAccountInfo = true) {
    if (this.currentRuntime == null) {
      console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
      return;
    }
    const appId = this.getAppId();
    if (appId == null) {
      console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
      return;
    }
    if (cleanAccountInfo && isBrowserStorageAvailable()) {
      cleanLocalAccountInfo(appId);
    }
    this.currentAccountInfo = null;
    this.currentRuntime.clearAuthState();
  }
  async getAppSetting(settingName = null) {
    if (this.currentRuntime == null) {
      throw new Error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    }
    const settings = await this.currentRuntime.getMySettings();
    return getSettingValue(settings, settingName);
  }
  async setAppSetting(settingName = null, settingValue) {
    if (this.currentRuntime == null) {
      throw new Error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    }
    const currentSettings = await this.currentRuntime.getMySettings();
    const nextSettings = setSettingValue(
      currentSettings && typeof currentSettings === "object" && !Array.isArray(currentSettings) ? { ...currentSettings } : {},
      settingName,
      parseSettingValue(settingValue)
    );
    await this.currentRuntime.updateAllMySettings(nextSettings);
  }
  getCurrentWalletUser() {
    if (typeof window === "undefined") {
      throw new Error("BuckyApi is only available in browser runtime");
    }
    return (async () => {
      const result = await window.BuckyApi.getCurrentUser();
      if (result.code === 0) {
        return result.data;
      }
      console.error("BuckyApi.getCurrentUser failed: ", result.message);
      return null;
    })();
  }
  walletSignWithActiveDid(payloads) {
    if (typeof window === "undefined") {
      throw new Error("BuckyApi is only available in browser runtime");
    }
    return (async () => {
      const result = await window.BuckyApi.signJsonWithActiveDid(payloads);
      if (result.code === 0) {
        return result.data.signatures;
      }
      console.error("BuckyApi.signWithActiveDid failed: ", result.message);
      return null;
    })();
  }
  getZoneHostName() {
    if (this.currentRuntime == null) {
      console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
      return null;
    }
    return this.currentRuntime.getZoneHostName();
  }
  getZoneServiceURL(serviceName) {
    if (this.currentRuntime == null) {
      throw new Error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    }
    return this.currentRuntime.getZoneServiceURL(serviceName);
  }
  getServiceRpcClient(serviceName) {
    if (this.currentRuntime == null) {
      console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
      throw new Error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    }
    this.syncCurrentAccountInfoFromRuntime();
    return this.currentRuntime.getServiceRpcClient(serviceName);
  }
  getVerifyHubClient() {
    if (this.currentRuntime == null) {
      console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
      throw new Error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    }
    return this.currentRuntime.getVerifyHubClient();
  }
  getSystemConfigClient() {
    if (this.currentRuntime == null) {
      console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
      throw new Error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    }
    return this.currentRuntime.getSystemConfigClient();
  }
  getTaskManagerClient() {
    if (this.currentRuntime == null) {
      console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
      throw new Error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    }
    return this.currentRuntime.getTaskManagerClient();
  }
  getAiccClient() {
    if (this.currentRuntime == null) {
      throw new Error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    }
    return this.currentRuntime.getAiccClient();
  }
  getMsgQueueClient() {
    if (this.currentRuntime == null) {
      throw new Error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    }
    return this.currentRuntime.getMsgQueueClient();
  }
  getMsgCenterClient() {
    if (this.currentRuntime == null) {
      throw new Error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    }
    return this.currentRuntime.getMsgCenterClient();
  }
  getRepoClient() {
    if (this.currentRuntime == null) {
      throw new Error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    }
    return this.currentRuntime.getRepoClient();
  }
  buildRuntimeConfig(appid, config) {
    if (config) {
      let runtimeType = config.runtimeType;
      if (runtimeType === RuntimeType.NodeJS && this.target !== "browser") {
        runtimeType = inferNodeRuntimeType();
      }
      return {
        ...DEFAULT_CONFIG,
        ...config,
        appId: config.appId || appid,
        runtimeType
      };
    }
    if (this.target === "browser") {
      return {
        ...DEFAULT_CONFIG,
        appId: appid,
        runtimeType: this.detectEnvironmentRuntimeType(),
        defaultProtocol: typeof window !== "undefined" ? window.location.protocol + "//" : "http://"
      };
    }
    if (this.target === "node") {
      return {
        ...DEFAULT_CONFIG,
        appId: appid,
        runtimeType: inferNodeRuntimeType(),
        defaultProtocol: "https://",
        zoneHost: trimToNull(getNodeEnv().BUCKYOS_ZONE_HOST) ?? ""
      };
    }
    if (isBrowserRuntime()) {
      return {
        ...DEFAULT_CONFIG,
        appId: appid,
        runtimeType: this.detectEnvironmentRuntimeType(),
        defaultProtocol: window.location.protocol + "//"
      };
    }
    return {
      ...DEFAULT_CONFIG,
      appId: appid,
      runtimeType: inferNodeRuntimeType(),
      defaultProtocol: "https://",
      zoneHost: trimToNull(getNodeEnv().BUCKYOS_ZONE_HOST) ?? ""
    };
  }
  async tryGetZoneHostName(appid, host, defaultProtocol) {
    const zoneFromDoc = await this.fetchZoneHostFromIdentifierDoc(defaultProtocol + host + "/1.0/identifiers/self");
    if (zoneFromDoc) {
      return zoneFromDoc;
    }
    const upHost = host.split(".").slice(1).join(".");
    if (!upHost) {
      return host;
    }
    const zoneFromParent = await this.fetchZoneHostFromIdentifierDoc(defaultProtocol + upHost + "/1.0/identifiers/self");
    if (zoneFromParent) {
      return zoneFromParent;
    }
    return host;
  }
  async fetchZoneHostFromIdentifierDoc(url) {
    try {
      const response = await fetch(url);
      if (response.status !== 200) {
        return null;
      }
      const doc = await response.json();
      const hostname = typeof doc.hostname === "string" ? doc.hostname.trim() : "";
      if (hostname.length > 0) {
        return hostname;
      }
      if (typeof doc.id === "string") {
        const match = doc.id.match(/^did:web:([^/?#]+)/);
        if (match && match[1]) {
          return match[1];
        }
      }
      return null;
    } catch {
      return null;
    }
  }
  syncCurrentAccountInfoFromRuntime() {
    if (this.currentRuntime == null) {
      return;
    }
    const sessionToken = this.currentRuntime.getSessionToken();
    if (!sessionToken) {
      return;
    }
    const claims = parseSessionTokenClaims(sessionToken);
    const userId = typeof (claims == null ? void 0 : claims.sub) === "string" ? claims.sub : typeof (claims == null ? void 0 : claims.userid) === "string" ? claims.userid : this.currentRuntime.getOwnerUserId() ?? "root";
    this.currentAccountInfo = {
      user_name: userId,
      user_id: userId,
      user_type: this.currentRuntime.getConfig().runtimeType === RuntimeType.AppService ? "service" : "root",
      session_token: sessionToken,
      refresh_token: this.currentRuntime.getRefreshToken() ?? void 0
    };
  }
  usesRuntimeManagedSession() {
    if (this.currentRuntime == null) {
      return false;
    }
    const runtimeType = this.currentRuntime.getConfig().runtimeType;
    return runtimeType === RuntimeType.AppClient || runtimeType === RuntimeType.AppService;
  }
  detectEnvironmentRuntimeType() {
    var _a, _b;
    if (this.target === "browser") {
      if (typeof window !== "undefined" && window.BuckyApi) {
        return RuntimeType.AppRuntime;
      }
      return typeof window !== "undefined" ? RuntimeType.Browser : RuntimeType.Unknown;
    }
    if (this.target === "node") {
      const runtimeProcess2 = globalThis.process;
      if ((_a = runtimeProcess2 == null ? void 0 : runtimeProcess2.versions) == null ? void 0 : _a.node) {
        return inferNodeRuntimeType();
      }
      return RuntimeType.Unknown;
    }
    if (typeof window !== "undefined") {
      if (window.BuckyApi) {
        return RuntimeType.AppRuntime;
      }
      return RuntimeType.Browser;
    }
    const runtimeProcess = globalThis.process;
    if ((_b = runtimeProcess == null ? void 0 : runtimeProcess.versions) == null ? void 0 : _b.node) {
      return RuntimeType.NodeJS;
    }
    return RuntimeType.Unknown;
  }
}
function createSDKModule(target) {
  const sdk = new BuckyOSSDK(target);
  const api = {
    initBuckyOS: sdk.initBuckyOS.bind(sdk),
    getBuckyOSConfig: sdk.getBuckyOSConfig.bind(sdk),
    getRuntimeType: sdk.getRuntimeType.bind(sdk),
    getAppId: sdk.getAppId.bind(sdk),
    attachEvent: sdk.attachEvent.bind(sdk),
    removeEvent: sdk.removeEvent.bind(sdk),
    getAccountInfo: sdk.getAccountInfo.bind(sdk),
    loginByPassword: sdk.loginByPassword.bind(sdk),
    loginByBrowserSSO: sdk.loginByBrowserSSO.bind(sdk),
    loginByRuntimeSession: sdk.loginByRuntimeSession.bind(sdk),
    login: sdk.login.bind(sdk),
    logout: sdk.logout.bind(sdk),
    getAppSetting: sdk.getAppSetting.bind(sdk),
    setAppSetting: sdk.setAppSetting.bind(sdk),
    getCurrentWalletUser: sdk.getCurrentWalletUser.bind(sdk),
    walletSignWithActiveDid: sdk.walletSignWithActiveDid.bind(sdk),
    getZoneHostName: sdk.getZoneHostName.bind(sdk),
    getZoneServiceURL: sdk.getZoneServiceURL.bind(sdk),
    getServiceRpcClient: sdk.getServiceRpcClient.bind(sdk),
    getVerifyHubClient: sdk.getVerifyHubClient.bind(sdk),
    getSystemConfigClient: sdk.getSystemConfigClient.bind(sdk),
    getTaskManagerClient: sdk.getTaskManagerClient.bind(sdk),
    getAiccClient: sdk.getAiccClient.bind(sdk),
    getMsgQueueClient: sdk.getMsgQueueClient.bind(sdk),
    getMsgCenterClient: sdk.getMsgCenterClient.bind(sdk),
    getRepoClient: sdk.getRepoClient.bind(sdk)
  };
  return {
    ...api,
    buckyos: {
      kRPCClient,
      AuthClient,
      ...api,
      hashPassword
    }
  };
}
class NdnError extends Error {
  constructor(kind, message) {
    super(`${kind}: ${message}`);
    this.kind = kind;
    this.name = "NdnError";
  }
}
const OBJ_TYPE_FILE = "cyfile";
const OBJ_TYPE_DIR = "cydir";
const OBJ_TYPE_MSG = "cymsg";
const OBJ_TYPE_MSG_RECE = "cymsgr";
const OBJ_TYPE_PATH = "cypath";
const OBJ_TYPE_INCLUSION_PROOF = "cyinc";
const OBJ_TYPE_RELATION = "cyrel";
const OBJ_TYPE_ACTION = "cyact";
const OBJ_TYPE_PACK = "cypack";
const OBJ_TYPE_TRIE = "cytrie";
const OBJ_TYPE_TRIE_SIMPLE = "cytrie-s";
const OBJ_TYPE_OBJMAP = "cymap-mtp";
const OBJ_TYPE_OBJMAP_SIMPLE = "cymap";
const OBJ_TYPE_LIST = "cylist-mtree";
const OBJ_TYPE_LIST_SIMPLE = "cylist";
const OBJ_TYPE_CHUNK_LIST = "cl";
const OBJ_TYPE_CHUNK_LIST_SIMPLE = "clist";
const OBJ_TYPE_CHUNK_LIST_FIX_SIZE = "clist-fix";
const OBJ_TYPE_CHUNK_LIST_SIMPLE_FIX_SIZE = "cl-sf";
const OBJ_TYPE_PKG = "pkg";
const RELATION_TYPE_SAME = "same";
const RELATION_TYPE_PART_OF = "part_of";
const HEX_CHARS = "0123456789abcdef";
function bytesToHex(bytes) {
  let s2 = "";
  for (let i2 = 0; i2 < bytes.length; i2++) {
    const b2 = bytes[i2];
    s2 += HEX_CHARS[b2 >>> 4 & 15];
    s2 += HEX_CHARS[b2 & 15];
  }
  return s2;
}
function hexToBytes(hex) {
  if (hex.length % 2 !== 0) {
    throw new NdnError("InvalidId", `invalid hex length: ${hex.length}`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i2 = 0; i2 < out.length; i2++) {
    const hi = HEX_CHARS.indexOf(hex[i2 * 2].toLowerCase());
    const lo = HEX_CHARS.indexOf(hex[i2 * 2 + 1].toLowerCase());
    if (hi < 0 || lo < 0) {
      throw new NdnError("InvalidId", `invalid hex char at offset ${i2 * 2}`);
    }
    out[i2] = hi << 4 | lo;
  }
  return out;
}
const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (let i2 = 0; i2 < bytes.length; i2++) {
    value = value << 8 | bytes[i2];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[value >>> bits & 31];
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[value << 5 - bits & 31];
  }
  return out;
}
function base32Decode(str) {
  const lower = str.toLowerCase();
  let bits = 0;
  let value = 0;
  const out = [];
  for (let i2 = 0; i2 < lower.length; i2++) {
    const ch = lower[i2];
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) {
      throw new NdnError("InvalidId", `invalid base32 char '${ch}' at ${i2}`);
    }
    value = value << 5 | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push(value >>> bits & 255);
    }
  }
  return new Uint8Array(out);
}
function varintEncode(value) {
  if (!Number.isFinite(value) || value < 0) {
    throw new NdnError("InvalidParam", `varint must be non-negative finite: ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new NdnError("InvalidParam", `varint exceeds safe integer range: ${value}`);
  }
  const out = [];
  let v2 = value;
  while (v2 >= 128) {
    out.push(v2 & 127 | 128);
    v2 = Math.floor(v2 / 128);
  }
  out.push(v2 & 127);
  return new Uint8Array(out);
}
function varintDecode(bytes, offset = 0) {
  let result = 0;
  let shiftMul = 1;
  let i2 = offset;
  let consumed = 0;
  while (i2 < bytes.length) {
    const b2 = bytes[i2++];
    consumed++;
    const part = b2 & 127;
    result += part * shiftMul;
    if (!Number.isSafeInteger(result)) {
      throw new NdnError("InvalidData", "varint exceeds safe integer range");
    }
    if ((b2 & 128) === 0) {
      return [result, consumed];
    }
    shiftMul *= 128;
    if (consumed > 10) {
      throw new NdnError("InvalidData", "varint too long");
    }
  }
  throw new NdnError("InvalidData", "varint truncated");
}
function sha256Bytes(data) {
  const sha = new ht("SHA-256", "UINT8ARRAY");
  sha.update(data);
  return sha.getHash("UINT8ARRAY");
}
function sha256Utf8(text) {
  const sha = new ht("SHA-256", "TEXT", { encoding: "UTF8" });
  sha.update(text);
  return sha.getHash("UINT8ARRAY");
}
function canonicalizeJson(value) {
  if (value === null || typeof value !== "object")
    return value;
  if (Array.isArray(value))
    return value.map(canonicalizeJson);
  const keys = Object.keys(value).sort();
  const result = {};
  for (const k2 of keys) {
    result[k2] = canonicalizeJson(value[k2]);
  }
  return result;
}
function toCanonicalJsonString(value) {
  return JSON.stringify(canonicalizeJson(value));
}
const DEFAULT_HASH_METHOD = "sha256";
const HashMethod = {
  Sha256: "sha256",
  Sha512: "sha512",
  QCID: "qcid",
  Blake2s256: "blake2s256",
  Keccak256: "keccak256",
  hashResultSize(method) {
    switch (method) {
      case "sha256":
        return 32;
      case "sha512":
        return 64;
      case "qcid":
        return 32;
      case "blake2s256":
        return 32;
      case "keccak256":
        return 32;
    }
  },
  /** parse(s) -> [HashMethod, isMix]; "mix256" -> [Sha256, true]. */
  parse(s2) {
    const isMix = s2.startsWith("mix");
    const method = HashMethod.fromString(s2);
    return [method, isMix];
  },
  fromString(s2) {
    switch (s2) {
      case "sha256":
      case "mix256":
        return "sha256";
      case "sha512":
      case "mix512":
        return "sha512";
      case "qcid":
      case "mixqcid":
        return "qcid";
      case "blake2s256":
      case "mixblake2s256":
        return "blake2s256";
      case "keccak256":
      case "mixkeccak256":
        return "keccak256";
      default:
        throw new NdnError("InvalidData", `Invalid hash method: ${s2}`);
    }
  }
};
const ChunkType = {
  Sha256: "sha256",
  Mix256: "mix256",
  Sha512: "sha512",
  Mix512: "mix512",
  QCID: "qcid",
  Blake2s256: "blake2s256",
  MixBlake2s256: "mixblake2s256",
  Keccak256: "keccak256",
  MixKeccak256: "mixkeccak256",
  isChunkType(typeStr) {
    switch (typeStr) {
      case "sha256":
      case "mix256":
      case "sha512":
      case "mix512":
      case "qcid":
      case "blake2s256":
      case "mixblake2s256":
      case "keccak256":
      case "mixkeccak256":
        return true;
      default:
        return false;
    }
  },
  isMix(typeStr) {
    switch (typeStr) {
      case "mix256":
      case "mix512":
      case "mixblake2s256":
      case "mixkeccak256":
      case "qcid":
        return true;
      default:
        return false;
    }
  },
  fromHashType(hashType, isMix) {
    switch (hashType) {
      case "sha256":
        return isMix ? "mix256" : "sha256";
      case "sha512":
        return isMix ? "mix512" : "sha512";
      case "qcid":
        if (!isMix) {
          throw new NdnError("InvalidObjType", "QCID must be mix hash");
        }
        return "qcid";
      case "blake2s256":
        return isMix ? "mixblake2s256" : "blake2s256";
      case "keccak256":
        return isMix ? "mixkeccak256" : "keccak256";
    }
  },
  toHashMethod(typeStr) {
    switch (typeStr) {
      case "sha256":
      case "mix256":
        return "sha256";
      case "sha512":
      case "mix512":
        return "sha512";
      case "qcid":
        return "qcid";
      case "blake2s256":
      case "mixblake2s256":
        return "blake2s256";
      case "keccak256":
      case "mixkeccak256":
        return "keccak256";
      default:
        throw new NdnError("InvalidObjType", `invalid chunk type: ${typeStr}`);
    }
  }
};
class ObjId {
  constructor(objType, objHash) {
    this.objType = objType;
    this.objHash = objHash;
  }
  /** Parse from base32 (no separator) or `obj_type:hex_hash`. */
  static fromString(s2) {
    const parts = s2.split(":");
    if (parts.length === 1) {
      const decoded = base32Decode(parts[0]);
      let pos = -1;
      for (let i2 = 0; i2 < decoded.length; i2++) {
        if (decoded[i2] === 58) {
          pos = i2;
          break;
        }
      }
      if (pos < 0) {
        throw new NdnError("InvalidId", "separator ':' not found");
      }
      const objType = utf8Decode(decoded.subarray(0, pos));
      const objHash = decoded.slice(pos + 1);
      return new ObjId(objType, objHash);
    } else if (parts.length === 2) {
      return new ObjId(parts[0], hexToBytes(parts[1]));
    } else {
      throw new NdnError("InvalidId", s2);
    }
  }
  static fromBytes(bytes) {
    if (bytes.length < 3) {
      throw new NdnError("InvalidId", "objid bytes too short");
    }
    let pos = -1;
    for (let i2 = 0; i2 < bytes.length; i2++) {
      if (bytes[i2] === 58) {
        pos = i2;
        break;
      }
    }
    if (pos < 0) {
      throw new NdnError("InvalidId", "separator ':' not found");
    }
    const objType = utf8Decode(bytes.subarray(0, pos));
    const objHash = bytes.slice(pos + 1);
    return new ObjId(objType, objHash);
  }
  static fromValue(v2) {
    if (typeof v2 === "string") {
      return ObjId.fromString(v2);
    }
    throw new NdnError("InvalidData", "ObjId MUST be string");
  }
  static fromHostname(hostname) {
    const first = hostname.split(".")[0];
    return ObjId.fromString(first);
  }
  /**
   * Try to extract an ObjId from an NDN-style path. Returns the ObjId and
   * the optional remaining sub-path (with leading '/'), or null if no part
   * of the path parses as an ObjId.
   */
  static fromPath(path) {
    const parts = path.split("/");
    for (let i2 = 0; i2 < parts.length; i2++) {
      const part = parts[i2];
      if (part.length === 0)
        continue;
      try {
        const objId = ObjId.fromString(part);
        if (i2 < parts.length - 1) {
          return { objId, subPath: "/" + parts.slice(i2 + 1).join("/") };
        }
        return { objId, subPath: null };
      } catch {
      }
    }
    throw new NdnError("InvalidId", `no objid found in path: ${path}`);
  }
  /** Construct an ObjId from a precomputed hash. */
  static fromRaw(objType, hashValue) {
    return new ObjId(objType, hashValue);
  }
  isChunk() {
    return ChunkType.isChunkType(this.objType);
  }
  isChunkList() {
    return this.objType === OBJ_TYPE_CHUNK_LIST_SIMPLE;
  }
  isJson() {
    if (this.isChunk() || this.isContainer())
      return false;
    return this.objType !== OBJ_TYPE_PACK;
  }
  isDirObject() {
    return this.objType === OBJ_TYPE_DIR;
  }
  isFileObject() {
    return this.objType === OBJ_TYPE_FILE;
  }
  isContainer() {
    switch (this.objType) {
      case OBJ_TYPE_DIR:
      case OBJ_TYPE_TRIE:
      case OBJ_TYPE_TRIE_SIMPLE:
      case OBJ_TYPE_OBJMAP:
      case OBJ_TYPE_OBJMAP_SIMPLE:
      case OBJ_TYPE_LIST:
      case OBJ_TYPE_LIST_SIMPLE:
      case OBJ_TYPE_CHUNK_LIST:
      case OBJ_TYPE_CHUNK_LIST_SIMPLE:
      case OBJ_TYPE_CHUNK_LIST_FIX_SIZE:
      case OBJ_TYPE_CHUNK_LIST_SIMPLE_FIX_SIZE:
        return true;
      default:
        return false;
    }
  }
  isBigContainer() {
    switch (this.objType) {
      case OBJ_TYPE_TRIE:
      case OBJ_TYPE_OBJMAP:
      case OBJ_TYPE_LIST:
      case OBJ_TYPE_CHUNK_LIST:
      case OBJ_TYPE_CHUNK_LIST_FIX_SIZE:
        return true;
      default:
        return false;
    }
  }
  /** `${obj_type}:${hex(obj_hash)}` form. */
  toString() {
    return `${this.objType}:${bytesToHex(this.objHash)}`;
  }
  toFilename() {
    return `${bytesToHex(this.objHash)}.${this.objType}`;
  }
  toBase32() {
    return base32Encode(this.toBytes());
  }
  toBytes() {
    const typeBytes = utf8Encode(this.objType);
    const out = new Uint8Array(typeBytes.length + 1 + this.objHash.length);
    out.set(typeBytes, 0);
    out[typeBytes.length] = 58;
    out.set(this.objHash, typeBytes.length + 1);
    return out;
  }
  /** Used for JSON.stringify -> serialized as the `${type}:${hex}` string. */
  toJSON() {
    return this.toString();
  }
  equals(other) {
    if (this.objType !== other.objType)
      return false;
    if (this.objHash.length !== other.objHash.length)
      return false;
    for (let i2 = 0; i2 < this.objHash.length; i2++) {
      if (this.objHash[i2] !== other.objHash[i2])
        return false;
    }
    return true;
  }
}
class ChunkId {
  constructor(chunkType, hashResult) {
    this.chunkType = chunkType;
    this.hashResult = hashResult;
  }
  static defaultChunkType() {
    return "mix256";
  }
  static fromString(s2) {
    const objId = ObjId.fromString(s2);
    if (!objId.isChunk()) {
      throw new NdnError("InvalidId", `invalid chunk id: ${s2}`);
    }
    return new ChunkId(objId.objType, objId.objHash);
  }
  static fromObjId(objId) {
    return new ChunkId(objId.objType, new Uint8Array(objId.objHash));
  }
  static fromBytes(bytes) {
    const obj = ObjId.fromBytes(bytes);
    return new ChunkId(obj.objType, obj.objHash);
  }
  /** Construct from raw hash result, no length encoding. */
  static fromHashResult(hashResult, chunkType) {
    return new ChunkId(chunkType, new Uint8Array(hashResult));
  }
  /** Construct mix-style ChunkId by prepending varint(length) to hash. */
  static fromMixHashResult(dataLength, hashResult, chunkType) {
    return new ChunkId(chunkType, ChunkId.mixLengthAndHashResult(dataLength, hashResult));
  }
  static fromMixHashResultByHashMethod(dataLength, hashResult, hashMethod) {
    const chunkType = ChunkType.fromHashType(hashMethod, true);
    return new ChunkId(chunkType, ChunkId.mixLengthAndHashResult(dataLength, hashResult));
  }
  static fromSha256Result(hashResult) {
    return new ChunkId("sha256", new Uint8Array(hashResult));
  }
  static fromMix256Result(dataLength, hashResult) {
    return new ChunkId("mix256", ChunkId.mixLengthAndHashResult(dataLength, hashResult));
  }
  static mixLengthAndHashResult(dataLength, hashResult) {
    const lenBytes = varintEncode(dataLength);
    const out = new Uint8Array(lenBytes.length + hashResult.length);
    out.set(lenBytes, 0);
    out.set(hashResult, lenBytes.length);
    return out;
  }
  toObjId() {
    return new ObjId(this.chunkType, new Uint8Array(this.hashResult));
  }
  toString() {
    return `${this.chunkType}:${bytesToHex(this.hashResult)}`;
  }
  toBase32() {
    const typeBytes = utf8Encode(this.chunkType);
    const buf = new Uint8Array(typeBytes.length + 1 + this.hashResult.length);
    buf.set(typeBytes, 0);
    buf[typeBytes.length] = 58;
    buf.set(this.hashResult, typeBytes.length + 1);
    return base32Encode(buf);
  }
  toDidString() {
    return `did:${this.chunkType}:${bytesToHex(this.hashResult)}`;
  }
  toBytes() {
    return this.toObjId().toBytes();
  }
  toJSON() {
    return this.toString();
  }
  /** For mix-* types, return the data length encoded in the prefix. */
  getLength() {
    if (this.hashResult.length === 0)
      return null;
    if (!ChunkType.isMix(this.chunkType))
      return null;
    try {
      const [len] = varintDecode(this.hashResult, 0);
      return len;
    } catch {
      return null;
    }
  }
  equalsHash(hashBytes) {
    if (this.hashResult.length !== hashBytes.length)
      return false;
    for (let i2 = 0; i2 < this.hashResult.length; i2++) {
      if (this.hashResult[i2] !== hashBytes[i2])
        return false;
    }
    return true;
  }
}
class NamedObjectBase {
  genObjId() {
    return buildNamedObjectByJson(this.getObjType(), this.toJSON());
  }
}
function buildObjId(objType, objJsonStr) {
  const hash = sha256Utf8(objJsonStr);
  return ObjId.fromRaw(objType, hash);
}
function buildNamedObjectByJson(objType, jsonValue) {
  const jsonStr = toCanonicalJsonString(jsonValue);
  const objId = buildObjId(objType, jsonStr);
  return [objId, jsonStr];
}
function verifyNamedObject(objId, jsonValue) {
  const [objId2] = buildNamedObjectByJson(objId.objType, jsonValue);
  return objId.equals(objId2);
}
function verifyNamedObjectFromStr(objId, objStr) {
  let parsed;
  try {
    parsed = JSON.parse(objStr);
  } catch (e2) {
    throw new NdnError("InvalidId", `failed to parse obj_str: ${e2.message}`);
  }
  if (!verifyNamedObject(objId, parsed)) {
    throw new NdnError("InvalidId", `verify named object failed: ${objStr}`);
  }
  return parsed;
}
function loadNamedObjectFromObjStr(objStr) {
  if (objStr.indexOf("{") >= 0) {
    try {
      return JSON.parse(objStr);
    } catch (e2) {
      throw new NdnError("InvalidId", `failed to parse obj_str: ${e2.message}`);
    }
  }
  throw new NdnError(
    "Unsupported",
    "JWT-encoded named objects are not supported in this TypeScript port"
  );
}
function loadNamedObj(objStr) {
  return loadNamedObjectFromObjStr(objStr);
}
function loadNamedObjAndVerify(objId, objStr) {
  const parsed = loadNamedObjectFromObjStr(objStr);
  if (!verifyNamedObject(objId, parsed)) {
    throw new NdnError("InvalidId", `verify named object failed for obj_id: ${objId.toString()}`);
  }
  return parsed;
}
function extractObjIdByPath(jsonValue, path) {
  const parts = path.split("/").filter((p2) => p2.length > 0);
  let cursor = jsonValue;
  for (const p2 of parts) {
    if (cursor == null) {
      throw new NdnError("InvalidParam", `objid path not found: ${path}`);
    }
    if (Array.isArray(cursor)) {
      const idx = Number(p2);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cursor.length) {
        throw new NdnError("InvalidParam", `objid path not found: ${path}`);
      }
      cursor = cursor[idx];
    } else if (typeof cursor === "object") {
      if (!(p2 in cursor)) {
        throw new NdnError("InvalidParam", `objid path not found: ${path}`);
      }
      cursor = cursor[p2];
    } else {
      throw new NdnError("InvalidParam", `objid path not found: ${path}`);
    }
  }
  try {
    return ObjId.fromValue(cursor);
  } catch (e2) {
    throw new NdnError("InvalidData", `invalid objid at path ${path}: ${e2.message}`);
  }
}
class BaseContentObject {
  constructor(fields = {}) {
    this.did = fields.did ?? null;
    this.name = fields.name ?? "";
    this.author = fields.author ?? "";
    this.owner = fields.owner ?? "";
    this.create_time = fields.create_time ?? 0;
    this.last_update_time = fields.last_update_time ?? 0;
    this.copyright = fields.copyright ?? null;
    this.tags = fields.tags ?? [];
    this.categories = fields.categories ?? [];
    this.base_on = fields.base_on ?? null;
    this.directory = fields.directory ?? {};
    this.references = fields.references ?? {};
    this.exp = fields.exp ?? 0;
  }
  /** Build the JSON object using the same skip rules as Rust serde. */
  toJSON() {
    const out = {};
    if (this.did != null)
      out.did = this.did;
    if (this.name.length > 0)
      out.name = this.name;
    if (this.author.length > 0)
      out.author = this.author;
    if (this.owner.length > 0)
      out.owner = this.owner;
    out.create_time = this.create_time;
    out.last_update_time = this.last_update_time;
    if (this.copyright != null)
      out.copyright = this.copyright;
    if (this.tags.length > 0)
      out.tags = this.tags;
    if (this.categories.length > 0)
      out.categories = this.categories;
    if (this.base_on != null)
      out.base_on = this.base_on.toString();
    if (Object.keys(this.directory).length > 0)
      out.directory = this.directory;
    if (Object.keys(this.references).length > 0)
      out.references = this.references;
    if (this.exp !== 0)
      out.exp = this.exp;
    return out;
  }
}
function nowSeconds() {
  return Math.floor(Date.now() / 1e3);
}
class FileObject extends NamedObjectBase {
  constructor(name, size, content) {
    super();
    this.content_obj = new BaseContentObject({ name });
    this.size = size;
    this.content = content;
    this.meta = {};
  }
  static fromJSON(value) {
    const file = new FileObject("", 0, "");
    const base = {};
    const meta = {};
    const baseKeys = /* @__PURE__ */ new Set([
      "did",
      "name",
      "author",
      "owner",
      "create_time",
      "last_update_time",
      "copyright",
      "tags",
      "categories",
      "base_on",
      "directory",
      "references",
      "exp"
    ]);
    for (const [k2, v2] of Object.entries(value)) {
      if (k2 === "size") {
        file.size = v2 ?? 0;
      } else if (k2 === "content") {
        file.content = v2 ?? "";
      } else if (baseKeys.has(k2)) {
        if (k2 === "base_on" && typeof v2 === "string") {
          base.base_on = ObjId.fromString(v2);
        } else {
          base[k2] = v2;
        }
      } else {
        meta[k2] = v2;
      }
    }
    file.content_obj = new BaseContentObject(base);
    file.meta = meta;
    return file;
  }
  getObjType() {
    return OBJ_TYPE_FILE;
  }
  toJSON() {
    const out = { ...this.content_obj.toJSON() };
    if (this.size !== 0)
      out.size = this.size;
    if (this.content.length > 0)
      out.content = this.content;
    for (const [k2, v2] of Object.entries(this.meta)) {
      out[k2] = v2;
    }
    return out;
  }
}
class PathObject extends NamedObjectBase {
  constructor(path, target, uptime, exp) {
    super();
    const now = nowSeconds();
    this.path = path;
    this.target = target;
    this.uptime = uptime ?? now;
    this.exp = exp ?? now + 3600 * 24 * 365 * 3;
  }
  static fromJSON(value) {
    const path = String(value.path ?? "");
    const target = ObjId.fromString(String(value.target ?? ""));
    const uptime = Number(value.uptime ?? 0);
    const exp = Number(value.exp ?? 0);
    return new PathObject(path, target, uptime, exp);
  }
  getObjType() {
    return OBJ_TYPE_PATH;
  }
  toJSON() {
    return {
      path: this.path,
      uptime: this.uptime,
      target: this.target.toString(),
      exp: this.exp
    };
  }
}
class InclusionProof extends NamedObjectBase {
  constructor(contentId, contentObj, curator, rank, collection) {
    super();
    const now = nowSeconds();
    this.content_id = contentId.toString();
    this.content_obj = contentObj;
    this.curator = curator;
    this.editor = [];
    this.meta = null;
    this.rank = rank;
    this.collection = collection;
    this.review_url = null;
    this.iat = now;
    this.exp = now + 3600 * 24 * 30 * 12;
  }
  /**
   * Reconstruct an InclusionProof from its JSON form. The decode /
   * re-encode round-trip (fromJSON followed by toJSON) must be
   * byte-stable under canonical JSON, otherwise ObjId verification on a
   * payload produced by the Rust reference impl would drift. That is
   * exactly what the tests under `tests/ndn_types_cases.ts` pin down.
   *
   * Notes on the field mapping:
   *   - `content_id` is passed through ObjId.fromString for validation,
   *     then pinned back to the raw input string so any non-hex-canonical
   *     forms survive the round-trip unchanged (the Rust side doesn't
   *     renormalize on deserialization either).
   *   - `iat` / `exp` must come from the payload, not from the
   *     constructor's `nowSeconds()` defaults, or decoding an older
   *     proof would silently rewrite its validity window.
   */
  static fromJSON(value) {
    const proof = new InclusionProof(
      ObjId.fromString(String(value.content_id ?? "")),
      value.content_obj ?? null,
      String(value.curator ?? ""),
      Number(value.rank ?? 0),
      Array.isArray(value.collection) ? value.collection.slice() : []
    );
    proof.content_id = String(value.content_id ?? "");
    proof.editor = Array.isArray(value.editor) ? value.editor.slice() : [];
    proof.meta = value.meta ?? null;
    proof.review_url = typeof value.review_url === "string" ? value.review_url : null;
    proof.iat = Number(value.iat ?? 0);
    proof.exp = Number(value.exp ?? 0);
    return proof;
  }
  getObjType() {
    return OBJ_TYPE_INCLUSION_PROOF;
  }
  toJSON() {
    const out = {
      content_id: this.content_id,
      content_obj: this.content_obj,
      curator: this.curator,
      editor: this.editor,
      meta: this.meta,
      rank: this.rank,
      iat: this.iat,
      exp: this.exp
    };
    if (this.collection.length > 0)
      out.collection = this.collection;
    if (this.review_url != null)
      out.review_url = this.review_url;
    return out;
  }
}
const SimpleMapItem = {
  fromObjId(objId) {
    return { kind: "objId", objId };
  },
  fromObject(objType, obj) {
    return { kind: "object", objType, obj };
  },
  fromObjectJwt(objType, jwt) {
    return { kind: "objectJwt", objType, jwt };
  },
  getObjType(item) {
    switch (item.kind) {
      case "objId":
        return item.objId.objType;
      case "object":
        return item.objType;
      case "objectJwt":
        return item.objType;
    }
  },
  /** Compute (objId, optional inline obj-string) for this item. */
  getObjId(item) {
    switch (item.kind) {
      case "objId":
        return [item.objId, ""];
      case "object":
        return buildNamedObjectByJson(item.objType, item.obj);
      case "objectJwt":
        throw new NdnError(
          "Unsupported",
          "JWT-encoded SimpleMapItem requires JWT decoding (not implemented in TS port)"
        );
    }
  },
  toJSON(item) {
    switch (item.kind) {
      case "objId":
        return item.objId.toString();
      case "object":
        return { obj_type: item.objType, body: item.obj };
      case "objectJwt":
        return { obj_type: item.objType, jwt: item.jwt };
    }
  },
  fromJSON(value) {
    if (typeof value === "string") {
      return { kind: "objId", objId: ObjId.fromString(value) };
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const v2 = value;
      const objType = v2.obj_type;
      if (typeof objType !== "string") {
        throw new NdnError("InvalidData", "SimpleMapItem must have obj_type field");
      }
      if (typeof v2.jwt === "string") {
        return { kind: "objectJwt", objType, jwt: v2.jwt };
      }
      if ("body" in v2) {
        return { kind: "object", objType, obj: v2.body };
      }
      throw new NdnError("InvalidData", "SimpleMapItem must have body or jwt field");
    }
    throw new NdnError("InvalidData", "SimpleMapItem must be string or object");
  }
};
class SimpleObjectMap {
  constructor() {
    this.body = /* @__PURE__ */ new Map();
  }
  static fromJSON(value) {
    const map = new SimpleObjectMap();
    if (!value || typeof value !== "object") {
      throw new NdnError("InvalidData", "SimpleObjectMap must be an object");
    }
    const root = value;
    const body = root.body;
    if (body == null)
      return map;
    if (typeof body !== "object" || Array.isArray(body)) {
      throw new NdnError("InvalidData", "SimpleObjectMap.body must be an object");
    }
    for (const [k2, v2] of Object.entries(body)) {
      map.body.set(k2, SimpleMapItem.fromJSON(v2));
    }
    return map;
  }
  /**
   * Resolve every entry to its ObjId string and merge it into `realObj` as
   * the `body` field, then derive a NamedObject ObjId. Matches
   * SimpleObjectMap::gen_obj_id_with_real_obj() in Rust.
   */
  genObjIdWithRealObj(resultObjType, realObj) {
    const realMap = {};
    for (const [k2, v2] of this.body) {
      const [subId] = SimpleMapItem.getObjId(v2);
      realMap[k2] = subId.toString();
    }
    realObj.body = realMap;
    return buildNamedObjectByJson(resultObjType, realObj);
  }
  get size() {
    return this.body.size;
  }
  isEmpty() {
    return this.body.size === 0;
  }
  get(key) {
    return this.body.get(key);
  }
  set(key, value) {
    this.body.set(key, value);
  }
  delete(key) {
    return this.body.delete(key);
  }
  has(key) {
    return this.body.has(key);
  }
  keys() {
    return this.body.keys();
  }
  values() {
    return this.body.values();
  }
  entries() {
    return this.body.entries();
  }
  /** Serialize to wire JSON (matches Rust SimpleObjectMap serde). */
  toJSON() {
    const body = {};
    for (const [k2, v2] of this.body) {
      body[k2] = SimpleMapItem.toJSON(v2);
    }
    return { body };
  }
}
class DirObject extends NamedObjectBase {
  constructor(name) {
    super();
    this.content_obj = name != null ? new BaseContentObject({ name }) : new BaseContentObject();
    this.meta = {};
    this.total_size = 0;
    this.file_count = 0;
    this.file_size = 0;
    this.object_map = new SimpleObjectMap();
  }
  static fromJSON(value) {
    const dir = new DirObject();
    const baseKeys = /* @__PURE__ */ new Set([
      "did",
      "name",
      "author",
      "owner",
      "create_time",
      "last_update_time",
      "copyright",
      "tags",
      "categories",
      "base_on",
      "directory",
      "references",
      "exp"
    ]);
    const baseFields = {};
    for (const [k2, v2] of Object.entries(value)) {
      if (k2 === "meta") {
        dir.meta = v2 ?? {};
      } else if (k2 === "total_size") {
        dir.total_size = Number(v2 ?? 0);
      } else if (k2 === "file_count") {
        dir.file_count = Number(v2 ?? 0);
      } else if (k2 === "file_size") {
        dir.file_size = Number(v2 ?? 0);
      } else if (k2 === "body") {
        const body = v2;
        if (body) {
          for (const [name, item] of Object.entries(body)) {
            dir.object_map.set(name, SimpleMapItem.fromJSON(item));
          }
        }
      } else if (baseKeys.has(k2)) {
        if (k2 === "base_on" && typeof v2 === "string") {
          baseFields.base_on = ObjId.fromString(v2);
        } else {
          baseFields[k2] = v2;
        }
      }
    }
    dir.content_obj = new BaseContentObject(baseFields);
    return dir;
  }
  getObjType() {
    return OBJ_TYPE_DIR;
  }
  /** JSON form (with raw `body`) - useful for storage / debug. */
  toJSON() {
    const out = { ...this.content_obj.toJSON() };
    if (Object.keys(this.meta).length > 0)
      out.meta = this.meta;
    out.total_size = this.total_size;
    out.file_count = this.file_count;
    out.file_size = this.file_size;
    out.body = this.object_map.toJSON().body;
    return out;
  }
  /**
   * DirObject's ObjId is derived from a JSON form whose `body` field is a
   * `name -> objIdString` map (children are reduced to ObjIds first).
   * Matches DirObject::gen_obj_id() in Rust.
   */
  genObjId() {
    const realObj = { ...this.content_obj.toJSON() };
    realObj.total_size = this.total_size;
    realObj.file_count = this.file_count;
    realObj.file_size = this.file_size;
    return this.object_map.genObjIdWithRealObj(OBJ_TYPE_DIR, realObj);
  }
  get size() {
    return this.object_map.size;
  }
  isEmpty() {
    return this.object_map.isEmpty();
  }
  get(key) {
    return this.object_map.get(key);
  }
  delete(key) {
    return this.object_map.delete(key);
  }
  has(key) {
    return this.object_map.has(key);
  }
  keys() {
    return this.object_map.keys();
  }
  values() {
    return this.object_map.values();
  }
  entries() {
    return this.object_map.entries();
  }
  addFile(name, fileObj, fileSize) {
    this.file_size += fileSize;
    this.file_count += 1;
    this.total_size += fileSize;
    this.object_map.set(name, SimpleMapItem.fromObject(OBJ_TYPE_FILE, fileObj));
  }
  addDirectory(name, dirObjId, dirSize) {
    if (dirObjId.objType !== OBJ_TYPE_DIR) {
      throw new NdnError("InvalidParam", "dir_obj_id is not a directory");
    }
    this.total_size += dirSize;
    this.object_map.set(name, SimpleMapItem.fromObjId(dirObjId));
  }
  listEntries() {
    return Array.from(this.object_map.keys());
  }
  isFile(name) {
    const item = this.object_map.get(name);
    if (!item)
      return false;
    return item.kind === "object" && item.objType === OBJ_TYPE_FILE;
  }
  isDirectory(name) {
    const item = this.object_map.get(name);
    if (!item)
      return false;
    switch (item.kind) {
      case "objId":
        return item.objId.objType === OBJ_TYPE_DIR;
      case "objectJwt":
        return item.objType === OBJ_TYPE_DIR;
      default:
        return false;
    }
  }
}
class SimpleChunkList {
  constructor() {
    this.total_size = 0;
    this.body = [];
  }
  static fromChunkList(chunks) {
    const list = new SimpleChunkList();
    for (const c2 of chunks) {
      const len = c2.getLength();
      if (len == null) {
        throw new NdnError("InvalidParam", "get chunk length from chunkid failed");
      }
      list.total_size += len;
    }
    list.body = chunks.slice();
    return list;
  }
  static fromJson(objStr) {
    let parsed;
    try {
      parsed = JSON.parse(objStr);
    } catch (e2) {
      throw new NdnError(
        "InvalidParam",
        `parse chunk list from json failed: ${e2.message}`
      );
    }
    return SimpleChunkList.fromJsonValue(parsed);
  }
  static fromJsonValue(value) {
    if (!Array.isArray(value)) {
      throw new NdnError("InvalidParam", "chunk list must be a JSON array");
    }
    const chunks = value.map((item) => {
      if (typeof item !== "string") {
        throw new NdnError("InvalidParam", "chunk list item must be a string");
      }
      return ChunkId.fromString(item);
    });
    return SimpleChunkList.fromChunkList(chunks);
  }
  appendChunk(chunkId) {
    const len = chunkId.getLength();
    if (len == null) {
      throw new NdnError("InvalidParam", "get chunk length from chunkid failed");
    }
    this.body.push(chunkId);
    this.total_size += len;
  }
  /**
   * Mirrors SimpleChunkList::gen_obj_id(): hash the JSON list of ChunkId
   * strings, then prefix the resulting hash bytes with varint(total_size)
   * to form the final ObjId.
   */
  genObjId() {
    const bodyJson = this.body.map((c2) => c2.toString());
    const [innerObjId, objStr] = buildNamedObjectByJson(
      OBJ_TYPE_CHUNK_LIST_SIMPLE,
      bodyJson
    );
    const mixed = ChunkId.mixLengthAndHashResult(this.total_size, innerObjId.objHash);
    const resultId = ObjId.fromRaw(OBJ_TYPE_CHUNK_LIST_SIMPLE, mixed);
    return [resultId, objStr];
  }
}
class RelationObject extends NamedObjectBase {
  constructor(source, relation, target, body = {}) {
    super();
    this.source = source;
    this.relation = relation;
    this.target = target;
    this.body = body;
    this.iat = null;
    this.exp = null;
  }
  /**
   * Reconstruct a RelationObject from its JSON form. `source`, `relation`,
   * `target`, `iat` and `exp` are reserved top-level fields; every other
   * key lands back in `body` (matching what `toJSON` spreads out), so the
   * decode → re-encode round-trip is byte-stable under canonical JSON
   * for any shape the TS class is capable of emitting.
   */
  static fromJSON(value) {
    const reserved = /* @__PURE__ */ new Set(["source", "relation", "target", "iat", "exp"]);
    const body = {};
    for (const [k2, v2] of Object.entries(value)) {
      if (!reserved.has(k2))
        body[k2] = v2;
    }
    const rel = new RelationObject(
      ObjId.fromString(String(value.source ?? "")),
      String(value.relation ?? ""),
      ObjId.fromString(String(value.target ?? "")),
      body
    );
    rel.iat = typeof value.iat === "number" ? value.iat : null;
    rel.exp = typeof value.exp === "number" ? value.exp : null;
    return rel;
  }
  static createByLinkData(source, link) {
    switch (link.kind) {
      case "sameAs":
        return new RelationObject(source, RELATION_TYPE_SAME, link.target);
      case "partOf":
        return new RelationObject(
          source,
          RELATION_TYPE_PART_OF,
          link.target,
          { range: { start: link.range.start, end: link.range.end } }
        );
    }
  }
  getLinkData() {
    switch (this.relation) {
      case RELATION_TYPE_SAME:
        return { kind: "sameAs", target: this.target };
      case RELATION_TYPE_PART_OF: {
        const range = this.body.range;
        if (!range || typeof range.start !== "number" || typeof range.end !== "number") {
          throw new NdnError(
            "InvalidLink",
            `invalid range: ${JSON.stringify(this.body.range)}`
          );
        }
        return {
          kind: "partOf",
          target: this.target,
          range: { start: range.start, end: range.end }
        };
      }
      default:
        throw new NdnError("InvalidLink", `invalid relation: ${this.relation}`);
    }
  }
  getObjType() {
    return OBJ_TYPE_RELATION;
  }
  toJSON() {
    const out = {
      source: this.source.toString(),
      relation: this.relation,
      target: this.target.toString()
    };
    for (const [k2, v2] of Object.entries(this.body)) {
      out[k2] = v2;
    }
    if (this.iat != null)
      out.iat = this.iat;
    if (this.exp != null)
      out.exp = this.exp;
    return out;
  }
}
const KnownStandardObject = {
  fromObjData(objId, objData) {
    switch (objId.objType) {
      case OBJ_TYPE_DIR: {
        let parsed;
        try {
          parsed = JSON.parse(objData);
        } catch (e2) {
          throw new NdnError(
            "InvalidParam",
            `parse dir object from json failed: ${e2.message}`
          );
        }
        return {
          kind: "dir",
          obj: DirObject.fromJSON(parsed),
          objStr: objData
        };
      }
      case OBJ_TYPE_FILE: {
        let parsed;
        try {
          parsed = JSON.parse(objData);
        } catch (e2) {
          throw new NdnError(
            "InvalidParam",
            `parse file object from json failed: ${e2.message}`
          );
        }
        return {
          kind: "file",
          obj: FileObject.fromJSON(parsed),
          objStr: objData
        };
      }
      case OBJ_TYPE_CHUNK_LIST_SIMPLE: {
        return {
          kind: "chunkList",
          obj: SimpleChunkList.fromJson(objData),
          objStr: objData
        };
      }
      default:
        throw new NdnError("InvalidParam", `Unknown object type: ${objId.objType}`);
    }
  },
  /** Return ObjIds (and optional inline obj-string) for the children. */
  getChildObjs(known) {
    switch (known.kind) {
      case "dir": {
        const out = [];
        for (const [, item] of known.obj.entries()) {
          const [objId, objStr] = SimpleMapItem.getObjId(item);
          out.push({ objId, objStr: objStr.length > 0 ? objStr : null });
        }
        return out;
      }
      case "file": {
        if (known.obj.content.length === 0)
          return [];
        return [{ objId: ObjId.fromString(known.obj.content), objStr: null }];
      }
      case "chunkList":
        return known.obj.body.map((c2) => ({ objId: c2.toObjId(), objStr: null }));
    }
  }
};
const _textEncoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
const _textDecoder = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;
function utf8Encode(s2) {
  if (_textEncoder)
    return _textEncoder.encode(s2);
  const out = [];
  for (let i2 = 0; i2 < s2.length; i2++) {
    let c2 = s2.charCodeAt(i2);
    if (c2 < 128) {
      out.push(c2);
    } else if (c2 < 2048) {
      out.push(192 | c2 >> 6, 128 | c2 & 63);
    } else if (c2 >= 55296 && c2 <= 56319 && i2 + 1 < s2.length) {
      const c22 = s2.charCodeAt(++i2);
      const cp = 65536 + ((c2 & 1023) << 10 | c22 & 1023);
      out.push(
        240 | cp >> 18,
        128 | cp >> 12 & 63,
        128 | cp >> 6 & 63,
        128 | cp & 63
      );
    } else {
      out.push(224 | c2 >> 12, 128 | c2 >> 6 & 63, 128 | c2 & 63);
    }
  }
  return new Uint8Array(out);
}
function utf8Decode(bytes) {
  if (_textDecoder)
    return _textDecoder.decode(bytes);
  let s2 = "";
  let i2 = 0;
  while (i2 < bytes.length) {
    const b2 = bytes[i2++];
    if (b2 < 128) {
      s2 += String.fromCharCode(b2);
    } else if (b2 < 224) {
      s2 += String.fromCharCode((b2 & 31) << 6 | bytes[i2++] & 63);
    } else if (b2 < 240) {
      s2 += String.fromCharCode(
        (b2 & 15) << 12 | (bytes[i2++] & 63) << 6 | bytes[i2++] & 63
      );
    } else {
      const cp = (b2 & 7) << 18 | (bytes[i2++] & 63) << 12 | (bytes[i2++] & 63) << 6 | bytes[i2++] & 63;
      const u2 = cp - 65536;
      s2 += String.fromCharCode(55296 + (u2 >> 10), 56320 + (u2 & 1023));
    }
  }
  return s2;
}
const ndn_types = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  BaseContentObject,
  ChunkId,
  ChunkType,
  DEFAULT_HASH_METHOD,
  DirObject,
  FileObject,
  HashMethod,
  InclusionProof,
  KnownStandardObject,
  NamedObjectBase,
  NdnError,
  OBJ_TYPE_ACTION,
  OBJ_TYPE_CHUNK_LIST,
  OBJ_TYPE_CHUNK_LIST_FIX_SIZE,
  OBJ_TYPE_CHUNK_LIST_SIMPLE,
  OBJ_TYPE_CHUNK_LIST_SIMPLE_FIX_SIZE,
  OBJ_TYPE_DIR,
  OBJ_TYPE_FILE,
  OBJ_TYPE_INCLUSION_PROOF,
  OBJ_TYPE_LIST,
  OBJ_TYPE_LIST_SIMPLE,
  OBJ_TYPE_MSG,
  OBJ_TYPE_MSG_RECE,
  OBJ_TYPE_OBJMAP,
  OBJ_TYPE_OBJMAP_SIMPLE,
  OBJ_TYPE_PACK,
  OBJ_TYPE_PATH,
  OBJ_TYPE_PKG,
  OBJ_TYPE_RELATION,
  OBJ_TYPE_TRIE,
  OBJ_TYPE_TRIE_SIMPLE,
  ObjId,
  PathObject,
  RELATION_TYPE_PART_OF,
  RELATION_TYPE_SAME,
  RelationObject,
  SimpleChunkList,
  SimpleMapItem,
  SimpleObjectMap,
  base32Decode,
  base32Encode,
  buildNamedObjectByJson,
  buildObjId,
  bytesToHex,
  canonicalizeJson,
  extractObjIdByPath,
  hexToBytes,
  loadNamedObj,
  loadNamedObjAndVerify,
  loadNamedObjectFromObjStr,
  sha256Bytes,
  sha256Utf8,
  toCanonicalJsonString,
  varintDecode,
  varintEncode,
  verifyNamedObject,
  verifyNamedObjectFromStr
}, Symbol.toStringTag, { value: "Module" }));
class NdmError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.code = code;
    this.name = "NdmError";
  }
}
class NdmStoreApiError extends Error {
  constructor(status, errorCode, message, responseBody) {
    super(message ?? `NDM store API request failed with status ${status}`);
    this.name = "NdmStoreApiError";
    this.status = status;
    this.errorCode = errorCode;
    this.responseBody = responseBody;
  }
}
const DEFAULT_CHUNK_SIZE = 32 * 1024 * 1024;
const sessionRegistry = /* @__PURE__ */ new Map();
let sessionCounter = 0;
function generateSessionId() {
  sessionCounter += 1;
  return `import-${Date.now()}-${sessionCounter}`;
}
const browserProvider = {
  getCapabilities() {
    return {
      canRevealRealPath: false,
      canUseNDMCache: false,
      canUseNDMStore: false,
      canPickDirectory: typeof HTMLInputElement !== "undefined" && "webkitdirectory" in HTMLInputElement.prototype,
      canPickMixed: false
    };
  },
  pickFiles(options) {
    return new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      if (options.mode === "single_dir") {
        if (!this.getCapabilities().canPickDirectory) {
          reject(new NdmError("DIRECTORY_NOT_SUPPORTED", "This browser does not support directory selection"));
          return;
        }
        input.webkitdirectory = true;
      } else if (options.mode === "multi_file" || options.mode === "mixed") {
        input.multiple = true;
      }
      if (options.accept && options.accept.length > 0 && options.mode !== "single_dir") {
        input.accept = options.accept.join(",");
      }
      let settled = false;
      input.addEventListener("change", () => {
        if (settled)
          return;
        settled = true;
        const files = input.files;
        if (!files || files.length === 0) {
          reject(new NdmError("USER_CANCELLED", "No files selected"));
          return;
        }
        resolve(Array.from(files));
      });
      const onFocus = () => {
        setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(new NdmError("USER_CANCELLED", "User cancelled file selection"));
          }
          window.removeEventListener("focus", onFocus);
        }, 500);
      };
      window.addEventListener("focus", onFocus);
      input.click();
    });
  }
};
let currentProvider = browserProvider;
function setImportProvider(provider) {
  currentProvider = provider;
}
function getImportProvider() {
  return currentProvider;
}
function defaultStoreFetcher(input, init) {
  if (typeof window !== "undefined" && typeof window.fetch === "function") {
    return window.fetch(input, init);
  }
  if (typeof globalThis !== "undefined" && typeof globalThis.fetch === "function") {
    return globalThis.fetch(input, init);
  }
  throw new Error("fetch is not available in this runtime");
}
function normalizeEndpoint(endpoint) {
  return endpoint.replace(/\/+$/, "");
}
function ensureStoreApiSupportedRuntime() {
  if (getActiveRuntimeType() === RuntimeType.Browser) {
    throw new NdmError(
      "STORE_API_NOT_SUPPORTED_IN_RUNTIME",
      "NDM structured store APIs are not available in pure Browser runtime"
    );
  }
}
function resolveStoreEndpoint(options) {
  if (options == null ? void 0 : options.endpoint) {
    return normalizeEndpoint(options.endpoint);
  }
  const activeOrigin = getActiveZoneGatewayOrigin();
  if (activeOrigin) {
    return normalizeEndpoint(activeOrigin);
  }
  throw new NdmError(
    "STORE_API_ENDPOINT_REQUIRED",
    "NDM structured store endpoint is unknown; pass options.endpoint or call initBuckyOS first"
  );
}
async function callStoreApi(methodName, requestBody, options) {
  var _a;
  ensureStoreApiSupportedRuntime();
  const endpoint = resolveStoreEndpoint(options);
  const fetcher = (options == null ? void 0 : options.fetcher) ?? defaultStoreFetcher;
  const sessionToken = (options == null ? void 0 : options.sessionToken) !== void 0 ? options.sessionToken : await getActiveSessionToken();
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(options == null ? void 0 : options.headers) ?? {}
  };
  if (sessionToken && !headers.Authorization) {
    headers.Authorization = `Bearer ${sessionToken}`;
  }
  const response = await fetcher(`${endpoint}/ndm/v1/store/${methodName}`, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
    credentials: (options == null ? void 0 : options.credentials) ?? "include"
  });
  if (response.status === 204) {
    await ((_a = response.body) == null ? void 0 : _a.cancel());
    return void 0;
  }
  const contentType = response.headers.get("content-type") ?? "";
  const isJsonResponse = contentType.includes("application/json");
  const responseBody = isJsonResponse ? await response.json() : await response.text();
  if (!response.ok) {
    const errorBody = responseBody && typeof responseBody === "object" && !Array.isArray(responseBody) ? responseBody : null;
    throw new NdmStoreApiError(
      response.status,
      errorBody == null ? void 0 : errorBody.error,
      (errorBody == null ? void 0 : errorBody.message) ?? (typeof responseBody === "string" && responseBody.length > 0 ? responseBody : `NDM store API request failed with status ${response.status}`),
      responseBody
    );
  }
  return responseBody;
}
async function getObject(request, options) {
  return callStoreApi("get_object", request, options);
}
async function openObject(request, options) {
  return callStoreApi("open_object", request, options);
}
async function getDirChild(request, options) {
  return callStoreApi("get_dir_child", request, options);
}
async function isObjectStored(request, options) {
  return callStoreApi("is_object_stored", request, options);
}
async function isObjectExist(request, options) {
  return callStoreApi("is_object_exist", request, options);
}
async function queryObjectById(request, options) {
  return callStoreApi("query_object_by_id", request, options);
}
async function putObject(request, options) {
  return callStoreApi("put_object", request, options);
}
async function removeObject(request, options) {
  return callStoreApi("remove_object", request, options);
}
async function haveChunk(request, options) {
  return callStoreApi("have_chunk", request, options);
}
async function queryChunkState(request, options) {
  return callStoreApi("query_chunk_state", request, options);
}
async function removeChunk(request, options) {
  return callStoreApi("remove_chunk", request, options);
}
async function addChunkBySameAs(request, options) {
  return callStoreApi("add_chunk_by_same_as", request, options);
}
async function applyEdge(request, options) {
  return callStoreApi("apply_edge", request, options);
}
async function pin(request, options) {
  return callStoreApi("pin", request, options);
}
async function unpin(request, options) {
  return callStoreApi("unpin", request, options);
}
async function unpinOwner(request, options) {
  return callStoreApi("unpin_owner", request, options);
}
async function fsAcquire(request, options) {
  return callStoreApi("fs_acquire", request, options);
}
async function fsRelease(request, options) {
  return callStoreApi("fs_release", request, options);
}
async function fsReleaseInode(request, options) {
  return callStoreApi("fs_release_inode", request, options);
}
async function fsAnchorState(request, options) {
  return callStoreApi("fs_anchor_state", request, options);
}
async function forcedGcUntil(request, options) {
  return callStoreApi("forced_gc_until", request, options);
}
async function outboxCount(options) {
  return callStoreApi("outbox_count", {}, options);
}
async function debugDumpExpandState(request, options) {
  return callStoreApi("debug_dump_expand_state", request, options);
}
async function anchorState(request, options) {
  return callStoreApi("anchor_state", request, options);
}
async function materializeFile(file, chunkSize = DEFAULT_CHUNK_SIZE) {
  const fileSize = file.size;
  const chunks = [];
  if (fileSize <= chunkSize) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const hash = sha256Bytes(buf);
    const chunkId = ChunkId.fromMix256Result(buf.length, hash);
    const chunkIdStr = chunkId.toString();
    chunks.push({ chunkId: chunkIdStr, offset: 0, length: buf.length, uploaded: false });
    const fileObj2 = new FileObject(file.name, fileSize, chunkIdStr);
    const [objId2] = fileObj2.genObjId();
    return { objectId: objId2.toString(), chunks };
  }
  const chunkList = new SimpleChunkList();
  let offset = 0;
  while (offset < fileSize) {
    const end = Math.min(offset + chunkSize, fileSize);
    const slice = new Uint8Array(await file.slice(offset, end).arrayBuffer());
    const hash = sha256Bytes(slice);
    const chunkId = ChunkId.fromMix256Result(slice.length, hash);
    chunkList.appendChunk(chunkId);
    chunks.push({ chunkId: chunkId.toString(), offset, length: slice.length, uploaded: false });
    offset = end;
  }
  const [chunkListObjId] = chunkList.genObjId();
  const fileObj = new FileObject(file.name, fileSize, chunkListObjId.toString());
  const [objId] = fileObj.genObjId();
  return { objectId: objId.toString(), chunks };
}
function buildDirTree(files, fileObjects) {
  const firstPath = files[0].webkitRelativePath;
  const rootName = firstPath ? firstPath.split("/")[0] : "directory";
  const root = {
    kind: "dir",
    objectId: "",
    // will be computed later
    name: rootName,
    children: []
  };
  const dirMap = /* @__PURE__ */ new Map();
  dirMap.set("", root);
  for (const fileObj of fileObjects) {
    const relPath = fileObj.relativePath ?? fileObj.name;
    const parts = relPath.split("/");
    const pathParts = parts.length > 1 ? parts.slice(1) : parts;
    let currentDir = root;
    for (let i2 = 0; i2 < pathParts.length - 1; i2++) {
      const dirName = pathParts[i2];
      const dirPath = pathParts.slice(0, i2 + 1).join("/");
      let dir = dirMap.get(dirPath);
      if (!dir) {
        dir = {
          kind: "dir",
          objectId: "",
          name: dirName,
          relativePath: dirPath,
          children: []
        };
        dirMap.set(dirPath, dir);
        currentDir.children.push(dir);
      }
      currentDir = dir;
    }
    currentDir.children.push(fileObj);
  }
  computeDirObjectIds(root);
  return root;
}
function computeDirObjectIds(dir) {
  const ndnDir = new DirObject(dir.name);
  if (dir.children) {
    for (const child of dir.children) {
      if (child.kind === "file") {
        const fileObj = new FileObject(child.name, child.size, "");
        ndnDir.addFile(child.name, fileObj.toJSON(), child.size);
      } else {
        const childObjId = computeDirObjectIds(child);
        ndnDir.addDirectory(child.name, ObjId.fromString(childObjId), 0);
      }
    }
  }
  const [objId] = ndnDir.genObjId();
  dir.objectId = objId.toString();
  return dir.objectId;
}
function shouldGenerateThumbnail(file, options) {
  if (!options || !options.enabled)
    return false;
  if (!options.forTypes || options.forTypes.length === 0) {
    return file.type.startsWith("image/");
  }
  for (const filter of options.forTypes) {
    if (filter.endsWith("/*")) {
      const prefix = filter.slice(0, -1);
      if (file.type.startsWith(prefix))
        return true;
    } else if (filter.startsWith(".")) {
      if (file.name.toLowerCase().endsWith(filter.toLowerCase()))
        return true;
    } else {
      if (file.type === filter)
        return true;
    }
  }
  return false;
}
async function generateThumbnail(file, options) {
  const maxWidth = options.maxWidth ?? 256;
  const maxHeight = options.maxHeight ?? 256;
  try {
    if (file.type.startsWith("image/")) {
      return await generateImageThumbnail(file, maxWidth, maxHeight);
    }
    return { available: false, errorCode: "UNSUPPORTED_TYPE" };
  } catch {
    return { available: false, errorCode: "THUMBNAIL_GENERATION_FAILED" };
  }
}
function generateImageThumbnail(file, maxWidth, maxHeight) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let w2 = img.naturalWidth;
      let h2 = img.naturalHeight;
      if (w2 > maxWidth || h2 > maxHeight) {
        const scale = Math.min(maxWidth / w2, maxHeight / h2);
        w2 = Math.round(w2 * scale);
        h2 = Math.round(h2 * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w2;
      canvas.height = h2;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w2, h2);
      const thumbUrl = canvas.toDataURL("image/jpeg", 0.8);
      URL.revokeObjectURL(url);
      resolve({ available: true, url: thumbUrl, width: w2, height: h2, mimeType: "image/jpeg" });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ available: false, errorCode: "THUMBNAIL_GENERATION_FAILED" });
    };
    img.src = url;
  });
}
function collectSummary(items) {
  let totalFiles = 0;
  let totalDirs = 0;
  let totalBytes = 0;
  function walk(list) {
    for (const item of list) {
      if (item.kind === "file") {
        totalFiles++;
        totalBytes += item.size;
      } else {
        totalDirs++;
        if (item.children)
          walk(item.children);
      }
    }
  }
  walk(items);
  return { totalObjects: totalFiles + totalDirs, totalFiles, totalDirs, totalBytes };
}
async function pickupAndImport(options) {
  var _a;
  const caps = currentProvider.getCapabilities();
  if (options.mode === "single_dir" && !caps.canPickDirectory) {
    throw new NdmError("DIRECTORY_NOT_SUPPORTED", "Current runtime does not support directory selection");
  }
  if (options.mode === "mixed" && !caps.canPickMixed) {
    throw new NdmError("MODE_NOT_SUPPORTED_IN_RUNTIME", "Current runtime does not support mixed file/directory selection");
  }
  const files = await currentProvider.pickFiles(options);
  if (files.length === 0) {
    throw new NdmError("USER_CANCELLED", "No files selected");
  }
  const fileObjects = [];
  const objectStates = /* @__PURE__ */ new Map();
  for (const file of files) {
    const relativePath = file.webkitRelativePath || void 0;
    const { objectId, chunks } = await materializeFile(file);
    const imported = {
      kind: "file",
      objectId,
      name: file.name,
      size: file.size,
      mimeType: file.type || void 0,
      relativePath,
      locality: "local_only",
      _file: file
    };
    if (shouldGenerateThumbnail(file, options.thumbnails)) {
      const eager = ((_a = options.thumbnails) == null ? void 0 : _a.eager) !== false;
      if (eager) {
        imported.thumbnail = await generateThumbnail(file, options.thumbnails);
      } else {
        imported.thumbnail = { available: false };
        generateThumbnail(file, options.thumbnails).then((result) => {
          imported.thumbnail = result;
        });
      }
    }
    fileObjects.push(imported);
    objectStates.set(objectId, {
      objectId,
      name: file.name,
      size: file.size,
      file,
      uploadedBytes: 0,
      state: "pending",
      chunks
    });
  }
  let items;
  let selection;
  if (options.mode === "single_dir") {
    const dirObj = buildDirTree(files, fileObjects);
    items = [dirObj];
    selection = dirObj;
  } else {
    items = fileObjects;
    if (options.mode === "single_file") {
      selection = fileObjects[0];
    } else {
      selection = fileObjects;
    }
  }
  const summary = collectSummary(items);
  const sessionId = generateSessionId();
  let materializationStatus = "ok";
  if (caps.canUseNDMStore) {
    materializationStatus = "all_in_store";
  } else if (caps.canUseNDMCache) {
    materializationStatus = "on_cache";
  }
  const uploadStatus = materializationStatus === "all_in_store" ? "not_required" : "not_started";
  const session = {
    sessionId,
    items,
    materializationStatus,
    uploadStatus,
    summary,
    objectStates
  };
  sessionRegistry.set(sessionId, session);
  const snapshot = {
    sessionId,
    selection,
    items,
    materializationStatus,
    uploadStatus,
    summary
  };
  if (options.autoStartUpload && uploadStatus === "not_started") {
    startUpload(sessionId).catch(() => {
    });
    snapshot.uploadStatus = "uploading";
  }
  return snapshot;
}
async function getImportSessionStatus(sessionId) {
  const session = sessionRegistry.get(sessionId);
  if (!session) {
    throw new NdmError("SESSION_NOT_FOUND", `Session ${sessionId} not found`);
  }
  const perObjectProgress = {};
  let uploadedBytes = 0;
  let uploadedObjects = 0;
  for (const [id, state] of session.objectStates) {
    perObjectProgress[id] = {
      objectId: state.objectId,
      uploadedBytes: state.uploadedBytes,
      totalBytes: state.size,
      state: state.state
    };
    uploadedBytes += state.uploadedBytes;
    if (state.state === "completed")
      uploadedObjects++;
  }
  return {
    sessionId,
    materializationStatus: session.materializationStatus,
    uploadStatus: session.uploadStatus,
    summary: session.summary,
    progress: {
      uploadedBytes,
      uploadedObjects,
      totalBytes: session.summary.totalBytes,
      totalObjects: session.summary.totalFiles
    },
    perObjectProgress
  };
}
async function getUploadProgress(sessionId) {
  const status = await getImportSessionStatus(sessionId);
  const result = {
    sessionId,
    uploadStatus: status.uploadStatus,
    totalBytes: status.progress.totalBytes,
    uploadedBytes: status.progress.uploadedBytes,
    totalObjects: status.progress.totalObjects,
    uploadedObjects: status.progress.uploadedObjects,
    perObjectProgress: status.perObjectProgress
  };
  const session = sessionRegistry.get(sessionId);
  if (session.uploadStartTime && status.uploadStatus === "uploading") {
    result.elapsedMs = Date.now() - session.uploadStartTime;
    if (result.uploadedBytes > 0 && result.elapsedMs > 0) {
      result.speedBps = Math.round(result.uploadedBytes * 1e3 / result.elapsedMs);
      const remaining = result.totalBytes - result.uploadedBytes;
      result.estimatedRemainingMs = Math.round(remaining * 1e3 / result.speedBps);
    }
  }
  return result;
}
async function uploadChunkViaTus(endpoint, file, chunkInfo, appId, logicalPath, fileHash, onProgress, signal) {
  const slice = file.slice(chunkInfo.offset, chunkInfo.offset + chunkInfo.length);
  const chunkData = new Uint8Array(await slice.arrayBuffer());
  let tus;
  try {
    tus = await import("./index-abe54758.mjs");
  } catch {
  }
  if (tus != null) {
    const tusModule = tus;
    return new Promise((resolve, reject) => {
      if (signal == null ? void 0 : signal.aborted) {
        reject(new NdmError("UPLOAD_FAILED", "Upload aborted"));
        return;
      }
      const blob = new Blob([chunkData]);
      const upload = new tusModule.Upload(blob, {
        endpoint: `${endpoint}/ndm/v1/uploads`,
        chunkSize: chunkData.length,
        retryDelays: [0, 1e3, 3e3, 5e3],
        metadata: {
          app_id: appId,
          logical_path: logicalPath,
          chunk_index: "0",
          file_hash: fileHash
        },
        onProgress: (bytesUploaded) => {
          onProgress(bytesUploaded);
        },
        onSuccess: () => {
          onProgress(chunkData.length);
          resolve(chunkInfo.chunkId);
        },
        onError: (error) => {
          reject(new NdmError("UPLOAD_FAILED", error.message));
        }
      });
      if (signal) {
        signal.addEventListener("abort", () => {
          upload.abort(true);
          reject(new NdmError("UPLOAD_FAILED", "Upload aborted"));
        });
      }
      upload.start();
    });
  }
  return await manualTusUpload(endpoint, chunkData, chunkInfo, appId, logicalPath, fileHash, onProgress, signal);
}
async function manualTusUpload(endpoint, chunkData, chunkInfo, appId, logicalPath, fileHash, onProgress, signal) {
  var _a, _b, _c, _d, _e, _f;
  const tusResumable = "1.0.0";
  const metadata = `app_id=${appId},logical_path=${logicalPath},chunk_index=0,file_hash=${fileHash}`;
  const createResp = await fetch(`${endpoint}/ndm/v1/uploads`, {
    method: "POST",
    headers: {
      "tus-resumable": tusResumable,
      "upload-length": String(chunkData.length),
      "upload-metadata": metadata
    },
    signal
  });
  if (createResp.status !== 201 && createResp.status !== 200) {
    await ((_a = createResp.body) == null ? void 0 : _a.cancel());
    throw new NdmError("UPLOAD_FAILED", `TUS create failed with status ${createResp.status}`);
  }
  const location = createResp.headers.get("location");
  if (!location) {
    await ((_b = createResp.body) == null ? void 0 : _b.cancel());
    throw new NdmError("UPLOAD_FAILED", "TUS create did not return location header");
  }
  await ((_c = createResp.body) == null ? void 0 : _c.cancel());
  const headResp = await fetch(`${endpoint}${location}`, {
    method: "HEAD",
    headers: { "tus-resumable": tusResumable },
    signal
  });
  const currentOffset = parseInt(headResp.headers.get("upload-offset") ?? "0", 10);
  await ((_d = headResp.body) == null ? void 0 : _d.cancel());
  if (currentOffset >= chunkData.length) {
    onProgress(chunkData.length);
    return chunkInfo.chunkId;
  }
  const patchResp = await fetch(`${endpoint}${location}`, {
    method: "PATCH",
    headers: {
      "tus-resumable": tusResumable,
      "upload-offset": String(currentOffset),
      "content-type": "application/offset+octet-stream"
    },
    body: chunkData.slice(currentOffset),
    signal
  });
  if (patchResp.status !== 204) {
    await ((_e = patchResp.body) == null ? void 0 : _e.cancel());
    throw new NdmError("UPLOAD_FAILED", `TUS PATCH failed with status ${patchResp.status}`);
  }
  await ((_f = patchResp.body) == null ? void 0 : _f.cancel());
  onProgress(chunkData.length);
  return chunkInfo.chunkId;
}
async function startUpload(sessionId, options) {
  const session = sessionRegistry.get(sessionId);
  if (!session) {
    throw new NdmError("SESSION_NOT_FOUND", `Session ${sessionId} not found`);
  }
  if (session.uploadStatus === "completed" || session.uploadStatus === "not_required") {
    return getImportSessionStatus(sessionId);
  }
  if (session.uploadStatus === "uploading") {
    return getImportSessionStatus(sessionId);
  }
  if (session.materializationStatus === "all_in_store") {
    session.uploadStatus = "not_required";
    return getImportSessionStatus(sessionId);
  }
  session.uploadStatus = "uploading";
  session.uploadStartTime = Date.now();
  session.abortController = new AbortController();
  const concurrency = (options == null ? void 0 : options.concurrency) ?? 3;
  let endpoint;
  if (options == null ? void 0 : options.endpoint) {
    endpoint = options.endpoint.replace(/\/+$/, "");
  } else {
    endpoint = typeof window !== "undefined" ? window.location.origin : "";
  }
  doUpload(session, endpoint, concurrency).catch(() => {
  });
  return getImportSessionStatus(sessionId);
}
async function doUpload(session, endpoint, concurrency) {
  const states = Array.from(session.objectStates.values()).filter((s2) => s2.state !== "completed");
  let running = 0;
  let idx = 0;
  let hasError = false;
  await new Promise((resolve, reject) => {
    function next() {
      if (hasError)
        return;
      if (idx >= states.length && running === 0) {
        const allCompleted = Array.from(session.objectStates.values()).every((s2) => s2.state === "completed");
        session.uploadStatus = allCompleted ? "completed" : "failed";
        resolve();
        return;
      }
      while (running < concurrency && idx < states.length) {
        const state = states[idx++];
        running++;
        uploadSingleObject(session, endpoint, state).then(() => {
          running--;
          next();
        }).catch(() => {
          running--;
          if (!hasError) {
            hasError = true;
            session.uploadStatus = "failed";
            reject(new NdmError("UPLOAD_FAILED", `Upload of ${state.name} failed`));
          }
        });
      }
    }
    next();
  });
}
async function uploadSingleObject(session, endpoint, state) {
  var _a;
  state.state = "uploading";
  for (const chunk of state.chunks) {
    if (chunk.uploaded)
      continue;
    await uploadChunkViaTus(
      endpoint,
      state.file,
      chunk,
      "default",
      state.name,
      state.objectId,
      (uploaded) => {
        const prevChunkBytes = state.chunks.filter((c2) => c2 !== chunk && c2.uploaded).reduce((sum, c2) => sum + c2.length, 0);
        state.uploadedBytes = prevChunkBytes + uploaded;
      },
      (_a = session.abortController) == null ? void 0 : _a.signal
    );
    chunk.uploaded = true;
  }
  state.uploadedBytes = state.size;
  state.state = "completed";
}
const ndm_client = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  NdmError,
  NdmStoreApiError,
  addChunkBySameAs,
  anchorState,
  applyEdge,
  debugDumpExpandState,
  forcedGcUntil,
  fsAcquire,
  fsAnchorState,
  fsRelease,
  fsReleaseInode,
  getDirChild,
  getImportProvider,
  getImportSessionStatus,
  getObject,
  getUploadProgress,
  haveChunk,
  isObjectExist,
  isObjectStored,
  openObject,
  outboxCount,
  pickupAndImport,
  pin,
  putObject,
  queryChunkState,
  queryObjectById,
  removeChunk,
  removeObject,
  setImportProvider,
  startUpload,
  unpin,
  unpinOwner
}, Symbol.toStringTag, { value: "Module" }));
export {
  AiccClient as A,
  BS_SERVICE_VERIFY_HUB as B,
  MsgQueueClient as M,
  RuntimeType as R,
  SystemConfigClient as S,
  TaskManagerClient as T,
  VerifyHubClient as V,
  WEB3_BRIDGE_HOST as W,
  ndm_client as a,
  BS_SERVICE_TASK_MANAGER as b,
  createSDKModule as c,
  getActiveZoneGatewayOrigin as d,
  getActiveSessionToken as e,
  BuckyOSSDK as f,
  getActiveRuntimeType as g,
  hashPassword as h,
  MsgCenterClient as i,
  RepoClient as j,
  ndn_types as n,
  parseSessionTokenClaims as p
};
//# sourceMappingURL=ndm_client-025d790a.mjs.map
