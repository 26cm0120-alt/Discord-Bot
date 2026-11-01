import { Readable } from "node:stream";
import { createAudioResource, AudioPlayerStatus } from "@discordjs/voice";

export class SpeechQueue {
  constructor({ player, tts, maxItems, onMetric, onError }) {
    this.player = player;
    this.tts = tts;
    this.maxItems = maxItems;
    this.onMetric = onMetric;
    this.onError = onError;
    this.items = [];
    this.current = null;
    this.busy = false;
  }

  enqueue({ text, segments = [{ type: "text", text }], speakerId, voiceSettings = {}, authorId, receivedAt = Date.now() }) {
    if (this.items.length >= this.maxItems) return { accepted: false, position: null };
    this.items.push({ text, segments, speakerId, voiceSettings, authorId, receivedAt });
    const position = this.items.length + (this.current ? 1 : 0);
    void this.pump();
    return { accepted: true, position };
  }

  get size() {
    return this.items.length + (this.current ? 1 : 0);
  }

  skip() {
    if (!this.current) return false;
    this.current.cancelled = true;
    if (this.player.state.status !== AudioPlayerStatus.Idle) this.player.stop(true);
    return true;
  }

  clear() {
    this.items.length = 0;
    this.skip();
  }

  async pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.items.length > 0) {
        const item = this.items.shift();
        this.current = item;
        const metrics = {
          queueWaitMs: Date.now() - item.receivedAt,
          synthesisMs: 0,
          playbackStartMs: null,
        };
        for (const segment of item.segments) {
          if (item.cancelled) break;
          let buffer = segment.buffer;
          if (segment.type === "text") {
            const synthesisStartedAt = Date.now();
            try {
              buffer = await this.tts.synthesize(segment.text, item.speakerId, item.voiceSettings);
            } catch (error) {
              this.onError(error);
              break;
            }
            metrics.synthesisMs += Date.now() - synthesisStartedAt;
          }
          if (!buffer?.length || item.cancelled) continue;
          const started = await this.playBuffer(buffer, item, metrics, metrics.playbackStartMs === null);
          if (!started) break;
        }
        this.current = null;
      }
    } finally {
      this.current = null;
      this.busy = false;
    }
  }

  playBuffer(buffer, item, metrics, reportStart) {
    return new Promise((resolve) => {
      let settled = false;
      let started = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this.player.off(AudioPlayerStatus.Playing, onPlaying);
        this.player.off(AudioPlayerStatus.Idle, onIdle);
        this.player.off("error", onError);
        resolve(started);
      };
      const onPlaying = () => {
        if (!started && reportStart) {
          metrics.playbackStartMs = Date.now() - item.receivedAt;
          this.onMetric(metrics);
        }
        started = true;
      };
      const onIdle = () => finish();
      const onError = (error) => {
        this.onError(error);
        finish();
      };

      this.player.once(AudioPlayerStatus.Playing, onPlaying);
      this.player.once(AudioPlayerStatus.Idle, onIdle);
      this.player.once("error", onError);
      this.player.play(createAudioResource(Readable.from(buffer)));
    });
  }
}


