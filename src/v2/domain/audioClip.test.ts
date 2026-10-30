import { describe, expect, it } from "vitest";
import { AUDIO_TEMPLATES, AUDIO_CLIP_FORMAT, clipDuration, midiOf, parseAudioClip, stringifyAudioClip, newAudioClip } from "./audioClip";
import { audioClipPrompt, audioClipExamples } from "./audioClipPrompt";
import { validateStoryboard } from "./storyJson";
import { encodeWav, rng, noiseSamples } from "../render/audioClip";

describe("dionysus.audioclip/1 (P4A)", () => {
  it("every template parses cleanly and round-trips", () => {
    expect(AUDIO_TEMPLATES.length).toBeGreaterThanOrEqual(5);
    for (const t of AUDIO_TEMPLATES) {
      const r = parseAudioClip(stringifyAudioClip(t.clip));
      expect(r.ok, t.id).toBe(true);
      if (r.ok) { expect(r.issues.filter((i) => i.level === "error")).toEqual([]); expect(clipDuration(r.clip)).toBeGreaterThan(0); }
    }
    expect(newAudioClip().format).toBe(AUDIO_CLIP_FORMAT);
  });
  it("rejects a wrong format and accepts JSON wrapped in chat text", () => {
    expect(parseAudioClip({ format: "x", tempo: 120, tracks: [] }).ok).toBe(false);
    expect(parseAudioClip("not json").ok).toBe(false);
    expect(parseAudioClip("Here you go:\n```json\n" + stringifyAudioClip(AUDIO_TEMPLATES[0].clip) + "```").ok).toBe(true);
  });
  it("reads note names", () => {
    expect(midiOf("A4")).toBe(69);
    expect(midiOf("C4")).toBe(60);
    expect(midiOf(64)).toBe(64);
  });
  it("the prompt embeds the spec link, the brief and parseable examples", () => {
    const p = audioClipPrompt({ name: "Chime", brief: "a bright title chime", durationSec: 3, specUrl: "https://x.test/ai/AUDIO_CLIP_FORMAT.md" });
    expect(p).toContain("https://x.test/ai/AUDIO_CLIP_FORMAT.md");
    expect(p).toContain("a bright title chime");
    expect(p).toContain(AUDIO_CLIP_FORMAT);
    expect(audioClipExamples(AUDIO_TEMPLATES.map((t) => t.id).slice(0, 2)).length).toBeGreaterThan(0);
  });
});

describe("deterministic rendering helpers (P4A)", () => {
  it("rng and noise are seeded", () => {
    const a = rng(7), b = rng(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(Array.from(noiseSamples(64, 0, rng(3)))).toEqual(Array.from(noiseSamples(64, 0, rng(3))));
  });
  it("encodes a 16-bit PCM WAV", async () => {
    const wav = encodeWav([new Float32Array([0, 1, -1]), new Float32Array([0, 0.5, -0.5])], 48000);
    expect(wav.type).toBe("audio/wav");
    expect(wav.size).toBe(44 + 3 * 2 * 2);
  });
});

describe("storyboard json audio source (P4A)", () => {
  const doc = (asset: Record<string, unknown>) => ({ format: "dionysus.storyboard/1", meta: { title: "T", aspect: "16:9" }, assets: [asset], shots: [{ id: "a", title: "a", description: "", durationSec: 3, prompt: "P", assets: [], qa: [] }] });
  it("accepts json on audio, rejects it elsewhere and requires a brief", () => {
    expect(validateStoryboard(doc({ id: "c", name: "C", type: "audio", prompt: "chime", source: "json" })).ok).toBe(true);
    expect(validateStoryboard(doc({ id: "c", name: "C", type: "image", prompt: "x", source: "json" })).ok).toBe(false);
    expect(validateStoryboard(doc({ id: "c", name: "C", type: "audio", source: "json" })).ok).toBe(false);
  });
});
