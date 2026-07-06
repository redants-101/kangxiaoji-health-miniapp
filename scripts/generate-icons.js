const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const W = 96, H = 96;
const OUT_DIR = path.join(__dirname, '..', 'assets', 'icons');

// Colors from project style guide
const C_GRAY = { r: 101, g: 117, b: 109 };    // #65756D
const C_GREEN = { r: 22, g: 137, b: 87 };      // #168957
const C_RED = { r: 200, g: 70, b: 58 };         // #C8463A
const C_ORANGE = { r: 210, g: 140, b: 30 };     // warning amber

const STROKE = 5; // thicker stroke for elderly

// =========== Drawing primitives ===========

function createCanvas() {
  return Buffer.alloc(W * H * 4, 0);
}

function setPixel(pixels, x, y, r, g, b, a) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 4;
  const srcA = a / 255;
  pixels[i]   = Math.round(r * srcA + pixels[i] * (1 - srcA));
  pixels[i+1] = Math.round(g * srcA + pixels[i+1] * (1 - srcA));
  pixels[i+2] = Math.round(b * srcA + pixels[i+2] * (1 - srcA));
  pixels[i+3] = Math.round(a + pixels[i+3] * (1 - srcA));
}

function drawCircle(pixels, cx, cy, radius, color, stroke) {
  const hs = stroke / 2;
  for (let y = Math.floor(cy - radius - stroke); y <= Math.ceil(cy + radius + stroke); y++) {
    for (let x = Math.floor(cx - radius - stroke); x <= Math.ceil(cx + radius + stroke); x++) {
      const d = Math.sqrt((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) - radius;
      if (d >= -hs && d <= hs) {
        const minD = Math.min(hs - d, d + hs);
        const alpha = Math.max(0, Math.min(1, minD));
        setPixel(pixels, x, y, color.r, color.g, color.b, Math.round(alpha * 255));
      }
    }
  }
}

function fillCircle(pixels, cx, cy, radius, color, alpha = 255) {
  for (let y = Math.floor(cy - radius - 1); y <= Math.ceil(cy + radius + 1); y++) {
    for (let x = Math.floor(cx - radius - 1); x <= Math.ceil(cx + radius + 1); x++) {
      const d = Math.sqrt((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) - radius;
      if (d <= 0.5) {
        const a = d < -0.5 ? 1 : Math.max(0, 0.5 - d);
        setPixel(pixels, x, y, color.r, color.g, color.b, Math.round(a * alpha));
      }
    }
  }
}

function drawLine(pixels, x1, y1, x2, y2, color, stroke) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return;
  const nx = -dy / len, ny = dx / len;
  const hs = stroke / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const px = x + 0.5 - x1, py = y + 0.5 - y1;
      const proj = (px * dx + py * dy) / len;
      if (proj < -hs || proj > len + hs) continue;
      const perpDist = Math.abs(px * nx + py * ny);
      if (perpDist <= hs) {
        const edgeD = hs - perpDist;
        const endD = Math.min(proj + hs, len + hs - proj);
        const alpha = Math.max(0, Math.min(1, edgeD, endD));
        setPixel(pixels, x, y, color.r, color.g, color.b, Math.round(alpha * 255));
      }
    }
  }
}

function drawRoundRect(pixels, x1, y1, x2, y2, r, color, stroke) {
  const hs = stroke / 2;
  for (let y = Math.floor(y1 - stroke); y <= Math.ceil(y2 + stroke); y++) {
    for (let x = Math.floor(x1 - stroke); x <= Math.ceil(x2 + stroke); x++) {
      let nearestX = Math.max(x1 + r, Math.min(x2 - r, x + 0.5));
      let nearestY = Math.max(y1 + r, Math.min(y2 - r, y + 0.5));
      const inCorner =
        (x + 0.5 < x1 + r && y + 0.5 < y1 + r) ||
        (x + 0.5 > x2 - r && y + 0.5 < y1 + r) ||
        (x + 0.5 < x1 + r && y + 0.5 > y2 - r) ||
        (x + 0.5 > x2 - r && y + 0.5 > y2 - r);
      let d;
      if (inCorner) {
        const cx = x + 0.5 < (x1 + x2) / 2 ? x1 + r : x2 - r;
        const cy = y + 0.5 < (y1 + y2) / 2 ? y1 + r : y2 - r;
        d = Math.sqrt((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) - r;
      } else {
        d = Math.min(x + 0.5 - x1, x2 - (x + 0.5), y + 0.5 - y1, y2 - (y + 0.5));
        d = -d; // negative inside
      }
      if (d >= -hs && d <= hs) {
        const minD = Math.min(hs - d, d + hs);
        const alpha = Math.max(0, Math.min(1, minD));
        setPixel(pixels, x, y, color.r, color.g, color.b, Math.round(alpha * 255));
      }
    }
  }
}

function fillRoundRect(pixels, x1, y1, x2, y2, r, color, alpha = 255) {
  for (let y = Math.floor(y1); y <= Math.ceil(y2); y++) {
    for (let x = Math.floor(x1); x <= Math.ceil(x2); x++) {
      let nearestX = Math.max(x1 + r, Math.min(x2 - r, x + 0.5));
      let nearestY = Math.max(y1 + r, Math.min(y2 - r, y + 0.5));
      const inCorner =
        (x + 0.5 < x1 + r && y + 0.5 < y1 + r) ||
        (x + 0.5 > x2 - r && y + 0.5 < y1 + r) ||
        (x + 0.5 < x1 + r && y + 0.5 > y2 - r) ||
        (x + 0.5 > x2 - r && y + 0.5 > y2 - r);
      let d;
      if (inCorner) {
        const cx = x + 0.5 < (x1 + x2) / 2 ? x1 + r : x2 - r;
        const cy = y + 0.5 < (y1 + y2) / 2 ? y1 + r : y2 - r;
        d = Math.sqrt((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) - r;
      } else {
        d = -Math.min(x + 0.5 - x1, x2 - (x + 0.5), y + 0.5 - y1, y2 - (y + 0.5));
      }
      if (d <= 0.5) {
        const a = d < -0.5 ? 1 : Math.max(0, 0.5 - d);
        setPixel(pixels, x, y, color.r, color.g, color.b, Math.round(a * alpha));
      }
    }
  }
}

function drawTriangle(pixels, x1, y1, x2, y2, x3, y3, color, stroke) {
  drawLine(pixels, x1, y1, x2, y2, color, stroke);
  drawLine(pixels, x2, y2, x3, y3, color, stroke);
  drawLine(pixels, x3, y3, x1, y1, color, stroke);
}

// =========== PNG encoder ===========

function createPNG(width, height, rgbaData) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const typeB = Buffer.from(type);
    const crcData = Buffer.concat([typeB, data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(crcData) >>> 0);
    return Buffer.concat([len, typeB, data, crc]);
  }
  function crc32(buf) {
    const table = new Int32Array(256);
    for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); table[i] = c; }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    return crc ^ 0xFFFFFFFF;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const rawData = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    rawData[y * (width * 4 + 1)] = 0;
    rgbaData.copy(rawData, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rawData)), chunk('IEND', Buffer.alloc(0))]);
}

function saveIcon(name, pixels) {
  const png = createPNG(W, H, pixels);
  fs.writeFileSync(path.join(OUT_DIR, name), png);
  console.log(`  ${name} (${png.length} bytes)`);
}

// =========== Icon generators ===========

// 1. icon-bp.png - 血压/仪表盘: circular gauge with needle
function genBP() {
  const px = createCanvas();
  const cx = 48, cy = 50, r = 30;
  // Outer arc (3/4 circle, open at bottom)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);
      // Draw arc from -210° to 30° (3/4 circle, open bottom-right to bottom-left)
      const inArc = angle > -Math.PI * 5/6 && angle < Math.PI * 5/6;
      if (inArc) {
        const d = dist - r;
        const hs = STROKE / 2;
        if (d >= -hs && d <= hs) {
          const minD = Math.min(hs - d, d + hs);
          const alpha = Math.max(0, Math.min(1, minD));
          setPixel(px, x, y, C_GRAY.r, C_GRAY.g, C_GRAY.b, Math.round(alpha * 255));
        }
      }
    }
  }
  // Tick marks at cardinal positions
  for (let tickAngle = -Math.PI * 5/6; tickAngle <= Math.PI * 5/6; tickAngle += Math.PI / 6) {
    const tx1 = cx + Math.cos(tickAngle) * (r - 6);
    const ty1 = cy + Math.sin(tickAngle) * (r - 6);
    const tx2 = cx + Math.cos(tickAngle) * (r + 2);
    const ty2 = cy + Math.sin(tickAngle) * (r + 2);
    drawLine(px, tx1, ty1, tx2, ty2, C_GRAY, 2);
  }
  // Needle pointing upper-right (~-30°)
  const needleAngle = -Math.PI / 5;
  const nx = cx + Math.cos(needleAngle) * (r - 10);
  const ny = cy + Math.sin(needleAngle) * (r - 10);
  drawLine(px, cx, cy, nx, ny, C_GREEN, 4);
  // Center dot
  fillCircle(px, cx, cy, 4, C_GREEN);
  saveIcon('icon-bp.png', px);
}

// 2. icon-bg.png - 血糖/水滴: teardrop/water drop
function genBG() {
  const px = createCanvas();
  const cx = 48, dropH = 50, dropW = 28;
  // Teardrop shape using SDF
  const topY = 18, botY = topY + dropH;
  const midY = (topY + botY) / 2 + 6;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const px2 = x + 0.5, py = y + 0.5;
      let d;
      if (py < midY) {
        // Upper cone part - width narrows linearly toward top
        const t = (py - topY) / (midY - topY); // 0 at top, 1 at midY
        const halfW = dropW * t * 0.3;
        d = Math.max(Math.abs(px2 - cx) - halfW, -(py - topY), py - midY);
      } else {
        // Lower circular part
        const circR = dropW;
        const circCy = botY - circR;
        d = Math.sqrt((px2 - cx) ** 2 + (py - circCy) ** 2) - circR;
      }
      const hs = STROKE / 2;
      if (d >= -hs && d <= hs) {
        const minD = Math.min(hs - d, d + hs);
        const alpha = Math.max(0, Math.min(1, minD));
        setPixel(px, x, y, C_GRAY.r, C_GRAY.g, C_GRAY.b, Math.round(alpha * 255));
      }
    }
  }
  saveIcon('icon-bg.png', px);
}

// 3. icon-reminder.png - 铃铛: bell
function genReminder() {
  const px = createCanvas();
  const cx = 48, topY = 20, botY = 62;
  // Bell body - flared shape
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const px2 = x + 0.5, py = y + 0.5;
      if (py < topY || py > botY + 6) continue;
      // Bell profile: narrow at top, wide at bottom
      const t = (py - topY) / (botY - topY); // 0=top, 1=bottom
      const halfW = 8 + t * 18; // narrows from 26 at bottom to 8 at top
      // Bell curve (slightly concave)
      const curveHalfW = halfW + Math.sin(t * Math.PI) * 2;
      const d = Math.abs(px2 - cx) - curveHalfW;
      const hs = STROKE / 2;
      if (py >= topY && py <= botY) {
        if (d >= -hs && d <= hs) {
          const minD = Math.min(hs - d, d + hs);
          const alpha = Math.max(0, Math.min(1, minD));
          setPixel(px, x, y, C_GRAY.r, C_GRAY.g, C_GRAY.b, Math.round(alpha * 255));
        }
      }
    }
  }
  // Top cap (small circle)
  drawCircle(px, cx, topY, 4, C_GRAY, STROKE);
  // Clapper (small circle at bottom)
  fillCircle(px, cx, botY + 6, 5, C_GRAY);
  // Top stem
  drawLine(px, cx, topY - 4, cx, topY - 10, C_GRAY, 3);
  saveIcon('icon-reminder.png', px);
}

// 4. icon-family.png - 家庭: two person silhouettes
function genFamily() {
  const px = createCanvas();
  // Person 1 (larger, left)
  fillCircle(px, 36, 28, 9, C_GRAY);   // head
  // Body trapezoid
  drawLine(px, 28, 38, 28, 62, C_GRAY, STROKE);
  drawLine(px, 44, 38, 44, 62, C_GRAY, STROKE);
  drawLine(px, 28, 62, 44, 62, C_GRAY, STROKE);
  drawLine(px, 28, 38, 44, 38, C_GRAY, STROKE);

  // Person 2 (smaller, right)
  fillCircle(px, 62, 32, 7, C_GRAY);   // head
  drawLine(px, 56, 40, 56, 58, C_GRAY, STROKE - 1);
  drawLine(px, 68, 40, 68, 58, C_GRAY, STROKE - 1);
  drawLine(px, 56, 58, 68, 58, C_GRAY, STROKE - 1);
  drawLine(px, 56, 40, 68, 40, C_GRAY, STROKE - 1);
  saveIcon('icon-family.png', px);
}

// 5. icon-trend.png - 趋势: upward line chart with arrow
function genTrend() {
  const px = createCanvas();
  // Axis lines
  drawLine(px, 22, 68, 22, 22, C_GRAY, STROKE);   // Y axis
  drawLine(px, 22, 68, 76, 68, C_GRAY, STROKE);   // X axis
  // Upward trending line
  drawLine(px, 28, 58, 42, 44, C_GREEN, STROKE + 1);
  drawLine(px, 42, 44, 52, 50, C_GREEN, STROKE + 1);
  drawLine(px, 52, 50, 68, 28, C_GREEN, STROKE + 1);
  // Arrow tip
  drawLine(px, 68, 28, 60, 28, C_GREEN, STROKE);
  drawLine(px, 68, 28, 68, 36, C_GREEN, STROKE);
  // Data dots
  fillCircle(px, 28, 58, 4, C_GREEN);
  fillCircle(px, 42, 44, 4, C_GREEN);
  fillCircle(px, 52, 50, 4, C_GREEN);
  fillCircle(px, 68, 28, 4, C_GREEN);
  saveIcon('icon-trend.png', px);
}

// 6. icon-report.png - 周报: document with bar chart
function genReport() {
  const px = createCanvas();
  // Document outline
  drawRoundRect(px, 24, 14, 72, 80, 4, C_GRAY, STROKE);
  // Folded corner
  drawLine(px, 58, 14, 72, 28, C_GRAY, STROKE - 1);
  drawLine(px, 58, 14, 58, 28, C_GRAY, STROKE - 1);
  drawLine(px, 58, 28, 72, 28, C_GRAY, STROKE - 1);
  // Bar chart inside
  fillRoundRect(px, 32, 56, 40, 70, 2, C_GREEN);
  fillRoundRect(px, 44, 44, 52, 70, 2, C_GREEN);
  fillRoundRect(px, 56, 50, 64, 70, 2, C_GREEN);
  saveIcon('icon-report.png', px);
}

// 7. icon-profile.png - 基础资料: person with card/ID
function genProfile() {
  const px = createCanvas();
  // Person head
  fillCircle(px, 36, 28, 10, C_GRAY);
  // Person body
  drawLine(px, 26, 40, 26, 64, C_GRAY, STROKE);
  drawLine(px, 46, 40, 46, 64, C_GRAY, STROKE);
  drawLine(px, 26, 64, 46, 64, C_GRAY, STROKE);
  drawLine(px, 26, 40, 46, 40, C_GRAY, STROKE);
  // ID card
  drawRoundRect(px, 50, 36, 80, 64, 4, C_GRAY, STROKE - 1);
  // Lines on card
  drawLine(px, 56, 44, 74, 44, C_GRAY, 2);
  drawLine(px, 56, 52, 70, 52, C_GRAY, 2);
  drawLine(px, 56, 58, 66, 58, C_GRAY, 2);
  saveIcon('icon-profile.png', px);
}

// 8. icon-self.png - 本人角色: single person with checkmark
function genSelf() {
  const px = createCanvas();
  // Person head
  fillCircle(px, 40, 26, 12, C_GRAY);
  // Person body
  drawLine(px, 26, 40, 26, 68, C_GRAY, STROKE);
  drawLine(px, 54, 40, 54, 68, C_GRAY, STROKE);
  drawLine(px, 26, 68, 54, 68, C_GRAY, STROKE);
  drawLine(px, 26, 40, 54, 40, C_GRAY, STROKE);
  // Checkmark circle
  drawCircle(px, 66, 60, 14, C_GREEN, STROKE - 1);
  // Checkmark
  drawLine(px, 57, 60, 63, 67, C_GREEN, STROKE);
  drawLine(px, 63, 67, 76, 52, C_GREEN, STROKE);
  saveIcon('icon-self.png', px);
}

// 9. icon-privacy.png - 隐私授权: shield
function genPrivacy() {
  const px = createCanvas();
  const cx = 48, topY = 16, botY = 78;
  // Shield outline
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const px2 = x + 0.5, py = y + 0.5;
      if (py < topY || py > botY) continue;
      const t = (py - topY) / (botY - topY); // 0=top, 1=bottom
      // Shield profile: wide at top, narrows to point at bottom
      let halfW;
      if (t < 0.6) {
        halfW = 26;
      } else {
        halfW = 26 * (1 - (t - 0.6) / 0.4);
      }
      // Slight concave curves on sides
      const curve = Math.sin(t * Math.PI) * 3;
      const shieldHalfW = halfW + curve * (1 - t);
      const d = Math.abs(px2 - cx) - shieldHalfW;
      const hs = STROKE / 2;
      if (d >= -hs && d <= hs) {
        const minD = Math.min(hs - d, d + hs);
        const alpha = Math.max(0, Math.min(1, minD));
        setPixel(px, x, y, C_GRAY.r, C_GRAY.g, C_GRAY.b, Math.round(alpha * 255));
      }
    }
  }
  // Lock icon inside shield
  const lockCx = cx, lockCy = 44;
  drawCircle(px, lockCx, lockCy - 4, 8, C_GRAY, STROKE - 1); // shackle
  fillRoundRect(px, lockCx - 9, lockCy + 2, lockCx + 9, lockCy + 18, 2, C_GRAY); // body
  fillCircle(px, lockCx, lockCy + 10, 3, C_GREEN); // keyhole
  saveIcon('icon-privacy.png', px);
}

// 10. icon-export.png - 导出: arrow coming out of box
function genExport() {
  const px = createCanvas();
  // Box outline
  drawRoundRect(px, 18, 42, 78, 76, 4, C_GRAY, STROKE);
  // Arrow pointing up out of box
  drawLine(px, 48, 68, 48, 20, C_GREEN, STROKE + 1);
  // Arrowhead
  drawLine(px, 48, 20, 36, 34, C_GREEN, STROKE + 1);
  drawLine(px, 48, 20, 60, 34, C_GREEN, STROKE + 1);
  saveIcon('icon-export.png', px);
}

// 11. icon-delete.png - 删除: trash can
function genDelete() {
  const px = createCanvas();
  // Can body
  drawRoundRect(px, 26, 30, 70, 76, 4, C_RED, STROKE);
  // Lid
  drawRoundRect(px, 22, 22, 74, 32, 3, C_RED, STROKE);
  // Handle
  drawLine(px, 40, 22, 40, 16, C_RED, STROKE);
  drawLine(px, 56, 22, 56, 16, C_RED, STROKE);
  drawLine(px, 40, 16, 56, 16, C_RED, STROKE);
  // Inner lines
  drawLine(px, 38, 38, 38, 68, C_RED, STROKE - 1);
  drawLine(px, 48, 38, 48, 68, C_RED, STROKE - 1);
  drawLine(px, 58, 38, 58, 68, C_RED, STROKE - 1);
  saveIcon('icon-delete.png', px);
}

// 12. icon-clear-account.png - 注销: person with X
function genClearAccount() {
  const px = createCanvas();
  // Person head
  fillCircle(px, 36, 28, 10, C_RED);
  // Person body
  drawLine(px, 24, 40, 24, 66, C_RED, STROKE);
  drawLine(px, 48, 40, 48, 66, C_RED, STROKE);
  drawLine(px, 24, 66, 48, 66, C_RED, STROKE);
  drawLine(px, 24, 40, 48, 40, C_RED, STROKE);
  // X circle
  drawCircle(px, 66, 58, 16, C_RED, STROKE - 1);
  // X mark
  drawLine(px, 58, 50, 74, 66, C_RED, STROKE + 1);
  drawLine(px, 74, 50, 58, 66, C_RED, STROKE + 1);
  saveIcon('icon-clear-account.png', px);
}

// 13. icon-help.png - 帮助: question mark in circle
function genHelp() {
  const px = createCanvas();
  drawCircle(px, 48, 48, 34, C_GRAY, STROKE);
  // Question mark - draw manually with thick strokes
  // Top curve of ?
  const qCx = 48, qCy = 36, qR = 10;
  for (let a = -Math.PI; a <= 0.3; a += 0.02) {
    const qx = qCx + Math.cos(a) * qR;
    const qy = qCy + Math.sin(a) * qR;
    fillCircle(px, Math.round(qx), Math.round(qy), STROKE / 2, C_GRAY);
  }
  // Stem
  drawLine(px, 48, 46, 48, 56, C_GRAY, STROKE + 1);
  // Dot
  fillCircle(px, 48, 64, 3, C_GRAY);
  saveIcon('icon-help.png', px);
}

// 14. icon-feedback.png - 意见反馈: speech bubble
function genFeedback() {
  const px = createCanvas();
  // Speech bubble
  drawRoundRect(px, 16, 16, 80, 60, 10, C_GRAY, STROKE);
  // Tail
  drawLine(px, 28, 60, 22, 76, C_GRAY, STROKE);
  drawLine(px, 22, 76, 40, 60, C_GRAY, STROKE);
  // Dots inside
  fillCircle(px, 36, 38, 4, C_GRAY);
  fillCircle(px, 48, 38, 4, C_GRAY);
  fillCircle(px, 60, 38, 4, C_GRAY);
  saveIcon('icon-feedback.png', px);
}

// 15. icon-error.png - 失败: X in circle
function genError() {
  const px = createCanvas();
  drawCircle(px, 48, 48, 34, C_RED, STROKE);
  // X mark
  drawLine(px, 34, 34, 62, 62, C_RED, STROKE + 2);
  drawLine(px, 62, 34, 34, 62, C_RED, STROKE + 2);
  saveIcon('icon-error.png', px);
}

// 16. icon-warning.png - 警示: triangle with exclamation
function genWarning() {
  const px = createCanvas();
  // Triangle
  drawTriangle(px, 48, 14, 14, 78, 82, 78, C_ORANGE, STROKE);
  // Exclamation mark
  drawLine(px, 48, 32, 48, 56, C_ORANGE, STROKE + 2);
  fillCircle(px, 48, 66, 4, C_ORANGE);
  saveIcon('icon-warning.png', px);
}

// =========== Run all ===========
console.log('Generating 16 missing icons...');
genBP();
genBG();
genReminder();
genFamily();
genTrend();
genReport();
genProfile();
genSelf();
genPrivacy();
genExport();
genDelete();
genClearAccount();
genHelp();
genFeedback();
genError();
genWarning();
console.log('Done! All icons saved to:', OUT_DIR);
