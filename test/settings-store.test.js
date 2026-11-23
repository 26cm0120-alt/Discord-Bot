import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadSettings, saveSettings } from "../src/settings-store.js";

function makeSettingsPath(t) {
  const directory = mkdtempSync(join(tmpdir(), "discord-bot-settings-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const nestedDirectory = join(directory, "nested");
  mkdirSync(nestedDirectory);
  return join(nestedDirectory, ".bot-settings.json");
}

test("saves atomically and keeps the previous valid settings as a backup", (t) => {
  const settingsPath = makeSettingsPath(t);
  const previous = { dictionary: [{ word: "UBW", reading: "ユー・ビー・ダブリュー" }] };
  const current = { dictionary: [], community: { topicIndex: 3 } };
  const latest = { dictionary: [], community: { topicIndex: 4 } };

  saveSettings(settingsPath, previous);
  saveSettings(settingsPath, current);
  saveSettings(settingsPath, latest);

  assert.deepEqual(loadSettings(settingsPath), latest);
  assert.deepEqual(JSON.parse(readFileSync(`${settingsPath}.bak`, "utf8")), current);
});

test("restores a corrupt settings file from its backup and preserves the corrupt copy", (t) => {
  const settingsPath = makeSettingsPath(t);
  const previous = { birthdays: [{ userId: "123", month: 4, day: 5 }] };
  saveSettings(settingsPath, previous);
  saveSettings(settingsPath, { birthdays: [] });
  writeFileSync(settingsPath, "{broken", "utf8");

  assert.deepEqual(loadSettings(settingsPath), previous);
  assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")), previous);
  const damagedFiles = readdirSync(join(settingsPath, ".."));
  assert.ok(damagedFiles.some((name) => name.startsWith(".bot-settings.json.corrupt-")));
});

test("restores a missing current file from its backup", (t) => {
  const settingsPath = makeSettingsPath(t);
  const previous = { seasonEntries: [{ date: "2026-11-23", stages: ["stage"] }] };
  saveSettings(settingsPath, previous);
  saveSettings(settingsPath, { seasonEntries: [] });
  rmSync(settingsPath);

  assert.deepEqual(loadSettings(settingsPath), previous);
  assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")), previous);
});

test("refuses to overwrite malformed settings when no valid backup exists", (t) => {
  const settingsPath = makeSettingsPath(t);
  writeFileSync(settingsPath, "{broken", "utf8");

  assert.throws(() => loadSettings(settingsPath), /バックアップもありません/u);
  assert.equal(readFileSync(settingsPath, "utf8"), "{broken");
});

test("refuses to save over a malformed current file", (t) => {
  const settingsPath = makeSettingsPath(t);
  writeFileSync(settingsPath, "{broken", "utf8");

  assert.throws(() => saveSettings(settingsPath, { dictionary: [] }));
  assert.equal(readFileSync(settingsPath, "utf8"), "{broken");
});
