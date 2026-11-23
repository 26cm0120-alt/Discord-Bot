import assert from "node:assert/strict";
import test from "node:test";
import { VoicevoxClient } from "../src/voicevox.js";

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
