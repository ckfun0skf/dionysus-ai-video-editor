import { expect, test } from "@playwright/test";
import { readFile, stat } from "node:fs/promises";
import { sampleProject } from "../src/sampleProject";

const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL4AAAAAElFTkSuQmCC";

test("browser smoke: generate a layer image and export a playable WebM", async ({ page }) => {
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
      layers: [{ id: "smoke-layer", name: "Smoke image", kind: "image", start: 0, duration: 1, assetId: "smoke-asset", x: 0, y: 0, width: 100, height: 100, fitMode: "fill" }],
      scriptVersionIds: [], generationRecords: []
    }]
  }];
  project.assets = [{ id: "smoke-asset", name: "Smoke source", kind: "image", path: tinyPng }];
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: "dionysus.project.v1", value: project });

  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.route("https://provider.example/v1/images/generations", async route => {
    const request = route.request().postDataJSON();
    expect(request.prompt).toContain("cinematic cyan shape");
    expect(request.model).toBe("smoke-image-model");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ model: "smoke-image-model", data: [{ b64_json: tinyPng.split(",")[1] }] })
    });
  });

  await page.goto("/");
  await expect(page).toHaveTitle(/Dionysus/);
  await expect(page.getByText("DYS-011 Browser Smoke")).toBeVisible();
  await page.getByRole("button", { name: "Project view" }).click();
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await page.locator(".timeline-slot").first().click();
  await expect(page.getByRole("heading", { name: "AI image generation / regenerate" })).toBeVisible();

  await page.getByPlaceholder("Optional submodule prompt").fill("cinematic cyan shape on black");
  await page.getByLabel("OpenAI-compatible image endpoint").fill("https://provider.example/v1/images/generations");
  await page.getByLabel("API key (kept in memory only)").fill("playwright-test-key");
  await page.getByPlaceholder("e.g. gpt-image-1").fill("smoke-image-model").catch(async () => {
    await page.locator(".ai-generation-panel input").nth(2).fill("smoke-image-model");
  });
  await page.getByRole("button", { name: "Generate / regenerate image" }).click();
  await expect(page.getByText("Generated image attached to composition layer.")).toBeVisible();

  const downloadPromise = page.waitForEvent("download", { timeout: 45_000 });
  await page.getByRole("button", { name: "Export WebM" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.webm$/);
  const path = await download.path();
  expect(path).toBeTruthy();
  const fileInfo = await stat(path!);
  expect(fileInfo.size).toBeGreaterThan(100);
  const encoded = (await readFile(path!)).toString("base64");
  const media = await page.evaluate(base64 => new Promise<{ duration: number; width: number; height: number }>((resolve, reject) => {
    const video = document.createElement("video");
    video.onloadedmetadata = () => resolve({ duration: video.duration, width: video.videoWidth, height: video.videoHeight });
    video.onerror = () => reject(new Error("Exported WebM could not be decoded by Chromium"));
    video.src = "data:video/webm;base64," + base64;
  }), encoded);
  expect(media.duration).toBeGreaterThan(0);
  expect(media.width).toBe(320);
  expect(media.height).toBe(180);
  expect(pageErrors).toEqual([]);
});
