/**
 * Global error handler middleware.
 *
 * - Catches unhandled errors from downstream handlers.
 * - Zod validation errors → 400 with structured issue list.
 * - Everything else → 500 with req_id for traceability.
 */

import type { MiddlewareHandler } from "hono";
import { ZodError } from "zod";
import { getLogger, getReqId } from "./logger.js";

export const errorHandler: MiddlewareHandler = async (c, next) => {
  try {
    await next();
  } catch (err) {
    const logger = getLogger(c);
    const reqId = getReqId(c);

    if (err instanceof ZodError) {
      logger.warn({ req_id: reqId, issues: err.format() }, "validation error");
      const isProduction = process.env["NODE_ENV"] === "production";
      return c.json(
        {
          error: "validation",
          issues: isProduction
            ? err.errors.map((e) => ({ path: e.path.join("."), code: e.code }))
            : err.format(),
        },
        400
      );
    }

    const userId = ((c.get as (k: string) => unknown)("user") as { userId?: string } | undefined)?.userId;
    const txSig = ((c.get as (k: string) => unknown)("tx_signature") as string | undefined);

    logger.error(
      { req_id: reqId, user_id: userId, tx_signature: txSig, err },
      "unhandled error"
    );

    return c.json({ error: "internal", req_id: reqId }, 500);
  }
};
