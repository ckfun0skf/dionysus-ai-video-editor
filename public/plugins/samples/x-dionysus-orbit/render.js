// Sample clip-type plugin using three.js (dionysus.cliptype/1, docs/v2/PLUGIN_PACKAGE.md). "three" in render.libs
// makes the pinned three.js available as the global THREE in this classic worker script; nothing is fetched.
// Everything is a function of t and ctx.params: the dots' positions come from a seeded table built once in init.
let renderer, scene, camera, knot, dots, table, built;

dionysus.clip({
  init(ctx) {
    renderer = new THREE.WebGLRenderer({ canvas: ctx.canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 6);
    knot = new THREE.Mesh(new THREE.TorusKnotGeometry(1, 0.32, 200, 32), new THREE.MeshStandardMaterial({ metalness: 0.35, roughness: 0.35 }));
    scene.add(knot, new THREE.AmbientLight(0xffffff, 0.45));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(3, 4, 5);
    scene.add(key);
    // Math.random is seeded by the host, so this table is the same on every load.
    table = Array.from({ length: 400 }, () => ({ r: 2.2 + Math.random() * 0.6, a: Math.random() * Math.PI * 2, y: (Math.random() - 0.5) * 1.2, s: 0.5 + Math.random() }));
  },
  render(t, ctx) {
    const p = ctx.params;
    renderer.setSize(ctx.width, ctx.height, false);
    camera.aspect = ctx.width / ctx.height;
    camera.updateProjectionMatrix();
    const n = Math.max(0, Math.min(400, Math.round(p.count)));
    if (built !== n) {
      if (dots) { scene.remove(dots); dots.geometry.dispose(); }
      dots = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 0.07 }));
      dots.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      scene.add(dots);
      built = n;
    }
    knot.material.color.set(p.color);
    dots.material.color.set(p.dots);
    scene.background = p.transparent ? null : new THREE.Color(p.background);
    const turn = t * p.turns * Math.PI * 2;
    knot.rotation.set(turn * 0.6, turn, 0);
    const pos = dots.geometry.attributes.position;
    for (let i = 0; i < n; i++) {
      const d = table[i], a = d.a + turn * d.s;
      pos.setXYZ(i, Math.cos(a) * d.r, d.y + Math.sin(a * 2) * 0.15, Math.sin(a) * d.r);
    }
    pos.needsUpdate = true;
    renderer.render(scene, camera);
  },
});
