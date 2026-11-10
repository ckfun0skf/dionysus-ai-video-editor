import { describe, expect, it } from "vitest";
import { readBuildStamp } from "../buildStamp";
import { BUILD_INFO, formatBuildTime, resolveBuildInfo, shortSha } from "./buildInfo";

describe("P56 build stamp", () => {
  it("prefers GITHUB_SHA and GITHUB_RUN_NUMBER over git", () => {
    const t = new Date("2026-11-10T06:11:20.000Z");
    expect(readBuildStamp(
      { GITHUB_SHA: "abcdef1234567890deadbeef", GITHUB_RUN_NUMBER: "42" },
      () => "should-not-be-used",
      () => t,
    )).toEqual({ sha: "abcdef1234567890deadbeef", time: "2026-11-10T06:11:20.000Z", run: "42" });
  });

  it("falls back to git rev-parse, then to dev, and trims env values", () => {
    expect(readBuildStamp({}, () => "  1111111222222233333333  \n")).toMatchObject({ sha: "1111111222222233333333", run: "" });
    expect(readBuildStamp({}, () => { throw new Error("not a repo"); })).toMatchObject({ sha: "dev", run: "" });
    expect(readBuildStamp({ GITHUB_SHA: "  ", GITHUB_RUN_NUMBER: " 7 " }, () => "abc")).toMatchObject({ sha: "abc", run: "7" });
    expect(readBuildStamp({})).toMatchObject({ sha: "dev", run: "" });
  });

  it("shortens a SHA to 7 characters and formats the time in the viewer's zone", () => {
    expect(shortSha("abcdef1234567890")).toBe("abcdef1");
    expect(shortSha("dev")).toBe("dev");
    expect(shortSha("")).toBe("dev");
    const info = resolveBuildInfo({ sha: "abcdef1234567890", time: "2026-11-10T06:11:20Z", run: "99" });
    expect(info).toEqual({ sha: "abcdef1234567890", shortSha: "abcdef1", time: "2026-11-10T06:11:20Z", run: "99" });
    expect(formatBuildTime("2026-11-10T06:11:20Z", { locale: "en-US", timeZone: "America/Los_Angeles" })).toBe("Nov 9, 2026, 10:11 PM");
    expect(formatBuildTime("")).toBe("");
    expect(formatBuildTime("not-a-date")).toBe("");
  });

  it("exposes the injected build info used by the picker menu", () => {
    expect(BUILD_INFO.shortSha).toMatch(/^(dev|[0-9a-f]{7})$/i);
    expect(BUILD_INFO.sha === "dev" || BUILD_INFO.sha.startsWith(BUILD_INFO.shortSha)).toBe(true);
    if (BUILD_INFO.time) expect(formatBuildTime(BUILD_INFO.time).length).toBeGreaterThan(0);
  });
});
