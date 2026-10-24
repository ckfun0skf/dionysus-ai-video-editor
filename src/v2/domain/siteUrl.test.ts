/** V2-OPS-LINKS: AI links are built from the deployment, never from a hard-coded host. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { aiLinks, buildSiteUrl, DEFAULT_SITE_URL, isPrivateHost, normalizeSiteUrl, runtimeSiteUrl } from "./siteUrl";

const loc = (href: string) => ({ href, hostname: new URL(href).hostname });

describe("site URL (V2-OPS-LINKS)", () => {
  it("runtime links follow the page's origin and the Vite base", () => {
    expect(runtimeSiteUrl(loc("https://video.example.com/editor/?v2"), "/editor/")).toBe("https://video.example.com/editor/");
    expect(runtimeSiteUrl(loc("https://video.example.com/?v2"), "/")).toBe("https://video.example.com/");
    expect(runtimeSiteUrl(loc("https://cdn.example.org/a/b/index.html?v2#x"), "./")).toBe("https://cdn.example.org/a/b/");
    expect(runtimeSiteUrl(loc("http://example.net:8080/x/"), "/x/")).toBe("http://example.net:8080/x/");
    const l = aiLinks(runtimeSiteUrl(loc("https://video.example.com/editor/?v2"), "/editor/"));
    expect(l).toEqual({
      site: "https://video.example.com/editor/",
      app: "https://video.example.com/editor/?v2",
      guide: "https://video.example.com/editor/ai/storyboard-guide.md",
      guideHtml: "https://video.example.com/editor/ai/storyboard-guide.html",
      presets: "https://video.example.com/editor/ai/presets.json",
      formatDoc: "https://video.example.com/editor/ai/STORYBOARD_FORMAT.md",
      llms: "https://video.example.com/editor/llms.txt",
    });
  });

  it("falls back to the configured site where an outside AI can't open links", () => {
    const fb = "https://public.example.com/app/";
    for (const h of ["http://localhost:3000/?v2", "http://127.0.0.1:3000/", "http://192.168.1.20:3000/", "http://10.0.0.5/", "http://172.20.0.2/", "http://mybox.local/", "http://[::1]:3000/"]) {
      expect(runtimeSiteUrl(loc(h), "/x/", fb), h).toBe(fb);
    }
    expect(runtimeSiteUrl(undefined, "/", fb)).toBe(fb);
    expect(runtimeSiteUrl(loc("file:///tmp/index.html"), "./", fb)).toBe(fb);
    expect(isPrivateHost("172.32.0.1")).toBe(false);
    expect(isPrivateHost("video.example.com")).toBe(false);
  });

  it("build site URL: env var, default fallback, explicit --base overrides the path", () => {
    expect(buildSiteUrl(undefined)).toBe(DEFAULT_SITE_URL);
    expect(buildSiteUrl("  ")).toBe(DEFAULT_SITE_URL);
    expect(buildSiteUrl("https://video.example.com/editor")).toBe("https://video.example.com/editor/");
    expect(buildSiteUrl("https://video.example.com")).toBe("https://video.example.com/");
    expect(buildSiteUrl(undefined, "/dionysus-ai-video-editor/pr-35/")).toBe("https://ckfun0skf.github.io/dionysus-ai-video-editor/pr-35/");
    expect(buildSiteUrl("https://video.example.com/editor/", "./")).toBe("https://video.example.com/editor/");
    expect(normalizeSiteUrl("https://x.example/a?q=1#h")).toBe("https://x.example/a/");
    expect(() => normalizeSiteUrl("/relative/")).toThrow();
    expect(() => normalizeSiteUrl("ftp://x.example/")).toThrow();
  });

  it("no source file hard-codes the GitHub Pages host except the documented default in siteUrl.ts", () => {
    const src = resolve(__dirname, "../..");
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
    const hits = walk(src)
      .filter((f) => /\.(tsx?|css|html)$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => /github\.io|ckfun0skf/.test(readFileSync(f, "utf8")))
      .map((f) => relative(src, f));
    expect(hits).toEqual(["v2/domain/siteUrl.ts"]);
    expect(readFileSync(join(src, "v2/domain/siteUrl.ts"), "utf8").match(/github\.io/g)).toHaveLength(1);
  });
});
