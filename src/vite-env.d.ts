/// <reference types="vite/client" />

/** Full git SHA or "dev", injected by vite.config `define`. */
declare const __BUILD_SHA__: string;
/** ISO-8601 build timestamp; the UI shows it in the viewer's local time. */
declare const __BUILD_TIME__: string;
/** GitHub Actions run number, or "" when built outside Actions. */
declare const __BUILD_RUN__: string;

declare module "three";
declare module "three/addons/loaders/GLTFLoader.js";
