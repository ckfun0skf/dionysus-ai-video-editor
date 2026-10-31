import { describe, it, expect } from "vitest";
import { readFileWithProgress } from "./media";

describe("P19 readFileWithProgress", () => {
  it("reports monotonic progress ending at 1 and keeps name/type", async () => {
    const f = new File([new Uint8Array(300_000)], "a.mov", { type: "video/quicktime" });
    const seen: number[] = [];
    const out = await readFileWithProgress(f, (x) => seen.push(x));
    expect(seen.at(-1)).toBe(1);
    expect(seen.every((x, i) => i === 0 || x >= seen[i - 1])).toBe(true);
    expect(out.name).toBe("a.mov"); expect(out.type).toBe("video/quicktime"); expect(out.size).toBe(300_000);
  });
});
