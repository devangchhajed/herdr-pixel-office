import { Color, TRANSPARENT } from "./palette";

const ESC = "\x1b";

/**
 * Subpixels per cell. Quadrant blocks give 2x2, twice the horizontal resolution
 * of the ▀ half-block, so the same artwork needs half the columns.
 *
 * The catch: a cell still carries only two colours. With 2x2 subpixels that is
 * lossy unless the art keeps each cell down to two colours — so sprites are
 * authored against that budget and `measureQuantisation()` checks it. Sextants
 * (2x3) would be finer again but render as tofu in Apple Terminal.
 */
export const SUB_X = 2;
export const SUB_Y = 2;

/** Quadrant glyph per bitmask: 1=top-left, 2=top-right, 4=bottom-left, 8=bottom-right. */
const QUADRANTS = [
  " ", "▘", "▝", "▀",
  "▖", "▌", "▞", "▛",
  "▗", "▚", "▐", "▜",
  "▄", "▙", "▟", "█",
];

/**
 * A pixel framebuffer that renders through Unicode half-blocks: one terminal
 * cell carries two vertically stacked pixels, so the drawable pixel grid is
 * `cols x rows*2` and pixels come out roughly square.
 *
 * A text overlay sits above the pixel layer for anything that has to stay
 * readable (names, tabs, the status bar). Frames are diffed against the last
 * one so a redraw only writes the cells that actually changed.
 */
export class Screen {
  cols = 0;
  rows = 0;
  pxW = 0;
  pxH = 0;

  private px = new Int32Array(0);
  private ch: string[] = [];
  private chFg = new Int32Array(0);
  private chBg = new Int32Array(0);
  private prev: string[] = [];

  // Pixel-space clip window; drawing outside it is dropped. Lets the office
  // scroll under the tab bar and status bar without painting over them.
  private clipX0 = 0;
  private clipY0 = 0;
  private clipX1 = 0;
  private clipY1 = 0;

  resize(cols: number, rows: number): void {
    this.cols = Math.max(1, cols);
    this.rows = Math.max(1, rows);
    this.pxW = this.cols * SUB_X;
    this.pxH = this.rows * SUB_Y;
    this.px = new Int32Array(this.pxW * this.pxH);
    this.ch = new Array(this.cols * this.rows).fill("");
    this.chFg = new Int32Array(this.cols * this.rows);
    this.chBg = new Int32Array(this.cols * this.rows);
    this.prev = new Array(this.cols * this.rows).fill("");
    this.resetClip();
  }

  /** Restricts pixel drawing to `[x0,x1) x [y0,y1)`. */
  setClip(x0: number, y0: number, x1: number, y1: number): void {
    this.clipX0 = Math.max(0, x0);
    this.clipY0 = Math.max(0, y0);
    this.clipX1 = Math.min(this.pxW, x1);
    this.clipY1 = Math.min(this.pxH, y1);
  }

  resetClip(): void {
    this.clipX0 = 0;
    this.clipY0 = 0;
    this.clipX1 = this.pxW;
    this.clipY1 = this.pxH;
  }

  /** Wipes the pixel layer and the text overlay back to a flat color. */
  clear(color: Color): void {
    this.resetClip();
    this.px.fill(color);
    this.ch.fill("");
    this.chBg.fill(TRANSPARENT);
  }

  setPixel(x: number, y: number, color: Color): void {
    if (color < 0) return;
    if (x < this.clipX0 || y < this.clipY0 || x >= this.clipX1 || y >= this.clipY1) return;
    this.px[y * this.pxW + x] = color;
  }

  getPixel(x: number, y: number): Color {
    if (x < 0 || y < 0 || x >= this.pxW || y >= this.pxH) return 0;
    return this.px[y * this.pxW + x];
  }

  fillRect(x: number, y: number, w: number, h: number, color: Color): void {
    if (color < 0) return;
    const x0 = Math.max(this.clipX0, x);
    const y0 = Math.max(this.clipY0, y);
    const x1 = Math.min(this.clipX1, x + w);
    const y1 = Math.min(this.clipY1, y + h);
    for (let yy = y0; yy < y1; yy++) {
      const row = yy * this.pxW;
      for (let xx = x0; xx < x1; xx++) this.px[row + xx] = color;
    }
  }

  strokeRect(x: number, y: number, w: number, h: number, color: Color): void {
    if (color < 0 || w <= 0 || h <= 0) return;
    for (let xx = x; xx < x + w; xx++) {
      this.setPixel(xx, y, color);
      this.setPixel(xx, y + h - 1, color);
    }
    for (let yy = y; yy < y + h; yy++) {
      this.setPixel(x, yy, color);
      this.setPixel(x + w - 1, yy, color);
    }
  }

  hLine(x: number, y: number, w: number, color: Color): void {
    for (let xx = x; xx < x + w; xx++) this.setPixel(xx, y, color);
  }

  vLine(x: number, y: number, h: number, color: Color): void {
    for (let yy = y; yy < y + h; yy++) this.setPixel(x, yy, color);
  }

  /**
   * Blits string-art. Each char in `art` is looked up in `palette`; a char
   * missing from the palette (conventionally `.`) leaves the pixel untouched.
   */
  drawArt(x: number, y: number, art: string[], palette: Record<string, Color>): void {
    for (let row = 0; row < art.length; row++) {
      const line = art[row];
      for (let col = 0; col < line.length; col++) {
        const color = palette[line[col]];
        if (color === undefined || color < 0) continue;
        this.setPixel(x + col, y + row, color);
      }
    }
  }

  /** Writes into the text overlay. `bg < 0` keeps whatever the pixel layer drew. */
  putText(col: number, row: number, text: string, fg: Color, bg: Color = TRANSPARENT): void {
    if (row < 0 || row >= this.rows) return;
    for (let i = 0; i < text.length; i++) {
      const c = col + i;
      if (c < 0) continue;
      if (c >= this.cols) break;
      const idx = row * this.cols + c;
      this.ch[idx] = text[i];
      this.chFg[idx] = fg;
      this.chBg[idx] = bg;
    }
  }

  /** Writes `text` centered inside the span `[col, col+width)`, truncating with an ellipsis. */
  putTextCentered(col: number, row: number, width: number, text: string, fg: Color, bg: Color = TRANSPARENT): void {
    const t = truncate(text, width);
    const start = col + Math.max(0, Math.floor((width - t.length) / 2));
    this.putText(start, row, t, fg, bg);
  }

  fillTextRow(row: number, fg: Color, bg: Color): void {
    for (let c = 0; c < this.cols; c++) {
      const idx = row * this.cols + c;
      this.ch[idx] = " ";
      this.chFg[idx] = fg;
      this.chBg[idx] = bg;
    }
  }

  /** Forces the next `frame()` to emit every cell (used after a resize or redraw request). */
  invalidate(): void {
    this.prev.fill("");
  }

  /** Returns the ANSI needed to turn the terminal into this frame. */
  frame(): string {
    const out: string[] = [];
    let lastFg = -2;
    let lastBg = -2;
    let curX = -1;
    let curY = -1;

    for (let y = 0; y < this.rows; y++) {
      const topRow = SUB_Y * y * this.pxW;
      const bottomRow = (SUB_Y * y + 1) * this.pxW;
      for (let x = 0; x < this.cols; x++) {
        const idx = y * this.cols + x;
        const overlay = this.ch[idx];
        const left = SUB_X * x;

        let fg: number;
        let bg: number;
        let glyph: string;

        if (overlay) {
          glyph = overlay;
          fg = this.chFg[idx];
          const wanted = this.chBg[idx];
          bg = wanted >= 0 ? wanted : this.px[bottomRow + left];
        } else {
          const tl = this.px[topRow + left];
          const tr = this.px[topRow + left + 1];
          const bl = this.px[bottomRow + left];
          const br = this.px[bottomRow + left + 1];
          if (tl === tr && tl === bl && tl === br) {
            // Flat cell — the common case for floor and walls.
            glyph = "█";
            fg = tl;
            bg = tl;
          } else {
            const [a, b] = pickPair(tl, tr, bl, br);
            let mask = 0;
            if (nearer(tl, a, b)) mask |= 1;
            if (nearer(tr, a, b)) mask |= 2;
            if (nearer(bl, a, b)) mask |= 4;
            if (nearer(br, a, b)) mask |= 8;
            glyph = QUADRANTS[mask];
            fg = a;
            bg = b;
          }
        }

        const key = `${fg},${bg},${glyph}`;
        if (this.prev[idx] === key) continue;
        this.prev[idx] = key;

        if (curY !== y || curX !== x) {
          out.push(`${ESC}[${y + 1};${x + 1}H`);
          curY = y;
        }
        if (fg !== lastFg) {
          out.push(`${ESC}[38;2;${(fg >> 16) & 0xff};${(fg >> 8) & 0xff};${fg & 0xff}m`);
          lastFg = fg;
        }
        if (bg !== lastBg) {
          out.push(`${ESC}[48;2;${(bg >> 16) & 0xff};${(bg >> 8) & 0xff};${bg & 0xff}m`);
          lastBg = bg;
        }
        out.push(glyph);
        curX = x + 1;
        if (curX >= this.cols) curX = -1;
      }
    }
    return out.join("");
  }

  /**
   * How much colour the 2-colours-per-cell limit is costing. Zero means every
   * cell holds at most two colours and the frame is pixel-exact; anything above
   * zero is a cell the terminal cannot show faithfully, which is what "blurry"
   * looks like. Sprites are authored against this.
   */
  measureQuantisation(x0 = 0, y0 = 0, x1 = this.pxW, y1 = this.pxH): {
    cells: number;
    lossy: number;
    coloursDropped: number;
  } {
    let cells = 0;
    let lossy = 0;
    let coloursDropped = 0;
    for (let y = Math.floor(y0 / SUB_Y); y < Math.ceil(y1 / SUB_Y); y++) {
      for (let x = Math.floor(x0 / SUB_X); x < Math.ceil(x1 / SUB_X); x++) {
        const left = SUB_X * x;
        const top = SUB_Y * y * this.pxW;
        const bottom = (SUB_Y * y + 1) * this.pxW;
        const seen = new Set([
          this.px[top + left],
          this.px[top + left + 1],
          this.px[bottom + left],
          this.px[bottom + left + 1],
        ]);
        if (seen.size === 1) continue;
        cells++;
        if (seen.size > 2) {
          lossy++;
          coloursDropped += seen.size - 2;
        }
      }
    }
    return { cells, lossy, coloursDropped };
  }
}

/**
 * A cell carries two colours but up to four subpixel colours: keep the most
 * common, plus whichever other is furthest from it, and snap the rest.
 */
function pickPair(a: number, b: number, c: number, d: number): [number, number] {
  const values = [a, b, c, d];
  let best = a;
  let bestCount = 0;
  for (const v of values) {
    let count = 0;
    for (const w of values) if (w === v) count++;
    if (count > bestCount) {
      bestCount = count;
      best = v;
    }
  }
  let other = best;
  let furthest = -1;
  for (const v of values) {
    const d2 = distance(v, best);
    if (d2 > furthest) {
      furthest = d2;
      other = v;
    }
  }
  return [other, best];
}

function nearer(value: number, fg: number, bg: number): boolean {
  return distance(value, fg) <= distance(value, bg);
}

function distance(x: number, y: number): number {
  const dr = ((x >> 16) & 0xff) - ((y >> 16) & 0xff);
  const dg = ((x >> 8) & 0xff) - ((y >> 8) & 0xff);
  const db = (x & 0xff) - (y & 0xff);
  return dr * dr + dg * dg + db * db;
}

export function truncate(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width === 1) return text.slice(0, 1);
  return text.slice(0, width - 1) + "…";
}
