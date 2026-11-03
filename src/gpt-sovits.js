import { createHash } from "node:crypto";
import { AudioCache } from "./audio-cache.js";

export function normalizePcm16Wav(input) {
  const audio = Buffer.from(input);
  if (audio.length < 44 || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE") {
    return audio;
  }

  let format = null;
  let dataOffset = -1;
  let dataLength = 0;
  for (let offset = 12; offset + 8 <= audio.length;) {
    const chunkName = audio.toString("ascii", offset, offset + 4);
    const chunkLength = audio.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    if (chunkStart + chunkLength > audio.length) break;
    if (chunkName === "fmt " && chunkLength >= 16) {
      format = {
        encoding: audio.readUInt16LE(chunkStart),
        channels: audio.readUInt16LE(chunkStart + 2),
        bits: audio.readUInt16LE(chunkStart + 14),
      };
    } else if (chunkName === "data") {
      dataOffset = chunkStart;
      dataLength = chunkLength;
      break;
    }
    offset = chunkStart + chunkLength + (chunkLength % 2);
  }
  if (format?.encoding !== 1 || format.bits !== 16 || dataOffset < 0) return audio;

  let peak = 0;
  const sampleEnd = dataOffset + dataLength - (dataLength % 2);
  for (let offset = dataOffset; offset < sampleEnd; offset += 2) {
    peak = Math.max(peak, Math.abs(audio.readInt16LE(offset)));
  }
  if (peak < 16) return audio;

  const targetPeak = Math.round(32767 * 0.75);
  const gain = Math.min(targetPeak / peak, 60);
  if (gain <= 1.01) return audio;
  for (let offset = dataOffset; offset < sampleEnd; offset += 2) {
    const sample = Math.round(audio.readInt16LE(offset) * gain);
    audio.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), offset);
  }
  return audio;
}

function inferReferenceLanguage(text, requestedLanguage, fallbackLanguage) {
  if (requestedLanguage === "ja" || requestedLanguage === "ko") return requestedLanguage;
  if (requestedLanguage !== "auto") return null;

  const japaneseCount = (text.match(/[\u3040-\u30ff]/gu) ?? []).length;
  const koreanCount = (text.match(/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/gu) ?? []).length;
  if (japaneseCount > koreanCount) return "ja";
  if (koreanCount > japaneseCount) return "ko";
  return fallbackLanguage === "ja" || fallbackLanguage === "ko" ? fallbackLanguage : null;
}

export class GptSovitsClient {
  constructor({
    baseUrl,
    referenceAudioPath,
    referenceText,
    promptLanguage = "ja",
    referenceAudioPathJa = "",
    referenceTextJa = "",
    referenceAudioPathKo = "",
    referenceTextKo = "",
    referencesJa = [],
    referencesKo = [],
    textLanguage = "auto",
    timeoutMs = 60000,
    promptFree = false,
    audioCache = new AudioCache(),
  }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    // The GPT-SoVITS process, not this bot process, opens this file. Preserve
    // the configured path verbatim so a Linux VPS can pass a Windows PC path.
    this.referenceAudioPath = referenceAudioPath?.trim() ?? "";
    this.referenceText = referenceText?.trim() ?? "";
    this.promptLanguage = promptLanguage.trim() || "ja";
    const cleanReferences = (references, language) => Array.isArray(references)
      ? references
        .filter((reference) => reference && typeof reference.audioPath === "string" && typeof reference.text === "string")
        .map((reference) => ({ audioPath: reference.audioPath.trim(), text: reference.text.trim(), promptLanguage: language }))
        .filter((reference) => reference.audioPath && reference.text)
      : [];
    const jaReferences = cleanReferences(referencesJa, "ja");
    const koReferences = cleanReferences(referencesKo, "ko");
    this.references = {
      ja: jaReferences.length ? jaReferences : [{
        audioPath: referenceAudioPathJa.trim() || (this.promptLanguage === "ja" ? this.referenceAudioPath : ""),
        text: referenceTextJa.trim() || (this.promptLanguage === "ja" ? this.referenceText : ""),
        promptLanguage: "ja",
      }],
      ko: koReferences.length ? koReferences : [{
        audioPath: referenceAudioPathKo.trim() || (this.promptLanguage === "ko" ? this.referenceAudioPath : ""),
        text: referenceTextKo.trim() || (this.promptLanguage === "ko" ? this.referenceText : ""),
        promptLanguage: "ko",
      }],
    };
    this.referenceIndexes = { ja: 0, ko: 0 };
    this.textLanguage = textLanguage.trim() || "auto";
    this.timeoutMs = timeoutMs;
    this.promptFree = promptFree;
    this.audioCache = audioCache;
  }

  async synthesize(text, textLanguage = this.textLanguage) {
    const language = textLanguage.trim().toLowerCase();
    const referenceLanguage = inferReferenceLanguage(text, language, this.promptLanguage);
    const pool = referenceLanguage ? this.references[referenceLanguage] : null;
    const referencePool = pool?.length ? pool : [{
      audioPath: this.referenceAudioPath,
      text: this.referenceText,
      promptLanguage: this.promptLanguage,
    }];
    const normalizedText = text.normalize("NFKC");
    const cacheKey = createHash("sha256").update(JSON.stringify({
      text: normalizedText,
      language,
      referenceLanguage,
      references: referencePool,
      promptFree: this.promptFree,
    })).digest("hex");
    const cachedAudio = this.audioCache.get(cacheKey);
    if (cachedAudio) return cachedAudio;

    let reference;
    if (pool?.length) {
      const index = this.referenceIndexes[referenceLanguage] ?? 0;
      reference = pool[index % pool.length];
      this.referenceIndexes[referenceLanguage] = (index + 1) % pool.length;
    } else {
      reference = {
        audioPath: this.referenceAudioPath,
        text: this.referenceText,
        promptLanguage: this.promptLanguage,
      };
    }
    const languageSuffix = referenceLanguage ? `_${referenceLanguage.toUpperCase()}` : "";
    if (!reference.audioPath) {
      throw new Error(`GPT-SoVITS参照音声の絶対パスを GPT_SOVITS_REF_AUDIO_PATH${languageSuffix} に設定してください。`);
    }
    if (!this.promptFree && !reference.text) {
      throw new Error(`参照音声の正確な書き起こしを GPT_SOVITS_REF_TEXT${languageSuffix} に設定してください。`);
    }

    const response = await fetch(`${this.baseUrl}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({
        text: normalizedText,
        text_lang: language,
        ref_audio_path: reference.audioPath,
        prompt_text: this.promptFree ? "" : reference.text,
        prompt_lang: reference.promptLanguage,
        text_split_method: "cut5",
        batch_size: 1,
        media_type: "wav",
        streaming_mode: false,
        speed_factor: 1.0,
      }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`GPT-SoVITS /tts returned HTTP ${response.status}: ${detail}`);
    }
    const audio = normalizePcm16Wav(Buffer.from(await response.arrayBuffer()));
    this.audioCache.set(cacheKey, audio);
    return audio;
  }
}
