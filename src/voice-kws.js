import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";

export class VoiceKwsWorker extends EventEmitter {
  constructor({ pythonPath, scriptPath, modelDir, keywords }) {
    super();
    this.pythonPath = pythonPath;
    this.scriptPath = scriptPath;
    this.modelDir = modelDir;
    this.keywords = keywords;
    this.child = null;
    this.ready = false;
    this.openStreams = new Set();
    this.lastBackpressureLogAt = 0;
  }

  start() {
    if (this.child) return;
    try {
      this.child = spawn(this.pythonPath, [
        this.scriptPath,
        "--model-dir", this.modelDir,
        "--keywords-json", JSON.stringify(this.keywords.map(({ keyword, reading }) => ({ keyword, reading }))),
      ], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        env: { ...process.env, PYTHONUTF8: "1" },
      });
    } catch (error) {
      this.emit("workerError", error);
      return;
    }

    const child = this.child;
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        this.emit("workerLog", "KWSワーカーから不正な出力を受け取りました。");
        return;
      }
      if (message.type === "ready") {
        this.ready = true;
        this.emit("ready", message);
      } else if (message.type === "hit" && typeof message.keyword === "string") {
        this.emit("hit", message);
      } else if (message.type === "error") {
        this.emit("workerLog", message.message ?? "音声チャンクの処理に失敗しました。");
      }
    });
    child.stderr.on("data", (data) => {
      const detail = data.toString("utf8").trim();
      if (detail) this.emit("workerLog", detail.slice(0, 1000));
    });
    child.on("error", (error) => this.failWorker(error));
    child.on("exit", (code, signal) => {
      this.ready = false;
      this.child = null;
      this.openStreams.clear();
      if (code !== 0 && code !== null) {
        this.emit("workerError", new Error(`KWSワーカーが終了しました（code=${code}, signal=${signal ?? "none"}）。`));
      }
    });
    child.stdin.on("error", (error) => this.emit("workerError", error));
  }

  send(message) {
    if (!this.ready || !this.child || this.child.stdin.destroyed) return false;
    try {
      this.child.stdin.write(`${JSON.stringify(message)}\n`);
      return true;
    } catch (error) {
      this.emit("workerError", error);
      return false;
    }
  }

  beginStream(userId) {
    if (this.openStreams.has(userId)) return;
    if (this.send({ op: "start", userId })) this.openStreams.add(userId);
  }

  acceptAudio(userId, pcm) {
    if (!this.openStreams.has(userId)) return;
    if ((this.child?.stdin?.writableLength ?? 0) > 512 * 1024) {
      const now = Date.now();
      if (now - this.lastBackpressureLogAt > 10000) {
        this.lastBackpressureLogAt = now;
        this.emit("workerLog", "KWS処理が追いつかず音声チャンクを破棄しました。");
      }
      return;
    }
    this.send({ op: "audio", userId, pcm: pcm.toString("base64") });
  }

  endStream(userId) {
    if (!this.openStreams.delete(userId)) return;
    this.send({ op: "end", userId });
  }

  stop() {
    this.ready = false;
    this.openStreams.clear();
    this.child?.stdin.end();
    this.child?.kill();
    this.child = null;
  }

  failWorker(error) {
    this.ready = false;
    this.openStreams.clear();
    this.emit("workerError", error);
  }
}
