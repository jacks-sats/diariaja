/**
 * ⚠️ DEPRECIADO — use scripts/generate-icons.py
 *
 * Esse script gerava ícones genéricos "DJ" laranjas (placeholder de quando o
 * app ainda não tinha logo definido). Substituído em 2026-05 pelo gerador
 * Python que processa o logo real (círculo laranja + raio amarelo) a partir
 * de assets/icon-source-brand.png.
 *
 * Mantido aqui por enquanto pra histórico. NÃO rodar — vai sobrescrever os
 * ícones bons com o placeholder antigo.
 *
 * Gerador antigo (zlib + png chunks puros):
 * Uso: node generate-icons.mjs
 * Cria: public/icon-192.png e public/icon-512.png
 * Usa apenas módulos built-in do Node.js (sem dependências externas).
 * Gera ícones com fundo laranja (#FF6B35) e letras "DJ" centralizadas em branco.
 */

import zlib from "zlib";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── CRC32 ────────────────────────────────────────────────────────────────────
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const d = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return Buffer.concat([u32(d.length), t, d, u32(crc32(Buffer.concat([t, d])))]);
}

// ── Renderizador de pixels ───────────────────────────────────────────────────
// Desenha retângulo colorido
function fillRect(pixels, w, x0, y0, bw, bh, r, g, b) {
  for (let y = y0; y < y0 + bh; y++) {
    for (let x = x0; x < x0 + bw; x++) {
      if (x < 0 || x >= w || y < 0 || y >= w) continue;
      const i = (y * w + x) * 4;
      pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = 255;
    }
  }
}

// Desenha círculo preenchido
function fillCircle(pixels, size, cx, cy, radius, r, g, b) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius) {
        const i = (y * size + x) * 4;
        pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = 255;
      }
    }
  }
}

// Bitmap 5x7 para cada letra (pixels ligados = 1)
const FONT = {
  D: [
    [1,1,1,0,0],
    [1,0,0,1,0],
    [1,0,0,0,1],
    [1,0,0,0,1],
    [1,0,0,0,1],
    [1,0,0,1,0],
    [1,1,1,0,0],
  ],
  J: [
    [0,0,1,1,1],
    [0,0,0,1,0],
    [0,0,0,1,0],
    [0,0,0,1,0],
    [1,0,0,1,0],
    [1,0,0,1,0],
    [0,1,1,0,0],
  ],
};

function drawLetter(pixels, size, letter, startX, startY, scale, r, g, b) {
  const bitmap = FONT[letter];
  if (!bitmap) return;
  for (let row = 0; row < bitmap.length; row++) {
    for (let col = 0; col < bitmap[row].length; col++) {
      if (bitmap[row][col]) {
        fillRect(pixels, size, startX + col * scale, startY + row * scale, scale, scale, r, g, b);
      }
    }
  }
}

// ── Cria PNG ─────────────────────────────────────────────────────────────────
function createIcon(size) {
  const pixels = new Uint8Array(size * size * 4);

  // Fundo laranja-escuro
  pixels.fill(0);
  for (let i = 0; i < size * size; i++) {
    pixels[i * 4] = 0x1a;
    pixels[i * 4 + 1] = 0x09;
    pixels[i * 4 + 2] = 0x00;
    pixels[i * 4 + 3] = 255;
  }

  // Círculo laranja principal
  const cx = size / 2, cy = size / 2;
  fillCircle(pixels, size, cx, cy, size * 0.46, 0xFF, 0x6B, 0x35);

  // Círculo laranja mais claro (destaque superior)
  fillCircle(pixels, size, cx - size * 0.08, cy - size * 0.08, size * 0.34, 0xFF, 0x8C, 0x60);

  // Letras "DJ" em branco
  const scale = Math.max(2, Math.floor(size / 38));
  const letterW = 5 * scale;
  const letterH = 7 * scale;
  const gap = scale * 2;
  const totalW = letterW * 2 + gap;
  const startX = Math.floor((size - totalW) / 2);
  const startY = Math.floor((size - letterH) / 2) - scale;

  drawLetter(pixels, size, "D", startX, startY, scale, 255, 255, 255);
  drawLetter(pixels, size, "J", startX + letterW + gap, startY, scale, 255, 255, 255);

  // Converte RGBA → raw PNG (RGBA, 8 bits)
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Adiciona byte de filtro (0 = None) em cada linha
  const rowLen = 1 + size * 4;
  const raw = Buffer.alloc(size * rowLen);
  for (let y = 0; y < size; y++) {
    raw[y * rowLen] = 0;
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4;
      const dst = y * rowLen + 1 + x * 4;
      raw[dst] = pixels[src];
      raw[dst + 1] = pixels[src + 1];
      raw[dst + 2] = pixels[src + 2];
      raw[dst + 3] = pixels[src + 3];
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 6 });

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Gera os dois tamanhos ────────────────────────────────────────────────────
const publicDir = path.join(__dirname, "public");

console.log("🎨 Gerando ícones PWA...");

const icon192 = createIcon(192);
fs.writeFileSync(path.join(publicDir, "icon-192.png"), icon192);
console.log("✅ public/icon-192.png criado (" + icon192.length + " bytes)");

const icon512 = createIcon(512);
fs.writeFileSync(path.join(publicDir, "icon-512.png"), icon512);
console.log("✅ public/icon-512.png criado (" + icon512.length + " bytes)");

console.log("\n🚀 Ícones prontos! O app agora pode ser instalado como PWA.");
console.log("   Para substituir por um design profissional:");
console.log("   - Crie um PNG 512x512 em Figma/Canva");
console.log("   - Salve em public/icon-512.png");
console.log("   - Gere versão 192x192 e salve em public/icon-192.png");
