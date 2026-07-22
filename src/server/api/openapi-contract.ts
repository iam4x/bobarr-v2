const MUTATION_METHODS = new Set(["post", "put", "patch", "delete"]);
const PUBLIC_MUTATIONS = new Set([
  "post /api/v1/setup",
  "post /api/v1/auth/login",
]);

type OpenApiRecord = Record<string, unknown>;

/**
 * Finalize the generated contract with security semantics that mirror the API
 * middleware. Keeping this rule at the document boundary means newly documented
 * authenticated mutations cannot accidentally advertise cookie-only access.
 */
export function finalizeOpenApiDocument<T>(
  document: T,
  sessionCookieName: string,
): T {
  if (!isRecord(document)) return document;

  const components = recordProperty(document, "components");
  const securitySchemes = recordProperty(components, "securitySchemes");
  securitySchemes["sessionCookie"] = {
    type: "apiKey",
    in: "cookie",
    name: sessionCookieName,
  };
  securitySchemes["csrfToken"] = {
    type: "apiKey",
    in: "header",
    name: "x-csrf-token",
    description:
      "CSRF token returned with the authenticated session; required together with the session cookie for mutations.",
  };

  const paths = recordProperty(document, "paths");
  for (const [path, pathItem] of Object.entries(paths)) {
    if (!isRecord(pathItem)) continue;
    for (const method of MUTATION_METHODS) {
      const operation = pathItem[method];
      if (
        !isRecord(operation) ||
        !isAuthenticatedMutationOperation(method, path)
      ) {
        continue;
      }
      operation["security"] = [{ sessionCookie: [], csrfToken: [] }];
    }
  }

  return document;
}

export function isAuthenticatedMutationOperation(
  method: string,
  path: string,
): boolean {
  const normalizedMethod = method.toLowerCase();
  return (
    path.startsWith("/api/v1/") &&
    MUTATION_METHODS.has(normalizedMethod) &&
    !PUBLIC_MUTATIONS.has(`${normalizedMethod} ${path}`)
  );
}

function recordProperty(
  record: OpenApiRecord,
  property: string,
): OpenApiRecord {
  const value = record[property];
  if (isRecord(value)) return value;
  const created: OpenApiRecord = {};
  record[property] = created;
  return created;
}

function isRecord(value: unknown): value is OpenApiRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
