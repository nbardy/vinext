/**
 * Default Cloudflare Worker entry point for vinext App Router.
 *
 * Use this directly in wrangler.jsonc:
 *   "main": "vinext/server/app-router-entry"
 *
 * Or import and delegate to it from a custom worker:
 *   import handler from "vinext/server/app-router-entry";
 *   return handler.fetch(request);
 *
 * This file runs in the RSC environment. Configure the Cloudflare plugin with:
 *   cloudflare({ viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] } })
 */

// @ts-expect-error — virtual module resolved by vinext
import rscHandler from "virtual:vinext-rsc-entry";
import { normalizePath } from "./normalize-path.js";

interface ExecutionContext {
  waitUntil(promise: Promise<any>): void;
  passThroughOnException(): void;
}

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Normalize backslashes (browsers treat /\ as //) then decode and normalize path.
    const rawPathname = url.pathname.replaceAll("\\", "/");

    // Block protocol-relative URL open redirects (//evil.com/ or /\evil.com/).
    if (rawPathname.startsWith("//")) {
      return new Response("404 Not Found", { status: 404 });
    }

    // Decode percent-encoding and normalize the path for middleware/route matching.
    let normalizedPathname: string;
    try {
      normalizedPathname = normalizePath(decodeURIComponent(rawPathname));
    } catch {
      // Malformed percent-encoding (e.g. /%E0%A4%A) — return 400 instead of throwing.
      return new Response("Bad Request", { status: 400 });
    }

    // Construct a new Request with normalized pathname so the RSC entry
    // sees the canonical path for middleware and route matching.
    let normalizedRequest = request;
    if (normalizedPathname !== url.pathname) {
      const normalizedUrl = new URL(url);
      normalizedUrl.pathname = normalizedPathname;
      normalizedRequest = new Request(normalizedUrl, request);
    }

    // Delegate to RSC handler
    const result = await rscHandler(normalizedRequest);

    // If the middleware registered any waitUntil promises, hand them off to the runtime
    if (result && typeof result === "object" && "__vinextWaitUntil" in result && Array.isArray(result.__vinextWaitUntil)) {
      for (const p of result.__vinextWaitUntil) {
        ctx.waitUntil(p);
      }
    }

    if (result instanceof Response) {
      return result;
    }

    if (result === null || result === undefined) {
      return new Response("Not Found", { status: 404 });
    }

    return new Response(String(result), { status: 200 });
  },
};
