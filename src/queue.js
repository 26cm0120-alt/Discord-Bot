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

  enqueue({ text, speakerId, authorId, receivedAt = Date.now() }) {
    if (this.items.length >= this.maxItems) return { accepted: false, position: null };
    this.items.push({ text, speakerId, authorId, receivedAt });
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
        const synthesisStartedAt = Date.now();
        let audio;
        try {
          audio = await this.tts.synthesize(item.text, item.speakerId);
        } catch (error) {
          this.onError(error);
          continue;
        }
        if (item.cancelled) continue;
        const synthesisFinishedAt = Date.now();
        const metrics = {
          queueWaitMs: synthesisStartedAt - item.receivedAt,
          synthesisMs: synthesisFinishedAt - synthesisStartedAt,
          playbackStartMs: null,
        };

        await new Promise((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            this.player.off(AudioPlayerStatus.Playing, onPlaying);
            this.player.off(AudioPlayerStatus.Idle, onIdle);
            this.player.off("error", onError);
            resolve();
          };
          const onPlaying = () => {
            metrics.playbackStartMs = Date.now() - item.receivedAt;
            this.onMetric(metrics);
          };
          const onIdle = () => finish();
          const onError = (error) => {
            this.onError(error);
            finish();
          };

          this.player.once(AudioPlayerStatus.Playing, onPlaying);
          this.player.once(AudioPlayerStatus.Idle, onIdle);
          this.player.once("error", onError);
          this.player.play(createAudioResource(Readable.from(audio)));
        });
        this.current = null;
      }
    } finally {
      this.current = null;
      this.busy = false;
    }
  }
}
