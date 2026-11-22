import assert from "node:assert/strict";
import test from "node:test";
import { hasHumanVoiceMember } from "../src/voice-channel-members.js";

function makeGuild(states) {
  return {
    voiceStates: { cache: { some: (predicate) => states.some(predicate) } },
    members: { cache: new Map() },
  };
}

test("reports empty when only the bot remains in the connected voice channel", () => {
  const guild = makeGuild([
    { id: "bot", channelId: "voice-1", member: { user: { bot: true } } },
    { id: "human", channelId: null, member: { user: { bot: false } } },
  ]);

  assert.equal(hasHumanVoiceMember(guild, "voice-1", "bot"), false);
});

test("keeps the connection while a human remains in the connected channel", () => {
  const guild = makeGuild([
    { id: "bot", channelId: "voice-1", member: { user: { bot: true } } },
    { id: "human", channelId: "voice-1", member: { user: { bot: false } } },
  ]);

  assert.equal(hasHumanVoiceMember(guild, "voice-1", "bot"), true);
});

test("ignores other voice channels and other bots", () => {
  const guild = makeGuild([
    { id: "bot", channelId: "voice-1", member: { user: { bot: true } } },
    { id: "other-human", channelId: "voice-2", member: { user: { bot: false } } },
    { id: "other-bot", channelId: "voice-1", member: { user: { bot: true } } },
  ]);

  assert.equal(hasHumanVoiceMember(guild, "voice-1", "bot"), false);
});

test("treats an uncached voice state as a possible human", () => {
  const guild = makeGuild([
    { id: "bot", channelId: "voice-1", member: { user: { bot: true } } },
    { id: "uncached", channelId: "voice-1", member: null },
  ]);

  assert.equal(hasHumanVoiceMember(guild, "voice-1", "bot"), true);
});
