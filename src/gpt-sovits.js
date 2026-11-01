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

export class GptSovitsClient {
  constructor({ baseUrl, referenceAudioPath, referenceText, timeoutMs = 60000 }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    // The GPT-SoVITS process, not this bot process, opens this file. Preserve
    // the configured path verbatim so a Linux VPS can pass a Windows PC path.
    this.referenceAudioPath = referenceAudioPath?.trim() ?? "";
    this.referenceText = referenceText?.trim() ?? "";
    this.timeoutMs = timeoutMs;
  }

  async synthesize(text) {
    if (!this.referenceAudioPath) {
      throw new Error("GPT-SoVITS参照音声の絶対パスを GPT_SOVITS_REF_AUDIO_PATH に設定してください。");
    }
    if (!this.referenceText) {
      throw new Error("参照音声の正確な書き起こしを GPT_SOVITS_REF_TEXT に設定してください。");
    }

    const response = await fetch(`${this.baseUrl}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({
        text,
        text_lang: "ja",
        ref_audio_path: this.referenceAudioPath,
        prompt_text: this.referenceText,
        prompt_lang: "ja",
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
    return normalizePcm16Wav(Buffer.from(await response.arrayBuffer()));
  }
}

