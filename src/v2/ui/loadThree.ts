/**
 * Lazy-load three.js + GLTFLoader (dynamic import, separate Vite chunk) so the main bundle
 * does not grow. Same version (0.160.0) as the clip vendor copies.
 */
export async function loadThree() {
  const THREE = await import("three");
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  return { THREE, GLTFLoader };
}
