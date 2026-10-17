import { afterEach, describe, expect, it } from "vitest";
import { getLocale, setLocale, t } from "./i18n";

describe("UI localization catalog", () => {
  afterEach(() => setLocale("en"));

  it("defaults to English", () => {
    expect(getLocale()).toBe("en");
    expect(t("action.exportProject")).toBe("Export project");
  });

  it("interpolates dynamic values without leaving placeholders", () => {
    expect(t("project.runtimeSummary", { duration: "01:25" })).toBe("01:25 planned runtime");
    expect(t("notice.slotDetails", { name: "Opening", count: 2 })).toBe("Opening · 2 version(s)");
  });

  it("keeps status labels in the catalog", () => {
    expect(t("status.in-progress")).toBe("In progress");
  });
});
