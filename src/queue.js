import { Readable } from "node:stream";
import { createAudioResource, AudioPlayerStatus } from "@discordjs/voice";

export class SpeechQueue {
  constructor({ player, tts, maxItems, ttsVolume = 0.65, onMetric, onError }) {
    this.player = player;
    this.tts = tts;
    this.maxItems = maxItems;
    this.ttsVolume = Number.isFinite(ttsVolume) ? Math.min(1, Math.max(0, ttsVolume)) : 0.65;
    this.onMetric = onMetric;
    this.onError = onError;
    this.items = [];
    this.current = null;
    this.busy = false;
  }

  enqueue({ text, segments = [{ type: "text", text }], speakerId, voiceSettings = {}, synthesizer = this.tts, authorId, receivedAt = Date.now() }) {
    if (this.items.length >= this.maxItems) return { accepted: false, position: null };
    this.items.push({ text, segments, speakerId, voiceSettings, synthesizer, authorId, receivedAt });
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
              buffer = await item.synthesizer.synthesize(segment.text, item.speakerId, item.voiceSettings);
            } catch (error) {
              this.onError(error);
              break;
            }
            metrics.synthesisMs += Date.now() - synthesisStartedAt;
          }
          if (!buffer?.length || item.cancelled) continue;
          const volume = segment.type === "audio" ? 0.3 : this.ttsVolume;
          const started = await this.playBuffer(buffer, item, metrics, metrics.playbackStartMs === null, volume);
          if (!started) break;
        }
        this.current = null;
      }
    } finally {
      this.current = null;
      this.busy = false;
    }
  }

  playBuffer(buffer, item, metrics, reportStart, volume = 1) {
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
      const onIdle = () => {
        if (!started) this.onError(new Error("音声プレイヤーが再生開始前に停止しました。"));
        finish();
      };
      const onError = (error) => {
        this.onError(error);
        finish();
      };

      this.player.once(AudioPlayerStatus.Playing, onPlaying);
      this.player.once(AudioPlayerStatus.Idle, onIdle);
      this.player.once("error", onError);
      try {
        const resource = createAudioResource(Readable.from([buffer]), { inlineVolume: true });
        resource.volume.setVolume(volume);
        this.player.play(resource);
      } catch (error) {
        this.onError(error);
        finish();
      }
    });
  }
}

