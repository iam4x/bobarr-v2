import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ReleaseTermFields } from "./ReleaseTermFields";

describe("release term settings", () => {
  test("explains required, preferred, and rejected release behavior", () => {
    const markup = renderToStaticMarkup(
      <ReleaseTermFields
        required={{ input: { name: "requiredTerms" } }}
        preferred={{ input: { name: "preferredTerms" } }}
        rejected={{ input: { name: "rejectedTerms" } }}
      />,
    );

    expect(markup).toContain("Required terms");
    expect(markup).toContain('name="requiredTerms"');
    expect(markup).toContain("must be present or the release is excluded");
    expect(markup).toContain("Preferred terms");
    expect(markup).toContain("Rejected terms");
  });
});
