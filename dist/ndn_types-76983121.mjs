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
const DID_OBJECT_SERVICE_TYPE = "DIDObjectService";
const DID_OBJECT_SERVICE_ID = "#did-object";
const NODE_IDENTITY_SCHEMA_V2 = "buckyos.node_identity.v2";
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isVerificationMethodArray(value) {
  return Array.isArray(value);
}
function isServiceArray(value) {
  return value === void 0 || Array.isArray(value);
}
function isDIDContext(value) {
  if (typeof value === "string") {
    return true;
  }
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function isW3CDIDDocumentBase(value) {
  if (!isRecord(value)) {
    return false;
  }
  return isDIDContext(value["@context"]) && typeof value.id === "string" && isVerificationMethodArray(value.verificationMethod) && Array.isArray(value.authentication) && typeof value.exp === "number" && typeof value.iat === "number" && isServiceArray(value.service);
}
function isBuckyOSOwnerDocument(value) {
  return isW3CDIDDocumentBase(value) && typeof value.name === "string" && (typeof value.display_name === "string" || typeof value.displayName === "string" || typeof value.full_name === "string");
}
function isBuckyOSDeviceMiniDocument(value) {
  return isRecord(value) && typeof value.n === "string" && typeof value.x === "string" && typeof value.exp === "number";
}
function isBuckyOSZoneBootDocument(value) {
  return isRecord(value) && Array.isArray(value.oods) && value.oods.every((item) => typeof item === "string") && typeof value.exp === "number";
}
function isBuckyOSNodeIdentityConfig(value) {
  return isRecord(value) && typeof value.zone_did === "string" && isRecord(value.owner_public_key) && typeof value.owner_did === "string" && typeof value.device_doc_jwt === "string" && typeof value.device_mini_doc_jwt === "string" && typeof value.zone_iat === "number";
}
function isBuckyOSLocalNodeIdentityConfig(value) {
  return isRecord(value) && value.schema === NODE_IDENTITY_SCHEMA_V2 && typeof value.zone_did === "string" && typeof value.owner_did === "string" && isRecord(value.owner_public_key) && typeof value.device_name === "string" && typeof value.device_did === "string" && typeof value.zone_iat === "number";
}
function isBuckyOSDeviceDocument(value) {
  return isW3CDIDDocumentBase(value) && typeof value.owner === "string" && typeof value.device_type === "string" && typeof value.name === "string";
}
function isBuckyOSAgentDocument(value) {
  return isW3CDIDDocumentBase(value) && typeof value.owner === "string" && isRecord(value.httpServicePorts);
}
function isBuckyOSZoneDocument(value) {
  return isW3CDIDDocumentBase(value) && typeof value.hostname === "string" && typeof value.owner === "string" && Array.isArray(value.oods) && typeof value.boot_jwt === "string";
}
function isBuckyOSDIDObjectCard(value) {
  if (!isRecord(value) || !isDIDContext(value["@context"]) || typeof value.id !== "string") {
    return false;
  }
  const services = value.service;
  return Array.isArray(services) && services.some((service) => isRecord(service) && service.type === DID_OBJECT_SERVICE_TYPE);
}
function isBuckyOSZoneConfig(value) {
  return isRecord(value) && typeof value.zone_document === "string";
}
function parseW3CDIDDocumentBase(value) {
  return isW3CDIDDocumentBase(value) ? value : null;
}
function parseBuckyOSOwnerDocument(value) {
  return isBuckyOSOwnerDocument(value) ? value : null;
}
function parseBuckyOSDeviceMiniDocument(value) {
  return isBuckyOSDeviceMiniDocument(value) ? value : null;
}
function parseBuckyOSDIDDocument(value) {
  if (isBuckyOSOwnerDocument(value)) {
    return value;
  }
  if (isBuckyOSAgentDocument(value)) {
    return value;
  }
  if (isBuckyOSDeviceDocument(value)) {
    return value;
  }
  if (isBuckyOSZoneDocument(value)) {
    return value;
  }
  if (isBuckyOSDIDObjectCard(value)) {
    return value;
  }
  return null;
}
function getDidMethod(did) {
  if (typeof did !== "string" || !did.startsWith("did:")) {
    return null;
  }
  const parts = did.split(":");
  return parts.length >= 3 ? parts[1] : null;
}
function getDidIdentifier(did) {
  if (typeof did !== "string" || !did.startsWith("did:")) {
    return null;
  }
  const parts = did.split(":");
  return parts.length >= 3 ? parts.slice(2).join(":") : null;
}
const DID_CORE_CONTEXT = "https://www.w3.org/ns/did/v1";
const BUCKYOS_CONTEXT_BASE = "https://buckyos.org/ns";
const DID_DOC_AUTHKEY = "#auth-key";
const DEFAULT_EXPIRE_TIME = 3600 * 24 * 365 * 5;
const DEFAULT_DOC_EXPIRE_TIME = 3600 * 24 * 365 * 10;
function buckyosContext(docType) {
  return [DID_CORE_CONTEXT, `${BUCKYOS_CONTEXT_BASE}/${docType}/v1`];
}
function buckyosGetUnixTimestamp() {
  return Math.floor(Date.now() / 1e3);
}
const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function bytesToBase64(bytes) {
  let result = "";
  for (let i2 = 0; i2 < bytes.length; i2 += 3) {
    const b0 = bytes[i2];
    const b1 = i2 + 1 < bytes.length ? bytes[i2 + 1] : 0;
    const b2 = i2 + 2 < bytes.length ? bytes[i2 + 2] : 0;
    result += BASE64_CHARS[b0 >> 2];
    result += BASE64_CHARS[(b0 & 3) << 4 | b1 >> 4];
    result += i2 + 1 < bytes.length ? BASE64_CHARS[(b1 & 15) << 2 | b2 >> 6] : "=";
    result += i2 + 2 < bytes.length ? BASE64_CHARS[b2 & 63] : "=";
  }
  return result;
}
function base64ToBytes(base64) {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, "");
  const length = Math.floor(clean.length * 3 / 4);
  const bytes = new Uint8Array(length);
  let byteIndex = 0;
  for (let i2 = 0; i2 < clean.length; i2 += 4) {
    const c0 = BASE64_CHARS.indexOf(clean[i2]);
    const c1 = BASE64_CHARS.indexOf(clean[i2 + 1]);
    const c2 = i2 + 2 < clean.length ? BASE64_CHARS.indexOf(clean[i2 + 2]) : -1;
    const c3 = i2 + 3 < clean.length ? BASE64_CHARS.indexOf(clean[i2 + 3]) : -1;
    bytes[byteIndex++] = c0 << 2 | c1 >> 4;
    if (c2 >= 0) {
      bytes[byteIndex++] = (c1 & 15) << 4 | c2 >> 2;
    }
    if (c3 >= 0) {
      bytes[byteIndex++] = (c2 & 3) << 6 | c3;
    }
  }
  return bytes.subarray(0, byteIndex);
}
function base64UrlEncodeBytes(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function base64UrlDecodeToBytes(value) {
  return base64ToBytes(value.replace(/-/g, "+").replace(/_/g, "/"));
}
function utf8Encode$1(value) {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(value);
  }
  const bytes = [];
  for (let i2 = 0; i2 < value.length; i2++) {
    let code = value.codePointAt(i2);
    if (code > 65535) {
      i2++;
    }
    if (code < 128) {
      bytes.push(code);
    } else if (code < 2048) {
      bytes.push(192 | code >> 6, 128 | code & 63);
    } else if (code < 65536) {
      bytes.push(224 | code >> 12, 128 | code >> 6 & 63, 128 | code & 63);
    } else {
      bytes.push(
        240 | code >> 18,
        128 | code >> 12 & 63,
        128 | code >> 6 & 63,
        128 | code & 63
      );
    }
  }
  return new Uint8Array(bytes);
}
function utf8Decode$1(bytes) {
  if (typeof TextDecoder !== "undefined") {
    return new TextDecoder().decode(bytes);
  }
  let result = "";
  for (let i2 = 0; i2 < bytes.length; ) {
    const b0 = bytes[i2];
    if (b0 < 128) {
      result += String.fromCharCode(b0);
      i2 += 1;
    } else if (b0 < 224) {
      result += String.fromCharCode((b0 & 31) << 6 | bytes[i2 + 1] & 63);
      i2 += 2;
    } else if (b0 < 240) {
      result += String.fromCharCode((b0 & 15) << 12 | (bytes[i2 + 1] & 63) << 6 | bytes[i2 + 2] & 63);
      i2 += 3;
    } else {
      const code = (b0 & 7) << 18 | (bytes[i2 + 1] & 63) << 12 | (bytes[i2 + 2] & 63) << 6 | bytes[i2 + 3] & 63;
      result += String.fromCodePoint(code);
      i2 += 4;
    }
  }
  return result;
}
function base64UrlEncodeString(value) {
  return base64UrlEncodeBytes(utf8Encode$1(value));
}
function base64UrlDecodeToString(value) {
  return utf8Decode$1(base64UrlDecodeToBytes(value));
}
function hasNodeRuntime() {
  var _a;
  const runtimeProcess = globalThis.process;
  return Boolean((_a = runtimeProcess == null ? void 0 : runtimeProcess.versions) == null ? void 0 : _a.node);
}
async function importNodeModule(moduleName) {
  if (typeof require === "function") {
    return require(moduleName);
  }
  const dynamicImport = Function("name", "return import(name)");
  return dynamicImport(moduleName);
}
async function getNodeCrypto() {
  if (!hasNodeRuntime()) {
    return null;
  }
  try {
    return await importNodeModule("node:crypto");
  } catch {
    return null;
  }
}
function getSubtleCrypto() {
  var _a;
  const subtle = (_a = globalThis.crypto) == null ? void 0 : _a.subtle;
  if (!subtle) {
    throw new Error("namelib: no crypto backend available (need node:crypto or WebCrypto with Ed25519 support)");
  }
  return subtle;
}
const PKCS8_PEM_HEADER = "-----BEGIN PRIVATE KEY-----";
const PKCS8_PEM_FOOTER = "-----END PRIVATE KEY-----";
const ED25519_SPKI_PREFIX = new Uint8Array([
  48,
  42,
  48,
  5,
  6,
  3,
  43,
  101,
  112,
  3,
  33,
  0
]);
function pemToDer(pem) {
  const body = pem.replace(/-----BEGIN [^-]+-----/g, "").replace(/-----END [^-]+-----/g, "").replace(/\s+/g, "");
  return base64ToBytes(body);
}
function derToPkcs8Pem(der) {
  const base64 = bytesToBase64(der);
  const lines = [];
  for (let i2 = 0; i2 < base64.length; i2 += 64) {
    lines.push(base64.slice(i2, i2 + 64));
  }
  return `${PKCS8_PEM_HEADER}
${lines.join("\n")}
${PKCS8_PEM_FOOTER}
`;
}
function concatBytes(a2, b2) {
  const result = new Uint8Array(a2.length + b2.length);
  result.set(a2, 0);
  result.set(b2, a2.length);
  return result;
}
function ed25519JwkToSpkiDer(jwk) {
  const x2 = base64UrlDecodeToBytes(jwk.x);
  if (x2.length !== 32) {
    throw new Error(`namelib: invalid Ed25519 jwk, x must be 32 bytes, got ${x2.length}`);
  }
  return concatBytes(ED25519_SPKI_PREFIX, x2);
}
async function ed25519Sign(data, privateKeyPem) {
  const nodeCrypto = await getNodeCrypto();
  if (nodeCrypto) {
    const key2 = nodeCrypto.createPrivateKey({ key: privateKeyPem, format: "pem" });
    return new Uint8Array(nodeCrypto.sign(null, data, key2));
  }
  const subtle = getSubtleCrypto();
  const der = pemToDer(privateKeyPem);
  const key = await subtle.importKey("pkcs8", der, { name: "Ed25519" }, false, ["sign"]);
  const signature = await subtle.sign({ name: "Ed25519" }, key, data);
  return new Uint8Array(signature);
}
async function ed25519Verify(data, signature, publicKeyJwk) {
  const nodeCrypto = await getNodeCrypto();
  if (nodeCrypto) {
    const key2 = nodeCrypto.createPublicKey({
      key: { kty: publicKeyJwk.kty, crv: publicKeyJwk.crv, x: publicKeyJwk.x },
      format: "jwk"
    });
    return nodeCrypto.verify(null, data, key2, signature);
  }
  const subtle = getSubtleCrypto();
  const der = ed25519JwkToSpkiDer(publicKeyJwk);
  const key = await subtle.importKey("spki", der, { name: "Ed25519" }, false, ["verify"]);
  return subtle.verify({ name: "Ed25519" }, key, signature, data);
}
async function generateEd25519KeyPair() {
  const nodeCrypto = await getNodeCrypto();
  if (nodeCrypto) {
    const { privateKey, publicKey } = nodeCrypto.generateKeyPairSync("ed25519");
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const jwk2 = publicKey.export({ format: "jwk" });
    return { privateKeyPem, publicKeyJwk: createJwkByX(jwk2.x) };
  }
  const subtle = getSubtleCrypto();
  const keyPair = await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const pkcs8 = new Uint8Array(await subtle.exportKey("pkcs8", keyPair.privateKey));
  const jwk = await subtle.exportKey("jwk", keyPair.publicKey);
  if (!jwk.x) {
    throw new Error("namelib: WebCrypto did not return Ed25519 public jwk");
  }
  return { privateKeyPem: derToPkcs8Pem(pkcs8), publicKeyJwk: createJwkByX(jwk.x) };
}
async function getPublicKeyXFromPrivatePem(privateKeyPem) {
  const nodeCrypto = await getNodeCrypto();
  if (nodeCrypto) {
    const privateKey = nodeCrypto.createPrivateKey({ key: privateKeyPem, format: "pem" });
    const publicKey = nodeCrypto.createPublicKey(privateKey);
    const jwk2 = publicKey.export({ format: "jwk" });
    return jwk2.x;
  }
  const subtle = getSubtleCrypto();
  const der = pemToDer(privateKeyPem);
  const key = await subtle.importKey("pkcs8", der, { name: "Ed25519" }, true, ["sign"]);
  const jwk = await subtle.exportKey("jwk", key);
  if (!jwk.x) {
    throw new Error("namelib: cannot derive public key from private pem");
  }
  return jwk.x;
}
function getXFromJwk(jwk) {
  const x2 = jwk.x;
  if (typeof x2 !== "string" || x2.length === 0) {
    throw new Error("namelib: invalid jwk, missing x");
  }
  return x2;
}
function createJwkByX(x2) {
  return { kty: "OKP", crv: "Ed25519", x: x2 };
}
function getDeviceDidFromJwk(jwk) {
  return `did:dev:${getXFromJwk(jwk)}`;
}
async function signJwtEdDSA(payload, privateKeyPem, header) {
  const headerJson = JSON.stringify(header ?? { alg: "EdDSA" });
  const signingInput = `${base64UrlEncodeString(headerJson)}.${base64UrlEncodeString(JSON.stringify(payload))}`;
  const signature = await ed25519Sign(utf8Encode$1(signingInput), privateKeyPem);
  return `${signingInput}.${base64UrlEncodeBytes(signature)}`;
}
function decodeJwtClaimWithoutVerify(jwt) {
  const parts = jwt.split(".");
  if (parts.length !== 3) {
    throw new Error("namelib: invalid jwt, parts.len != 3");
  }
  return JSON.parse(base64UrlDecodeToString(parts[1]));
}
function decodeJwtHeaderWithoutVerify(jwt) {
  const parts = jwt.split(".");
  if (parts.length !== 3) {
    throw new Error("namelib: invalid jwt, parts.len != 3");
  }
  return JSON.parse(base64UrlDecodeToString(parts[0]));
}
async function verifyJwtEdDSA(jwt, publicKeyJwk) {
  const parts = jwt.split(".");
  if (parts.length !== 3) {
    throw new Error("namelib: invalid jwt, parts.len != 3");
  }
  const header = JSON.parse(base64UrlDecodeToString(parts[0]));
  if (header.alg !== "EdDSA") {
    throw new Error(`namelib: unsupported jwt alg: ${header.alg}`);
  }
  const signingInput = `${parts[0]}.${parts[1]}`;
  const ok = await ed25519Verify(utf8Encode$1(signingInput), base64UrlDecodeToBytes(parts[2]), publicKeyJwk);
  if (!ok) {
    throw new Error("namelib: jwt signature verify failed");
  }
  return JSON.parse(base64UrlDecodeToString(parts[1]));
}
function encodedDocumentFromStr(docStr) {
  if (docStr.startsWith("{") || docStr.startsWith("[")) {
    return { type: "json", value: JSON.parse(docStr) };
  }
  return { type: "jwt", jwt: docStr };
}
function encodedDocumentToJsonValue(doc) {
  if (doc.type === "jwt") {
    return decodeJwtClaimWithoutVerify(doc.jwt);
  }
  return doc.value;
}
function encodedDocumentToString(doc) {
  if (doc.type === "jwt") {
    return doc.jwt;
  }
  return JSON.stringify(doc.value);
}
let knownWeb3BridgeConfig = null;
function setKnownWeb3BridgeConfig(config) {
  if (knownWeb3BridgeConfig !== null) {
    return false;
  }
  knownWeb3BridgeConfig = { ...config };
  return true;
}
function getKnownWeb3BridgeConfig() {
  return knownWeb3BridgeConfig;
}
function resetKnownWeb3BridgeConfigForTest() {
  knownWeb3BridgeConfig = null;
}
class DID {
  constructor(method, id) {
    this.method = method;
    this.id = id;
  }
  static undefined() {
    return new DID("undefined", "undefined");
  }
  isUndefined() {
    return this.method === "undefined";
  }
  isValid() {
    return this.method !== "undefined";
  }
  static isDid(did) {
    return did.startsWith("did:");
  }
  static fromStr(did) {
    const parts = did.split(":");
    if (parts[0] !== "did") {
      const result = DID.fromHostName(did);
      if (result) {
        return result;
      }
      throw new Error(`namelib: invalid did ${did}`);
    }
    return new DID(parts[1], parts.slice(2).join(":"));
  }
  static fromHostName(hostName) {
    if (hostName.endsWith(".did")) {
      const parts = hostName.split(".");
      if (parts.length === 3) {
        return new DID(parts[1], parts[0]);
      }
    }
    if (knownWeb3BridgeConfig) {
      for (const method of Object.keys(knownWeb3BridgeConfig)) {
        const bridgeBaseHostname = knownWeb3BridgeConfig[method];
        if (hostName.endsWith(bridgeBaseHostname)) {
          if (hostName === bridgeBaseHostname) {
            break;
          }
          const id = hostName.slice(0, hostName.length - bridgeBaseHostname.length - 1);
          return new DID(method, id);
        }
      }
    }
    return new DID("web", hostName);
  }
  static fromHostNameByBridge(hostName, method, bridgeBaseHostname) {
    if (hostName.endsWith(bridgeBaseHostname) && hostName !== bridgeBaseHostname) {
      const id = hostName.slice(0, hostName.length - bridgeBaseHostname.length - 1);
      return new DID(method, id);
    }
    if (hostName.endsWith(".did")) {
      const parts = hostName.split(".");
      if (parts.length === 3) {
        return new DID(parts[1], parts[0]);
      }
    }
    return new DID("web", hostName);
  }
  toString() {
    return `did:${this.method}:${this.id}`;
  }
  isNamedObjId() {
    return this.method === "dev";
  }
  getPathFromId() {
    const parts = this.id.split(":");
    if (parts.length > 1) {
      return parts.slice(1).join("/");
    }
    return null;
  }
  // Mirrors Rust DID::upper_did: strip the left-most name label to get the
  // parent DID. Ports (%3A-encoded) and path segments do not take part in the
  // name hierarchy. Returns null when the parent is not independently
  // resolvable (top-level domain, IP address, first-level bns name, key DIDs).
  upperDid() {
    const name = (this.id.split(":")[0] ?? "").split("%")[0] ?? "";
    switch (this.method) {
      case "web": {
        if (isValidIpAddress(name)) {
          return null;
        }
        const dotIndex = name.indexOf(".");
        if (dotIndex < 0) {
          return null;
        }
        const upper = name.slice(dotIndex + 1);
        if (!upper.includes(".")) {
          return null;
        }
        return new DID("web", upper);
      }
      case "bns": {
        const dotIndex = name.indexOf(".");
        if (dotIndex < 0) {
          return null;
        }
        return new DID("bns", name.slice(dotIndex + 1));
      }
      default:
        return null;
    }
  }
  // Mirrors Rust DID::to_filename: percent-encode the raw host uri so it is a
  // safe single-path-component file name.
  toFilename() {
    const HEX = "0123456789ABCDEF";
    const rawHostUri = this.toRawHostUri();
    const bytes = utf8Encode$1(rawHostUri);
    let filename = "";
    for (const byte of bytes) {
      const ch = String.fromCharCode(byte);
      if (/[A-Za-z0-9._-]/.test(ch)) {
        filename += ch;
      } else {
        filename += `%${HEX[byte >> 4]}${HEX[byte & 15]}`;
      }
    }
    return filename;
  }
  // For did:dev the id is the base64url Ed25519 public key.
  getEd25519AuthKey() {
    if (this.method === "dev") {
      return base64UrlDecodeToBytes(this.id);
    }
    return null;
  }
  getAuthKeyJwk() {
    if (this.method === "dev") {
      return createJwkByX(this.id);
    }
    return null;
  }
  toRawHostName() {
    const realId = this.id.split(":")[0];
    if (this.method === "web") {
      return realId;
    }
    return `${realId}.${this.method}.did`;
  }
  toRawHostUri() {
    const hostname = this.toRawHostName();
    const path = this.getPathFromId();
    return path ? `${hostname}/${path}` : hostname;
  }
  toHostNameByBridge(bridgeBaseHostname) {
    const realId = this.id.split(":")[0];
    if (this.method === "web") {
      return realId;
    }
    return `${realId}.${bridgeBaseHostname}`;
  }
  toHostName() {
    const realId = this.id.split(":")[0];
    if (this.method === "web") {
      return realId;
    }
    if (knownWeb3BridgeConfig) {
      const bridgeBaseHostname = knownWeb3BridgeConfig[this.method];
      if (bridgeBaseHostname) {
        return `${realId}.${bridgeBaseHostname}`;
      }
    }
    return `${realId}.${this.method}.did`;
  }
  toHostUri() {
    const hostname = this.toHostName();
    const path = this.getPathFromId();
    return path ? `${hostname}/${path}` : hostname;
  }
  equals(other) {
    return this.method === other.method && this.id === other.id;
  }
}
function parseOODDescription(s2) {
  let nodeType = "OOD";
  let rest = s2;
  if (s2.startsWith("#")) {
    nodeType = "Gateway";
    rest = s2.slice(1);
  } else if (s2.startsWith("$")) {
    nodeType = "OODOnly";
    rest = s2.slice(1);
  }
  let netId;
  const atIndex = rest.lastIndexOf("@");
  let beforeNetId = rest;
  if (atIndex >= 0) {
    beforeNetId = rest.slice(0, atIndex);
    netId = rest.slice(atIndex + 1);
  }
  let ip;
  let name = beforeNetId;
  const colonIndex = beforeNetId.indexOf(":");
  if (colonIndex >= 0) {
    name = beforeNetId.slice(0, colonIndex);
    ip = beforeNetId.slice(colonIndex + 1);
    if (!isValidIpAddress(ip)) {
      throw new Error(`namelib: invalid ip addr: ${ip}`);
    }
  }
  if (ip !== void 0 && netId === void 0) {
    netId = "wan";
  }
  if (!name) {
    throw new Error("namelib: name in OODDescriptionString is empty");
  }
  return pruneUndefined({ name, nodeType, netId, ip });
}
function oodDescriptionToString(desc) {
  let result;
  switch (desc.nodeType) {
    case "OOD":
      result = desc.name;
      break;
    case "Gateway":
      result = `#${desc.name}`;
      break;
    case "OODOnly":
      result = `$${desc.name}`;
      break;
    default:
      throw new Error("namelib: node type is not allow in oods");
  }
  if (desc.ip !== void 0) {
    result += `:${desc.ip}`;
    if (desc.netId !== void 0 && desc.netId !== "wan") {
      result += `@${desc.netId}`;
    }
    return result;
  }
  if (desc.netId !== void 0) {
    result += `@${desc.netId}`;
  }
  return result;
}
function oodNodeTypeIsOod(nodeType) {
  return nodeType === "OOD" || nodeType === "OODOnly";
}
function oodNodeTypeIsGateway(nodeType) {
  return nodeType === "Gateway" || nodeType === "OOD";
}
function isValidIpAddress(value) {
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = value.match(ipv4);
  if (match) {
    return match.slice(1).every((part) => Number(part) <= 255);
  }
  return /^[0-9a-fA-F:]+$/.test(value) && value.includes(":");
}
function pruneUndefined(obj) {
  for (const key of Object.keys(obj)) {
    if (obj[key] === void 0) {
      delete obj[key];
    }
  }
  return obj;
}
function asDid(value) {
  return value instanceof DID ? value : DID.fromStr(value);
}
function newOwnerDocument(params) {
  const did = asDid(params.did);
  const now = params.now ?? buckyosGetUnixTimestamp();
  const didStr = did.toString();
  return {
    "@context": buckyosContext("owner"),
    id: didStr,
    verificationMethod: [
      {
        type: "Ed25519VerificationKey2020",
        id: "#main_key",
        controller: didStr,
        publicKeyJwk: params.publicKeyJwk
      }
    ],
    authentication: ["#main_key"],
    assertion_method: ["#main_key"],
    capabilityInvocation: ["#main_key"],
    exp: now + DEFAULT_DOC_EXPIRE_TIME,
    iat: now,
    version_seq: 0,
    name: params.name,
    display_name: params.displayName
  };
}
function newOwnerDocumentByPkx(pkx, hostname) {
  const parts = pkx.split(":");
  if (parts.length === 0 || !parts[0]) {
    throw new Error("namelib: invalid pkx: empty x");
  }
  const x2 = parts[0];
  if (!/^[A-Za-z0-9_-]+$/.test(x2)) {
    throw new Error("namelib: invalid pkx: x must be base64url");
  }
  if (base64UrlDecodeToBytes(x2).length !== 32) {
    throw new Error(`namelib: invalid pkx: x length must be 32 bytes`);
  }
  const jwk = createJwkByX(x2);
  if (parts.length === 1) {
    const ownerDid = DID.fromStr(hostname);
    const ownerName = ownerDid.id;
    return newOwnerDocument({
      did: ownerDid,
      name: ownerName,
      displayName: `${ownerName}@${hostname}`,
      publicKeyJwk: jwk
    });
  }
  if (parts.length >= 3) {
    const ownerName = parts[2];
    return newOwnerDocument({
      did: new DID(parts[1], parts[2]),
      name: ownerName,
      displayName: `${ownerName}@${hostname}`,
      publicKeyJwk: jwk
    });
  }
  throw new Error(`namelib: invalid pkx: ${pkx}`);
}
function ownerDocumentSetDefaultZoneDid(ownerDoc, defaultZoneDid) {
  const zoneDid = asDid(defaultZoneDid);
  const zoneDidStr = zoneDid.toString();
  const bindedZoneList = (ownerDoc.binded_zone_list ?? []).filter((did) => did !== zoneDidStr);
  bindedZoneList.unshift(zoneDidStr);
  ownerDoc.binded_zone_list = bindedZoneList;
  const lastDocServiceId = `${ownerDoc.id}#lastDoc`;
  const services = (ownerDoc.service ?? []).filter((service) => service.id !== lastDocServiceId);
  services.push({
    id: lastDocServiceId,
    type: "DIDDoc",
    serviceEndpoint: `https://${zoneDid.toHostName()}/resolve/${ownerDoc.id}`
  });
  ownerDoc.service = services;
}
function ownerDocumentGetDefaultZoneDid(ownerDoc) {
  var _a;
  return ((_a = ownerDoc.binded_zone_list) == null ? void 0 : _a[0]) ?? null;
}
function ownerDocumentIsBoundToZone(ownerDoc, zoneDid) {
  const zoneDidStr = asDid(zoneDid).toString();
  return (ownerDoc.binded_zone_list ?? []).includes(zoneDidStr);
}
function ownerDocumentGetHistoricalKeys(ownerDoc) {
  return ownerDoc.verificationMethod.filter((method) => method.id !== "#main_key").map((method) => [method.id, method.publicKeyJwk]);
}
function ownerDocumentValidateJwtRevocation(ownerDoc, docType, doc) {
  if (ownerDoc.mini_version_seq === void 0 && ownerDoc.valid_iat === void 0) {
    return;
  }
  if (doc.type !== "jwt") {
    return;
  }
  const docValue = encodedDocumentToJsonValue(doc);
  if (ownerDoc.mini_version_seq !== void 0) {
    const versionSeq = typeof (docValue == null ? void 0 : docValue.version_seq) === "number" ? docValue.version_seq : void 0;
    if (versionSeq === void 0) {
      throw new Error(`namelib: ${docType} JWT missing version_seq required by owner revocation policy`);
    }
    if (versionSeq <= ownerDoc.mini_version_seq) {
      throw new Error(
        `namelib: ${docType} JWT version_seq ${versionSeq} is not greater than owner mini_version_seq ${ownerDoc.mini_version_seq}`
      );
    }
  }
  if (ownerDoc.valid_iat !== void 0) {
    const iat = typeof (docValue == null ? void 0 : docValue.iat) === "number" ? docValue.iat : void 0;
    if (iat === void 0) {
      throw new Error(`namelib: ${docType} JWT missing iat required by owner revocation policy`);
    }
    if (iat <= ownerDoc.valid_iat) {
      throw new Error(
        `namelib: ${docType} JWT iat ${iat} is not greater than owner valid_iat ${ownerDoc.valid_iat}`
      );
    }
  }
}
function newZoneDocument(params) {
  const id = asDid(params.id);
  const ownerDid = asDid(params.ownerDid);
  const now = params.now ?? buckyosGetUnixTimestamp();
  const idStr = id.toString();
  return {
    "@context": buckyosContext("zone"),
    id: idStr,
    verificationMethod: [
      {
        type: "Ed25519VerificationKey2020",
        id: "#main_key",
        controller: ownerDid.toString(),
        publicKeyJwk: params.publicKeyJwk
      }
    ],
    authentication: ["#main_key"],
    assertionMethod: ["#main_key"],
    capabilityInvocation: ["#main_key"],
    service: [
      {
        id: `${idStr}#lastDoc`,
        type: "DIDDoc",
        serviceEndpoint: `https://${id.toHostName()}/resolve/this_zone`
      }
    ],
    exp: now + DEFAULT_DOC_EXPIRE_TIME,
    iat: now,
    version_seq: 0,
    hostname: id.toHostName(),
    owner: ownerDid.toString(),
    oods: [],
    boot_jwt: ""
  };
}
function zoneDocumentGetDefaultGateway(zoneDoc) {
  for (const oodString of zoneDoc.oods) {
    const ood = parseOODDescription(oodString);
    if (oodNodeTypeIsGateway(ood.nodeType)) {
      return ood.name;
    }
  }
  return null;
}
function zoneDocumentGetSnApiUrl(zoneDoc) {
  return zoneDoc.sn !== void 0 ? `https://${zoneDoc.sn}/kapi/sn` : null;
}
function newZoneBootDocument(params) {
  return pruneUndefined({
    id: params.id !== void 0 ? asDid(params.id).toString() : void 0,
    oods: [...params.oods],
    sn: params.sn,
    exp: params.exp,
    owner: params.owner !== void 0 ? asDid(params.owner).toString() : void 0,
    owner_key: params.ownerKey
  });
}
async function encodeZoneBootDocument(bootDoc, ownerPrivateKeyPem) {
  const { id, oods, sn, exp, owner, owner_key, ...extra } = bootDoc;
  const payload = pruneUndefined({ id, oods, sn, exp, owner, ...extra, owner_key });
  return signJwtEdDSA(payload, ownerPrivateKeyPem);
}
async function decodeZoneBootDocument(jwt, publicKeyJwk) {
  const payload = publicKeyJwk ? await verifyJwtEdDSA(jwt, publicKeyJwk) : decodeJwtClaimWithoutVerify(jwt);
  return payload;
}
function zoneBootDocumentGetGatewayName(bootDoc) {
  for (const oodString of bootDoc.oods) {
    const ood = parseOODDescription(oodString);
    if (oodNodeTypeIsGateway(ood.nodeType)) {
      return ood.name;
    }
  }
  return "";
}
function zoneBootDocumentToZoneDocument(bootDoc, bootJwt) {
  if (!bootDoc.id || !bootDoc.owner_key) {
    throw new Error("namelib: zone boot document needs id and owner_key to build zone document");
  }
  const ownerDid = bootDoc.owner ? DID.fromStr(bootDoc.owner) : DID.undefined();
  const zoneDoc = newZoneDocument({
    id: bootDoc.id,
    ownerDid,
    publicKeyJwk: bootDoc.owner_key
  });
  zoneDoc.boot_jwt = bootJwt;
  zoneDoc.oods = [...bootDoc.oods];
  if (bootDoc.sn !== void 0) {
    zoneDoc.sn = bootDoc.sn;
  } else {
    delete zoneDoc.sn;
  }
  zoneDoc.exp = bootDoc.exp;
  zoneDoc.iat = bootDoc.exp - DEFAULT_EXPIRE_TIME;
  zoneDoc.version_seq = 0;
  zoneDoc.owner = bootDoc.owner ?? DID.undefined().toString();
  return zoneDoc;
}
function newDeviceDocument(params) {
  const now = params.now ?? buckyosGetUnixTimestamp();
  const did = `did:dev:${params.pkx}`;
  return {
    "@context": buckyosContext("device"),
    id: did,
    verificationMethod: [
      {
        type: "Ed25519VerificationKey2020",
        id: "#main_key",
        controller: did,
        publicKeyJwk: createJwkByX(params.pkx)
      }
    ],
    authentication: ["#main_key"],
    assertion_method: ["#main_key"],
    capabilityInvocation: ["#main_key"],
    exp: now + DEFAULT_EXPIRE_TIME,
    iat: now,
    version_seq: 0,
    owner: DID.undefined().toString(),
    device_type: "ood",
    name: params.name
  };
}
function newDeviceDocumentByJwk(name, publicKeyJwk, now) {
  return newDeviceDocument({ name, pkx: getXFromJwk(publicKeyJwk), now });
}
function newDeviceDocumentByMiniDocument(miniDocJwt, miniDoc, zoneDid, ownerDid) {
  const did = `did:dev:${miniDoc.x}`;
  const deviceDoc = {
    "@context": buckyosContext("device"),
    id: did,
    verificationMethod: [
      {
        type: "Ed25519VerificationKey2020",
        id: "#main_key",
        controller: did,
        publicKeyJwk: createJwkByX(miniDoc.x)
      }
    ],
    authentication: ["#main_key"],
    assertion_method: ["#main_key"],
    capabilityInvocation: ["#main_key"],
    exp: miniDoc.exp,
    iat: miniDoc.exp - DEFAULT_EXPIRE_TIME,
    version_seq: 0,
    zone_did: asDid(zoneDid).toString(),
    owner: asDid(ownerDid).toString(),
    device_type: "ood",
    device_mini_document_jwt: miniDocJwt,
    name: miniDoc.n
  };
  if (miniDoc.p !== void 0) {
    deviceDoc.rtcp_port = miniDoc.p;
  }
  return deviceDoc;
}
async function encodeDeviceDocument(deviceDoc, ownerPrivateKeyPem) {
  if (deviceDoc.version_seq === void 0) {
    throw new Error("namelib: DeviceDocument version_seq is required when encoding as JWT");
  }
  return signJwtEdDSA(deviceDocumentPayload(deviceDoc), ownerPrivateKeyPem);
}
function deviceDocumentPayload(doc) {
  const {
    "@context": context,
    id,
    verificationMethod,
    authentication,
    assertion_method,
    capabilityInvocation,
    service,
    exp,
    iat,
    version_seq,
    keyScope,
    "buckyos:scopes": buckyosScopes,
    zone_did,
    owner,
    device_type,
    device_mini_document_jwt,
    name,
    rtcp_port,
    ips,
    net_id,
    ddns_sn_url,
    support_container,
    capbilities,
    ...extra
  } = doc;
  const keyScopeValue = keyScope ?? buckyosScopes;
  return pruneUndefined({
    "@context": context,
    id,
    verificationMethod,
    authentication,
    assertion_method: assertion_method && assertion_method.length > 0 ? assertion_method : void 0,
    capabilityInvocation: capabilityInvocation && capabilityInvocation.length > 0 ? capabilityInvocation : void 0,
    service: service && service.length > 0 ? service : void 0,
    exp,
    iat,
    version_seq,
    ...extra,
    keyScope: keyScopeValue && Object.keys(keyScopeValue).length > 0 ? keyScopeValue : void 0,
    zone_did,
    owner,
    device_type,
    device_mini_document_jwt,
    name,
    rtcp_port,
    ips: ips && ips.length > 0 ? ips : void 0,
    net_id,
    ddns_sn_url,
    support_container: support_container === false ? false : void 0,
    capbilities: capbilities && Object.keys(capbilities).length > 0 ? capbilities : void 0
  });
}
async function decodeDeviceDocument(jwt, publicKeyJwk) {
  const payload = publicKeyJwk ? await verifyJwtEdDSA(jwt, publicKeyJwk) : decodeJwtClaimWithoutVerify(jwt);
  if (payload.version_seq === void 0) {
    throw new Error("namelib: DeviceDocument version_seq is required when decoding from JWT");
  }
  return payload;
}
function newDeviceMiniDocument(params) {
  return pruneUndefined({
    n: params.name,
    x: params.x,
    p: params.rtcpPort,
    exp: params.exp
  });
}
function newDeviceMiniDocumentByDeviceDocument(deviceDoc) {
  const defaultKey = deviceDoc.verificationMethod.find((method) => method.id === "#main_key");
  if (!defaultKey) {
    throw new Error("namelib: device document has no #main_key verification method");
  }
  return newDeviceMiniDocument({
    name: deviceDoc.name,
    x: getXFromJwk(defaultKey.publicKeyJwk),
    rtcpPort: deviceDoc.rtcp_port,
    exp: deviceDoc.exp
  });
}
async function deviceMiniDocumentToJwt(miniDoc, ownerPrivateKeyPem) {
  const { n: n2, x: x2, p: p2, exp, ...extra } = miniDoc;
  const payload = pruneUndefined({ n: n2, x: x2, p: p2, exp, ...extra });
  return signJwtEdDSA(payload, ownerPrivateKeyPem);
}
async function deviceMiniDocumentFromJwt(jwt, publicKeyJwk) {
  const payload = publicKeyJwk ? await verifyJwtEdDSA(jwt, publicKeyJwk) : decodeJwtClaimWithoutVerify(jwt);
  return payload;
}
function newNodeIdentityConfig(params) {
  return {
    zone_did: asDid(params.zoneDid).toString(),
    owner_public_key: params.ownerPublicKey,
    owner_did: asDid(params.ownerDid).toString(),
    device_doc_jwt: params.deviceDocJwt,
    device_mini_doc_jwt: params.deviceMiniDocJwt,
    zone_iat: params.zoneIat
  };
}
async function encodeOwnerDocument(ownerDoc, privateKeyPem) {
  if (ownerDoc.version_seq === void 0) {
    throw new Error("namelib: OwnerDocument version_seq is required when encoding as JWT");
  }
  return signJwtEdDSA(ownerDocumentPayload(ownerDoc), privateKeyPem);
}
function ownerDocumentPayload(doc) {
  const {
    "@context": context,
    id,
    verificationMethod,
    authentication,
    assertion_method,
    capabilityInvocation,
    service,
    exp,
    iat,
    version_seq,
    mini_version_seq,
    valid_iat,
    keyScope,
    "buckyos:scopes": buckyosScopes,
    name,
    display_name,
    avatar,
    meta,
    binded_zone_list,
    wallets,
    ...extra
  } = doc;
  const keyScopeValue = keyScope ?? buckyosScopes;
  return pruneUndefined({
    "@context": context,
    id,
    verificationMethod,
    authentication,
    assertion_method: assertion_method && assertion_method.length > 0 ? assertion_method : void 0,
    capabilityInvocation: capabilityInvocation && capabilityInvocation.length > 0 ? capabilityInvocation : void 0,
    service: service && service.length > 0 ? service : void 0,
    exp,
    iat,
    version_seq,
    mini_version_seq,
    valid_iat,
    ...extra,
    keyScope: keyScopeValue && Object.keys(keyScopeValue).length > 0 ? keyScopeValue : void 0,
    name,
    display_name,
    avatar,
    meta,
    binded_zone_list: binded_zone_list && binded_zone_list.length > 0 ? binded_zone_list : void 0,
    wallets: wallets && Object.keys(wallets).length > 0 ? wallets : void 0
  });
}
async function encodeZoneDocument(zoneDoc, ownerPrivateKeyPem) {
  if (zoneDoc.version_seq === void 0) {
    throw new Error("namelib: ZoneDocument version_seq is required when encoding as JWT");
  }
  return signJwtEdDSA(zoneDocumentPayload(zoneDoc), ownerPrivateKeyPem);
}
function zoneDocumentPayload(doc) {
  const {
    "@context": context,
    id,
    verificationMethod,
    authentication,
    assertionMethod,
    capabilityInvocation,
    service,
    exp,
    iat,
    version_seq,
    keyScope,
    "buckyos:scopes": buckyosScopes,
    hostname,
    owner,
    oods,
    boot_jwt,
    mini_device_jwts,
    devices,
    sn,
    ...extra
  } = doc;
  const keyScopeValue = keyScope ?? buckyosScopes;
  return pruneUndefined({
    "@context": context,
    id,
    verificationMethod,
    authentication,
    assertionMethod: assertionMethod && assertionMethod.length > 0 ? assertionMethod : void 0,
    capabilityInvocation: capabilityInvocation && capabilityInvocation.length > 0 ? capabilityInvocation : void 0,
    service: service && service.length > 0 ? service : void 0,
    exp,
    iat,
    version_seq,
    ...extra,
    keyScope: keyScopeValue && Object.keys(keyScopeValue).length > 0 ? keyScopeValue : void 0,
    hostname,
    owner,
    oods,
    boot_jwt,
    mini_device_jwts: mini_device_jwts && Object.keys(mini_device_jwts).length > 0 ? mini_device_jwts : void 0,
    devices: devices && Object.keys(devices).length > 0 ? devices : void 0,
    sn
  });
}
function ownerDocumentToOrderedJson(doc) {
  return ownerDocumentPayload(doc);
}
function zoneDocumentToOrderedJson(doc) {
  return zoneDocumentPayload(doc);
}
function deviceDocumentToOrderedJson(doc) {
  return deviceDocumentPayload(doc);
}
const KEY_SCOPE_MANUAL = "manual";
const KEY_SCOPE_ZONE_PUBLISH = "zone:publish";
const KEY_SCOPE_MESSAGE_CREATE = "message:create";
const KEY_SCOPE_CONTENT_CREATE = "content:create";
const KEY_SCOPE_AGENT_SPEND = "agent:spend";
const KEY_SCOPE_AGENT_RECEIVE = "agent:receive";
const KEY_SCOPE_AGENT_CREATE_CONTENT = "agent:create-content";
function getDocumentKeyScope(doc) {
  const keyScope = doc.keyScope ?? doc["buckyos:scopes"];
  return keyScope ?? {};
}
function getDocumentAuthKey(doc, kid) {
  const methods = doc.verificationMethod ?? [];
  if (methods.length === 0) {
    return null;
  }
  if (kid === void 0) {
    return methods[0].publicKeyJwk;
  }
  const method = methods.find((item) => item.id === kid);
  return method ? method.publicKeyJwk : null;
}
function getDocumentDefaultKey(doc) {
  const method = (doc.verificationMethod ?? []).find((item) => item.id === "#main_key");
  return method ? method.publicKeyJwk : null;
}
function getKeyIdsByScope(doc, scope) {
  return getDocumentKeyScope(doc)[scope] ?? null;
}
function hasKeyScope(doc) {
  return Object.keys(getDocumentKeyScope(doc)).length > 0;
}
function getStandardScopeKeyIds(doc) {
  const capabilityInvocation = doc.capabilityInvocation;
  if (Array.isArray(capabilityInvocation) && capabilityInvocation.length > 0) {
    return capabilityInvocation;
  }
  const authentication = doc.authentication;
  if (Array.isArray(authentication) && authentication.length > 0) {
    return authentication;
  }
  if (isBuckyOSDIDObjectCard(doc)) {
    const assertionMethod = doc.assertionMethod;
    if (Array.isArray(assertionMethod) && assertionMethod.length > 0) {
      return assertionMethod;
    }
  }
  return null;
}
function normalizeKeyIdForLocalLookup(doc, keyId) {
  const documentId = doc.id;
  if (keyId.startsWith(documentId)) {
    const localKeyId = keyId.slice(documentId.length);
    if (localKeyId.startsWith("#")) {
      return localKeyId;
    }
  }
  return keyId;
}
function expandLocalKeyId(doc, keyId) {
  if (keyId.startsWith("#")) {
    return `${doc.id}${keyId}`;
  }
  return keyId;
}
function isSameDocumentKeyId(doc, left, right) {
  return left === right || normalizeKeyIdForLocalLookup(doc, left) === normalizeKeyIdForLocalLookup(doc, right) || expandLocalKeyId(doc, left) === expandLocalKeyId(doc, right);
}
function getKeyFromKeyIds(doc, keyIds) {
  for (const keyId of keyIds) {
    const localKeyId = normalizeKeyIdForLocalLookup(doc, keyId);
    const jwk = getDocumentAuthKey(doc, localKeyId);
    if (jwk) {
      return [keyId, jwk];
    }
  }
  return null;
}
function getKeyByScope(doc, scope) {
  const scopedKeyIds = getKeyIdsByScope(doc, scope);
  if (scopedKeyIds) {
    return getKeyFromKeyIds(doc, scopedKeyIds);
  }
  if (hasKeyScope(doc)) {
    return null;
  }
  const standardKeyIds = getStandardScopeKeyIds(doc);
  if (standardKeyIds) {
    const key = getKeyFromKeyIds(doc, standardKeyIds);
    if (key) {
      return key;
    }
  }
  const authKey = getDocumentAuthKey(doc);
  return authKey ? ["", authKey] : null;
}
function isKeyAllowedInScope(doc, scope, keyId) {
  const scopedKeyIds = getKeyIdsByScope(doc, scope);
  if (scopedKeyIds) {
    return scopedKeyIds.some((allowedKeyId) => isSameDocumentKeyId(doc, allowedKeyId, keyId));
  }
  if (hasKeyScope(doc)) {
    return false;
  }
  const standardKeyIds = getStandardScopeKeyIds(doc);
  if (standardKeyIds) {
    return standardKeyIds.some((allowedKeyId) => isSameDocumentKeyId(doc, allowedKeyId, keyId));
  }
  return getDocumentAuthKey(doc, normalizeKeyIdForLocalLookup(doc, keyId)) !== null;
}
function parseDidDoc(doc) {
  const encoded = typeof doc === "string" ? encodedDocumentFromStr(doc) : doc;
  const isJwt = encoded.type === "jwt";
  const value = encodedDocumentToJsonValue(encoded);
  if (typeof value !== "object" || value === null) {
    throw new Error("namelib: unknown did document");
  }
  const ensureVersionSeqForJwt = (docTypeName) => {
    if (isJwt && typeof value.version_seq !== "number") {
      throw new Error(`namelib: ${docTypeName} version_seq is required when encoding as JWT`);
    }
  };
  if (value.verificationMethod !== void 0 && value.name !== void 0 && (value.display_name !== void 0 || value.displayName !== void 0 || value.full_name !== void 0)) {
    ensureVersionSeqForJwt("OwnerDocument");
    return { docType: "owner", doc: value };
  }
  if (value.httpServicePorts !== void 0) {
    ensureVersionSeqForJwt("AgentDocument");
    return { docType: "agent", doc: value };
  }
  if (value.device_type !== void 0) {
    ensureVersionSeqForJwt("DeviceDocument");
    return { docType: "device", doc: value };
  }
  if (value.oods !== void 0) {
    ensureVersionSeqForJwt("ZoneDocument");
    return { docType: "zone", doc: value };
  }
  if (Array.isArray(value.service) && value.service.some((service) => (service == null ? void 0 : service.type) === DID_OBJECT_SERVICE_TYPE)) {
    ensureVersionSeqForJwt("DIDObjectCard");
    return { docType: "did-object", doc: value };
  }
  throw new Error("namelib: unknown did document");
}
function getDidDocType(parsed) {
  return parsed.docType;
}
function parseDidDocAs(doc, docType) {
  const parsed = parseDidDoc(doc);
  if (parsed.docType !== docType) {
    throw new Error(`namelib: expected ${docType} document, got ${parsed.docType}`);
  }
  return parsed.doc;
}
const namelib = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  BUCKYOS_CONTEXT_BASE,
  DEFAULT_EXPIRE_TIME,
  DID,
  DID_CORE_CONTEXT,
  DID_DOC_AUTHKEY,
  KEY_SCOPE_AGENT_CREATE_CONTENT,
  KEY_SCOPE_AGENT_RECEIVE,
  KEY_SCOPE_AGENT_SPEND,
  KEY_SCOPE_CONTENT_CREATE,
  KEY_SCOPE_MANUAL,
  KEY_SCOPE_MESSAGE_CREATE,
  KEY_SCOPE_ZONE_PUBLISH,
  base64UrlDecodeToBytes,
  base64UrlDecodeToString,
  base64UrlEncodeBytes,
  base64UrlEncodeString,
  buckyosContext,
  buckyosGetUnixTimestamp,
  createJwkByX,
  decodeDeviceDocument,
  decodeJwtClaimWithoutVerify,
  decodeJwtHeaderWithoutVerify,
  decodeZoneBootDocument,
  derToPkcs8Pem,
  deviceDocumentToOrderedJson,
  deviceMiniDocumentFromJwt,
  deviceMiniDocumentToJwt,
  encodeDeviceDocument,
  encodeOwnerDocument,
  encodeZoneBootDocument,
  encodeZoneDocument,
  encodedDocumentFromStr,
  encodedDocumentToJsonValue,
  encodedDocumentToString,
  expandLocalKeyId,
  generateEd25519KeyPair,
  getDeviceDidFromJwk,
  getDidDocType,
  getDocumentAuthKey,
  getDocumentDefaultKey,
  getDocumentKeyScope,
  getKeyByScope,
  getKeyFromKeyIds,
  getKeyIdsByScope,
  getKnownWeb3BridgeConfig,
  getPublicKeyXFromPrivatePem,
  getStandardScopeKeyIds,
  getXFromJwk,
  hasKeyScope,
  isKeyAllowedInScope,
  isSameDocumentKeyId,
  newDeviceDocument,
  newDeviceDocumentByJwk,
  newDeviceDocumentByMiniDocument,
  newDeviceMiniDocument,
  newDeviceMiniDocumentByDeviceDocument,
  newNodeIdentityConfig,
  newOwnerDocument,
  newOwnerDocumentByPkx,
  newZoneBootDocument,
  newZoneDocument,
  normalizeKeyIdForLocalLookup,
  oodDescriptionToString,
  oodNodeTypeIsGateway,
  oodNodeTypeIsOod,
  ownerDocumentGetDefaultZoneDid,
  ownerDocumentGetHistoricalKeys,
  ownerDocumentIsBoundToZone,
  ownerDocumentSetDefaultZoneDid,
  ownerDocumentToOrderedJson,
  ownerDocumentValidateJwtRevocation,
  parseDidDoc,
  parseDidDocAs,
  parseOODDescription,
  pemToDer,
  resetKnownWeb3BridgeConfigForTest,
  setKnownWeb3BridgeConfig,
  signJwtEdDSA,
  verifyJwtEdDSA,
  zoneBootDocumentGetGatewayName,
  zoneBootDocumentToZoneDocument,
  zoneDocumentGetDefaultGateway,
  zoneDocumentGetSnApiUrl,
  zoneDocumentToOrderedJson
}, Symbol.toStringTag, { value: "Module" }));
var commonjsGlobal = typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : {};
function getDefaultExportFromCjs(x2) {
  return x2 && x2.__esModule && Object.prototype.hasOwnProperty.call(x2, "default") ? x2["default"] : x2;
}
var canonicalize = function serialize(object) {
  if (typeof object === "number" && isNaN(object)) {
    throw new Error("NaN is not allowed");
  }
  if (typeof object === "number" && !isFinite(object)) {
    throw new Error("Infinity is not allowed");
  }
  if (object === null || typeof object !== "object") {
    return JSON.stringify(object);
  }
  if (object.toJSON instanceof Function) {
    return serialize(object.toJSON());
  }
  if (Array.isArray(object)) {
    const values2 = object.reduce((t2, cv, ci) => {
      const comma = ci === 0 ? "" : ",";
      const value = cv === void 0 || typeof cv === "symbol" ? null : cv;
      return `${t2}${comma}${serialize(value)}`;
    }, "");
    return `[${values2}]`;
  }
  const values = Object.keys(object).sort().reduce((t2, cv) => {
    if (object[cv] === void 0 || typeof object[cv] === "symbol") {
      return t2;
    }
    const comma = t2.length === 0 ? "" : ",";
    return `${t2}${comma}${serialize(cv)}:${serialize(object[cv])}`;
  }, "");
  return `{${values}}`;
};
const canonicalize$1 = /* @__PURE__ */ getDefaultExportFromCjs(canonicalize);
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
function ensureValidJcsString(value) {
  for (let i2 = 0; i2 < value.length; i2++) {
    const code = value.charCodeAt(i2);
    if (code < 55296 || code > 57343)
      continue;
    if (code <= 56319) {
      const next = value.charCodeAt(i2 + 1);
      if (i2 + 1 < value.length && next >= 56320 && next <= 57343) {
        i2++;
        continue;
      }
    }
    throw new NdnError("InvalidData", "JSON string contains lone surrogate");
  }
}
function assertValidJcsPrimitive(value) {
  switch (typeof value) {
    case "string":
      ensureValidJcsString(value);
      return;
    case "number":
      if (!Number.isFinite(value)) {
        throw new NdnError("InvalidData", "JSON number MUST be finite for JCS");
      }
      if (Object.is(value, -0)) {
        throw new NdnError("InvalidData", "JSON number MUST NOT be negative zero for JCS");
      }
      return;
    case "boolean":
      return;
    case "undefined":
      throw new NdnError("InvalidData", "undefined is not a valid JSON value");
    case "bigint":
      throw new NdnError("InvalidData", "bigint is not a valid JSON value");
    case "function":
      throw new NdnError("InvalidData", "function is not a valid JSON value");
    case "symbol":
      throw new NdnError("InvalidData", "symbol is not a valid JSON value");
    case "object":
      if (value === null)
        return;
      return;
  }
}
function canonicalizeJson(value) {
  assertValidJcsPrimitive(value);
  if (value === null || typeof value !== "object")
    return value;
  if (Array.isArray(value)) {
    const result2 = new Array(value.length);
    for (let i2 = 0; i2 < value.length; i2++) {
      if (!Object.prototype.hasOwnProperty.call(value, i2)) {
        throw new NdnError("InvalidData", "sparse arrays are not valid JSON values");
      }
      result2[i2] = canonicalizeJson(value[i2]);
    }
    return result2;
  }
  const keys = Object.keys(value).sort();
  const result = {};
  for (const k2 of keys) {
    ensureValidJcsString(k2);
    result[k2] = canonicalizeJson(value[k2]);
  }
  return result;
}
function toCanonicalJsonString(value) {
  const normalized = canonicalizeJson(value);
  const result = canonicalize$1(normalized);
  if (result === void 0) {
    throw new NdnError("InvalidData", "failed to canonicalize JSON value");
  }
  return result;
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
export {
  buildNamedObjectByJson as $,
  newDeviceDocumentByJwk as A,
  verifyJwtEdDSA as B,
  ChunkId as C,
  DID_OBJECT_SERVICE_TYPE as D,
  deviceDocumentToOrderedJson as E,
  FileObject as F,
  decodeJwtClaimWithoutVerify as G,
  commonjsGlobal as H,
  createJwkByX as I,
  newOwnerDocument as J,
  ownerDocumentToOrderedJson as K,
  parseOODDescription as L,
  oodDescriptionToString as M,
  NODE_IDENTITY_SCHEMA_V2 as N,
  ObjId as O,
  newZoneBootDocument as P,
  newZoneDocument as Q,
  encodeZoneBootDocument as R,
  SimpleChunkList as S,
  DEFAULT_EXPIRE_TIME as T,
  zoneDocumentToOrderedJson as U,
  newDeviceMiniDocument as V,
  deviceMiniDocumentToJwt as W,
  encodeDeviceDocument as X,
  newDeviceMiniDocumentByDeviceDocument as Y,
  newDeviceDocumentByMiniDocument as Z,
  buckyosGetUnixTimestamp as _,
  ndn_types as a,
  getDefaultExportFromCjs as a0,
  DID_OBJECT_SERVICE_ID as b,
  isBuckyOSOwnerDocument as c,
  isBuckyOSDeviceMiniDocument as d,
  isBuckyOSZoneBootDocument as e,
  isBuckyOSNodeIdentityConfig as f,
  isBuckyOSLocalNodeIdentityConfig as g,
  isBuckyOSDeviceDocument as h,
  isW3CDIDDocumentBase as i,
  isBuckyOSAgentDocument as j,
  isBuckyOSZoneDocument as k,
  isBuckyOSDIDObjectCard as l,
  isBuckyOSZoneConfig as m,
  namelib as n,
  parseBuckyOSOwnerDocument as o,
  parseW3CDIDDocumentBase as p,
  parseBuckyOSDeviceMiniDocument as q,
  parseBuckyOSDIDDocument as r,
  getDidMethod as s,
  getDidIdentifier as t,
  ht as u,
  DID as v,
  canonicalize$1 as w,
  signJwtEdDSA as x,
  sha256Bytes as y,
  DirObject as z
};
//# sourceMappingURL=ndn_types-76983121.mjs.map
