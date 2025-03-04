class RPCError extends Error {
  constructor(message) {
    super(message);
    this.name = "RPCError";
  }
}
class kRPCClient {
  constructor(url, token = null, seq = null) {
    this.serverUrl = url;
    this.protocolType = "HttpPostJson";
    this.seq = seq ? seq : Date.now();
    this.sessionToken = token || null;
    this.initToken = token || null;
  }
  // 公开的调用方法
  async call(method, params) {
    return this._call(method, params);
  }
  setSeq(seq) {
    this.seq = seq;
  }
  async _call(method, params) {
    const currentSeq = this.seq;
    this.seq += 1;
    const requestBody = {
      method,
      params,
      sys: this.sessionToken ? [currentSeq, this.sessionToken] : [currentSeq]
    };
    try {
      const response = await window.fetch(this.serverUrl, {
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
      if (rpcResponse.sys) {
        const sys = rpcResponse.sys;
        if (!Array.isArray(sys)) {
          throw new RPCError("sys is not array");
        }
        if (sys.length > 1) {
          const responseSeq = sys[0];
          if (typeof responseSeq !== "number") {
            throw new RPCError("sys[0] is not number");
          }
          if (responseSeq !== currentSeq) {
            throw new RPCError(`seq not match: ${responseSeq}!=${currentSeq}`);
          }
        }
        if (sys.length > 2) {
          const token = sys[1];
          if (typeof token !== "string") {
            throw new RPCError("sys[1] is not string");
          }
          this.sessionToken = token;
        }
      }
      if (rpcResponse.error) {
        throw new RPCError(`RPC call error: ${rpcResponse.error}`);
      }
      return rpcResponse.result;
    } catch (error) {
      if (error instanceof RPCError) {
        throw error;
      }
      throw new RPCError(`RPC call failed: ${error.message}`);
    }
  }
}
class AuthClient {
  constructor(zone_base_url, appId) {
    this.zone_hostname = zone_base_url;
    this.clientId = appId;
    this.authWindow = null;
  }
  async login(redirect_uri = null) {
    try {
      const token = await this._openAuthWindow(redirect_uri);
      let account_info = JSON.parse(token);
      return account_info;
    } catch (error) {
      throw new Error(error || "Login failed");
    }
  }
  async request(action, params) {
  }
  async _openAuthWindow(redirect_uri = null) {
    return new Promise((resolve, reject) => {
      const width = 500;
      const height = 600;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;
      let sso_url = window.location.protocol + "//sys." + this.zone_hostname + "/login.html";
      const authUrl = `${sso_url}?client_id=${this.clientId}&redirect_uri=${encodeURIComponent(redirect_uri)}&response_type=token`;
      alert(authUrl);
      this.authWindow = window.open(authUrl, "BuckyOS Login", `width=${width},height=${height},top=${top},left=${left}`);
      window.addEventListener("message", (event) => {
        console.log("message event", event);
        if (event.origin !== new URL(sso_url).origin) {
          return;
        }
        const { token, error } = event.data;
        if (token) {
          resolve(token);
        } else {
          reject(error || "BuckyOSLogin failed");
        }
        if (this.authWindow) {
          this.authWindow.close();
        }
      }, false);
    });
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
  localStorage.removeItem("buckyos.account_info");
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
  localStorage.setItem("buckyos.account_info", JSON.stringify(account_info));
  let cookie_options = {
    path: "/",
    expires: new Date(Date.now() + 1e3 * 60 * 60 * 24 * 30),
    // 30天
    secure: true,
    sameSite: "Lax"
  };
  document.cookie = `${appId}_token=${account_info.session_token}; ${Object.entries(cookie_options).map(([key, value]) => `${key}=${value}`).join("; ")}`;
}
function getLocalAccountInfo(appId) {
  let account_info = localStorage.getItem("buckyos.account_info");
  if (account_info == null) {
    return null;
  }
  return JSON.parse(account_info);
}
async function doLogin(username, password) {
  let appId = buckyos.getAppId();
  if (appId == null) {
    console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    return null;
  }
  let login_nonce = Date.now();
  let password_hash = hashPassword(username, password, login_nonce);
  console.log("password_hash: ", password_hash);
  localStorage.removeItem("account_info");
  try {
    let rpc_client = buckyos.getServiceRpcClient(BS_SERVICE_VERIFY_HUB);
    rpc_client.setSeq(login_nonce);
    let account_info = await rpc_client.call("login", {
      type: "password",
      username,
      password: password_hash,
      appid: appId,
      source_url: window.location.href
    });
    saveLocalAccountInfo(appId, account_info);
    return account_info;
  } catch (error) {
    console.error("login failed: ", error);
    throw error;
  }
}
const BS_SERVICE_VERIFY_HUB = "verify_hub";
var _current_config = null;
var _current_account_info = null;
const default_config = {
  zone_host_name: "",
  appid: "",
  default_protocol: "http://"
};
async function tryGetZoneHostName() {
  const protocol = window.location.protocol;
  const host = window.location.host;
  const configUrl = `${protocol}//${host}/zone_config.json`;
  try {
    const response = await fetch(configUrl);
    if (response.ok) {
      return host;
    }
  } catch (error) {
  }
  try {
    let up_host = host.split(".").slice(1).join(".");
    const configUrl2 = `${protocol}//${up_host}/zone_config.json`;
    const response2 = await fetch(configUrl2);
    if (response2.ok) {
      return up_host;
    }
  } catch (error) {
  }
  return null;
}
async function initBuckyOS(appid, config = null) {
  if (_current_config) {
    console.warn("BuckyOS WebSDK is already initialized!");
  }
  if (config) {
    _current_config = config;
  } else {
    config = default_config;
    config.appid = appid;
    config.default_protocol = window.location.protocol + "//";
    try {
      let up_host = window.location.host.split(".").slice(1).join(".");
      config.zone_host_name = up_host;
    } catch (error) {
      config.zone_host_name = window.location.host;
    }
    let zone_host_name = localStorage.getItem("buckyos.zone_host_name");
    if (zone_host_name) {
      config.zone_host_name = zone_host_name;
    } else {
      zone_host_name = await tryGetZoneHostName();
      if (zone_host_name) {
        localStorage.setItem("buckyos.zone_host_name", zone_host_name);
        config.zone_host_name = zone_host_name;
      }
    }
    return await initBuckyOS(appid, config);
  }
}
function getRuntimeType() {
  if (typeof window !== "undefined") {
    const userAgent = window.navigator.userAgent.toLowerCase();
    return "Browser-" + userAgent;
  }
  if (typeof process !== "undefined" && process.versions && process.versions.node) {
    return "NodeJS-" + process.versions.node;
  }
  return "Unknown";
}
function attachEvent(event_name, callback) {
}
function removeEvent(cookie_id) {
}
function getAccountInfo() {
  if (_current_account_info) {
    return _current_account_info;
  }
  if (_current_config == null) {
    console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    return null;
  }
  return null;
}
async function login(auto_login = true) {
  if (_current_config == null) {
    console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    return null;
  }
  let appId = getAppId();
  if (appId == null) {
    console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    return null;
  }
  if (auto_login) {
    let account_info = getLocalAccountInfo();
    if (account_info) {
      _current_account_info = account_info;
      return _current_account_info;
    }
  }
  cleanLocalAccountInfo(appId);
  let zone_host_name = getZoneHostName();
  if (zone_host_name == null) {
    console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    return null;
  }
  try {
    let auth_client = new AuthClient(zone_host_name, appId);
    let account_info = await auth_client.login();
    if (account_info) {
      saveLocalAccountInfo(appId, account_info);
      _current_account_info = account_info;
    }
    return account_info;
  } catch (error) {
    console.error("login failed: ", error);
    throw error;
  }
}
function logout(clean_account_info = true) {
  if (_current_config == null) {
    console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    return;
  }
  let appId = getAppId();
  if (appId == null) {
    console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    return;
  }
  if (_current_account_info == null) {
    console.error("BuckyOS WebSDK is not login,call login first");
    return;
  }
  if (clean_account_info) {
    cleanLocalAccountInfo(appId);
  }
}
function getAppSetting(setting_name = null) {
}
function setAppSetting(setting_name = null, setting_value) {
}
function getZoneHostName() {
  if (_current_config == null) {
    console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    return null;
  }
  return _current_config.zone_host_name;
}
function getZoneServiceURL(service_name) {
  if (_current_config == null) {
    console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    throw new Error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
  }
  return _current_config.default_protocol + _current_config.zone_host_name + "/kapi/" + service_name;
}
function getServiceRpcClient(service_name) {
  if (_current_config == null) {
    console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
    throw new Error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
  }
  let session_token = null;
  if (_current_account_info) {
    session_token = _current_account_info.session_token;
  }
  return new kRPCClient(getZoneServiceURL(service_name), session_token);
}
function getAppId() {
  if (_current_config) {
    return _current_config.appid;
  }
  console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");
  return null;
}
function getBuckyOSConfig() {
  return _current_config;
}
const buckyos = {
  kRPCClient,
  AuthClient,
  initBuckyOS,
  getBuckyOSConfig,
  getRuntimeType,
  getAppId,
  attachEvent,
  removeEvent,
  getAccountInfo,
  doLogin,
  login,
  logout,
  hashPassword,
  getAppSetting,
  setAppSetting,
  //add_web3_bridge,        
  getZoneHostName,
  getZoneServiceURL,
  getServiceRpcClient
};
export {
  BS_SERVICE_VERIFY_HUB,
  buckyos
};
//# sourceMappingURL=buckyos.mjs.map
