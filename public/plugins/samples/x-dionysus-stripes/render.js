// Sample clip-type plugin (dionysus.cliptype/1, docs/v2/PLUGIN_PACKAGE.md). The host runs this classic script in a
// sandboxed worker with no network. Draw frame t (clip-local seconds) on ctx.canvas, an OffscreenCanvas; the picture
// may depend only on t and ctx.params, so preview, seeking and export always show the same frame.
dionysus.clip({
  render(t, ctx) {
    const { width: w, height: h, params: p } = ctx;
    const g = ctx.canvas.getContext("2d");
    const count = Math.max(2, Math.round(p.count));
    const angle = (p.angle * Math.PI) / 180;
    const diag = Math.hypot(w, h);
    const size = diag / count;
    const dir = p.direction === "right" ? 1 : -1;
    const shift = ((((t * p.speed * dir) % 2) + 2) % 2) * size;

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = p.colorA;
    g.fillRect(0, 0, w, h);
    g.translate(w / 2, h / 2);
    g.rotate(angle);
    g.fillStyle = p.colorB;
    for (let x = -diag - 2 * size + shift; x < diag; x += 2 * size) g.fillRect(x, -diag, size, 2 * diag);
    g.setTransform(1, 0, 0, 1, 0, 0);

    const title = String(p.title || "").trim();
    if (!title) return;
    const fontPx = Math.round(h * 0.09);
    if (p.band) {
      g.fillStyle = p.colorA;
      g.fillRect(0, h / 2 - fontPx, w, fontPx * 2);
    }
    g.fillStyle = p.band ? p.colorB : p.colorA;
    g.font = `700 ${fontPx}px sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(title, w / 2, h / 2, w * 0.9);
  },
});
