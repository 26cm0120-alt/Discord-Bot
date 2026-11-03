import assert from "node:assert/strict";
import test from "node:test";
import { GptSovitsClient } from "../src/gpt-sovits.js";
import { splitTextByLanguage } from "../src/language-segments.js";

test("auto keeps Japanese only and Korean only text in one matching segment", () => {
  assert.deepEqual(splitTextByLanguage("こんにちは。"), [{ text: "こんにちは。", textLanguage: "ja" }]);
  assert.deepEqual(splitTextByLanguage("안녕하세요."), [{ text: "안녕하세요.", textLanguage: "ko" }]);
});

test("auto splits Japanese first, Korean second, preserving exact text order", () => {
  const text = "今日は청소をします。";
  const segments = splitTextByLanguage(text);
  assert.deepEqual(segments, [
    { text: "今日は", textLanguage: "ja" },
    { text: "청소", textLanguage: "ko" },
    { text: "をします。", textLanguage: "ja" },
  ]);
  assert.equal(segments.map(({ text: part }) => part).join(""), text);
});

test("auto splits Korean first, Japanese second, preserving exact text order", () => {
  const text = "안녕해요日本語です。";
  const segments = splitTextByLanguage(text);
  assert.deepEqual(segments, [
    { text: "안녕해요", textLanguage: "ko" },
    { text: "日本語です。", textLanguage: "ja" },
  ]);
  assert.equal(segments.map(({ text: part }) => part).join(""), text);
});

test("explicit language selection does not split mixed text", () => {
  assert.deepEqual(splitTextByLanguage("今日は청소をします。", "ja"), [
    { text: "今日は청소をします。", textLanguage: "ja" },
  ]);
});

test("each split language selects the matching GPT-SoVITS prompt and reference", async () => {
  const client = new GptSovitsClient({
    baseUrl: "http://127.0.0.1:9880",
    promptLanguage: "ja",
    referenceAudioPathJa: "ja.wav",
    referenceTextJa: "日本語の参照文です。",
    referenceAudioPathKo: "ko.wav",
    referenceTextKo: "한국어 참조 문장입니다.",
  });
  const originalFetch = globalThis.fetch;
  const payloads = [];
  globalThis.fetch = async (_url, options) => {
    payloads.push(JSON.parse(options.body));
    return new Response(Buffer.from("audio"), { status: 200 });
  };
  try {
    const segments = splitTextByLanguage("今日は청소をします。");
    for (const segment of segments) await client.synthesize(segment.text, segment.textLanguage);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(payloads.map(({ text_lang, prompt_lang, ref_audio_path }) => ({ text_lang, prompt_lang, ref_audio_path })), [
    { text_lang: "ja", prompt_lang: "ja", ref_audio_path: "ja.wav" },
    { text_lang: "ko", prompt_lang: "ko", ref_audio_path: "ko.wav" },
    { text_lang: "ja", prompt_lang: "ja", ref_audio_path: "ja.wav" },
  ]);
});
