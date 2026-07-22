import { describe, expect, it } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { EmptyState, ProgressBar } from "./ui";

describe("accessible UI primitives", () => {
  it("renders progress with a bounded accessible value", () => {
    const markup = renderToStaticMarkup(
      <ProgressBar value={140} label="Movie download" />,
    );
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-label="Movie download"');
    expect(markup).toContain('aria-valuenow="100"');
    expect(markup).toContain("width:100%");
  });

  it("renders meaningful empty-state copy", () => {
    const markup = renderToStaticMarkup(
      <EmptyState title="No movies" description="Find a title to begin." />,
    );
    expect(markup).toContain("No movies");
    expect(markup).toContain("Find a title to begin.");
  });
});
