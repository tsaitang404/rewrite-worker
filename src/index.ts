/**
 * Cloudflare Worker – Origin Rewrite
 *
 * Rewrites the origin host/path of incoming requests based on configurable
 * rules, equivalent to Cloudflare's Origin Rules feature.
 *
 * Configuration is supplied via the `REWRITE_RULES` environment variable as
 * a JSON array of `RewriteRule` objects (see wrangler.toml for format docs).
 */

export interface MatchCondition {
  /** Exact hostname to match (e.g. "example.com"). Omit to match any hostname. */
  hostname?: string;
  /**
   * Path glob to match. Supports a single "*" wildcard that matches any
   * sequence of characters within the path (e.g. "/api/*").
   * Omit to match any path.
   */
  path?: string;
}

export interface RewriteTarget {
  /** New origin hostname (e.g. "api.backend.internal"). */
  hostname?: string;
  /** New origin port. */
  port?: number;
  /**
   * New path. Use "*" to substitute the captured wildcard from the match
   * path (e.g. if match.path="/api/*" and rewrite.path="/v2/*", a request
   * to "/api/users" becomes "/v2/users").
   * Omit to keep the original path.
   */
  path?: string;
}

export interface RedirectTarget {
  /**
   * Redirect destination. Accepts an absolute URL ("https://example.com/Index")
   * or a path ("/Index"). Use "*" to substitute the wildcard capture from the
   * match path.
   */
  location: string;
  /** HTTP status code. Defaults to 302. */
  status?: 301 | 302 | 307 | 308;
}

export interface RewriteRule {
  match: MatchCondition;
  /**
   * Proxy the request to a different origin.
   * When both `redirect` and `rewrite` are set, `redirect` takes priority.
   */
  rewrite?: RewriteTarget;
  /** When present, returns an HTTP redirect instead of proxying. */
  redirect?: RedirectTarget;
}

export interface Env {
  /** JSON-encoded array of RewriteRule objects. */
  REWRITE_RULES: string;
}

/**
 * Parse the REWRITE_RULES environment variable.
 * Returns an empty array on parse errors so the worker degrades gracefully.
 */
export function parseRules(raw: string): RewriteRule[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as RewriteRule[];
  } catch {
    return [];
  }
}

/**
 * Convert a path glob string (with a single "*") into a RegExp.
 * Returns null when the glob contains no wildcard (exact match).
 */
function globToRegex(glob: string): { regex: RegExp; hasWildcard: boolean } {
  const hasWildcard = glob.includes("*");
  // Escape all regex special characters except "*", then replace "*" with a capture group
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "(.*)");
  return { regex: new RegExp(`^${escaped}$`), hasWildcard };
}

/**
 * Check whether a request matches a rule's match condition.
 * Returns the wildcard capture (if any) on a match, or null on no match.
 */
export function matchRule(url: URL, rule: RewriteRule): string | null {
  const { match } = rule;

  // Hostname check (optional)
  if (match.hostname !== undefined && url.hostname !== match.hostname) {
    return null;
  }

  // Path check (optional)
  if (match.path !== undefined) {
    const { regex, hasWildcard } = globToRegex(match.path);
    const result = regex.exec(url.pathname);
    if (!result) return null;
    return hasWildcard ? (result[1] ?? "") : "";
  }

  return "";
}

/**
 * Apply a rewrite target to a URL, returning the modified origin URL.
 *
 * @param original  The original request URL.
 * @param rewrite   The rewrite target from the matching rule.
 * @param captured  The wildcard capture string from matchRule().
 */
export function applyRewrite(original: URL, rewrite: RewriteTarget, captured: string): URL {
  const result = new URL(original.toString());

  if (rewrite.hostname !== undefined) {
    result.hostname = rewrite.hostname;
  }

  if (rewrite.port !== undefined) {
    result.port = String(rewrite.port);
  } else if (rewrite.hostname !== undefined) {
    // Clear an explicit port when only the hostname changes so we use the
    // default port for the protocol.
    result.port = "";
  }

  if (rewrite.path !== undefined) {
    result.pathname = rewrite.path.replaceAll("*", captured);
  }

  return result;
}

/**
 * Find the first matching rule and return the rewritten URL,
 * or null if no rule matches.
 */
export function rewriteUrl(url: URL, rules: RewriteRule[]): URL | null {
  for (const rule of rules) {
    if (!rule.rewrite) continue; // skip redirect-only rules
    const captured = matchRule(url, rule);
    if (captured !== null) {
      return applyRewrite(url, rule.rewrite, captured);
    }
  }
  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const rules = parseRules(env.REWRITE_RULES);
    const url = new URL(request.url);

    for (const rule of rules) {
      const captured = matchRule(url, rule);
      if (captured === null) continue;

      if (rule.redirect) {
        const rawLocation = rule.redirect.location.replaceAll("*", captured);
        // Resolve path-only locations against the current origin.
        const target = rawLocation.startsWith("/")
          ? `${url.protocol}//${url.host}${rawLocation}`
          : rawLocation;
        return Response.redirect(target, rule.redirect.status ?? 302);
      }

      if (rule.rewrite) {
        const rewritten = applyRewrite(url, rule.rewrite, captured);
        const newRequest = new Request(rewritten.toString(), {
          method: request.method,
          headers: request.headers,
          body: request.body,
          redirect: "follow",
        });
        return fetch(newRequest);
      }
    }

    // No rule matched – proxy the request as-is to the original origin.
    return fetch(request);
  },
} satisfies ExportedHandler<Env>;
