const soundCuePattern = /ああう\s*あ\s*うああ|お掃除|掃除|ダメ|嫌|かくれんぼ|隠れる|かぼちゃ|パンプキン|好き|(?<![A-Za-z])(?:like(?:s|d)?|liking)(?![A-Za-z])|やめてください|やめてくれ|やめなさい|やめてよ|やめろ|やめて|(?<![A-Za-z])stop(?:s|ped|ping)?(?![A-Za-z])/giu;
const standaloneSoundCuePattern = /^(?:お掃除|掃除|ダメ|嫌|かくれんぼ|隠れる|かぼちゃ|パンプキン|好き|like(?:s|d)?|liking|やめてください|やめてくれ|やめなさい|やめてよ|やめろ|やめて|stop(?:s|ped|ping)?)[\s。.!！?？、,]*$/iu;
const standalonePhrasePattern = /^ああう\s*あ\s*うああ[\s。.!！?？、,]*$/iu;
const wordCharacterPattern = /[\p{L}\p{N}]/u;

function hasAdjacentWordCharacter(text, start, end) {
  const previousCharacter = Array.from(text.slice(0, start)).at(-1);
  const nextCharacter = Array.from(text.slice(end))[0];
  return Boolean(
    (previousCharacter && wordCharacterPattern.test(previousCharacter))
    || (nextCharacter && wordCharacterPattern.test(nextCharacter)),
  );
}

function getSoundClip(cue, voiceClips) {
  const normalizedCue = cue.toLowerCase();
  if (["お掃除", "掃除"].includes(cue)) return voiceClips.clean;
  if (["ダメ", "嫌"].includes(cue)) return voiceClips.dislike;
  if (["かくれんぼ", "隠れる"].includes(cue)) return voiceClips.hide;
  if (["かぼちゃ", "パンプキン"].includes(cue)) return voiceClips.pumpkin;
  if (normalizedCue === "好き" || ["like", "likes", "liked", "liking"].includes(normalizedCue)) return voiceClips.like;
  return voiceClips.stop;
}

export function buildSpeechSegments(input, { voiceClips, maxMessageChars, replaceLinks }) {
  const text = replaceLinks(input.slice(0, maxMessageChars).replace(/\s+/g, " ")).trim();
  if (standalonePhrasePattern.test(text)) {
    const clips = voiceClips.phrase.filter((buffer) => buffer.length > 0);
    return clips.length ? clips.map((buffer) => ({ type: "audio", buffer })) : [{ type: "text", text }];
  }
  // 既存動作を保ち、単独の合図語は読み上げのままにする。
  if (standaloneSoundCuePattern.test(text)) return [{ type: "text", text }];

  const segments = [];
  let cursor = 0;
  for (const match of text.matchAll(soundCuePattern)) {
    const index = match.index ?? 0;
    const cue = match[0];
    // 日本語は単語境界がないため、漢字・かな・英数字に続く部分一致を置換しない。
    if (/[^\x00-\x7F]/u.test(cue) && hasAdjacentWordCharacter(text, index, index + cue.length)) continue;
    if (index > cursor) segments.push({ type: "text", text: text.slice(cursor, index) });
    if (standalonePhrasePattern.test(cue)) {
      if (voiceClips.phrase.length) {
        segments.push(...voiceClips.phrase.map((buffer) => ({ type: "audio", buffer })));
      } else {
        segments.push({ type: "text", text: cue });
      }
      cursor = index + cue.length;
      continue;
    }
    const clip = getSoundClip(cue, voiceClips);
    segments.push(clip?.length ? { type: "audio", buffer: clip } : { type: "text", text: cue });
    cursor = index + cue.length;
  }
  if (cursor < text.length) segments.push({ type: "text", text: text.slice(cursor) });
  return segments.length ? segments : [{ type: "text", text }];
}
