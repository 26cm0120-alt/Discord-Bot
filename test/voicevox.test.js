import assert from "node:assert/strict";
import test from "node:test";
import { VoicevoxClient } from "../src/voicevox.js";
import { logVoicevoxConnectionCheck } from "../src/voicevox-startup.js";
import { formatErrorForLog } from "../src/error-format.js";

function waitForAbort(_url, { signal }) {
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

test("applies a timeout to the speaker list request", async () => {
  const client = new VoicevoxClient("http://voicevox.test", 1, { timeoutMs: 5, fetchImpl: waitForAbort });

  await assert.rejects(client.getSpeakers(), { name: "TimeoutError" });
});

test("applies a timeout to audio_query", async () => {
  const client = new VoicevoxClient("http://voicevox.test", 1, { timeoutMs: 5, fetchImpl: waitForAbort });

  await assert.rejects(client.synthesize("hello"), { name: "TimeoutError" });
});

test("applies a separate timeout to synthesis", async () => {
  let requestCount = 0;
  const client = new VoicevoxClient("http://voicevox.test", 1, {
    timeoutMs: 5,
    fetchImpl: async (_url, options) => {
      requestCount += 1;
      if (requestCount === 1) {
        return { ok: true, json: async () => ({ speedScale: 1 }) };
      }
      return waitForAbort(_url, options);
    },
  });

  await assert.rejects(client.synthesize("hello"), { name: "TimeoutError" });
  assert.equal(requestCount, 2);
});

test("falls back to the default timeout for invalid configuration", async () => {
  const client = new VoicevoxClient("http://voicevox.test", 1, { timeoutMs: Number.NaN });

  assert.equal(client.timeoutMs, 30000);
});

test("checks the VOICEVOX version endpoint", async () => {
  let requestedUrl;
  const client = new VoicevoxClient("http://voicevox.test/", 1, {
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return { ok: true };
    },
  });

  assert.equal(await client.checkConnection(), true);
  assert.equal(requestedUrl, "http://voicevox.test/version");
});

test("reports HTTP errors from the VOICEVOX version endpoint", async () => {
  const client = new VoicevoxClient("http://voicevox.test", 1, {
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });

  await assert.rejects(client.checkConnection(), { message: "VOICEVOX version returned HTTP 503" });
});

test("preserves fetch cause details for startup connection errors", async () => {
  const cause = Object.assign(new Error("connect ECONNREFUSED voicevox:50021"), { code: "ECONNREFUSED" });
  const client = new VoicevoxClient("http://voicevox.test", 1, {
    fetchImpl: async () => { throw new TypeError("fetch failed", { cause }); },
  });

  await assert.rejects(client.checkConnection(), (error) => {
    assert.equal(
      formatErrorForLog(error),
      "fetch failed | cause 1: connect ECONNREFUSED voicevox:50021 code=ECONNREFUSED",
    );
    return true;
  });
});

test("connection check timeout remains bounded by five seconds", async () => {
  const client = new VoicevoxClient("http://voicevox.test", 1, {
    timeoutMs: 30_000,
    fetchImpl: waitForAbort,
  });

  await assert.rejects(client.checkConnection(), { name: "TimeoutError" });
});

test("logs a successful connection check", async () => {
  const entries = [];
  const logger = {
    info: (message) => entries.push(["info", message]),
    error: (...args) => entries.push(["error", ...args]),
  };

  assert.equal(await logVoicevoxConnectionCheck({ checkConnection: async () => true }, logger), true);
  assert.deepEqual(entries, [["info", "VOICEVOX接続確認: 成功"]]);
});

test("logs a connection error without propagating it to startup", async () => {
  const cause = Object.assign(new Error("getaddrinfo ENOTFOUND voicevox"), { code: "ENOTFOUND" });
  const client = { checkConnection: async () => { throw new TypeError("fetch failed", { cause }); } };
  const entries = [];
  const logger = {
    info: (message) => entries.push(["info", message]),
    error: (...args) => entries.push(["error", ...args]),
  };

  assert.equal(await logVoicevoxConnectionCheck(client, logger), false);
  assert.deepEqual(entries, [[
    "error",
    "VOICEVOX接続確認エラー:",
    "fetch failed | cause 1: getaddrinfo ENOTFOUND voicevox code=ENOTFOUND",
  ]]);
});
