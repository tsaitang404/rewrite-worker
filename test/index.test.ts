import { describe, it, expect } from "vitest";
import { parseRules, matchRule, applyRewrite, rewriteUrl } from "../src/index";
import type { RewriteRule } from "../src/index";

// ---------------------------------------------------------------------------
// parseRules
// ---------------------------------------------------------------------------
describe("parseRules", () => {
  it("parses a valid JSON array of rules", () => {
    const raw = JSON.stringify([
      { match: { hostname: "example.com" }, rewrite: { hostname: "backend.internal" } },
    ]);
    const rules = parseRules(raw);
    expect(rules).toHaveLength(1);
    expect(rules[0].match.hostname).toBe("example.com");
  });

  it("returns empty array for invalid JSON", () => {
    expect(parseRules("not-json")).toEqual([]);
  });

  it("returns empty array when JSON is not an array", () => {
    expect(parseRules('{"foo":"bar"}')).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseRules("")).toEqual([]);
  });

  it("returns empty array for empty JSON array", () => {
    expect(parseRules("[]")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// matchRule
// ---------------------------------------------------------------------------
describe("matchRule", () => {
  it("matches when no conditions are specified (catch-all)", () => {
    const rule: RewriteRule = { match: {}, rewrite: { hostname: "backend.internal" } };
    expect(matchRule(new URL("https://example.com/any/path"), rule)).toBe("");
  });

  it("matches exact hostname", () => {
    const rule: RewriteRule = {
      match: { hostname: "example.com" },
      rewrite: { hostname: "backend.internal" },
    };
    expect(matchRule(new URL("https://example.com/path"), rule)).toBe("");
    expect(matchRule(new URL("https://other.com/path"), rule)).toBeNull();
  });

  it("matches path with wildcard and captures the wildcard part", () => {
    const rule: RewriteRule = {
      match: { path: "/api/*" },
      rewrite: { path: "/v2/*" },
    };
    expect(matchRule(new URL("https://example.com/api/users"), rule)).toBe("users");
    expect(matchRule(new URL("https://example.com/api/a/b/c"), rule)).toBe("a/b/c");
    expect(matchRule(new URL("https://example.com/other"), rule)).toBeNull();
  });

  it("matches exact path (no wildcard)", () => {
    const rule: RewriteRule = { match: { path: "/health" }, rewrite: { hostname: "backend" } };
    expect(matchRule(new URL("https://example.com/health"), rule)).toBe("");
    expect(matchRule(new URL("https://example.com/health/check"), rule)).toBeNull();
  });

  it("matches both hostname and path", () => {
    const rule: RewriteRule = {
      match: { hostname: "example.com", path: "/api/*" },
      rewrite: { hostname: "backend.internal" },
    };
    expect(matchRule(new URL("https://example.com/api/users"), rule)).toBe("users");
    expect(matchRule(new URL("https://other.com/api/users"), rule)).toBeNull();
    expect(matchRule(new URL("https://example.com/other"), rule)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// applyRewrite
// ---------------------------------------------------------------------------
describe("applyRewrite", () => {
  it("rewrites hostname only", () => {
    const url = new URL("https://example.com/path");
    const result = applyRewrite(url, { hostname: "backend.internal" }, "");
    expect(result.hostname).toBe("backend.internal");
    expect(result.pathname).toBe("/path");
  });

  it("rewrites hostname and port", () => {
    const url = new URL("https://example.com/path");
    const result = applyRewrite(url, { hostname: "backend.internal", port: 8080 }, "");
    expect(result.hostname).toBe("backend.internal");
    expect(result.port).toBe("8080");
  });

  it("clears port when only hostname changes", () => {
    const url = new URL("https://example.com:9000/path");
    const result = applyRewrite(url, { hostname: "backend.internal" }, "");
    expect(result.port).toBe("");
  });

  it("rewrites path using wildcard substitution", () => {
    const url = new URL("https://example.com/api/users");
    const result = applyRewrite(url, { path: "/v2/*" }, "users");
    expect(result.pathname).toBe("/v2/users");
  });

  it("rewrites path with multi-segment wildcard capture", () => {
    const url = new URL("https://example.com/api/a/b/c");
    const result = applyRewrite(url, { path: "/v2/*" }, "a/b/c");
    expect(result.pathname).toBe("/v2/a/b/c");
  });

  it("rewrites exact path (no wildcard)", () => {
    const url = new URL("https://example.com/old");
    const result = applyRewrite(url, { path: "/new" }, "");
    expect(result.pathname).toBe("/new");
  });

  it("preserves query string", () => {
    const url = new URL("https://example.com/api/users?foo=bar");
    const result = applyRewrite(url, { hostname: "backend.internal", path: "/v2/*" }, "users");
    expect(result.search).toBe("?foo=bar");
    expect(result.pathname).toBe("/v2/users");
  });
});

// ---------------------------------------------------------------------------
// rewriteUrl (integration)
// ---------------------------------------------------------------------------
describe("rewriteUrl", () => {
  it("returns null when no rules are defined", () => {
    expect(rewriteUrl(new URL("https://example.com/path"), [])).toBeNull();
  });

  it("returns null when no rule matches", () => {
    const rules: RewriteRule[] = [
      { match: { hostname: "other.com" }, rewrite: { hostname: "backend.internal" } },
    ];
    expect(rewriteUrl(new URL("https://example.com/path"), rules)).toBeNull();
  });

  it("returns the rewritten URL for the first matching rule", () => {
    const rules: RewriteRule[] = [
      {
        match: { hostname: "example.com", path: "/api/*" },
        rewrite: { hostname: "api.backend.internal", path: "/v2/*" },
      },
    ];
    const result = rewriteUrl(new URL("https://example.com/api/users"), rules);
    expect(result).not.toBeNull();
    expect(result!.hostname).toBe("api.backend.internal");
    expect(result!.pathname).toBe("/v2/users");
  });

  it("uses the first matching rule (priority order)", () => {
    const rules: RewriteRule[] = [
      { match: { path: "/api/*" }, rewrite: { hostname: "first.backend" } },
      { match: { path: "/api/*" }, rewrite: { hostname: "second.backend" } },
    ];
    const result = rewriteUrl(new URL("https://example.com/api/foo"), rules);
    expect(result!.hostname).toBe("first.backend");
  });

  it("falls through to the next rule when first does not match", () => {
    const rules: RewriteRule[] = [
      { match: { hostname: "other.com" }, rewrite: { hostname: "first.backend" } },
      { match: { hostname: "example.com" }, rewrite: { hostname: "second.backend" } },
    ];
    const result = rewriteUrl(new URL("https://example.com/path"), rules);
    expect(result!.hostname).toBe("second.backend");
  });
});
