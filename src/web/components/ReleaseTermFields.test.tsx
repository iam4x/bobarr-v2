import { describe, expect, test } from "bun:test";

import { ReleaseTermFields } from "./ReleaseTermFields";
import { renderWithUi } from "../i18n/test-utils";

describe("release term settings", () => {
  test("explains required, preferred, and rejected release behavior", () => {
    const markup = renderWithUi(
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
