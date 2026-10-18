import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { CompositionLayer } from "./types";

type Props = { width: number; height: number; layers: CompositionLayer[] };

export default function ProceduralAnimationPreview({ width, height, layers }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const error = useRef(false);
  useEffect(() => {
    const root = host.current;
    if (!root || error.current) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      root.dataset.renderer = "unavailable";
      root.textContent = "WebGL is unavailable in this browser; procedural preview requires WebGL.";
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(root.clientWidth || 480, root.clientHeight || 220, false);
    root.replaceChildren(renderer.domElement);
    root.dataset.renderer = "threejs";
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(layers.find(layer => layer.backgroundColor)?.backgroundColor ?? "#111113");
    const camera = new THREE.PerspectiveCamera(38, (root.clientWidth || 480) / (root.clientHeight || 220), 0.1, 100);
    camera.position.set(0, 0, 8);
    scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const key = new THREE.PointLight(0x8ca8ff, 30);
    key.position.set(3, 3, 5);
    scene.add(key);
    const group = new THREE.Group();
    scene.add(group);
    const palette = [0x7c8cff, 0x54e0d1, 0xf4b860, 0xe879f9, 0xffffff];
    const count = Math.max(1, Math.min(8, layers.length || 1));
    for (let i = 0; i < count; i++) {
      const geometry = i % 3 === 0
        ? new THREE.TorusKnotGeometry(0.55 + i * 0.025, 0.14, 100, 12)
        : i % 3 === 1
          ? new THREE.IcosahedronGeometry(0.7, 1)
          : new THREE.TorusGeometry(0.55, 0.12, 16, 80);
      const material = new THREE.MeshStandardMaterial({ color: palette[i % palette.length], metalness: 0.45, roughness: 0.28, wireframe: i % 2 === 1 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.x = (i - (count - 1) / 2) * 1.35;
      mesh.scale.setScalar(Math.max(0.45, Math.min(1.2, layers[i]?.scale ?? 1)));
      group.add(mesh);
    }
    const particleGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(360 * 3);
    for (let i = 0; i < positions.length; i++) positions[i] = (Math.random() - 0.5) * 12;
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const particles = new THREE.Points(particleGeometry, new THREE.PointsMaterial({ color: 0x8ca8ff, size: 0.025, transparent: true, opacity: 0.8 }));
    scene.add(particles);
    let frame = 0;
    let raf = 0;
    const animate = () => {
      frame += 0.01;
      group.rotation.y = frame * 0.6;
      group.rotation.x = Math.sin(frame * 0.7) * 0.22;
      group.children.forEach((child, i) => {
        child.rotation.x += 0.004 + i * 0.0005;
        child.rotation.y += 0.006;
        child.position.y = Math.sin(frame * 1.4 + i) * 0.16;
      });
      particles.rotation.y = -frame * 0.04;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();
    const resize = () => {
      const w = root.clientWidth || 480, h = root.clientHeight || 220;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      group.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const material = object.material;
          if (Array.isArray(material)) material.forEach(item => item.dispose()); else material.dispose();
        }
      });
      particleGeometry.dispose();
      particles.material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [width, height, layers]);
  return <div className="procedural-preview" ref={host} role="img" aria-label="Animated Three.js procedural composition preview" style={{ width: "100%", height: 220, overflow: "hidden", borderRadius: 8 }} />;
}
