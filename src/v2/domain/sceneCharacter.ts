/**
 * Scene Phase 2 (#351): characters in `dionysus.scene/1`. Pure: no DOM, no three.js. Every field is optional, so a
 * scene without characters renders exactly as before.
 *
 * An object with `character` is a humanoid: a built-in mannequin (no files), a VRM model (`model: "x.vrm"`, loaded with
 * the vendored three-vrm) or a humanoid GLB whose bones are mapped to the common humanoid rig (VRM bone names) by
 * `rig` ("auto" detects Mixamo and common names). Animation is defined on a **normalized humanoid** (T-pose, facing
 * +z, y up, every rest rotation identity): the built-in clips here, and library clips (`animations`: animation-only GLBs
 * such as Mixamo exports) that the page retargets onto it; the page maps the normalized pose onto each rig.
 *
 * High-level actions are events the evaluator expands from the document and `t` alone:
 *   walkTo / runTo   along points at a speed (a trapezoid speed profile); the locomotion clip's time is the distance
 *                    walked divided by its stride, so feet don't slide; the body turns towards the travel direction
 *   turnTo           turn the body (yaw) to an object, a point or an angle
 *   lookAt           head and eyes look at an object, a point or "camera" (tracked live), with a weight
 *   sit / stand      move to a seat and blend into the sit pose, and back
 *   gesture          a clip on the upper-body layer (over walking or idling) for its length
 *   play / stop      a full-body clip in place of idling (dance…)
 *   expression       facial expressions (happy, angry, sad, surprised, relaxed, blink, visemes) tween like properties
 *   speak            lip sync: visemes from the text over the duration, or precomputed visemes (from an audio file)
 *   pickUp / drop    hold an object in a hand (it follows the hand bone) and put it down
 * Blinking is automatic (seeded by the object's id) unless `blink: false`.
 */
import type { SceneLoop, Vec3 } from "./scene";

/** The common humanoid rig (VRM 1.0 bone names); the first group is required for a GLB rig. */
export const HUMAN_BONES = [
  "hips", "spine", "chest", "upperChest", "neck", "head", "leftEye", "rightEye",
  "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand", "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand",
  "leftUpperLeg", "leftLowerLeg", "leftFoot", "leftToes", "rightUpperLeg", "rightLowerLeg", "rightFoot", "rightToes",
] as const;
export type HumanBone = (typeof HUMAN_BONES)[number];
export const REQUIRED_BONES: readonly HumanBone[] = ["hips", "spine", "head", "leftUpperArm", "leftLowerArm", "leftHand", "rightUpperArm", "rightLowerArm", "rightHand", "leftUpperLeg", "leftLowerLeg", "leftFoot", "rightUpperLeg", "rightLowerLeg", "rightFoot"];
/** Bones an upper-body layer (gesture) may move. */
export const UPPER_BONES: readonly HumanBone[] = ["spine", "chest", "upperChest", "neck", "head", "leftEye", "rightEye", "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand", "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand"];

/** Expressions (VRM presets); visemes are aa, ih, ou, ee, oh. */
export const SCENE_EXPRESSIONS = ["happy", "angry", "sad", "surprised", "relaxed", "blink", "aa", "ih", "ou", "ee", "oh"] as const;
export type SceneExpression = (typeof SCENE_EXPRESSIONS)[number];
export const SCENE_VISEMES = ["aa", "ih", "ou", "ee", "oh"] as const;
export type SceneViseme = (typeof SCENE_VISEMES)[number];

export interface SceneCharacterBody { height?: number; skin?: string; cloth?: string; pants?: string; hair?: string; shoes?: string }
export interface SceneCharacter {
  /** GLB models: humanoid bone → node name, or "auto" (default). VRM models carry their own humanoid. */
  rig?: "auto" | Partial<Record<HumanBone, string>>;
  /** The built-in mannequin (an object with no model or script): height in units (default 1.7) and colours. */
  body?: SceneCharacterBody;
  /** Clips (built-in or library names) for idling, walking and running. */
  idle?: string; walk?: string; run?: string;
  /** Automatic seeded blinking (default true). */
  blink?: boolean;
  /** Expressions from 0 s, 0–1. */
  expressions?: Partial<Record<SceneExpression, number>>;
}
/** A library clip: an animation in a GLB of `files`, retargeted onto any humanoid. */
export interface SceneAnimationEntry { file: string; clip?: string; rig?: "auto" | Partial<Record<HumanBone, string>>; stride?: number; loop?: SceneLoop; length?: number; mask?: "full" | "upper" }

// ---------------------------------------------------------------- built-in clips (normalized humanoid)

/** A built-in clip: Euler keys in degrees (XYZ order) per bone, hips offset keys in metres (for a 1.7 m body). */
export interface BuiltinClip {
  length: number;
  loop: SceneLoop;
  /** Upper-body clips leave the legs to the layer below (gestures). */
  mask: "full" | "upper";
  /** Metres moved per cycle (locomotion clips), for a 1.7 m body. */
  stride?: number;
  bones: Partial<Record<HumanBone, [number, number, number, number][]>>;
  hips?: [number, number, number, number][];
  description: string;
}
const A = 79; // arms down from the T-pose
const k = (...rows: [number, number, number, number][]) => rows;
export const BUILTIN_CLIPS: Record<string, BuiltinClip> = {
  idle: {
    length: 4, loop: "repeat", mask: "full", description: "Standing, breathing, a slight sway.",
    bones: {
      spine: k([0, 2, 0, 0], [2, 3, 0, 0], [4, 2, 0, 0]),
      chest: k([0, 0, 0, 0], [2, 2, 1, 0], [4, 0, 0, 0]),
      head: k([0, 0, 0, 0], [2, -2, 4, 0], [4, 0, 0, 0]),
      leftUpperArm: k([0, 4, 0, -A], [2, 2, 0, -A + 3], [4, 4, 0, -A]),
      rightUpperArm: k([0, 4, 0, A], [2, 2, 0, A - 3], [4, 4, 0, A]),
      leftLowerArm: k([0, 0, -10, 0], [4, 0, -10, 0]),
      rightLowerArm: k([0, 0, 10, 0], [4, 0, 10, 0]),
      leftUpperLeg: k([0, 0, 0, 2], [4, 0, 0, 2]),
      rightUpperLeg: k([0, 0, 0, -2], [4, 0, 0, -2]),
    },
    hips: k([0, 0, 0, 0], [2, 0, -0.008, 0], [4, 0, 0, 0]),
  },
  walk: {
    length: 1, loop: "repeat", mask: "full", stride: 1.3, description: "A walk cycle (1.3 m per cycle at 1.7 m tall).",
    bones: {
      hips: k([0, 0, 5, 0], [0.5, 0, -5, 0], [1, 0, 5, 0]),
      spine: k([0, 4, -3, 0], [0.5, 4, 3, 0], [1, 4, -3, 0]),
      chest: k([0, 0, -3, 0], [0.5, 0, 3, 0], [1, 0, -3, 0]),
      leftUpperLeg: k([0, -25, 0, 0], [0.25, -5, 0, 0], [0.5, 20, 0, 0], [0.75, -12, 0, 0], [1, -25, 0, 0]),
      rightUpperLeg: k([0, 20, 0, 0], [0.25, -12, 0, 0], [0.5, -25, 0, 0], [0.75, -5, 0, 0], [1, 20, 0, 0]),
      leftLowerLeg: k([0, 5, 0, 0], [0.25, 10, 0, 0], [0.5, 15, 0, 0], [0.62, 55, 0, 0], [0.8, 40, 0, 0], [0.92, 12, 0, 0], [1, 5, 0, 0]),
      rightLowerLeg: k([0, 15, 0, 0], [0.12, 55, 0, 0], [0.3, 40, 0, 0], [0.42, 12, 0, 0], [0.5, 5, 0, 0], [0.75, 10, 0, 0], [1, 15, 0, 0]),
      leftFoot: k([0, -10, 0, 0], [0.25, 0, 0, 0], [0.45, 15, 0, 0], [0.7, 0, 0, 0], [1, -10, 0, 0]),
      rightFoot: k([0, 15, 0, 0], [0.2, 0, 0, 0], [0.5, -10, 0, 0], [0.75, 0, 0, 0], [0.95, 15, 0, 0], [1, 15, 0, 0]),
      leftUpperArm: k([0, 16, 0, -A], [0.5, -16, 0, -A], [1, 16, 0, -A]),
      rightUpperArm: k([0, -16, 0, A], [0.5, 16, 0, A], [1, -16, 0, A]),
      leftLowerArm: k([0, 0, -12, 0], [0.5, 0, -22, 0], [1, 0, -12, 0]),
      rightLowerArm: k([0, 0, 22, 0], [0.5, 0, 12, 0], [1, 0, 22, 0]),
    },
    hips: k([0, 0, -0.02, 0], [0.25, 0, 0.012, 0], [0.5, 0, -0.02, 0], [0.75, 0, 0.012, 0], [1, 0, -0.02, 0]),
  },
  run: {
    length: 0.7, loop: "repeat", mask: "full", stride: 2.6, description: "A run cycle (2.6 m per cycle at 1.7 m tall).",
    bones: {
      hips: k([0, 0, 8, 0], [0.35, 0, -8, 0], [0.7, 0, 8, 0]),
      spine: k([0, 12, -5, 0], [0.35, 12, 5, 0], [0.7, 12, -5, 0]),
      leftUpperLeg: k([0, -45, 0, 0], [0.175, -10, 0, 0], [0.35, 30, 0, 0], [0.525, -20, 0, 0], [0.7, -45, 0, 0]),
      rightUpperLeg: k([0, 30, 0, 0], [0.175, -20, 0, 0], [0.35, -45, 0, 0], [0.525, -10, 0, 0], [0.7, 30, 0, 0]),
      leftLowerLeg: k([0, 20, 0, 0], [0.175, 30, 0, 0], [0.35, 40, 0, 0], [0.45, 100, 0, 0], [0.6, 70, 0, 0], [0.7, 20, 0, 0]),
      rightLowerLeg: k([0, 40, 0, 0], [0.1, 100, 0, 0], [0.25, 70, 0, 0], [0.35, 20, 0, 0], [0.525, 30, 0, 0], [0.7, 40, 0, 0]),
      leftFoot: k([0, -10, 0, 0], [0.3, 20, 0, 0], [0.7, -10, 0, 0]),
      rightFoot: k([0, 20, 0, 0], [0.35, -10, 0, 0], [0.7, 20, 0, 0]),
      leftUpperArm: k([0, 40, 0, -A + 5], [0.35, -40, 0, -A + 5], [0.7, 40, 0, -A + 5]),
      rightUpperArm: k([0, -40, 0, A - 5], [0.35, 40, 0, A - 5], [0.7, -40, 0, A - 5]),
      leftLowerArm: k([0, 0, -75, 0], [0.7, 0, -75, 0]),
      rightLowerArm: k([0, 0, 75, 0], [0.7, 0, 75, 0]),
    },
    hips: k([0, 0, -0.05, 0], [0.175, 0, 0.03, 0], [0.35, 0, -0.05, 0], [0.525, 0, 0.03, 0], [0.7, 0, -0.05, 0]),
  },
  wave: {
    length: 2.4, loop: "once", mask: "upper", description: "Raise the right hand and wave (upper body).",
    bones: {
      rightUpperArm: k([0, 0, 0, A], [0.35, 0, -15, -55], [2.05, 0, -15, -55], [2.4, 0, 0, A]),
      rightLowerArm: k([0, 0, 0, 0], [0.35, 0, 0, -50], [0.6, 0, 0, -25], [0.85, 0, 0, -55], [1.1, 0, 0, -25], [1.35, 0, 0, -55], [1.6, 0, 0, -25], [1.85, 0, 0, -50], [2.4, 0, 0, 0]),
      rightHand: k([0, 0, 0, 0], [0.35, 0, 0, -10], [2.05, 0, 0, -10], [2.4, 0, 0, 0]),
      head: k([0, 0, 0, 0], [0.4, 0, 0, -6], [2, 0, 0, -6], [2.4, 0, 0, 0]),
    },
  },
  nod: {
    length: 1.2, loop: "once", mask: "upper", description: "Nod twice (upper body).",
    bones: { head: k([0, 0, 0, 0], [0.25, 14, 0, 0], [0.5, 0, 0, 0], [0.75, 12, 0, 0], [1.2, 0, 0, 0]), neck: k([0, 0, 0, 0], [0.25, 4, 0, 0], [0.5, 0, 0, 0], [0.75, 4, 0, 0], [1.2, 0, 0, 0]) },
  },
  point: {
    length: 1.8, loop: "once", mask: "upper", description: "Point forward with the right arm (upper body).",
    bones: {
      rightUpperArm: k([0, 0, 0, A], [0.4, -5, 75, 5], [1.4, -5, 75, 5], [1.8, 0, 0, A]),
      rightLowerArm: k([0, 0, 0, 0], [0.4, 0, 5, 0], [1.4, 0, 5, 0], [1.8, 0, 0, 0]),
      chest: k([0, 0, 0, 0], [0.4, 0, -8, 0], [1.4, 0, -8, 0], [1.8, 0, 0, 0]),
    },
  },
  talk: {
    length: 2.4, loop: "repeat", mask: "upper", description: "Small hand gestures while talking (upper body).",
    bones: {
      leftUpperArm: k([0, -5, 0, -A + 8], [0.6, -12, 0, -A + 14], [1.2, -5, 0, -A + 8], [1.8, -8, 0, -A + 10], [2.4, -5, 0, -A + 8]),
      rightUpperArm: k([0, -8, 0, A - 10], [0.6, -5, 0, A - 8], [1.2, -14, 0, A - 16], [1.8, -5, 0, A - 8], [2.4, -8, 0, A - 10]),
      leftLowerArm: k([0, 0, -45, 0], [0.6, 0, -60, 0], [1.2, 0, -40, 0], [1.8, 0, -55, 0], [2.4, 0, -45, 0]),
      rightLowerArm: k([0, 0, 50, 0], [0.6, 0, 40, 0], [1.2, 0, 62, 0], [1.8, 0, 42, 0], [2.4, 0, 50, 0]),
      chest: k([0, 0, -3, 0], [1.2, 0, 3, 0], [2.4, 0, -3, 0]),
      head: k([0, 0, 3, 0], [0.8, 3, -3, 0], [1.6, 0, 2, 0], [2.4, 0, 3, 0]),
    },
  },
  sit: {
    length: 1, loop: "once", mask: "full", description: "Sitting on a seat about a quarter of the body height high (a pose).",
    bones: {
      spine: k([0, -4, 0, 0], [1, -4, 0, 0]),
      leftUpperLeg: k([0, -88, 0, 4], [1, -88, 0, 4]),
      rightUpperLeg: k([0, -88, 0, -4], [1, -88, 0, -4]),
      leftLowerLeg: k([0, 88, 0, 0], [1, 88, 0, 0]),
      rightLowerLeg: k([0, 88, 0, 0], [1, 88, 0, 0]),
      leftUpperArm: k([0, -20, 0, -A + 4], [1, -20, 0, -A + 4]),
      rightUpperArm: k([0, -20, 0, A - 4], [1, -20, 0, A - 4]),
      leftLowerArm: k([0, 0, -45, 0], [1, 0, -45, 0]),
      rightLowerArm: k([0, 0, 45, 0], [1, 0, 45, 0]),
    },
    hips: k([0, 0, -0.43, -0.08], [1, 0, -0.43, -0.08]),
  },
};
/** The built-in clip names. */
export const BUILTIN_CLIP_NAMES = Object.keys(BUILTIN_CLIPS);

// ---------------------------------------------------------------- rigs

const RIG_ALIASES: Record<HumanBone, string[]> = {
  hips: ["hips", "pelvis", "hip"], spine: ["spine", "spine01", "spine1x"], chest: ["chest", "spine1", "spine02"], upperChest: ["upperchest", "spine2", "spine03"],
  neck: ["neck"], head: ["head"], leftEye: ["lefteye", "eyel", "eyeleft"], rightEye: ["righteye", "eyer", "eyeright"],
  leftShoulder: ["leftshoulder", "shoulderl", "claviclel", "lclavicle"], leftUpperArm: ["leftupperarm", "leftarm", "upperarml", "uparml", "larm"],
  leftLowerArm: ["leftlowerarm", "leftforearm", "lowerarml", "forearml", "lforearm"], leftHand: ["lefthand", "handl", "lhand"],
  rightShoulder: ["rightshoulder", "shoulderr", "clavicler", "rclavicle"], rightUpperArm: ["rightupperarm", "rightarm", "upperarmr", "uparmr", "rarm"],
  rightLowerArm: ["rightlowerarm", "rightforearm", "lowerarmr", "forearmr", "rforearm"], rightHand: ["righthand", "handr", "rhand"],
  leftUpperLeg: ["leftupperleg", "leftupleg", "thighl", "upperlegl", "lthigh"], leftLowerLeg: ["leftlowerleg", "leftleg", "calfl", "shinl", "lowerlegl", "lcalf"],
  leftFoot: ["leftfoot", "footl", "lfoot"], leftToes: ["lefttoes", "lefttoebase", "toel", "ballL".toLowerCase()],
  rightUpperLeg: ["rightupperleg", "rightupleg", "thighr", "upperlegr", "rthigh"], rightLowerLeg: ["rightlowerleg", "rightleg", "calfr", "shinr", "lowerlegr", "rcalf"],
  rightFoot: ["rightfoot", "footr", "rfoot"], rightToes: ["righttoes", "righttoebase", "toer", "ballr"],
};
/** A node name without rig prefixes, separators and case ("mixamorig:LeftForeArm" → "leftforearm", "upperarm_l" → "upperarml"). */
const cleanBoneName = (n: string) => n.replace(/^.*[:|]/, "").replace(/^(mixamorig\d*|bip0?1|def|j_bip_[clr]_|j_)/i, "").replace(/[\s_.-]/g, "").toLowerCase();

/** Map a skeleton's node names to the humanoid rig ("auto"); `missing` lists required bones it doesn't have. */
export function autoRig(nodeNames: readonly string[]): { rig: Partial<Record<HumanBone, string>>; missing: HumanBone[] } {
  const rig: Partial<Record<HumanBone, string>> = {};
  const used = new Set<string>();
  for (const bone of HUMAN_BONES) {
    for (const alias of RIG_ALIASES[bone]) {
      const hit = nodeNames.find((n) => !used.has(n) && cleanBoneName(n) === alias);
      if (hit) { rig[bone] = hit; used.add(hit); break; }
    }
  }
  return { rig, missing: REQUIRED_BONES.filter((b) => !rig[b]) };
}

// ---------------------------------------------------------------- calls (events)

export interface SceneCharacterCall { arg: string; description: string; tweens: boolean }
/** The character calls (on objects with `character`). `lookAt` here moves the head and eyes (turnTo turns the body). */
export const SCENE_CHARACTER_CALLS: Record<string, SceneCharacterCall> = {
  walkTo: { arg: "path", tweens: false, description: "Walk along points [[x, y, z], …] (or one point) at speed m/s (default 1.3); the walk cycle is speed-matched and the body turns along the way." },
  runTo: { arg: "path", tweens: false, description: "Like walkTo with the run cycle (default 3.6 m/s)." },
  turnTo: { arg: "target", tweens: true, description: "Turn the body to an object id, a point [x, y, z] or an angle in degrees (yaw), over dur (default 0.6 s)." },
  lookAt: { arg: "target", tweens: true, description: "Head and eyes look at an object id, a point or \"camera\" (followed as it moves); weight 0–1 (0 = look ahead again), blending over dur." },
  sit: { arg: "seat", tweens: true, description: "Move to a seat (an object id or [x, y, z]) and sit, over dur (default 0.8 s); facing: degrees or an object id." },
  stand: { arg: "dur", tweens: true, description: "Stand up from sitting, over dur (default 0.8 s)." },
  gesture: { arg: "clip", tweens: true, description: "Play a clip on the upper body (wave, nod, point, talk or a library clip) over walking or idling; dur (default the clip's length), fade (default 0.25 s)." },
  expression: { arg: "value", tweens: true, description: "Set expressions { happy, angry, sad, surprised, relaxed, blink, aa, ih, ou, ee, oh: 0–1 }, tweening over dur." },
  speak: { arg: "text", tweens: true, description: "Lip sync over dur seconds: visemes from the text (spread over dur), or visemes [[seconds, viseme, weight], …] (e.g. from an audio file)." },
  pickUp: { arg: "object", tweens: false, description: "Hold an object in a hand (hand: right or left); it follows the hand until dropped." },
  drop: { arg: "object", tweens: false, description: "Put a held object down at position [x, y, z] (default in front of the character, on the floor)." },
};

// ---------------------------------------------------------------- pure helpers

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(num);

/** The points of a walk path argument: one point or a list (y is ignored: characters walk on the floor). */
export function pathPoints(v: unknown): Vec3[] | undefined {
  if (isVec3(v)) return [v];
  if (Array.isArray(v) && v.length > 0 && v.length <= 256 && v.every(isVec3)) return v as Vec3[];
  return undefined;
}

/**
 * Distance walked τ seconds into a walk of length `len` at top speed `v` with `ramp` seconds to speed up and slow
 * down (a trapezoid speed profile; a triangle when the walk is short). Returns the total time too.
 */
export function walkProfile(len: number, v: number, ramp = 0.4): { total: number; at: (tau: number) => { d: number; speed: number } } {
  if (len <= 1e-6) return { total: 0, at: () => ({ d: 0, speed: 0 }) };
  const a = v / ramp;
  if (len >= v * ramp) {
    const total = len / v + ramp;
    return {
      total,
      at(tau) {
        const t = Math.max(0, Math.min(total, tau));
        if (t < ramp) return { d: 0.5 * a * t * t, speed: a * t };
        if (t > total - ramp) { const r = total - t; return { d: len - 0.5 * a * r * r, speed: a * r }; }
        return { d: 0.5 * v * ramp + v * (t - ramp), speed: v };
      },
    };
  }
  const tp = Math.sqrt(len / a), total = 2 * tp;
  return {
    total,
    at(tau) {
      const t = Math.max(0, Math.min(total, tau));
      if (t < tp) return { d: 0.5 * a * t * t, speed: a * t };
      const r = total - t;
      return { d: len - 0.5 * a * r * r, speed: a * r };
    },
  };
}

/** A polyline on the floor (x, z) from `from` through `points`: its length, a point and the heading at a distance. */
export function floorPath(from: Vec3, points: Vec3[]): { len: number; at: (d: number) => { p: Vec3; yaw: number } } {
  const pts: Vec3[] = [[from[0], from[1], from[2]], ...points.map((p): Vec3 => [p[0], from[1], p[2]])];
  const segs: { a: Vec3; b: Vec3; len: number; yaw: number }[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (len > 1e-6) segs.push({ a, b, len, yaw: (Math.atan2(b[0] - a[0], b[2] - a[2]) * 180) / Math.PI });
  }
  const len = segs.reduce((s, x) => s + x.len, 0);
  return {
    len,
    at(d) {
      if (!segs.length) return { p: [from[0], from[1], from[2]], yaw: NaN };
      let rest = Math.max(0, Math.min(len, d));
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (rest <= s.len || i === segs.length - 1) {
          const f = s.len ? Math.min(1, rest / s.len) : 1;
          // Round the corner: blend the heading into the next segment's over the last 0.35 m.
          let yaw = s.yaw;
          const next = segs[i + 1], left = s.len - rest;
          if (next && left < 0.35) yaw = blendYaw(s.yaw, next.yaw, 0.5 * (1 - left / 0.35));
          const prev = segs[i - 1];
          if (prev && rest < 0.35) yaw = blendYaw(prev.yaw, s.yaw, 0.5 + 0.5 * (rest / 0.35));
          return { p: [s.a[0] + (s.b[0] - s.a[0]) * f, from[1], s.a[2] + (s.b[2] - s.a[2]) * f], yaw };
        }
        rest -= s.len;
      }
      const s = segs[segs.length - 1];
      return { p: [s.b[0], from[1], s.b[2]], yaw: s.yaw };
    },
  };
}

/** The shortest-way blend between two headings in degrees (k = 0..1). */
export function blendYaw(a: number, b: number, k: number): number {
  let d = ((b - a) % 360 + 540) % 360 - 180;
  if (!Number.isFinite(d)) d = 0;
  return a + d * k;
}

/** FNV-1a of a string, for seeded schedules. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
/** A seeded generator (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const blinkCache = new Map<string, number[]>();
/** The automatic blink at `t` (0–1) for an object id: blinks every 2–5.5 s (seeded by the id), 0.16 s each. */
export function blinkAt(id: string, t: number): number {
  let starts = blinkCache.get(id);
  if (!starts) {
    const r = seeded(hash(`blink:${id}`));
    starts = [];
    for (let at = 0.6 + r() * 2; at < 600; at += 2 + r() * 3.5) starts.push(at);
    if (blinkCache.size > 256) blinkCache.clear();
    blinkCache.set(id, starts);
  }
  // Binary search for the last start ≤ t.
  let lo = 0, hi = starts.length - 1, i = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (starts[m] <= t) { i = m; lo = m + 1; } else hi = m - 1; }
  if (i < 0) return 0;
  const x = (t - starts[i]) / 0.16;
  return x < 0 || x > 1 ? 0 : 1 - Math.abs(2 * x - 1);
}

/** One viseme key: seconds from the speak event's start, viseme, weight 0–1. */
export type SceneVisemeKey = [number, SceneViseme, number];
const VOWEL_VISEME: Record<string, SceneViseme> = { a: "aa", á: "aa", à: "aa", e: "ee", é: "ee", è: "ee", i: "ih", í: "ih", y: "ih", o: "oh", ó: "oh", u: "ou", ú: "ou", w: "ou" };
/**
 * Visemes from text, spread evenly over `dur` seconds: each vowel group is a syllable with the viseme of its first
 * vowel; punctuation adds a pause. CJK characters (and other letters with no vowel table) count one syllable each with
 * an "aa"-ish open mouth that alternates, so any language moves the mouth in time.
 */
export function visemesFromText(text: string, dur: number): SceneVisemeKey[] {
  const syl: (SceneViseme | null)[] = [];
  const s = text.toLowerCase();
  let inVowel = false;
  const cycle: SceneViseme[] = ["aa", "oh", "ih", "ee", "ou"];
  let ci = 0;
  for (const ch of s) {
    const v = VOWEL_VISEME[ch];
    if (v) { if (!inVowel) syl.push(v); inVowel = true; continue; }
    inVowel = false;
    if (/[.,!?;:。、！？…]/.test(ch)) syl.push(null);
    else if (/[぀-ヿ㐀-鿿가-힯]/.test(ch)) syl.push(cycle[ci++ % cycle.length]);
  }
  while (syl.length && syl[syl.length - 1] === null) syl.pop();
  if (!syl.length || !(dur > 0)) return [];
  const step = dur / syl.length;
  const out: SceneVisemeKey[] = [];
  syl.forEach((v, i) => { if (v) out.push([+(step * (i + 0.5)).toFixed(3), v, 1]); });
  return out;
}

/** Viseme weights at `tau` seconds into a speak event from its keys (each key a bell about 0.18 s wide). */
export function visemesAt(keys: readonly SceneVisemeKey[], tau: number, dur: number): Partial<Record<SceneViseme, number>> {
  const out: Partial<Record<SceneViseme, number>> = {};
  if (tau < 0 || tau > dur + 0.2) return out;
  const width = 0.09;
  for (const [t, v, w] of keys) {
    const x = (tau - t) / width;
    if (Math.abs(x) > 2.5) continue;
    out[v] = Math.min(1, (out[v] ?? 0) + w * Math.exp(-x * x));
  }
  return out;
}

/** Valid viseme keys (or a problem). */
export function visemeKeysProblem(v: unknown): string | undefined {
  if (!Array.isArray(v) || v.length > 20000) return "must be a list (at most 20000) of [seconds, viseme, weight]";
  for (const x of v) if (!Array.isArray(x) || x.length !== 3 || !num(x[0]) || x[0] < 0 || !(SCENE_VISEMES as readonly string[]).includes(String(x[1])) || !num(x[2]) || x[2] < 0 || x[2] > 1)
    return `has an item that is not [seconds ≥ 0, ${SCENE_VISEMES.join(" | ")}, weight 0–1]`;
  return undefined;
}

/** Problems with an `expression` map. */
export function expressionsProblem(v: unknown): string | undefined {
  if (!isObj(v) || !Object.keys(v).length) return `must be an object of expression → 0–1 (${SCENE_EXPRESSIONS.join(", ")})`;
  for (const [k2, x] of Object.entries(v)) {
    if (!(SCENE_EXPRESSIONS as readonly string[]).includes(k2)) return `has "${k2}", which is not an expression (${SCENE_EXPRESSIONS.join(", ")})`;
    if (!num(x) || x < 0 || x > 1) return `has ${k2} that is not a number from 0 to 1`;
  }
  return undefined;
}

/**
 * Visemes from an audio signal's energy (for "speak" from an audio file): `frames` are per-window [rms, low, high]
 * (low/high-band energy shares 0–1) every `hop` seconds. Loud frames open the mouth; bright frames (more high band)
 * lean to ee / ih, dark ones to oh / ou, the rest aa. Keys every 50 ms where the mouth is open.
 */
export function visemesFromEnergy(frames: readonly [number, number, number][], hop: number): SceneVisemeKey[] {
  if (!frames.length || !(hop > 0)) return [];
  const peak = Math.max(1e-6, ...frames.map((f) => f[0]));
  const out: SceneVisemeKey[] = [];
  const every = Math.max(1, Math.round(0.05 / hop));
  for (let i = 0; i < frames.length; i += every) {
    const [rms, low, high] = frames[i];
    const open = Math.min(1, Math.max(0, (rms / peak - 0.12) / 0.6));
    if (open < 0.05) continue;
    const v: SceneViseme = high > 0.45 ? (high > 0.6 ? "ee" : "ih") : low > 0.65 ? (low > 0.8 ? "ou" : "oh") : "aa";
    out.push([+(i * hop).toFixed(3), v, +open.toFixed(2)]);
  }
  return out;
}

/**
 * Energy frames of mono audio samples for lip sync: every `hop` seconds (default 10 ms) over a 20 ms window, the RMS
 * and the low (< ~400 Hz) and high (> ~2.5 kHz) band shares of the energy, from one-pole filters. Pure arithmetic on
 * the samples, so the same file always gives the same visemes (the editor decodes the file, this does the rest).
 */
export function audioVisemeFrames(samples: Float32Array, sampleRate: number, hop = 0.01): [number, number, number][] {
  if (!(sampleRate > 0) || !samples.length) return [];
  const aLow = 1 - Math.exp((-2 * Math.PI * 400) / sampleRate), aHigh = 1 - Math.exp((-2 * Math.PI * 2500) / sampleRate);
  const low = new Float32Array(samples.length), high = new Float32Array(samples.length);
  let yl = 0, yh = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    yl += aLow * (x - yl); yh += aHigh * (x - yh);
    low[i] = yl; high[i] = x - yh;
  }
  const step = Math.max(1, Math.round(hop * sampleRate)), win = Math.max(step, Math.round(0.02 * sampleRate));
  const out: [number, number, number][] = [];
  for (let start = 0; start < samples.length; start += step) {
    let e = 0, el = 0, eh = 0;
    const end = Math.min(samples.length, start + win);
    for (let i = start; i < end; i++) { e += samples[i] * samples[i]; el += low[i] * low[i]; eh += high[i] * high[i]; }
    const n = Math.max(1, end - start);
    out.push([Math.sqrt(e / n), e > 0 ? Math.min(1, el / e) : 0, e > 0 ? Math.min(1, eh / e) : 0]);
  }
  return out;
}
