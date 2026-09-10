import { describe, expect, it } from "bun:test";

const css = await Bun.file(new URL("./styles.css", import.meta.url)).text();

describe("control spacing tokens", () => {
  it("defines a shared control height and cluster gap", () => {
    expect(css).toContain("--control-height: 44px");
    expect(css).toContain("--control-height-lg: 50px");
    expect(css).toContain("--control-gap: 8px");
  });

  it("keeps button min-heights on the shared tokens", () => {
    const heights: string[] = [];
    for (const match of css.matchAll(
      /\.button[^{]*\{[^}]*min-height:\s*([^;]+)/g,
    )) {
      const height = match[1];
      if (height === undefined) continue;
      heights.push(height.trim());
    }
    expect(heights.length).toBeGreaterThan(0);
    for (const height of heights) {
      expect(["var(--control-height)", "var(--control-height-lg)"]).toContain(
        height,
      );
    }
  });

  it("spaces invite actions instead of leaving them flush", () => {
    expect(css).toContain(".backup-actions");
    expect(css).toMatch(
      /\.backup-actions\s*\{[^}]*gap:\s*var\(--control-gap\)/,
    );
    expect(css).toMatch(
      /\.backup-actions \+ \.backup-list\s*\{[^}]*margin-top:\s*12px/,
    );
  });

  it("vertically centers the discover search icon", () => {
    expect(css).toMatch(
      /\.discover-search-jump\s*\{[^}]*align-items:\s*center/,
    );
    expect(css).toMatch(
      /\.discover-search-jump > svg\s*\{[^}]*flex:\s*0 0 auto/,
    );
  });

  it("keeps calendar release cards compact", () => {
    expect(css).toMatch(
      /\.calendar-item\s*\{[^}]*grid-template-columns:\s*36px 1fr auto/,
    );
    expect(css).toMatch(/\.calendar-item__poster\s*\{[^}]*height:\s*50px/);
  });

  it("does not keep an unstyled account username in the rail footer", () => {
    expect(css).not.toContain("nav-rail__username");
    expect(css).not.toContain("nav-rail__account");
  });
});
