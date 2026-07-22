import { describe, expect, it } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { EmptyState, ProgressBar, SelectControl } from "./ui";

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

  it("renders selects with one shared non-interactive chevron", () => {
    const markup = renderToStaticMarkup(
      <SelectControl aria-label="Download status" defaultValue="active">
        <option value="active">Active</option>
      </SelectControl>,
    );

    expect(markup).toContain('class="select-control"');
    expect(markup).toContain('aria-label="Download status"');
    expect(markup).toContain(
      'class="lucide lucide-chevron-down select-control__icon"',
    );
    expect(markup).toContain('aria-hidden="true"');
  });
});
