const japaneseKanaPattern = /[\u3040-\u30ff\uff66-\uff9f]/u;
const koreanHangulPattern = /[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7af\ud7b0-\ud7ff]/u;
const cjkIdeographPattern = /[\u3400-\u9fff\uf900-\ufaff]/u;
const spacingOrPunctuationPattern = /^[\s\p{P}\p{S}]$/u;
const sentencePattern = /[^。！？!?]+[。！？!?]*/gu;

function scriptLanguage(character) {
  if (japaneseKanaPattern.test(character)) return "ja";
  if (koreanHangulPattern.test(character)) return "ko";
  return null;
}

function countScriptCharacters(text) {
  let japanese = 0;
  let korean = 0;
  for (const character of text) {
    const language = scriptLanguage(character);
    if (language === "ja") japanese += 1;
    if (language === "ko") korean += 1;
  }
  return { japanese, korean };
}

function appendRun(runs, language, character) {
  const previous = runs.at(-1);
  if (previous?.language === language) previous.text += character;
  else runs.push({ language, text: character });
}

/** Split auto-language text into ordered Japanese and Korean runs by script ratio. */
export function splitTextByLanguage(text, requestedLanguage = "auto", fallbackLanguage = "ja") {
  if (requestedLanguage === "ja" || requestedLanguage === "ko") {
    return text ? [{ text, textLanguage: requestedLanguage }] : [];
  }
  if (requestedLanguage !== "auto") {
    return text ? [{ text, textLanguage: requestedLanguage }] : [];
  }

  const sentences = text.match(sentencePattern) ?? (text ? [text] : []);
  const result = [];
  for (const sentence of sentences) {
    const counts = countScriptCharacters(sentence);
    if (counts.japanese === 0 && counts.korean === 0) {
      result.push({ text: sentence, textLanguage: "auto" });
      continue;
    }
    const dominantLanguage = counts.japanese === counts.korean
      ? (fallbackLanguage === "ko" ? "ko" : "ja")
      : counts.japanese > counts.korean ? "ja" : "ko";
    const runs = [];
    for (const character of sentence) {
      const marker = scriptLanguage(character);
      const language = marker
        ?? (counts.japanese > 0 && cjkIdeographPattern.test(character) ? "ja" : null)
        ?? (spacingOrPunctuationPattern.test(character) && runs.length ? runs.at(-1).language : dominantLanguage);
      appendRun(runs, language, character);
    }
    result.push(...runs.map(({ language, text: runText }) => ({ text: runText, textLanguage: language })));
  }
  return result;
}
