import type { Candles } from './data';

export interface Theme {
  up: string;
  down: string;
  grid: string;
  text: string;
}

export class ChartRenderer {
  /** Index of the first visible bar (fractional) and bar width in CSS px. */
  start = 0;
  barW = 8;
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private raf = 0;

  constructor(private canvas: HTMLCanvasElement, private data: Candles, public theme: Theme) {
    this.ctx = canvas.getContext('2d', { alpha: true })!;
    this.start = Math.max(0, data.n - 120);
  }

  resize(w: number, h: number) {
    this.dpr = window.devicePixelRatio || 1;
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.invalidate();
  }

  pan(dxPx: number) {
    this.start = Math.min(Math.max(this.start - dxPx / this.barW, -50), this.data.n - 5);
    this.invalidate();
  }

  zoom(factor: number, anchorPx: number) {
    const anchorBar = this.start + anchorPx / this.barW;
    this.barW = Math.min(Math.max(this.barW * factor, 1), 60);
    this.start = anchorBar - anchorPx / this.barW;
    this.invalidate();
  }

  invalidate() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  destroy() {
    cancelAnimationFrame(this.raf);
  }

  private draw() {
    const { ctx, w, h, dpr, data, theme } = this;
    const axisW = 56;
    const plotW = w - axisW;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const first = Math.max(0, Math.floor(this.start));
    const last = Math.min(data.n - 1, Math.ceil(this.start + plotW / this.barW));
    if (last < first) return;

    // Price range of visible bars.
    let lo = Infinity, hi = -Infinity;
    for (let i = first; i <= last; i++) {
      if (data.l[i] < lo) lo = data.l[i];
      if (data.h[i] > hi) hi = data.h[i];
    }
    const pad = (hi - lo) * 0.08 || 1;
    lo -= pad;
    hi += pad;
    const top = 8, bot = h - 8;
    const y = (p: number) => bot - ((p - lo) / (hi - lo)) * (bot - top);

    // Grid + price labels.
    ctx.strokeStyle = theme.grid;
    ctx.fillStyle = theme.text;
    ctx.font = '11px ui-monospace, monospace';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let g = 0; g <= 5; g++) {
      const p = lo + ((hi - lo) * g) / 5;
      const gy = Math.round(y(p)) + 0.5;
      ctx.moveTo(0, gy);
      ctx.lineTo(plotW, gy);
      ctx.fillText(p.toFixed(2), plotW + 6, gy + 4);
    }
    ctx.stroke();

    // Candles, batched by colour (2 stroke + 2 fill calls total).
    const bw = Math.max(1, Math.floor(this.barW * 0.7));
    for (const up of [true, false]) {
      ctx.fillStyle = ctx.strokeStyle = up ? theme.up : theme.down;
      ctx.beginPath();
      for (let i = first; i <= last; i++) {
        const isUp = data.c[i] >= data.o[i];
        if (isUp !== up) continue;
        const cx = Math.round((i - this.start) * this.barW + this.barW / 2) + 0.5;
        ctx.moveTo(cx, y(data.h[i]));
        ctx.lineTo(cx, y(data.l[i]));
      }
      ctx.stroke();
      ctx.beginPath();
      for (let i = first; i <= last; i++) {
        const isUp = data.c[i] >= data.o[i];
        if (isUp !== up) continue;
        const cx = Math.round((i - this.start) * this.barW + this.barW / 2);
        const yo = y(data.o[i]), yc = y(data.c[i]);
        ctx.rect(cx - bw / 2, Math.min(yo, yc), bw, Math.max(1, Math.abs(yo - yc)));
      }
      ctx.fill();
    }
  }
}
