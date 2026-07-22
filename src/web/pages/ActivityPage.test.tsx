import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  DownloadRemovalTitle,
  DownloadFilterBar,
  formatJobKind,
  JobFilterBar,
  JobPagination,
  ManualJobControls,
} from "./ActivityPage";

describe("activity jobs browser", () => {
  test("defaults the download filter UI to active downloads", () => {
    const markup = renderToStaticMarkup(
      <DownloadFilterBar value="active" onChange={() => {}} />,
    );

    expect(markup).toContain("Download status");
    expect(markup).toContain(
      '<option value="active" selected="">Active</option>',
    );
    expect(markup).toContain('<option value="completed">Completed</option>');
  });

  test("renders an accessible exact-type filter with known durable jobs", () => {
    const markup = renderToStaticMarkup(
      <JobFilterBar kind="library.scan.v1" busy={false} onChange={() => {}} />,
    );

    expect(markup).toContain("Job type");
    expect(markup).toContain('value="library.scan.v1" selected=""');
    expect(markup).toContain("Library scan");
    expect(markup).toContain("Organize download");
  });

  test("shows stable result bounds and disables unavailable page controls", () => {
    const markup = renderToStaticMarkup(
      <JobPagination
        page={{ limit: 20, offset: 0, total: 43 }}
        busy={false}
        onPrevious={() => {}}
        onNext={() => {}}
      />,
    );
    const buttons = markup.match(/<button[^>]*>.*?<\/button>/g) ?? [];
    const previous = buttons.find((button) => button.includes("Previous"));
    const next = buttons.find((button) => button.includes("Next"));

    expect(markup).toContain("1–20 of 43");
    expect(previous).toContain("disabled");
    expect(next).not.toContain("disabled");
  });

  test("offers safe maintenance jobs for manual execution", () => {
    const markup = renderToStaticMarkup(
      <ManualJobControls
        kind="library.scan.v1"
        busy={false}
        onChange={() => {}}
        onRun={() => {}}
      />,
    );

    expect(markup).toContain("Run maintenance now");
    expect(markup).toContain('value="library.scan.v1" selected=""');
    expect(markup).toContain("Library scan");
    expect(markup).toContain("Refresh metadata");
    expect(markup).not.toContain("Media acquisition");
  });

  test("formats unknown job kinds for readable activity cards", () => {
    expect(formatJobKind("custom.refresh_posters-v2")).toBe(
      "custom refresh posters v2",
    );
  });

  test("marks long removal titles for safe visual truncation", () => {
    const title = `${"Very.Long.Torrent.Title.".repeat(12)}mkv`;
    const markup = renderToStaticMarkup(<DownloadRemovalTitle title={title} />);

    expect(markup).toContain('class="download-remove-title"');
    expect(markup).toContain(`title="${title}"`);
    expect(markup).toContain(title);
  });
});
