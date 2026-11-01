const cache = new Map();
const MAX_CACHE_ENTRIES = 48;

export class VoicevoxClient {
  constructor(baseUrl, defaultSpeakerId) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.defaultSpeakerId = Number(defaultSpeakerId);
  }

  async synthesize(text, speakerId = this.defaultSpeakerId) {
    const key = `${speakerId}\u0000${text}`;
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key);
      cache.set(key, cached);
      return Buffer.from(cached);
    }

    const queryUrl = new URL(`${this.baseUrl}/audio_query`);
    queryUrl.searchParams.set("text", text);
    queryUrl.searchParams.set("speaker", String(speakerId));
    const queryResponse = await fetch(queryUrl, { method: "POST" });
    if (!queryResponse.ok) {
      throw new Error(`VOICEVOX audio_query returned HTTP ${queryResponse.status}`);
    }

    const synthesisUrl = new URL(`${this.baseUrl}/synthesis`);
    synthesisUrl.searchParams.set("speaker", String(speakerId));
    const synthesisResponse = await fetch(synthesisUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(await queryResponse.json()),
    });
    if (!synthesisResponse.ok) {
      throw new Error(`VOICEVOX synthesis returned HTTP ${synthesisResponse.status}`);
    }

    const audio = Buffer.from(await synthesisResponse.arrayBuffer());
    cache.set(key, audio);
    while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
    return Buffer.from(audio);
  }
}
