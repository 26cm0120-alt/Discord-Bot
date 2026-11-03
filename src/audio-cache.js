export class AudioCache {
  constructor({ maxEntries = 32, maxBytes = 64 * 1024 * 1024 } = {}) {
    this.maxEntries = Math.max(0, Math.floor(maxEntries));
    this.maxBytes = Math.max(0, Math.floor(maxBytes));
    this.entries = new Map();
    this.bytes = 0;
  }

  get(key) {
    const audio = this.entries.get(key);
    if (!audio) return null;
    this.entries.delete(key);
    this.entries.set(key, audio);
    return Buffer.from(audio);
  }

  set(key, value) {
    const audio = Buffer.from(value);
    if (!this.maxEntries || !this.maxBytes || audio.length > this.maxBytes) return false;

    const existing = this.entries.get(key);
    if (existing) {
      this.entries.delete(key);
      this.bytes -= existing.length;
    }
    while (this.entries.size >= this.maxEntries || this.bytes + audio.length > this.maxBytes) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) return false;
      this.bytes -= this.entries.get(oldestKey).length;
      this.entries.delete(oldestKey);
    }
    this.entries.set(key, audio);
    this.bytes += audio.length;
    return true;
  }

  get stats() {
    return { entries: this.entries.size, bytes: this.bytes, maxEntries: this.maxEntries, maxBytes: this.maxBytes };
  }
}
