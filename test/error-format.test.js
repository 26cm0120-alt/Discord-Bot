import assert from "node:assert/strict";
import test from "node:test";
import { formatErrorForLog } from "../src/error-format.js";

test("formats nested error causes with their codes", () => {
  const cause = Object.assign(new Error("getaddrinfo ENOTFOUND voicevox"), { code: "ENOTFOUND" });
  const error = new TypeError("fetch failed", { cause });

  assert.equal(
    formatErrorForLog(error),
    "fetch failed | cause 1: getaddrinfo ENOTFOUND voicevox code=ENOTFOUND",
  );
});

test("redacts URLs and their query strings from every cause", () => {
  const cause = new Error("request to https://voicevox.local/audio_query?text=private failed");
  const error = new Error("fetch failed: https://voicevox.local/synthesis?text=private", { cause });
  const formatted = formatErrorForLog(error);

  assert.equal(formatted, "fetch failed: [URL省略] | cause 1: request to [URL省略] failed");
  assert.equal(formatted.includes("private"), false);
  assert.equal(formatted.includes("https://"), false);
});

test("keeps errors without causes unchanged", () => {
  assert.equal(formatErrorForLog(new Error("VOICEVOX synthesis returned HTTP 500")), "VOICEVOX synthesis returned HTTP 500");
});

test("stops at circular cause references", () => {
  const error = new Error("outer");
  error.cause = error;

  assert.equal(formatErrorForLog(error), "outer");
});
