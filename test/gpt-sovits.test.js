import assert from "node:assert/strict";
import test from "node:test";
import { GptSovitsClient } from "../src/gpt-sovits.js";

test("omits the GPT-SoVITS HTTP error response body", async (t) => {
  const marker = "private-response-body-marker";
  t.mock.method(globalThis, "fetch", async () => new Response(marker, { status: 503 }));
  const client = new GptSovitsClient({
    baseUrl: "http://gpt-sovits.test",
    referenceAudioPath: "/reference.wav",
    referenceText: "参照音声",
  });

  await assert.rejects(client.synthesize("読み上げテスト"), (error) => {
    assert.doesNotMatch(error.message, new RegExp(marker));
    assert.equal(error.message, "GPT-SoVITS /tts returned HTTP 503");
    return true;
  });
});
