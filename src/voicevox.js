const cache = new Map();
const MAX_CACHE_ENTRIES = 48;

export class VoicevoxClient {
  constructor(baseUrl, defaultSpeakerId, { timeoutMs = 30000, fetchImpl = globalThis.fetch } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.defaultSpeakerId = Number(defaultSpeakerId);
    this.timeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? Math.min(Math.trunc(timeoutMs), 2_147_483_647)
      : 30000;
    this.fetch = fetchImpl;
  }

  async getSpeakers() {
    const response = await this.fetch(`${this.baseUrl}/speakers`, {
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`VOICEVOX speakers returned HTTP ${response.status}`);
    return response.json();
  }

  async synthesize(text, speakerId = this.defaultSpeakerId, voiceSettings = {}) {
    const key = `${speakerId}\u0000${JSON.stringify(voiceSettings)}\u0000${text}`;
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key);
      cache.set(key, cached);
      return Buffer.from(cached);
    }

    const queryUrl = new URL(`${this.baseUrl}/audio_query`);
    queryUrl.searchParams.set("text", text);
    queryUrl.searchParams.set("speaker", String(speakerId));
    const queryResponse = await this.fetch(queryUrl, {
      method: "POST",
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!queryResponse.ok) throw new Error(`VOICEVOX audio_query returned HTTP ${queryResponse.status}`);

    const audioQuery = await queryResponse.json();
    for (const key of ["speedScale", "pitchScale", "intonationScale"]) {
      if (Number.isFinite(voiceSettings[key])) audioQuery[key] = voiceSettings[key];
    }
    const synthesisUrl = new URL(`${this.baseUrl}/synthesis`);
    synthesisUrl.searchParams.set("speaker", String(speakerId));
    const synthesisResponse = await this.fetch(synthesisUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(audioQuery),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!synthesisResponse.ok) throw new Error(`VOICEVOX synthesis returned HTTP ${synthesisResponse.status}`);

    const audio = Buffer.from(await synthesisResponse.arrayBuffer());
    cache.set(key, audio);
    while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
    return Buffer.from(audio);
  }
}

