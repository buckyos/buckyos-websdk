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
function getLocalAccountInfo(appId) {
  const scoped = parseAccountInfo(localStorage.getItem(getAccountStorageKey(appId)));
  if (scoped != null) {
    return scoped;
  }
  const legacy = parseAccountInfo(localStorage.getItem(LEGACY_ACCOUNT_STORAGE_KEY));
  if ((legacy == null ? void 0 : legacy.session_token) && parseTokenAppId(legacy.session_token) === appId) {
    localStorage.setItem(getAccountStorageKey(appId), JSON.stringify(legacy));
    return legacy;
  }
  return null;
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
function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RPCError("Invalid RPC response format");
  }
  return value;
}
function parseTask(value) {
  const record = asRecord(value);
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
  const parsed = asRecord(value);
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
    const parsed = asRecord(result);
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
    const parsed = asRecord(result);
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
    const parsed = asRecord(result);
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
class OpenDanClient {
  constructor(rpcClient) {
    this.rpcClient = rpcClient;
  }
  setSeq(seq) {
    this.rpcClient.setSeq(seq);
  }
  async listAgents(params = {}) {
    const req = {
      status: params.status,
      include_sub_agents: params.includeSubAgents,
      limit: params.limit,
      cursor: params.cursor
    };
    return this.rpcClient.call("list_agents", req);
  }
  async getAgent(agentId) {
    const req = { agent_id: agentId };
    return this.rpcClient.call("get_agent", req);
  }
  async getWorkshop(agentId) {
    const req = { agent_id: agentId };
    return this.rpcClient.call("get_workshop", req);
  }
  async getWorkspace(agentId) {
    return this.getWorkshop(agentId);
  }
  async listWorkshopWorklogs(params) {
    const req = {
      agent_id: params.agentId,
      owner_session_id: params.ownerSessionId,
      log_type: params.logType,
      status: params.status,
      step_id: params.stepId,
      keyword: params.keyword,
      limit: params.limit,
      cursor: params.cursor
    };
    return this.rpcClient.call("list_workshop_worklogs", req);
  }
  async listWorkspaceWorklogs(params) {
    return this.listWorkshopWorklogs(params);
  }
  async listWorkshopTodos(params) {
    const req = {
      agent_id: params.agentId,
      owner_session_id: params.ownerSessionId,
      status: params.status,
      include_closed: params.includeClosed,
      limit: params.limit,
      cursor: params.cursor
    };
    return this.rpcClient.call("list_workshop_todos", req);
  }
  async listWorkspaceTodos(params) {
    return this.listWorkshopTodos(params);
  }
  async listWorkshopSubAgents(params) {
    const req = {
      agent_id: params.agentId,
      include_disabled: params.includeDisabled,
      limit: params.limit,
      cursor: params.cursor
    };
    return this.rpcClient.call("list_workshop_sub_agents", req);
  }
  async listWorkspaceSubAgents(params) {
    return this.listWorkshopSubAgents(params);
  }
  async listAgentSessions(params) {
    const req = {
      agent_id: params.agentId,
      limit: params.limit,
      cursor: params.cursor
    };
    return this.rpcClient.call("list_agent_sessions", req);
  }
  async getAgentSession(agentId, sessionId) {
    const req = {
      agent_id: agentId,
      session_id: sessionId
    };
    return this.rpcClient.call("get_agent_session", req);
  }
  async getSessionRecord(sessionId) {
    const req = {
      session_id: sessionId
    };
    return this.rpcClient.call("get_session_record", req);
  }
  async pauseSession(sessionId) {
    const req = {
      session_id: sessionId
    };
    return this.rpcClient.call("pause_session", req);
  }
  async resumeSession(sessionId) {
    const req = {
      session_id: sessionId
    };
    return this.rpcClient.call("resume_session", req);
  }
}
const CONFIG_CACHE_TIME_SECONDS = 10;
const CACHE_KEY_PREFIXES = ["services/", "system/rbac/"];
const _SystemConfigClient = class _SystemConfigClient2 {
  constructor(serviceUrl, sessionToken = null, options = {}) {
    this.rpcClient = new kRPCClient(serviceUrl, sessionToken, null, options);
  }
  needCache(key) {
    return CACHE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
  }
  getUnixTimestamp() {
    return Math.floor(Date.now() / 1e3);
  }
  getConfigCache(key) {
    const cached = _SystemConfigClient2.configCache.get(key);
    if (!cached) {
      return null;
    }
    if (cached.cachedAt + CONFIG_CACHE_TIME_SECONDS < this.getUnixTimestamp()) {
      _SystemConfigClient2.configCache.delete(key);
      return null;
    }
    return cached;
  }
  setConfigCache(key, value, version) {
    if (!this.needCache(key)) {
      return true;
    }
    const previous = _SystemConfigClient2.configCache.get(key);
    _SystemConfigClient2.configCache.set(key, {
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
    _SystemConfigClient2.configCache.delete(key);
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
};
_SystemConfigClient.configCache = /* @__PURE__ */ new Map();
let SystemConfigClient = _SystemConfigClient;
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
  getOpenDanClient() {
    const rpcClient = this.getServiceRpcClient("opendan");
    return new OpenDanClient(rpcClient);
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
const BS_SERVICE_OPENDAN = "opendan";
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
      let zoneHostName = localStorage.getItem("zone_host_name");
      if (zoneHostName) {
        finalConfig.zoneHost = zoneHostName;
      } else {
        zoneHostName = await this.tryGetZoneHostName(appid, window.location.host, finalConfig.defaultProtocol);
        localStorage.setItem("zone_host_name", zoneHostName);
        finalConfig.zoneHost = zoneHostName;
      }
    }
    (_a = this.currentRuntime) == null ? void 0 : _a.stopAutoRenew();
    this.currentRuntime = new BuckyOSRuntime(finalConfig);
    await this.currentRuntime.initialize();
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
  async loginByBrowserSSO(autoLogin = true) {
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
    if (autoLogin && isBrowserStorageAvailable()) {
      const accountInfo = getLocalAccountInfo(appId);
      if (accountInfo) {
        this.currentAccountInfo = accountInfo;
        runtime.setSessionToken(accountInfo.session_token);
        runtime.setRefreshToken(accountInfo.refresh_token ?? null);
        return;
      }
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
  async login(autoLogin = true) {
    if (this.usesRuntimeManagedSession()) {
      return this.loginByRuntimeSession();
    }
    await this.loginByBrowserSSO(autoLogin);
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
  getOpenDanClient() {
    if (this.currentRuntime == null) {
      console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
      throw new Error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    }
    return this.currentRuntime.getOpenDanClient();
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
    let zoneDocUrl = defaultProtocol + host + "/1.0/identifiers/self";
    let response = await fetch(zoneDocUrl);
    if (response.status === 200) {
      return host;
    }
    const upHost = host.split(".").slice(1).join(".");
    if (!upHost) {
      return host;
    }
    zoneDocUrl = defaultProtocol + upHost + "/1.0/identifiers/self";
    response = await fetch(zoneDocUrl);
    if (response.status === 200) {
      return upHost;
    }
    return host;
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
    getOpenDanClient: sdk.getOpenDanClient.bind(sdk)
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
export {
  BS_SERVICE_VERIFY_HUB as B,
  OpenDanClient as O,
  RuntimeType as R,
  SystemConfigClient as S,
  TaskManagerClient as T,
  VerifyHubClient as V,
  WEB3_BRIDGE_HOST as W,
  BS_SERVICE_TASK_MANAGER as a,
  BS_SERVICE_OPENDAN as b,
  createSDKModule as c,
  BuckyOSSDK as d,
  hashPassword as h,
  parseSessionTokenClaims as p
};
//# sourceMappingURL=sdk_core-ebb953e6.mjs.map
