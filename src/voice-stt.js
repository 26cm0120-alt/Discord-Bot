import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";

export class VoiceSttWorker extends EventEmitter {
  constructor({ pythonPath, scriptPath, model = "base", device = "cpu", computeType = "int8" }) {
    super();
    this.pythonPath = pythonPath;
    this.scriptPath = scriptPath;
    this.model = model;
    this.device = device;
    this.computeType = computeType;
    this.child = null;
    this.ready = false;
    this.pending = new Map();
    this.maxPending = 6;
    this.lastMalformedOutputAt = 0;
  }

  start() {
    if (this.child) return;
    try {
      this.child = spawn(this.pythonPath, [
        this.scriptPath,
        "--model", this.model,
        "--device", this.device,
        "--compute-type", this.computeType,
      ], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
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
        const now = Date.now();
        if (now - this.lastMalformedOutputAt > 5000) {
          this.lastMalformedOutputAt = now;
          this.emit("workerLog", "認識ライブラリの非JSON出力を無視しました。");
        }
        return;
      }
      if (message.type === "ready") {
        this.ready = true;
        this.emit("ready", message);
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(message.id);
      pending.resolve(message.error ? null : message);
    });
    child.stderr.on("data", (data) => {
      const detail = data.toString("utf8").trim();
      if (detail) this.emit("workerLog", detail.slice(0, 1000));
    });
    child.on("error", (error) => this.failWorker(error));
    child.on("exit", (code, signal) => {
      this.ready = false;
      this.child = null;
      this.failPending();
      if (code !== 0 && code !== null) {
        this.emit("workerError", new Error(`音声認識ワーカーが終了しました（code=${code}, signal=${signal ?? "none"}）。`));
      }
    });
    child.stdin.on("error", (error) => this.emit("workerError", error));
  }

  transcribe(userId, wavBuffer, hotwords) {
    if (!this.ready || !this.child || this.pending.size >= this.maxPending) return null;
    const id = randomUUID();
    const promise = new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        resolve(null);
      }, 60_000);
      this.pending.set(id, { resolve, timeout });
    });
    const payload = JSON.stringify({
      id,
      userId,
      wav: wavBuffer.toString("base64"),
      hotwords,
    });
    this.child.stdin.write(`${payload}\n`, (error) => {
      if (!error) return;
      const pending = this.pending.get(id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(id);
      pending.resolve(null);
      this.emit("workerError", error);
    });
    return promise;
  }

  stop() {
    this.ready = false;
    this.child?.stdin.end();
    this.child?.kill();
    this.child = null;
    this.failPending();
  }

  failWorker(error) {
    this.ready = false;
    this.failPending();
    this.emit("workerError", error);
  }

  failPending() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.resolve(null);
    }
    this.pending.clear();
  }
}

