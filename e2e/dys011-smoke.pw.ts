import { expect, test } from "@playwright/test";
import { readFile, stat } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { sampleProject } from "../src/sampleProject";

const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL4AAAAAElFTkSuQmCC";

function toneWavDataUri(durationSeconds = 1): string {
  const sampleRate = 8000;
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const pcm = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) pcm.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / sampleRate) * 3500), i * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return "data:audio/wav;base64," + Buffer.concat([header, pcm]).toString("base64");
}

test("browser smoke: compose video and audio, generate an image, export a playable WebM", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto("/");
  const sourceVideo = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 64; canvas.height = 36;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable for the browser fixture");
    const mimeType = ["video/webm;codecs=vp8", "video/webm"].find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error("Browser lacks MediaRecorder WebM support");
    const stream = canvas.captureStream(4);
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: BlobPart[] = [];
    const stopped = new Promise<Blob>((resolve, reject) => {
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => reject(new Error("Failed to create browser video fixture"));
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    });
    recorder.start(100);
    for (const color of ["#102040", "#206080", "#40a0d0", "#a0d0f0"]) {
      context.fillStyle = color; context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#ffffff"; context.fillRect(8, 8, 12, 12);
      await new Promise(resolve => window.setTimeout(resolve, 250));
    }
    recorder.stop();
    const blob = await stopped;
    stream.getTracks().forEach(track => track.stop());
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Could not encode browser video fixture"));
      reader.readAsDataURL(blob);
    });
  });

  const project = structuredClone(sampleProject);
  project.name = "DYS-011 Browser Smoke";
  project.width = 320;
  project.height = 180;
  project.frameRate = 4;
  project.shots = project.shots.slice(0, 1);
  project.shots[0].duration = 1;
  project.shots[0].slots = [{
    id: "smoke-slot", name: "Smoke shot", start: 0, duration: 1, selectedVersionId: "smoke-version",
    versions: [{
      id: "smoke-version", name: "Smoke version", description: "Playwright render test", duration: 1,
      layers: [
        { id: "smoke-layer", name: "Smoke image", kind: "image", start: 0, duration: 1, assetId: "smoke-asset", x: 0, y: 0, width: 100, height: 100, fitMode: "fill" },
        { id: "smoke-video-layer", name: "Motion insert", kind: "video", start: 0, duration: 1, assetId: "smoke-video-asset", x: 65, y: 10, width: 30, height: 30, fitMode: "contain" }
      ],
      scriptVersionIds: [], generationRecords: []
    }]
  }];
  project.assets = [
    { id: "smoke-asset", name: "Smoke source", kind: "image", path: tinyPng },
    { id: "smoke-video-asset", name: "Motion source", kind: "video", path: sourceVideo },
    { id: "smoke-audio-asset", name: "Tone source", kind: "audio", path: toneWavDataUri() }
  ];
  project.timelineClips = [{
    id: "smoke-audio-clip", name: "Tone bed", kind: "audio", trackId: "track-audio-1",
    start: 0, duration: 1, assetId: "smoke-audio-asset", sourceIn: 0, sourceOut: 1
  }];
  await page.evaluate(value => localStorage.setItem("dionysus.project.v1", JSON.stringify(value)), project);
  await page.reload();

  await page.route("https://provider.example/v1/images/generations", async route => {
    const corsHeaders = {
      "access-control-allow-origin": "http://127.0.0.1:4173",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "POST, OPTIONS"
    };
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    const request = route.request().postDataJSON();
    expect(request.prompt).toContain("cinematic cyan shape");
    expect(request.model).toBe("smoke-image-model");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: corsHeaders,
      body: JSON.stringify({ model: "smoke-image-model", data: [{ b64_json: tinyPng.split(",")[1] }] })
    });
  });

  await expect(page).toHaveTitle(/Dionysus/);
  await expect(page.getByText("DYS-011 Browser Smoke").first()).toBeVisible();
  await page.getByRole("button", { name: "Project view" }).click();
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await page.locator(".timeline-slot").first().click();
  const generationPanel = page.locator(".ai-generation-panel").first();
  await expect(generationPanel).toBeVisible();
  await generationPanel.getByPlaceholder("Optional submodule prompt").fill("cinematic cyan shape on black");
  await generationPanel.locator("input").nth(0).fill("https://provider.example/v1/images/generations");
  await generationPanel.locator("input").nth(1).fill("playwright-test-key");
  await generationPanel.locator("input").nth(2).fill("smoke-image-model");
  await generationPanel.getByRole("button", { name: "Generate / regenerate image" }).click();
  await page.waitForFunction(() => {
    const saved = JSON.parse(localStorage.getItem("dionysus.project.v1") || "null");
    const layer = saved?.shots?.[0]?.slots?.[0]?.versions?.[0]?.layers?.[0];
    const asset = saved?.assets?.find((candidate: { id: string }) => candidate.id === layer?.assetId);
    return asset?.prompt === "cinematic cyan shape on black" && asset?.modelName === "smoke-image-model";
  });

  const downloadPromise = page.waitForEvent("download", { timeout: 45_000 });
  await page.getByRole("button", { name: "Export WebM" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.webm$/);
  const path = await download.path();
  expect(path).toBeTruthy();
  const fileInfo = await stat(path!);
  expect(fileInfo.size).toBeGreaterThan(100);
  const bytes = await readFile(path!);
  expect(bytes.includes(Buffer.from("A_OPUS"))).toBe(true);
  expect(bytes.includes(Buffer.from("V_VP8")) || bytes.includes(Buffer.from("V_VP9"))).toBe(true);
  const media = await page.evaluate(base64 => new Promise<{ duration: number; width: number; height: number }>((resolve, reject) => {
    const video = document.createElement("video");
    video.onloadedmetadata = () => resolve({ duration: video.duration, width: video.videoWidth, height: video.videoHeight });
    video.onerror = () => reject(new Error("Exported WebM could not be decoded by Chromium"));
    video.src = "data:video/webm;base64," + base64;
  }), bytes.toString("base64"));
  expect(media.duration).toBeGreaterThan(0);
  expect(media.width).toBe(320);
  expect(media.height).toBe(180);
  expect(pageErrors).toEqual([]);
});
