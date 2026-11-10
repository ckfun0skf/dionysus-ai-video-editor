import { useEffect, useRef } from "react";
import { decodeTextDataUrl, findAttachedName, meshStats, missingGltfExternals, missingGltfMessage, objectUrlFromDataUrl } from "./codeFilePreview";
import { Ic } from "./Icon";
import { loadThree } from "./loadThree";

export function GlbViewer({ url, name, data, files, onStats, onError }: {
  url: string;
  name: string;
  data: string;
  files: Record<string, string>;
  onStats: (s: { meshes: number; triangles: number }) => void;
  onError: (message: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const reset = useRef<(() => void) | null>(null);
  const onStatsRef = useRef(onStats); onStatsRef.current = onStats;
  const onErrorRef = useRef(onError); onErrorRef.current = onError;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let dead = false;
    const extra: string[] = [];
    let raf = 0;
    let renderer: { dispose: () => void; render: (s: unknown, c: unknown) => void; setSize: (w: number, h: number, updateStyle?: boolean) => void; setPixelRatio: (n: number) => void; domElement: HTMLCanvasElement } | undefined;
    const cleanups: Array<() => void> = [];

    void (async () => {
      try {
        if (/\.gltf$/i.test(name)) {
          const missing = missingGltfExternals(decodeTextDataUrl(data), files);
          if (missing.length) { onErrorRef.current(missingGltfMessage(missing)); return; }
        }
        const { THREE, GLTFLoader } = await loadThree();
        if (dead) return;
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x111115);
        scene.add(new THREE.AmbientLight(0xffffff, 0.55));
        scene.add(new THREE.HemisphereLight(0xf0f0f5, 0x2a2a30, 0.4));
        const key = new THREE.DirectionalLight(0xffffff, 0.9);
        key.position.set(2.2, 3.4, 2.8);
        scene.add(key);

        const manager = new THREE.LoadingManager();
        manager.setURLModifier((raw: string) => {
          if (raw.startsWith("blob:") || raw.startsWith("data:")) return raw;
          const attached = findAttachedName(files, raw);
          if (!attached) return raw;
          const mapped = objectUrlFromDataUrl(files[attached]);
          extra.push(mapped);
          return mapped;
        });
        const gltf = await new GLTFLoader(manager).loadAsync(url);
        if (dead) return;
        scene.add(gltf.scene);
        onStatsRef.current(meshStats(gltf.scene));

        const canvas = document.createElement("canvas");
        canvas.setAttribute("aria-label", `3D preview of ${name}`);
        el.appendChild(canvas);
        const gl = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        renderer = gl;
        gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 2000);
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = box.getSize(new THREE.Vector3());
        const target = box.getCenter(new THREE.Vector3());
        const radius = Math.max(size.x, size.y, size.z, 0.001);
        let yaw = 0.6, pitch = 0.45, dist = radius * 2.35;
        const start = { yaw, pitch, dist };
        const apply = () => {
          const cp = Math.cos(pitch);
          camera.position.set(target.x + dist * Math.sin(yaw) * cp, target.y + dist * Math.sin(pitch), target.z + dist * Math.cos(yaw) * cp);
          camera.lookAt(target);
        };
        const fit = () => {
          const w = el.clientWidth || 320, h = el.clientHeight || 240;
          gl.setSize(w, h, false);
          camera.aspect = w / Math.max(h, 1);
          camera.updateProjectionMatrix();
        };
        fit();
        apply();
        reset.current = () => { yaw = start.yaw; pitch = start.pitch; dist = start.dist; apply(); };

        const pts = new Map<number, { x: number; y: number }>();
        let pinch0 = 0, lx = 0, ly = 0, dragging = false;
        const clampDist = (d: number) => Math.max(radius * 0.25, Math.min(radius * 14, d));
        const down = (e: PointerEvent) => {
          pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
          canvas.setPointerCapture?.(e.pointerId);
          if (pts.size === 1) { dragging = true; lx = e.clientX; ly = e.clientY; }
        };
        const move = (e: PointerEvent) => {
          if (!pts.has(e.pointerId)) return;
          pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pts.size >= 2) {
            const [a, b] = [...pts.values()];
            const gap = Math.hypot(a.x - b.x, a.y - b.y);
            if (pinch0) { dist = clampDist(dist * (pinch0 / gap)); apply(); }
            pinch0 = gap;
            return;
          }
          if (!dragging) return;
          yaw -= (e.clientX - lx) * 0.01;
          pitch = Math.max(-1.2, Math.min(1.2, pitch + (e.clientY - ly) * 0.01));
          lx = e.clientX; ly = e.clientY;
          apply();
        };
        const up = (e: PointerEvent) => {
          pts.delete(e.pointerId);
          if (pts.size < 2) pinch0 = 0;
          if (pts.size === 0) dragging = false;
        };
        const wheel = (e: WheelEvent) => { e.preventDefault(); dist = clampDist(dist * (1 + e.deltaY * 0.0015)); apply(); };
        canvas.addEventListener("pointerdown", down);
        canvas.addEventListener("pointermove", move);
        canvas.addEventListener("pointerup", up);
        canvas.addEventListener("pointercancel", up);
        canvas.addEventListener("wheel", wheel, { passive: false });
        const ro = new ResizeObserver(fit);
        ro.observe(el);
        cleanups.push(() => {
          canvas.removeEventListener("pointerdown", down);
          canvas.removeEventListener("pointermove", move);
          canvas.removeEventListener("pointerup", up);
          canvas.removeEventListener("pointercancel", up);
          canvas.removeEventListener("wheel", wheel);
          ro.disconnect();
        });
        const tick = () => { if (dead) return; renderer!.render(scene, camera); raf = requestAnimationFrame(tick); };
        tick();
      } catch {
        if (!dead) onErrorRef.current("Couldn't load this 3D model.");
      }
    })();

    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      reset.current = null;
      cleanups.forEach((fn) => fn());
      renderer?.dispose();
      extra.forEach((u) => URL.revokeObjectURL(u));
      el.replaceChildren();
    };
  }, [url, name, data, files]);

  return (
    <div className="v2-ce-fprev-glb">
      <div ref={host} className="v2-ce-fprev-stage" data-testid="v2-ce-fprev-glb" />
      <button type="button" className="v2-btn v2-ce-icon v2-ce-fprev-reset" aria-label="Reset view" title="Reset view" onClick={() => reset.current?.()}><Ic g="⟳" /></button>
    </div>
  );
}
