// Filtre « One Euro » (Casiez et al., 2012) : lisse fort quand la main est immobile,
// réagit vite quand elle bouge. Bien plus précis qu'un simple lerp pour le suivi.
export class OneEuro {
  constructor(minCutoff = 1.2, beta = 0.02, dCutoff = 1.0) { Object.assign(this, { minCutoff, beta, dCutoff }); this.x = null; this.dx = 0; this.t = 0; }
  static alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(v, tSec) {
    if (this.x === null) { this.x = v; this.t = tSec; return v; }
    const dt = Math.max(1e-3, tSec - this.t); this.t = tSec;
    const dv = (v - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (dv - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (v - this.x);
    return this.x;
  }
  reset() { this.x = null; this.dx = 0; }
}
// Lisse un point {x, y, z?}
export class OneEuro3 {
  constructor(...a) { this.f = [new OneEuro(...a), new OneEuro(...a), new OneEuro(...a)]; }
  filter(p, t) { return { x: this.f[0].filter(p.x, t), y: this.f[1].filter(p.y, t), z: this.f[2].filter(p.z ?? 0, t) }; }
  reset() { this.f.forEach((f) => f.reset()); }
}
