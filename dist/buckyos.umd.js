!function(t,n){"object"==typeof exports&&"undefined"!=typeof module?n(exports):"function"==typeof define&&define.amd?define(["exports"],n):n((t="undefined"!=typeof globalThis?globalThis:t||self).buckyos={})}(this,(function(t){"use strict";class n extends Error{constructor(t){super(t),this.name="RPCError"}}class e{constructor(t,n=null,e=null){this.serverUrl=t,this.protocolType="HttpPostJson",this.seq=e||Date.now(),this.sessionToken=n||null,this.initToken=n||null}async call(t,n){return this._call(t,n)}setSeq(t){this.seq=t}async _call(t,e){const i=this.seq;this.seq+=1;const o={method:t,params:e,sys:this.sessionToken?[i,this.sessionToken]:[i]};try{const t=await window.fetch(this.serverUrl,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(o)});if(!t.ok)throw new n(`RPC call error: ${t.status}`);const e=await t.json();if(e.sys){const t=e.sys;if(!Array.isArray(t))throw new n("sys is not array");if(t.length>1){const e=t[0];if("number"!=typeof e)throw new n("sys[0] is not number");if(e!==i)throw new n(`seq not match: ${e}!=${i}`)}if(t.length>2){const e=t[1];if("string"!=typeof e)throw new n("sys[1] is not string");this.sessionToken=e}}if(e.error)throw new n(`RPC call error: ${e.error}`);return e.result}catch(s){if(s instanceof n)throw s;throw new n(`RPC call failed: ${s.message}`)}}}class i{constructor(t,n){this.zone_hostname=t,this.clientId=n,this.authWindow=null}async login(t=null){try{const n=await this._openAuthWindow(t);return JSON.parse(n)}catch(n){throw new Error(n||"Login failed")}}async request(t,n){}async _openAuthWindow(t=null){return new Promise(((n,e)=>{const i=window.screen.width/2-250,o=window.screen.height/2-300;let s=window.location.protocol+"//sys."+this.zone_hostname+"/login.html";const r=`${s}?client_id=${this.clientId}&redirect_uri=${encodeURIComponent(t)}&response_type=token`;alert(r),this.authWindow=window.open(r,"BuckyOS Login",`width=500,height=600,top=${o},left=${i}`),window.addEventListener("message",(t=>{if(console.log("message event",t),t.origin!==new URL(s).origin)return;const{token:i,error:o}=t.data;i?n(i):e(o||"BuckyOSLogin failed"),this.authWindow&&this.authWindow.close()}),!1)}))}}const o="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",s="ARRAYBUFFER not supported by this environment",r="UINT8ARRAY not supported by this environment";function u(t,n,e,i){let o,s,r;const u=n||[0],c=(e=e||0)>>>3,h=-1===i?3:0;for(o=0;o<t.length;o+=1)r=o+c,s=r>>>2,u.length<=s&&u.push(0),u[s]|=t[o]<<8*(h+i*(r%4));return{value:u,binLen:8*t.length+e}}function c(t,n,e){switch(n){case"UTF8":case"UTF16BE":case"UTF16LE":break;default:throw new Error("encoding must be UTF8, UTF16BE, or UTF16LE")}switch(t){case"HEX":return function(t,n,i){return function(t,n,e,i){let o,s,r,u;if(0!=t.length%2)throw new Error("String of HEX type must be in byte increments");const c=n||[0],h=(e=e||0)>>>3,l=-1===i?3:0;for(o=0;o<t.length;o+=2){if(s=parseInt(t.substr(o,2),16),isNaN(s))throw new Error("String of HEX type contains invalid characters");for(u=(o>>>1)+h,r=u>>>2;c.length<=r;)c.push(0);c[r]|=s<<8*(l+i*(u%4))}return{value:c,binLen:4*t.length+e}}(t,n,i,e)};case"TEXT":return function(t,i,o){return function(t,n,e,i,o){let s,r,u,c,h,l,a,w,f=0;const p=e||[0],d=(i=i||0)>>>3;if("UTF8"===n)for(a=-1===o?3:0,u=0;u<t.length;u+=1)for(s=t.charCodeAt(u),r=[],128>s?r.push(s):2048>s?(r.push(192|s>>>6),r.push(128|63&s)):55296>s||57344<=s?r.push(224|s>>>12,128|s>>>6&63,128|63&s):(u+=1,s=65536+((1023&s)<<10|1023&t.charCodeAt(u)),r.push(240|s>>>18,128|s>>>12&63,128|s>>>6&63,128|63&s)),c=0;c<r.length;c+=1){for(l=f+d,h=l>>>2;p.length<=h;)p.push(0);p[h]|=r[c]<<8*(a+o*(l%4)),f+=1}else for(a=-1===o?2:0,w="UTF16LE"===n&&1!==o||"UTF16LE"!==n&&1===o,u=0;u<t.length;u+=1){for(s=t.charCodeAt(u),!0===w&&(c=255&s,s=c<<8|s>>>8),l=f+d,h=l>>>2;p.length<=h;)p.push(0);p[h]|=s<<8*(a+o*(l%4)),f+=2}return{value:p,binLen:8*f+i}}(t,n,i,o,e)};case"B64":return function(t,n,i){return function(t,n,e,i){let s,r,u,c,h,l,a,w=0;const f=n||[0],p=(e=e||0)>>>3,d=-1===i?3:0,g=t.indexOf("=");if(-1===t.search(/^[a-zA-Z0-9=+/]+$/))throw new Error("Invalid character in base-64 string");if(t=t.replace(/=/g,""),-1!==g&&g<t.length)throw new Error("Invalid '=' found in base-64 string");for(r=0;r<t.length;r+=4){for(h=t.substr(r,4),c=0,u=0;u<h.length;u+=1)s=o.indexOf(h.charAt(u)),c|=s<<18-6*u;for(u=0;u<h.length-1;u+=1){for(a=w+p,l=a>>>2;f.length<=l;)f.push(0);f[l]|=(c>>>16-8*u&255)<<8*(d+i*(a%4)),w+=1}}return{value:f,binLen:8*w+e}}(t,n,i,e)};case"BYTES":return function(t,n,i){return function(t,n,e,i){let o,s,r,u;const c=n||[0],h=(e=e||0)>>>3,l=-1===i?3:0;for(s=0;s<t.length;s+=1)o=t.charCodeAt(s),u=s+h,r=u>>>2,c.length<=r&&c.push(0),c[r]|=o<<8*(l+i*(u%4));return{value:c,binLen:8*t.length+e}}(t,n,i,e)};case"ARRAYBUFFER":try{new ArrayBuffer(0)}catch(i){throw new Error(s)}return function(t,n,i){return o=n,s=i,r=e,u(new Uint8Array(t),o,s,r);var o,s,r};case"UINT8ARRAY":try{new Uint8Array(0)}catch(i){throw new Error(r)}return function(t,n,i){return u(t,n,i,e)};default:throw new Error("format must be HEX, TEXT, B64, BYTES, ARRAYBUFFER, or UINT8ARRAY")}}function h(t,n,e,i){switch(t){case"HEX":return function(t){return function(t,n,e,i){const o="0123456789abcdef";let s,r,u="";const c=n/8,h=-1===e?3:0;for(s=0;s<c;s+=1)r=t[s>>>2]>>>8*(h+e*(s%4)),u+=o.charAt(r>>>4&15)+o.charAt(15&r);return i.outputUpper?u.toUpperCase():u}(t,n,e,i)};case"B64":return function(t){return function(t,n,e,i){let s,r,u,c,h,l="";const a=n/8,w=-1===e?3:0;for(s=0;s<a;s+=3)for(c=s+1<a?t[s+1>>>2]:0,h=s+2<a?t[s+2>>>2]:0,u=(t[s>>>2]>>>8*(w+e*(s%4))&255)<<16|(c>>>8*(w+e*((s+1)%4))&255)<<8|h>>>8*(w+e*((s+2)%4))&255,r=0;r<4;r+=1)l+=8*s+6*r<=n?o.charAt(u>>>6*(3-r)&63):i.b64Pad;return l}(t,n,e,i)};case"BYTES":return function(t){return function(t,n,e){let i,o,s="";const r=n/8,u=-1===e?3:0;for(i=0;i<r;i+=1)o=t[i>>>2]>>>8*(u+e*(i%4))&255,s+=String.fromCharCode(o);return s}(t,n,e)};case"ARRAYBUFFER":try{new ArrayBuffer(0)}catch(u){throw new Error(s)}return function(t){return function(t,n,e){let i;const o=n/8,s=new ArrayBuffer(o),r=new Uint8Array(s),u=-1===e?3:0;for(i=0;i<o;i+=1)r[i]=t[i>>>2]>>>8*(u+e*(i%4))&255;return s}(t,n,e)};case"UINT8ARRAY":try{new Uint8Array(0)}catch(u){throw new Error(r)}return function(t){return function(t,n,e){let i;const o=n/8,s=-1===e?3:0,r=new Uint8Array(o);for(i=0;i<o;i+=1)r[i]=t[i>>>2]>>>8*(s+e*(i%4))&255;return r}(t,n,e)};default:throw new Error("format must be HEX, B64, BYTES, ARRAYBUFFER, or UINT8ARRAY")}}const l=4294967296,a=[1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298],w=[3238371032,914150663,812702999,4144912697,4290775857,1750603025,1694076839,3204075428],f=[1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225],p="Chosen SHA variant is not supported",d="Cannot set numRounds with MAC";function g(t,n){let e,i;const o=t.binLen>>>3,s=n.binLen>>>3,r=o<<3,u=4-o<<3;if(o%4!=0){for(e=0;e<s;e+=4)i=o+e>>>2,t.value[i]|=n.value[e>>>2]<<r,t.value.push(0),t.value[i+1]|=n.value[e>>>2]>>>u;return(t.value.length<<2)-4>=s+o&&t.value.pop(),{value:t.value,binLen:t.binLen+n.binLen}}return{value:t.value.concat(n.value),binLen:t.binLen+n.binLen}}function m(t){const n={outputUpper:!1,b64Pad:"=",outputLen:-1},e=t||{},i="Output length must be a multiple of 8";if(n.outputUpper=e.outputUpper||!1,e.b64Pad&&(n.b64Pad=e.b64Pad),e.outputLen){if(e.outputLen%8!=0)throw new Error(i);n.outputLen=e.outputLen}else if(e.shakeLen){if(e.shakeLen%8!=0)throw new Error(i);n.outputLen=e.shakeLen}if("boolean"!=typeof n.outputUpper)throw new Error("Invalid outputUpper formatting option");if("string"!=typeof n.b64Pad)throw new Error("Invalid b64Pad formatting option");return n}function y(t,n,e,i){const o=t+" must include a value and format";if(!n){if(!i)throw new Error(o);return i}if(void 0===n.value||!n.format)throw new Error(o);return c(n.format,n.encoding||"UTF8",e)(n.value)}class S{constructor(t,n,e){const i=e||{};if(this.t=n,this.i=i.encoding||"UTF8",this.numRounds=i.numRounds||1,isNaN(this.numRounds)||this.numRounds!==parseInt(this.numRounds,10)||1>this.numRounds)throw new Error("numRounds must a integer >= 1");this.o=t,this.h=[],this.u=0,this.l=!1,this.A=0,this.H=!1,this.S=[],this.p=[]}update(t){let n,e=0;const i=this.m>>>5,o=this.C(t,this.h,this.u),s=o.binLen,r=o.value,u=s>>>5;for(n=0;n<u;n+=i)e+this.m<=s&&(this.U=this.v(r.slice(n,n+i),this.U),e+=this.m);return this.A+=e,this.h=r.slice(e>>>5),this.u=s%this.m,this.l=!0,this}getHash(t,n){let e,i,o=this.R;const s=m(n);if(this.K){if(-1===s.outputLen)throw new Error("Output length must be specified in options");o=s.outputLen}const r=h(t,o,this.T,s);if(this.H&&this.g)return r(this.g(s));for(i=this.F(this.h.slice(),this.u,this.A,this.L(this.U),o),e=1;e<this.numRounds;e+=1)this.K&&o%32!=0&&(i[i.length-1]&=16777215>>>24-o%32),i=this.F(i,o,0,this.B(this.o),o);return r(i)}setHMACKey(t,n,e){if(!this.M)throw new Error("Variant does not support HMAC");if(this.l)throw new Error("Cannot set MAC key after calling update");const i=c(n,(e||{}).encoding||"UTF8",this.T);this.k(i(t))}k(t){const n=this.m>>>3,e=n/4-1;let i;if(1!==this.numRounds)throw new Error(d);if(this.H)throw new Error("MAC key already set");for(n<t.binLen/8&&(t.value=this.F(t.value,t.binLen,0,this.B(this.o),this.R));t.value.length<=e;)t.value.push(0);for(i=0;i<=e;i+=1)this.S[i]=909522486^t.value[i],this.p[i]=1549556828^t.value[i];this.U=this.v(this.S,this.U),this.A=this.m,this.H=!0}getHMAC(t,n){const e=m(n);return h(t,this.R,this.T,e)(this.Y())}Y(){let t;if(!this.H)throw new Error("Cannot call getHMAC without first setting MAC key");const n=this.F(this.h.slice(),this.u,this.A,this.L(this.U),this.R);return t=this.v(this.p,this.B(this.o)),t=this.F(n,this.R,this.m,t,this.R),t}}function A(t,n){return t<<n|t>>>32-n}function I(t,n){return t>>>n|t<<32-n}function N(t,n){return t>>>n}function b(t,n,e){return t^n^e}function k(t,n,e){return t&n^~t&e}function v(t,n,e){return t&n^t&e^n&e}function E(t){return I(t,2)^I(t,13)^I(t,22)}function R(t,n){const e=(65535&t)+(65535&n);return(65535&(t>>>16)+(n>>>16)+(e>>>16))<<16|65535&e}function H(t,n,e,i){const o=(65535&t)+(65535&n)+(65535&e)+(65535&i);return(65535&(t>>>16)+(n>>>16)+(e>>>16)+(i>>>16)+(o>>>16))<<16|65535&o}function K(t,n,e,i,o){const s=(65535&t)+(65535&n)+(65535&e)+(65535&i)+(65535&o);return(65535&(t>>>16)+(n>>>16)+(e>>>16)+(i>>>16)+(o>>>16)+(s>>>16))<<16|65535&s}function B(t){return I(t,7)^I(t,18)^N(t,3)}function L(t){return I(t,6)^I(t,11)^I(t,25)}function T(t){return[1732584193,4023233417,2562383102,271733878,3285377520]}function U(t,n){let e,i,o,s,r,u,c;const h=[];for(e=n[0],i=n[1],o=n[2],s=n[3],r=n[4],c=0;c<80;c+=1)h[c]=c<16?t[c]:A(h[c-3]^h[c-8]^h[c-14]^h[c-16],1),u=c<20?K(A(e,5),k(i,o,s),r,1518500249,h[c]):c<40?K(A(e,5),b(i,o,s),r,1859775393,h[c]):c<60?K(A(e,5),v(i,o,s),r,2400959708,h[c]):K(A(e,5),b(i,o,s),r,3395469782,h[c]),r=s,s=o,o=A(i,30),i=e,e=u;return n[0]=R(e,n[0]),n[1]=R(i,n[1]),n[2]=R(o,n[2]),n[3]=R(s,n[3]),n[4]=R(r,n[4]),n}function C(t,n,e,i){let o;const s=15+(n+65>>>9<<4),r=n+e;for(;t.length<=s;)t.push(0);for(t[n>>>5]|=128<<24-n%32,t[s]=4294967295&r,t[s-1]=r/l|0,o=0;o<t.length;o+=16)i=U(t.slice(o,o+16),i);return i}let _=class extends S{constructor(t,n,e){if("SHA-1"!==t)throw new Error(p);super(t,n,e);const i=e||{};this.M=!0,this.g=this.Y,this.T=-1,this.C=c(this.t,this.i,this.T),this.v=U,this.L=function(t){return t.slice()},this.B=T,this.F=C,this.U=[1732584193,4023233417,2562383102,271733878,3285377520],this.m=512,this.R=160,this.K=!1,i.hmacKey&&this.k(y("hmacKey",i.hmacKey,this.T))}};function O(t){let n;return n="SHA-224"==t?w.slice():f.slice(),n}function z(t,n){let e,i,o,s,r,u,c,h,l,w,f;const p=[];for(e=n[0],i=n[1],o=n[2],s=n[3],r=n[4],u=n[5],c=n[6],h=n[7],f=0;f<64;f+=1)p[f]=f<16?t[f]:H(I(d=p[f-2],17)^I(d,19)^N(d,10),p[f-7],B(p[f-15]),p[f-16]),l=K(h,L(r),k(r,u,c),a[f],p[f]),w=R(E(e),v(e,i,o)),h=c,c=u,u=r,r=R(s,l),s=o,o=i,i=e,e=R(l,w);var d;return n[0]=R(e,n[0]),n[1]=R(i,n[1]),n[2]=R(o,n[2]),n[3]=R(s,n[3]),n[4]=R(r,n[4]),n[5]=R(u,n[5]),n[6]=R(c,n[6]),n[7]=R(h,n[7]),n}let F=class extends S{constructor(t,n,e){if("SHA-224"!==t&&"SHA-256"!==t)throw new Error(p);super(t,n,e);const i=e||{};this.g=this.Y,this.M=!0,this.T=-1,this.C=c(this.t,this.i,this.T),this.v=z,this.L=function(t){return t.slice()},this.B=O,this.F=function(n,e,i,o){return function(t,n,e,i,o){let s,r;const u=15+(n+65>>>9<<4),c=n+e;for(;t.length<=u;)t.push(0);for(t[n>>>5]|=128<<24-n%32,t[u]=4294967295&c,t[u-1]=c/l|0,s=0;s<t.length;s+=16)i=z(t.slice(s,s+16),i);return r="SHA-224"===o?[i[0],i[1],i[2],i[3],i[4],i[5],i[6]]:i,r}(n,e,i,o,t)},this.U=O(t),this.m=512,this.R="SHA-224"===t?224:256,this.K=!1,i.hmacKey&&this.k(y("hmacKey",i.hmacKey,this.T))}};class M{constructor(t,n){this.N=t,this.I=n}}function P(t,n){let e;return n>32?(e=64-n,new M(t.I<<n|t.N>>>e,t.N<<n|t.I>>>e)):0!==n?(e=32-n,new M(t.N<<n|t.I>>>e,t.I<<n|t.N>>>e)):t}function Y(t,n){let e;return n<32?(e=32-n,new M(t.N>>>n|t.I<<e,t.I>>>n|t.N<<e)):(e=64-n,new M(t.I>>>n|t.N<<e,t.N>>>n|t.I<<e))}function $(t,n){return new M(t.N>>>n,t.I>>>n|t.N<<32-n)}function W(t,n,e){return new M(t.N&n.N^t.N&e.N^n.N&e.N,t.I&n.I^t.I&e.I^n.I&e.I)}function D(t){const n=Y(t,28),e=Y(t,34),i=Y(t,39);return new M(n.N^e.N^i.N,n.I^e.I^i.I)}function x(t,n){let e,i;e=(65535&t.I)+(65535&n.I),i=(t.I>>>16)+(n.I>>>16)+(e>>>16);const o=(65535&i)<<16|65535&e;return e=(65535&t.N)+(65535&n.N)+(i>>>16),i=(t.N>>>16)+(n.N>>>16)+(e>>>16),new M((65535&i)<<16|65535&e,o)}function X(t,n,e,i){let o,s;o=(65535&t.I)+(65535&n.I)+(65535&e.I)+(65535&i.I),s=(t.I>>>16)+(n.I>>>16)+(e.I>>>16)+(i.I>>>16)+(o>>>16);const r=(65535&s)<<16|65535&o;return o=(65535&t.N)+(65535&n.N)+(65535&e.N)+(65535&i.N)+(s>>>16),s=(t.N>>>16)+(n.N>>>16)+(e.N>>>16)+(i.N>>>16)+(o>>>16),new M((65535&s)<<16|65535&o,r)}function j(t,n,e,i,o){let s,r;s=(65535&t.I)+(65535&n.I)+(65535&e.I)+(65535&i.I)+(65535&o.I),r=(t.I>>>16)+(n.I>>>16)+(e.I>>>16)+(i.I>>>16)+(o.I>>>16)+(s>>>16);const u=(65535&r)<<16|65535&s;return s=(65535&t.N)+(65535&n.N)+(65535&e.N)+(65535&i.N)+(65535&o.N)+(r>>>16),r=(t.N>>>16)+(n.N>>>16)+(e.N>>>16)+(i.N>>>16)+(o.N>>>16)+(s>>>16),new M((65535&r)<<16|65535&s,u)}function q(t,n){return new M(t.N^n.N,t.I^n.I)}function J(t){const n=Y(t,19),e=Y(t,61),i=$(t,6);return new M(n.N^e.N^i.N,n.I^e.I^i.I)}function V(t){const n=Y(t,1),e=Y(t,8),i=$(t,7);return new M(n.N^e.N^i.N,n.I^e.I^i.I)}function Z(t){const n=Y(t,14),e=Y(t,18),i=Y(t,41);return new M(n.N^e.N^i.N,n.I^e.I^i.I)}const G=[new M(a[0],3609767458),new M(a[1],602891725),new M(a[2],3964484399),new M(a[3],2173295548),new M(a[4],4081628472),new M(a[5],3053834265),new M(a[6],2937671579),new M(a[7],3664609560),new M(a[8],2734883394),new M(a[9],1164996542),new M(a[10],1323610764),new M(a[11],3590304994),new M(a[12],4068182383),new M(a[13],991336113),new M(a[14],633803317),new M(a[15],3479774868),new M(a[16],2666613458),new M(a[17],944711139),new M(a[18],2341262773),new M(a[19],2007800933),new M(a[20],1495990901),new M(a[21],1856431235),new M(a[22],3175218132),new M(a[23],2198950837),new M(a[24],3999719339),new M(a[25],766784016),new M(a[26],2566594879),new M(a[27],3203337956),new M(a[28],1034457026),new M(a[29],2466948901),new M(a[30],3758326383),new M(a[31],168717936),new M(a[32],1188179964),new M(a[33],1546045734),new M(a[34],1522805485),new M(a[35],2643833823),new M(a[36],2343527390),new M(a[37],1014477480),new M(a[38],1206759142),new M(a[39],344077627),new M(a[40],1290863460),new M(a[41],3158454273),new M(a[42],3505952657),new M(a[43],106217008),new M(a[44],3606008344),new M(a[45],1432725776),new M(a[46],1467031594),new M(a[47],851169720),new M(a[48],3100823752),new M(a[49],1363258195),new M(a[50],3750685593),new M(a[51],3785050280),new M(a[52],3318307427),new M(a[53],3812723403),new M(a[54],2003034995),new M(a[55],3602036899),new M(a[56],1575990012),new M(a[57],1125592928),new M(a[58],2716904306),new M(a[59],442776044),new M(a[60],593698344),new M(a[61],3733110249),new M(a[62],2999351573),new M(a[63],3815920427),new M(3391569614,3928383900),new M(3515267271,566280711),new M(3940187606,3454069534),new M(4118630271,4000239992),new M(116418474,1914138554),new M(174292421,2731055270),new M(289380356,3203993006),new M(460393269,320620315),new M(685471733,587496836),new M(852142971,1086792851),new M(1017036298,365543100),new M(1126000580,2618297676),new M(1288033470,3409855158),new M(1501505948,4234509866),new M(1607167915,987167468),new M(1816402316,1246189591)];function Q(t){return"SHA-384"===t?[new M(3418070365,w[0]),new M(1654270250,w[1]),new M(2438529370,w[2]),new M(355462360,w[3]),new M(1731405415,w[4]),new M(41048885895,w[5]),new M(3675008525,w[6]),new M(1203062813,w[7])]:[new M(f[0],4089235720),new M(f[1],2227873595),new M(f[2],4271175723),new M(f[3],1595750129),new M(f[4],2917565137),new M(f[5],725511199),new M(f[6],4215389547),new M(f[7],327033209)]}function tt(t,n){let e,i,o,s,r,u,c,h,l,a,w,f;const p=[];for(e=n[0],i=n[1],o=n[2],s=n[3],r=n[4],u=n[5],c=n[6],h=n[7],w=0;w<80;w+=1)w<16?(f=2*w,p[w]=new M(t[f],t[f+1])):p[w]=X(J(p[w-2]),p[w-7],V(p[w-15]),p[w-16]),l=j(h,Z(r),(g=u,m=c,new M((d=r).N&g.N^~d.N&m.N,d.I&g.I^~d.I&m.I)),G[w],p[w]),a=x(D(e),W(e,i,o)),h=c,c=u,u=r,r=x(s,l),s=o,o=i,i=e,e=x(l,a);var d,g,m;return n[0]=x(e,n[0]),n[1]=x(i,n[1]),n[2]=x(o,n[2]),n[3]=x(s,n[3]),n[4]=x(r,n[4]),n[5]=x(u,n[5]),n[6]=x(c,n[6]),n[7]=x(h,n[7]),n}let nt=class extends S{constructor(t,n,e){if("SHA-384"!==t&&"SHA-512"!==t)throw new Error(p);super(t,n,e);const i=e||{};this.g=this.Y,this.M=!0,this.T=-1,this.C=c(this.t,this.i,this.T),this.v=tt,this.L=function(t){return t.slice()},this.B=Q,this.F=function(n,e,i,o){return function(t,n,e,i,o){let s,r;const u=31+(n+129>>>10<<5),c=n+e;for(;t.length<=u;)t.push(0);for(t[n>>>5]|=128<<24-n%32,t[u]=4294967295&c,t[u-1]=c/l|0,s=0;s<t.length;s+=32)i=tt(t.slice(s,s+32),i);return r="SHA-384"===o?[i[0].N,i[0].I,i[1].N,i[1].I,i[2].N,i[2].I,i[3].N,i[3].I,i[4].N,i[4].I,i[5].N,i[5].I]:[i[0].N,i[0].I,i[1].N,i[1].I,i[2].N,i[2].I,i[3].N,i[3].I,i[4].N,i[4].I,i[5].N,i[5].I,i[6].N,i[6].I,i[7].N,i[7].I],r}(n,e,i,o,t)},this.U=Q(t),this.m=1024,this.R="SHA-384"===t?384:512,this.K=!1,i.hmacKey&&this.k(y("hmacKey",i.hmacKey,this.T))}};const et=[new M(0,1),new M(0,32898),new M(2147483648,32906),new M(2147483648,2147516416),new M(0,32907),new M(0,2147483649),new M(2147483648,2147516545),new M(2147483648,32777),new M(0,138),new M(0,136),new M(0,2147516425),new M(0,2147483658),new M(0,2147516555),new M(2147483648,139),new M(2147483648,32905),new M(2147483648,32771),new M(2147483648,32770),new M(2147483648,128),new M(0,32778),new M(2147483648,2147483658),new M(2147483648,2147516545),new M(2147483648,32896),new M(0,2147483649),new M(2147483648,2147516424)],it=[[0,36,3,41,18],[1,44,10,45,2],[62,6,43,15,61],[28,55,25,21,56],[27,20,39,8,14]];function ot(t){let n;const e=[];for(n=0;n<5;n+=1)e[n]=[new M(0,0),new M(0,0),new M(0,0),new M(0,0),new M(0,0)];return e}function st(t){let n;const e=[];for(n=0;n<5;n+=1)e[n]=t[n].slice();return e}function rt(t,n){let e,i,o,s;const r=[],u=[];if(null!==t)for(i=0;i<t.length;i+=2)n[(i>>>1)%5][(i>>>1)/5|0]=q(n[(i>>>1)%5][(i>>>1)/5|0],new M(t[i+1],t[i]));for(e=0;e<24;e+=1){for(s=ot(),i=0;i<5;i+=1)r[i]=(c=n[i][0],h=n[i][1],l=n[i][2],a=n[i][3],w=n[i][4],new M(c.N^h.N^l.N^a.N^w.N,c.I^h.I^l.I^a.I^w.I));for(i=0;i<5;i+=1)u[i]=q(r[(i+4)%5],P(r[(i+1)%5],1));for(i=0;i<5;i+=1)for(o=0;o<5;o+=1)n[i][o]=q(n[i][o],u[i]);for(i=0;i<5;i+=1)for(o=0;o<5;o+=1)s[o][(2*i+3*o)%5]=P(n[i][o],it[i][o]);for(i=0;i<5;i+=1)for(o=0;o<5;o+=1)n[i][o]=q(s[i][o],new M(~s[(i+1)%5][o].N&s[(i+2)%5][o].N,~s[(i+1)%5][o].I&s[(i+2)%5][o].I));n[0][0]=q(n[0][0],et[e])}var c,h,l,a,w;return n}function ut(t){let n,e,i=0;const o=[0,0],s=[4294967295&t,t/l&2097151];for(n=6;n>=0;n--)e=s[n>>2]>>>8*n&255,0===e&&0===i||(o[i+1>>2]|=e<<8*(i+1),i+=1);return i=0!==i?i:1,o[0]|=i,{value:i+1>4?o:[o[0]],binLen:8+8*i}}function ct(t){return g(ut(t.binLen),t)}function ht(t,n){let e,i=ut(n);i=g(i,t);const o=n>>>2,s=(o-i.value.length%o)%o;for(e=0;e<s;e++)i.value.push(0);return i.value}let lt=class extends S{constructor(t,n,e){let i=6,o=0;super(t,n,e);const s=e||{};if(1!==this.numRounds){if(s.kmacKey||s.hmacKey)throw new Error(d);if("CSHAKE128"===this.o||"CSHAKE256"===this.o)throw new Error("Cannot set numRounds for CSHAKE variants")}switch(this.T=1,this.C=c(this.t,this.i,this.T),this.v=rt,this.L=st,this.B=ot,this.U=ot(),this.K=!1,t){case"SHA3-224":this.m=o=1152,this.R=224,this.M=!0,this.g=this.Y;break;case"SHA3-256":this.m=o=1088,this.R=256,this.M=!0,this.g=this.Y;break;case"SHA3-384":this.m=o=832,this.R=384,this.M=!0,this.g=this.Y;break;case"SHA3-512":this.m=o=576,this.R=512,this.M=!0,this.g=this.Y;break;case"SHAKE128":i=31,this.m=o=1344,this.R=-1,this.K=!0,this.M=!1,this.g=null;break;case"SHAKE256":i=31,this.m=o=1088,this.R=-1,this.K=!0,this.M=!1,this.g=null;break;case"KMAC128":i=4,this.m=o=1344,this.X(e),this.R=-1,this.K=!0,this.M=!1,this.g=this._;break;case"KMAC256":i=4,this.m=o=1088,this.X(e),this.R=-1,this.K=!0,this.M=!1,this.g=this._;break;case"CSHAKE128":this.m=o=1344,i=this.O(e),this.R=-1,this.K=!0,this.M=!1,this.g=null;break;case"CSHAKE256":this.m=o=1088,i=this.O(e),this.R=-1,this.K=!0,this.M=!1,this.g=null;break;default:throw new Error(p)}this.F=function(t,n,e,s,r){return function(t,n,e,i,o,s,r){let u,c,h=0;const l=[],a=o>>>5,w=n>>>5;for(u=0;u<w&&n>=o;u+=a)i=rt(t.slice(u,u+a),i),n-=o;for(t=t.slice(u),n%=o;t.length<a;)t.push(0);for(u=n>>>3,t[u>>2]^=s<<u%4*8,t[a-1]^=2147483648,i=rt(t,i);32*l.length<r&&(c=i[h%5][h/5|0],l.push(c.I),!(32*l.length>=r));)l.push(c.N),h+=1,0==64*h%o&&(rt(null,i),h=0);return l}(t,n,0,s,o,i,r)},s.hmacKey&&this.k(y("hmacKey",s.hmacKey,this.T))}O(t,n){const e=function(t){const n=t||{};return{funcName:y("funcName",n.funcName,1,{value:[],binLen:0}),customization:y("Customization",n.customization,1,{value:[],binLen:0})}}(t||{});n&&(e.funcName=n);const i=g(ct(e.funcName),ct(e.customization));if(0!==e.customization.binLen||0!==e.funcName.binLen){const t=ht(i,this.m>>>3);for(let n=0;n<t.length;n+=this.m>>>5)this.U=this.v(t.slice(n,n+(this.m>>>5)),this.U),this.A+=this.m;return 4}return 31}X(t){const n=function(t){const n=t||{};return{kmacKey:y("kmacKey",n.kmacKey,1),funcName:{value:[1128353099],binLen:32},customization:y("Customization",n.customization,1,{value:[],binLen:0})}}(t||{});this.O(t,n.funcName);const e=ht(ct(n.kmacKey),this.m>>>3);for(let i=0;i<e.length;i+=this.m>>>5)this.U=this.v(e.slice(i,i+(this.m>>>5)),this.U),this.A+=this.m;this.H=!0}_(t){const n=g({value:this.h.slice(),binLen:this.u},function(t){let n,e,i=0;const o=[0,0],s=[4294967295&t,t/l&2097151];for(n=6;n>=0;n--)e=s[n>>2]>>>8*n&255,0===e&&0===i||(o[i>>2]|=e<<8*i,i+=1);return i=0!==i?i:1,o[i>>2]|=i<<8*i,{value:i+1>4?o:[o[0]],binLen:8+8*i}}(t.outputLen));return this.F(n.value,n.binLen,this.A,this.L(this.U),t.outputLen)}};class at{constructor(t,n,e){if("SHA-1"==t)this.P=new _(t,n,e);else if("SHA-224"==t||"SHA-256"==t)this.P=new F(t,n,e);else if("SHA-384"==t||"SHA-512"==t)this.P=new nt(t,n,e);else{if("SHA3-224"!=t&&"SHA3-256"!=t&&"SHA3-384"!=t&&"SHA3-512"!=t&&"SHAKE128"!=t&&"SHAKE256"!=t&&"CSHAKE128"!=t&&"CSHAKE256"!=t&&"KMAC128"!=t&&"KMAC256"!=t)throw new Error(p);this.P=new lt(t,n,e)}}update(t){return this.P.update(t),this}getHash(t,n){return this.P.getHash(t,n)}setHMACKey(t,n,e){this.P.setHMACKey(t,n,e)}getHMAC(t,n){return this.P.getHMAC(t,n)}}function wt(t,n,e=null){const i=new at("SHA-256","TEXT",{encoding:"UTF8"});i.update(n+t+".buckyos");let o=i.getHash("B64");if(null==e)return o;const s=new at("SHA-256","TEXT",{encoding:"UTF8"});let r=o+e.toString();return s.update(r),s.getHash("B64")}function ft(t){localStorage.removeItem("buckyos.account_info");let n={path:"/",expires:new Date(0),secure:!0,sameSite:"Lax"};document.cookie=`${t}_token=; ${Object.entries(n).map((([t,n])=>`${t}=${n}`)).join("; ")}`}function pt(t,n){if(null==n.session_token)return void console.error("session_token is null,can't save account info");localStorage.setItem("buckyos.account_info",JSON.stringify(n));let e={path:"/",expires:new Date(Date.now()+2592e6),secure:!0,sameSite:"Lax"};document.cookie=`${t}_token=${n.session_token}; ${Object.entries(e).map((([t,n])=>`${t}=${n}`)).join("; ")}`}const dt="verify_hub";var gt=null,mt=null;const yt={zone_host_name:"",appid:"",default_protocol:"http://"};function St(){return null==gt?(console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first"),null):gt.zone_host_name}function At(t){if(null==gt)throw console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first"),new Error("BuckyOS WebSDK is not initialized,call initBuckyOS first");return gt.default_protocol+gt.zone_host_name+"/kapi/"+t}function It(){return gt?gt.appid:(console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first"),null)}const Nt={kRPCClient:e,AuthClient:i,initBuckyOS:async function t(n,e=null){if(gt&&console.warn("BuckyOS WebSDK is already initialized!"),!e){(e=yt).appid=n,e.default_protocol=window.location.protocol+"//";try{let t=window.location.host.split(".").slice(1).join(".");e.zone_host_name=t}catch(i){e.zone_host_name=window.location.host}let o=localStorage.getItem("buckyos.zone_host_name");return o?e.zone_host_name=o:(o=await async function(){const t=window.location.protocol,n=window.location.host,e=`${t}//${n}/zone_config.json`;try{if((await fetch(e)).ok)return n}catch(i){}try{let e=n.split(".").slice(1).join(".");const i=`${t}//${e}/zone_config.json`;if((await fetch(i)).ok)return e}catch(i){}return null}(),o&&(localStorage.setItem("buckyos.zone_host_name",o),e.zone_host_name=o)),await t(n,e)}gt=e},getBuckyOSConfig:function(){return gt},getRuntimeType:function(){if("undefined"!=typeof window){return"Browser-"+window.navigator.userAgent.toLowerCase()}return"undefined"!=typeof process&&process.versions&&process.versions.node?"NodeJS-"+process.versions.node:"Unknown"},getAppId:It,attachEvent:function(t,n){},removeEvent:function(t){},getAccountInfo:function(){return mt||(null==gt?(console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first"),null):null)},doLogin:async function(t,n){let e=Nt.getAppId();if(null==e)return console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first"),null;let i=Date.now(),o=wt(t,n,i);console.log("password_hash: ",o),localStorage.removeItem("account_info");try{let n=Nt.getServiceRpcClient(dt);n.setSeq(i);let s=await n.call("login",{type:"password",username:t,password:o,appid:e,source_url:window.location.href});return pt(e,s),s}catch(s){throw console.error("login failed: ",s),s}},login:async function(t=!0){if(null==gt)return console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first"),null;let n=It();if(null==n)return console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first"),null;if(t){let t=function(){let t=localStorage.getItem("buckyos.account_info");return null==t?null:JSON.parse(t)}();if(t)return mt=t}ft(n);let e=St();if(null==e)return console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first"),null;try{let t=new i(e,n),o=await t.login();return o&&(pt(n,o),mt=o),o}catch(o){throw console.error("login failed: ",o),o}},logout:function(t=!0){if(null==gt)return void console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first");let n=It();null!=n?null!=mt?t&&ft(n):console.error("BuckyOS WebSDK is not login,call login first"):console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first")},hashPassword:wt,getAppSetting:function(t=null){},setAppSetting:function(t=null,n){},getZoneHostName:St,getZoneServiceURL:At,getServiceRpcClient:function(t){if(null==gt)throw console.error("BuckyOS WebSDK is not initialized,call initBuckyOS first"),new Error("BuckyOS WebSDK is not initialized,call initBuckyOS first");let n=null;return mt&&(n=mt.session_token),new e(At(t),n)}};t.BS_SERVICE_VERIFY_HUB=dt,t.buckyos=Nt,Object.defineProperty(t,Symbol.toStringTag,{value:"Module"})}));
//# sourceMappingURL=buckyos.umd.js.map
