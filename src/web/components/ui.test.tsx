import { describe, expect, it } from "bun:test";

import { Dialog, EmptyState, ProgressBar, SelectControl } from "./ui";
import { renderWithUi } from "../i18n/test-utils";

describe("accessible UI primitives", () => {
  it("renders progress with a bounded accessible value", () => {
    const markup = renderWithUi(
      <ProgressBar value={140} label="Movie download" />,
    );
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-label="Movie download"');
    expect(markup).toContain('aria-valuenow="100"');
    expect(markup).toContain("width:100%");
  });

  it("renders meaningful empty-state copy", () => {
    const markup = renderWithUi(
      <EmptyState title="No movies" description="Find a title to begin." />,
    );
    expect(markup).toContain("No movies");
    expect(markup).toContain("Find a title to begin.");
  });

  it("renders selects with one shared non-interactive chevron", () => {
    const markup = renderWithUi(
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

  it("keeps the Dialog API and adds a compact, non-interactive drag handle", () => {
    const markup = renderWithUi(
      <Dialog open title="Native sheet" onClose={() => {}}>
        Content
      </Dialog>,
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('data-availability="compact"');
    expect(markup).toContain('data-sheet-drag-handle="true"');
    expect(markup).toContain('aria-hidden="true"');
  });
});
