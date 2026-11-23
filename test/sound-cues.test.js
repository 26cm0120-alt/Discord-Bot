import assert from "node:assert/strict";
import test from "node:test";
import { buildSpeechSegments } from "../src/sound-cues.js";

const clips = {
  phrase: [],
  clean: Buffer.from("clean"),
  dislike: Buffer.from("dislike"),
  hide: Buffer.from("hide"),
  pumpkin: Buffer.from("pumpkin"),
  like: Buffer.from("like"),
  stop: Buffer.from("stop"),
};

function segments(text) {
  return buildSpeechSegments(text, {
    voiceClips: clips,
    maxMessageChars: 240,
    replaceLinks: (input) => input,
  });
}

for (const [text, description] of [
  ["ダメージを受けた", "damage"],
  ["ご機嫌だね", "good mood"],
  ["掃除機を使う", "vacuum cleaner"],
]) {
  test(`does not replace a cue embedded in the ${description} word`, () => {
    assert.deepEqual(segments(text), [{ type: "text", text }]);
  });
}

test("preserves the existing read-aloud behavior for a standalone Japanese cue", () => {
  assert.deepEqual(segments("ダメ"), [{ type: "text", text: "ダメ" }]);
});

test("replaces an explicitly separated Japanese cue with its sound", () => {
  const result = segments("それは、ダメ！");
  assert.deepEqual(result, [
    { type: "text", text: "それは、" },
    { type: "audio", buffer: clips.dislike },
    { type: "text", text: "！" },
  ]);
});

test("continues to replace a standalone English cue inside a sentence", () => {
  const result = segments("I like this");
  assert.deepEqual(result, [
    { type: "text", text: "I " },
    { type: "audio", buffer: clips.like },
    { type: "text", text: " this" },
  ]);
});
