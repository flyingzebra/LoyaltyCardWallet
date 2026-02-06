
const barcode_render_scripts = `
/* ---------- Shared 5-bit PNG slice tables (from Notionovus MIT snippet) ---------- */
var array5bit_A = [ 'f//AAAAAAAAAAAAAAAAAAAA','f//AAAAAAAAAAAAAAAAAAAB','f//AAAAAAAAAAAAAAEAAAD/','f//AAAAAAAAAAAAAAEAAAAA',
'f//AAAAAAAAAQAAAP8AAAAA','f//AAAAAAAAAQAAAP8AAAAB','f//AAAAAAAAAQAAAAAAAAD/','f//AAAAAAAAAQAAAAAAAAAA',
'f//AAABAAAA/wAAAAAAAAAA','f//AAABAAAA/wAAAAAAAAAB','f//AAABAAAA/wAAAAEAAAD/','f//AAABAAAA/wAAAAEAAAAA',
'f//AAABAAAAAAAAAP8AAAAA','f//AAABAAAAAAAAAP8AAAAB','f//AAABAAAAAAAAAAAAAAD/','f//AAABAAAAAAAAAAAAAAAA',
'QD/AAD/AAAAAAAAAAAAAAAA','QD/AAD/AAAAAAAAAAAAAAAB','QD/AAD/AAAAAAAAAAEAAAD/','QD/AAD/AAAAAAAAAAEAAAAA',
'QD/AAD/AAAAAQAAAP8AAAAA','QD/AAD/AAAAAQAAAP8AAAAB','QD/AAD/AAAAAQAAAAAAAAD/','QD/AAD/AAAAAQAAAAAAAAAA',
'QD/AAAAAAAA/wAAAAAAAAAA','QD/AAAAAAAA/wAAAAAAAAAB','SL/AADeAAAA/gAAAAIAAAD+','QD/AAAAAAAA/wAAAAEAAAAA',
'QD/AAAAAAAAAAAAAP8AAAAA','QD/AAAAAAAAAAAAAP8AAAAB','QD/AAAAAAAAAAAAAAAAAAD/','QD/AAAAAAAAAAAAAAAAAAAA' ];

var array5bit_B = [ 'US0CAuSD38g','UUYCA7QBErs','ajEDAm49ReY','UUoCA+juogg','bjEDAjQrOn0','bkoDA3iPVH4',
'ajUDAt82atY','UU4CA1nljTg','cjEDAghkmFU','ckoDA0TA9lY','izUEAhrxcbg','ck4DAxY8F10','bjUDAlvFFR8',
'bk4DAxdhexw','ajkDAr7LFAw','UVICAyQ+UJI','TTECAq7UnEM','TUoCA+Jw8kA','ZjUDAmZGozo','TU4CA7CME0s',
'ajUDAvnk9E4','ak4DA7VAmk0','ZjkDAtle3bI','TVICAxOyzrM','STUCAqHeHtM','SU4CA+16cNA','h6QEAZKdo54',
'SVICA62zYxM','RTkCAqx1lb4','RVICA/z3WM0','QT0CAkdoxRU','KFYBA46vJCA' ];

var stringStart = '<img alt="bar" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAACCAQAAADLaIVbAAAANUlEQVQIHQEqANX/A';
var stringMid   = 'AAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAA';
var stringEnd   = 'AAAAASUVORK5CYII=" width="';

function genBarcode(bitString, sliceWidthPx, sliceHeightPx) {
  var m = bitString.length % 5;
  if (m > 0) for (var i=0;i<5-m;i++) bitString += "0";
  var chunks = bitString.length / 5;
  var seq = new Array(chunks);
  for (var j=0;j<chunks;j++) seq[j] = parseInt(bitString.substr(j*5, 5), 2);

  var out = "";
  for (var k=0;k<seq.length;k++) {
    out += stringStart + array5bit_A[seq[k]] + stringMid + array5bit_B[seq[k]] +
           stringEnd + sliceWidthPx + '" height="' + sliceHeightPx + '">';
  }
  return out;
}

/* ---------------- EAN-13 ---------------- */
var arrayCodeEANBin = [
  [ '0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011' ],
  [ '0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111' ],
  [ '1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100' ]
];
var arrayStructEAN = ['000000','001011','001101','001110','010011','011001','011100','010101','010110','011010'];

function eanCompute(d12) {
  var sumOdd=0, sumEven=0;
  for (var i=0;i<12;i+=2){ sumEven += parseInt(d12[i],10); sumOdd += parseInt(d12[i+1],10); }
  var chk = ((sumOdd*3)+sumEven)%10; if(chk>0) chk=10-chk;
  var d13 = d12 + chk;

  var raw = "101";
  var struct = arrayStructEAN[parseInt(d13[0],10)];
  for (var a=1;a<7;a++) raw += arrayCodeEANBin[parseInt(struct[a-1],10)][parseInt(d13[a],10)];
  raw += "01010";
  for (var b=0;b<6;b++) raw += arrayCodeEANBin[2][parseInt(d13[b+7],10)];
  raw += "101";
  return { bits: raw, digits13: d13 };
}

function renderEAN13(targetId, digits, barH, sliceW){
  var clean=(digits||"").replace(/\\D/g,"");
  if(clean.length<12) return {ok:false, error:"EAN-13 requires >=12 digits"};
  clean=clean.substr(0,12);
  var r=eanCompute(clean);
  document.getElementById(targetId).innerHTML = genBarcode(r.bits, sliceW, barH);
  return {ok:true, digits13:r.digits13};
}

/* ---------------- Code128-B (minimal) ----------------
   We render into a module-bitstring then reuse genBarcode().
   This is a compact subset-B encoder (ASCII 32..127).
*/
var C128_PAT = [
[2,1,2,2,2,2],[2,2,2,1,2,2],[2,2,2,2,2,1],[1,2,1,2,2,3],[1,2,1,3,2,2],[1,3,1,2,2,2],
[1,2,2,2,1,3],[1,2,2,3,1,2],[1,3,2,2,1,2],[2,2,1,2,1,3],[2,2,1,3,1,2],[2,3,1,2,1,2],
[1,1,2,2,3,2],[1,2,2,1,3,2],[1,2,2,2,3,1],[1,1,3,2,2,2],[1,2,3,1,2,2],[1,2,3,2,2,1],
[2,2,3,2,1,1],[2,2,1,1,3,2],[2,2,1,2,3,1],[2,1,3,2,1,2],[2,2,3,1,1,2],[3,1,2,1,3,1],
[3,1,1,2,2,2],[3,2,1,1,2,2],[3,2,1,2,2,1],[3,1,2,2,1,2],[3,2,2,1,1,2],[3,2,2,2,1,1],
[2,1,2,1,2,3],[2,1,2,3,2,1],[2,3,2,1,2,1],[1,1,1,3,2,3],[1,3,1,1,2,3],[1,3,1,3,2,1],
[1,1,2,3,1,3],[1,3,2,1,1,3],[1,3,2,3,1,1],[2,1,1,3,1,3],[2,3,1,1,1,3],[2,3,1,3,1,1],
[1,1,2,1,3,3],[1,1,2,3,3,1],[1,3,2,1,3,1],[1,1,3,1,2,3],[1,1,3,3,2,1],[1,3,3,1,2,1],
[3,1,3,1,2,1],[2,1,1,3,3,1],[2,3,1,1,3,1],[2,1,3,1,1,3],[2,1,3,3,1,1],[2,1,3,1,3,1],
[3,1,1,1,2,3],[3,1,1,3,2,1],[3,3,1,1,2,1],[3,1,2,1,1,3],[3,1,2,3,1,1],[3,3,2,1,1,1],
[3,1,4,1,1,1],[2,2,1,4,1,1],[4,3,1,1,1,1],[1,1,1,2,2,4],[1,1,1,4,2,2],[1,2,1,1,2,4],
[1,2,1,4,2,1],[1,4,1,1,2,2],[1,4,1,2,2,1],[1,1,2,2,1,4],[1,1,2,4,1,2],[1,2,2,1,1,4],
[1,2,2,4,1,1],[1,4,2,1,1,2],[1,4,2,2,1,1],[2,4,1,2,1,1],[2,2,1,1,1,4],[4,1,3,1,1,1],
[2,4,1,1,1,2],[1,3,4,1,1,1],[1,1,1,2,4,2],[1,2,1,1,4,2],[1,2,1,2,4,1],[1,1,4,2,1,2],
[1,2,4,1,1,2],[1,2,4,2,1,1],[4,1,1,2,1,2],[4,2,1,1,1,2],[4,2,1,2,1,1],[2,1,2,1,4,1],
[2,1,4,1,2,1],[4,1,2,1,2,1],[1,1,1,1,4,3],[1,1,1,3,4,1],[1,3,1,1,4,1],[1,1,4,1,1,3],
[1,1,4,3,1,1],[4,1,1,1,1,3],[4,1,1,3,1,1],[1,1,3,1,4,1],[1,1,4,1,3,1],[3,1,1,1,4,1],
[4,1,1,1,3,1],[2,1,1,4,1,2],[2,1,1,2,1,4],[2,1,1,2,3,2],[2,3,3,1,1,1],[2,1,4,1,1,2],
[2,1,2,1,1,4]
];
// Start/Stop (explicit)
var C128_START_B = [2,1,1,2,1,4];          // code 104
var C128_STOP    = [2,3,3,1,1,1,2];        // code 106 (7 elements)

function c128B_codes(text){
  var s=(text||"");
  var codes=[];
  for(var i=0;i<s.length;i++){
    var cc=s.charCodeAt(i);
    if(cc<32||cc>127) cc=63; // '?'
    codes.push(cc-32);
  }
  var checksum = 104;
  for(var j=0;j<codes.length;j++) checksum += codes[j]*(j+1);
  checksum = checksum % 103;
  return { data: codes, checksum: checksum };
}

function widthsToBits(widths){
  var bits="", bar=true;
  for(var i=0;i<widths.length;i++){
    for(var k=0;k<widths[i];k++) bits += bar ? "1":"0";
    bar=!bar;
  }
  return bits;
}

function renderCode128B(targetId, text, barH, sliceW){
  var enc=c128B_codes(text);
  var bits = widthsToBits(C128_START_B);
  for(var i=0;i<enc.data.length;i++) bits += widthsToBits(C128_PAT[enc.data[i]]);
  bits += widthsToBits(C128_PAT[enc.checksum]);
  bits += widthsToBits(C128_STOP);
  // quiet zones (10 modules)
  var q="0000000000";
  bits = q + bits + q;
  document.getElementById(targetId).innerHTML = genBarcode(bits, sliceW, barH);
  return { ok:true };
}
`


/**
 * Determine dominant color of a base64 image.
 *
 * @param {string} base64 - Either a full data URL ("data:image/png;base64,...")
 *                          or raw base64 (no prefix).
 * @param {object} [opts]
 * @param {number} [opts.sampleStride=8] - Sample every Nth pixel (higher = faster, less accurate).
 * @param {number} [opts.quant=24] - Quantization step in 0..255 (higher = fewer buckets, more stable).
 * @param {number} [opts.minAlpha=32] - Ignore pixels with alpha below this (0..255).
 * @param {number} [opts.maxSize=256] - Downscale longest edge to this for speed (0 disables).
 * @returns {Promise<{r:number,g:number,b:number,hex:string}>}
 */
function dominantColorFromBase64(base64, opts = {}) {
  const {
    sampleStride = 8,
    quant = 24,
    minAlpha = 32,
    maxSize = 256
  } = opts;

  const dataUrl = base64.startsWith("data:")
    ? base64
    : `data:image/png;base64,${base64}`;

  return new Promise((resolve, reject) => {
    const img = new Image();
    // If you ever pass non-data URLs, CORS could matter; for base64 it’s fine.
    img.onload = () => {
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;

      // Optional downscale for speed
      if (maxSize && (w > maxSize || h > maxSize)) {
        const scale = maxSize / Math.max(w, h);
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));
      }

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);

      const { data } = ctx.getImageData(0, 0, w, h);

      // Map bucketKey -> count
      const buckets = new Map();

      // Quantize to reduce tiny variations:
      // e.g. quant=24 => values snap to 0,24,48,...,240
      const q = Math.max(1, quant | 0);
      const snap = (v) => Math.min(255, Math.round(v / q) * q);

      // We’ll also keep a running sum for the winning bucket to return a nicer mean color
      const sums = new Map(); // bucketKey -> {r,g,b,count}

      // sampleStride is in "pixels", so step by 4*stride in the RGBA array
      const step = Math.max(1, sampleStride | 0) * 4;

      for (let i = 0; i < data.length; i += step) {
        const a = data[i + 3];
        if (a < minAlpha) continue;

        const r = snap(data[i]);
        const g = snap(data[i + 1]);
        const b = snap(data[i + 2]);

        const key = (r << 16) | (g << 8) | b;

        buckets.set(key, (buckets.get(key) || 0) + 1);

        const s = sums.get(key) || { r: 0, g: 0, b: 0, count: 0 };
        // accumulate *original* (un-snapped) values for a better mean
        s.r += data[i];
        s.g += data[i + 1];
        s.b += data[i + 2];
        s.count += 1;
        sums.set(key, s);
      }

      if (buckets.size === 0) {
        // all pixels were transparent (or filtered out)
        resolve({ r: 0, g: 0, b: 0, hex: "#000000" });
        return;
      }

      // Find most frequent bucket
      let bestKey = null;
      let bestCount = -1;
      for (const [key, count] of buckets.entries()) {
        if (count > bestCount) {
          bestCount = count;
          bestKey = key;
        }
      }

      const best = sums.get(bestKey);
      const r = Math.round(best.r / best.count);
      const g = Math.round(best.g / best.count);
      const b = Math.round(best.b / best.count);

      const hex =
        "#" +
        [r, g, b]
          .map((v) => v.toString(16).padStart(2, "0"))
          .join("")
          .toLowerCase();

      resolve({ r, g, b, hex });
    };

    img.onerror = () => reject(new Error("Could not decode base64 image."));
    img.src = dataUrl;
  });
}
