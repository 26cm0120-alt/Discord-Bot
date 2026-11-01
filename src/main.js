import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { resolve } from "node:path";
import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import {
  AudioPlayerStatus,
  VoiceConnectionStatus,
  createAudioPlayer,
  entersState,
  joinVoiceChannel,
} from "@discordjs/voice";
import { SpeechQueue } from "./queue.js";
import { VoicevoxClient } from "./voicevox.js";

const config = {
  token: process.env.DISCORD_TOKEN,
  guildId: process.env.GUILD_ID,
  envTextChannelIds: (process.env.TEXT_CHANNEL_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean),
  voicevoxUrl: process.env.VOICEVOX_URL ?? "http://127.0.0.1:50021",
  defaultSpeakerId: Number(process.env.VOICEVOX_SPEAKER_ID ?? 1),
  supikiSpeakerId: Number(process.env.SUPIKI_SPEAKER_ID ?? process.env.VOICEVOX_SPEAKER_ID ?? 1),
  supikiVoiceSettings: {
    speedScale: Number(process.env.SUPIKI_SPEED_SCALE ?? 1.12),
    pitchScale: Number(process.env.SUPIKI_PITCH_SCALE ?? 0.08),
    intonationScale: Number(process.env.SUPIKI_INTONATION_SCALE ?? 1.2),
  },
  announceVoiceEvents: process.env.ANNOUNCE_VOICE_EVENTS !== "false",
  linkSpeechMode: process.env.LINK_SPEECH_MODE ?? "omit",
  maxMessageChars: Number(process.env.MAX_MESSAGE_CHARS ?? 240),
  maxQueueItems: Number(process.env.MAX_QUEUE_ITEMS ?? 30),
  voiceReadyTimeoutMs: Number(process.env.VOICE_READY_TIMEOUT_MS ?? 15000),
};
if (!config.token || !config.guildId || config.envTextChannelIds.length === 0) {
  throw new Error(".env の DISCORD_TOKEN, GUILD_ID, TEXT_CHANNEL_IDS を設定してください。");
}

const settingsPath = resolve(process.cwd(), ".bot-settings.json");
const defaultSettings = {
  textChannelIds: config.envTextChannelIds,
  announceVoiceEvents: config.announceVoiceEvents,
  linkSpeechMode: ["omit", "domain", "keep"].includes(config.linkSpeechMode) ? config.linkSpeechMode : "omit",
  dictionary: [],
};
let savedSettings = {};
if (existsSync(settingsPath)) {
  try {
    savedSettings = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch (error) {
    console.error("設定ファイルを読めません。初期値で起動します:", error.message);
  }
}
const guildSettings = {
  ...defaultSettings,
  ...savedSettings,
  textChannelIds: Array.isArray(savedSettings.textChannelIds) ? savedSettings.textChannelIds : defaultSettings.textChannelIds,
  dictionary: Array.isArray(savedSettings.dictionary) ? savedSettings.dictionary : [],
};
if (!["omit", "domain", "keep"].includes(guildSettings.linkSpeechMode)) guildSettings.linkSpeechMode = "omit";
const textChannelIds = new Set(guildSettings.textChannelIds);
function saveGuildSettings() {
  guildSettings.textChannelIds = [...textChannelIds];
  writeFileSync(settingsPath, `${JSON.stringify(guildSettings, null, 2)}\n`, "utf8");
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
});
const tts = new VoicevoxClient(config.voicevoxUrl, config.defaultSpeakerId);
const player = createAudioPlayer();
const voiceClipsPath = resolve(process.cwd(), "assets", "voice-clips.json");
let voiceClips = { join: null, leave: null, like: null, stop: null };
try {
  const encodedClips = JSON.parse(readFileSync(voiceClipsPath, "utf8"));
  voiceClips = {
    join: Buffer.from(encodedClips.join ?? "", "base64"),
    leave: Buffer.from(encodedClips.leave ?? "", "base64"),
    like: Buffer.from(encodedClips.like ?? "", "base64"),
    stop: Buffer.from(encodedClips.stop ?? "", "base64"),
  };
} catch (error) {
  console.error("入退室音声を読み込めません。音声なしで案内します:", error.message);
}
const voicePreferencesByUser = new Map();
const supikiUsers = new Set();
let connection = null;
let lastMetric = null;
const queue = new SpeechQueue({
  player,
  tts,
  maxItems: config.maxQueueItems,
  onMetric: (metric) => {
    lastMetric = metric;
    console.log(JSON.stringify({ event: "speech_started", ...metric }));
  },
  onError: (error) => console.error("読み上げエラー:", error.message),
});

const alphabetNames = {
  A: "エー", B: "ビー", C: "シー", D: "ディー", E: "イー", F: "エフ", G: "ジー",
  H: "エイチ", I: "アイ", J: "ジェイ", K: "ケー", L: "エル", M: "エム", N: "エヌ",
  O: "オー", P: "ピー", Q: "キュー", R: "アール", S: "エス", T: "ティー", U: "ユー",
  V: "ブイ", W: "ダブリュー", X: "エックス", Y: "ワイ", Z: "ゼット",
};

function replaceLinks(text) {
  const mode = guildSettings.linkSpeechMode;
  if (mode === "keep") return text;
  if (mode === "omit") {
    return text
      .replace(/\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/giu, "リンク省略")
      .replace(/<((?:https?:\/\/|www\.)[^>]+)>/giu, "リンク省略")
      .replace(/(?:https?:\/\/|www\.)[^\s<>]+/giu, "リンク省略");
  }
  const toSpeech = (url) => {
    const cleaned = url.replace(/[.,!?;:、。！？）)]+$/u, "");
    try {
      const parsed = new URL(cleaned.startsWith("www.") ? `https://${cleaned}` : cleaned);
      return `${parsed.hostname}${url.slice(cleaned.length)}`;
    } catch {
      return "リンク";
    }
  };
  let result = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/giu, (_all, label, url) => {
    const spokenUrl = toSpeech(url);
    return spokenUrl ? `${label} ${spokenUrl}` : label;
  });
  result = result.replace(/<((?:https?:\/\/|www\.)[^>]+)>/giu, (_all, url) => toSpeech(url));
  return result.replace(/(?:https?:\/\/|www\.)[^\s<>]+/giu, (url) => toSpeech(url));
}

function normalizeForSpeech(input) {
  let text = replaceLinks(input.replace(/\s+/g, " ")).trim();
  const entries = [...guildSettings.dictionary]
    .filter((entry) => entry && typeof entry.word === "string" && entry.word.length > 0 && typeof entry.reading === "string")
    .sort((a, b) => b.word.length - a.word.length);
  for (const entry of entries) text = text.split(entry.word).join(entry.reading);
  text = text.replace(/\b[A-Z]{2,}\b/g, (letters) => [...letters].map((letter) => alphabetNames[letter]).join(" "));
  return text.trim().slice(0, config.maxMessageChars);
}

const soundCuePattern = /好き|(?<![A-Za-z])(?:like(?:s|d)?|liking)(?![A-Za-z])|やめてください|やめてくれ|やめなさい|やめてよ|やめろ|やめて|(?<![A-Za-z])stop(?:s|ped|ping)?(?![A-Za-z])/giu;

function buildSpeechSegments(input) {
  const text = replaceLinks(input.slice(0, config.maxMessageChars).replace(/\s+/g, " ")).trim();
  const segments = [];
  let cursor = 0;
  for (const match of text.matchAll(soundCuePattern)) {
    const index = match.index ?? 0;
    if (index > cursor) segments.push({ type: "text", text: text.slice(cursor, index) });
    const cue = match[0].toLowerCase();
    const clip = cue === "好き" || ["like", "likes", "liked", "liking"].includes(cue)
      ? voiceClips.like
      : voiceClips.stop;
    segments.push(clip?.length ? { type: "audio", buffer: clip } : { type: "text", text: match[0] });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) segments.push({ type: "text", text: text.slice(cursor) });
  return segments.length ? segments : [{ type: "text", text }];
}

function enqueueSegments({ segments, authorId, receivedAt = Date.now() }) {
  const normalizedSegments = segments.flatMap((segment) => {
    if (segment.type === "text") {
      const text = normalizeForSpeech(segment.text);
      return text ? [{ type: "text", text }] : [];
    }
    if (segment.type === "audio" && segment.buffer?.length) return [segment];
    return [];
  });
  const text = normalizedSegments.filter((segment) => segment.type === "text").map((segment) => segment.text).join(" ");
  if (!text) return { accepted: false, position: null, reason: "empty" };
  const preference = voicePreferencesByUser.get(authorId) ?? {};
  const isSupiki = supikiUsers.has(authorId);
  const voiceSettings = isSupiki
    ? config.supikiVoiceSettings
    : Object.fromEntries(["speedScale", "pitchScale", "intonationScale"].filter((key) => Number.isFinite(preference[key])).map((key) => [key, preference[key]]));
  return queue.enqueue({
    text,
    segments: normalizedSegments,
    authorId,
    receivedAt,
    speakerId: isSupiki ? config.supikiSpeakerId : (preference.speakerId ?? config.defaultSpeakerId),
    voiceSettings,
  });
}

function enqueueText({ text, authorId, receivedAt = Date.now() }) {
  return enqueueSegments({ segments: buildSpeechSegments(text), authorId, receivedAt });
}

async function connectTo(channel) {
  if (connection) connection.destroy();
  connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: true,
  });
  connection.subscribe(player);
  connection.on("error", (error) => console.error("音声接続エラー:", error.message));
  let reconnecting = false;
  connection.on(VoiceConnectionStatus.Disconnected, () => {
    console.warn("音声接続が切断されました。");
    if (reconnecting) return;
    reconnecting = true;
    void (async () => {
      try {
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          if (connection !== activeConnection) return;
          activeConnection.rejoin();
          try {
            await entersState(activeConnection, VoiceConnectionStatus.Ready, 5000);
            console.info(JSON.stringify({ event: "voice_reconnected", attempt }));
            return;
          } catch {
            console.warn(JSON.stringify({ event: "voice_reconnect_retry", attempt }));
          }
        }
        if (connection === activeConnection) {
          queue.clear();
          activeConnection.destroy();
          connection = null;
          console.error("再接続できませんでした。/join で再接続してください。");
        }
      } finally {
        reconnecting = false;
      }
    })();
  });
  const activeConnection = connection;
  await entersState(connection, VoiceConnectionStatus.Ready, config.voiceReadyTimeoutMs);
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Bot起動: ${readyClient.user.tag}; 対象サーバー=${config.guildId}`);
  console.log(`TTS engine=${config.voicevoxUrl}; text channels=${[...textChannelIds].join(",")}`);
  console.log(`入退室通知=${guildSettings.announceVoiceEvents}; URL読み=${guildSettings.linkSpeechMode}`);
});

client.on(Events.MessageCreate, (message) => {
  if (message.guildId !== config.guildId || !textChannelIds.has(message.channelId)) return;
  if (message.author.bot || !connection || connection.state.status !== VoiceConnectionStatus.Ready) return;

  const result = enqueueText({ text: message.cleanContent, authorId: message.author.id, receivedAt: Date.now() });
  if (!result.accepted && result.reason !== "empty") {
    console.warn(JSON.stringify({ event: "queue_full", guildId: message.guildId }));
  }
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  if (!guildSettings.announceVoiceEvents || oldState.guild.id !== config.guildId) return;
  const targetVoiceId = connection?.joinConfig?.channelId;
  if (!targetVoiceId || connection.state.status !== VoiceConnectionStatus.Ready) return;
  const wasInTarget = oldState.channelId === targetVoiceId;
  const isInTarget = newState.channelId === targetVoiceId;
  if (wasInTarget === isInTarget) return;
  const member = isInTarget ? newState.member : oldState.member;
  if (!member || member.user.bot) return;
  const name = member.displayName.replace(/@/g, "アット");
  const isJoining = isInTarget;
  const clip = isJoining ? voiceClips.join : voiceClips.leave;
  const segments = clip?.length
    ? [
        { type: "text", text: `${name}さんが` },
        { type: "audio", buffer: clip },
        { type: "text", text: isJoining ? "しにきました。" : "しました。" },
      ]
    : [{ type: "text", text: isJoining ? `${name}さんが来ました。` : `${name}さんが退出しました。` }];
  enqueueSegments({ segments, authorId: member.id });
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.guildId !== config.guildId) return;

  try {
    if (interaction.commandName === "help") {
      await interaction.reply({
        content: [
          "**読み上げBot コマンド一覧**",
          "`/join` — VCに接続して読み上げ開始。`/leave` — 切断。",
          "`/say text:<文章>` — 文章を直接読み上げ。`/skip` — 再生中をスキップ。`/queue` — 待ち状況。",
          "`/setvoice speaker/speed/pitch` — 自分の声を調整。`/voice` — 自分の設定。`/voices` — 話者一覧。",
          "`/supiki enabled:true/false` — 自分の投稿をスピキ風/通常に切替。",
          "`/dict add|remove|list` — 読み方辞書。`/readch add|remove|list` — 読み上げ対象チャンネル。",
          "`/setting` — 入退室通知とURL読み上げの設定（管理者）。",
        ].join("\n"),
      });
      return;
    }

    if (interaction.commandName === "join") {
      const channel = interaction.member.voice?.channel;
      if (!channel) {
        await interaction.reply({ content: "先にボイスチャンネルに入ってください。" });
        return;
      }
      await interaction.deferReply();
      await connectTo(channel);
      enqueueText({ text: "接続しました。", authorId: interaction.user.id });
      await interaction.editReply(`${channel.name} に接続しました。設定した読み上げ元チャンネルの投稿を読み上げます。`);
      return;
    }

    if (interaction.commandName === "leave") {
      queue.clear();
      connection?.destroy();
      connection = null;
      await interaction.reply({ content: "読み上げを停止して切断しました。", flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.commandName === "queue") {
      const metricText = lastMetric
        ? `\n直近: 待ち ${lastMetric.queueWaitMs} ms / 合成 ${lastMetric.synthesisMs} ms / 受信から再生開始 ${lastMetric.playbackStartMs ?? "計測中"} ms`
        : "\nまだ再生計測はありません。";
      await interaction.reply({ content: `待ち件数: ${queue.size}${metricText}`, flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.commandName === "skip") {
      const skipped = queue.skip();
      await interaction.reply({ content: skipped ? "再生をスキップしました。" : "再生中の文章はありません。", flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.commandName === "say") {
      if (!connection || connection.state.status !== VoiceConnectionStatus.Ready) {
        await interaction.reply({ content: "先に `/join` でボイスチャンネルへ接続してください。", flags: MessageFlags.Ephemeral });
        return;
      }
      const result = enqueueText({ text: interaction.options.getString("text", true), authorId: interaction.user.id });
      const message = result.accepted ? `読み上げ列に追加しました（${result.position}番目）。` : result.reason === "empty" ? "リンクなどを省略した結果、読み上げる内容がありません。" : "読み上げ列がいっぱいです。少し待ってから試してください。";
      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.commandName === "supiki") {
      const enabled = interaction.options.getBoolean("enabled", true);
      if (enabled) supikiUsers.add(interaction.user.id);
      else supikiUsers.delete(interaction.user.id);
      await interaction.reply({
        content: enabled
          ? "あなたの投稿をスピキ風モードで読み上げます。通常に戻すには `/supiki enabled:false` を実行してください。"
          : "あなたの投稿を通常モードで読み上げます。",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.commandName === "speaker" || interaction.commandName === "setvoice") {
      const preference = { ...(voicePreferencesByUser.get(interaction.user.id) ?? {}) };
      if (interaction.commandName === "speaker") {
        preference.speakerId = interaction.options.getInteger("id", true);
      } else {
        const speakerId = interaction.options.getInteger("speaker");
        const speedScale = interaction.options.getNumber("speed");
        const pitchScale = interaction.options.getNumber("pitch");
        if (speakerId === null && speedScale === null && pitchScale === null) {
          await interaction.reply({ content: "speaker、speed、pitchのいずれかを指定してください。", flags: MessageFlags.Ephemeral });
          return;
        }
        if (speakerId !== null) preference.speakerId = speakerId;
        if (speedScale !== null) preference.speedScale = speedScale;
        if (pitchScale !== null) preference.pitchScale = pitchScale;
      }
      voicePreferencesByUser.set(interaction.user.id, preference);
      const speakerLabel = preference.speakerId ?? config.defaultSpeakerId;
      const speedLabel = preference.speedScale ?? 1;
      const pitchLabel = preference.pitchScale ?? 0;
      await interaction.reply({ content: `設定しました（話者ID ${speakerLabel}、速度 ${speedLabel}、高さ ${pitchLabel}）。`, flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.commandName === "voice") {
      const preference = voicePreferencesByUser.get(interaction.user.id) ?? {};
      await interaction.reply({
        content: `話者ID: ${preference.speakerId ?? config.defaultSpeakerId}\n速度: ${preference.speedScale ?? 1}\n高さ: ${preference.pitchScale ?? 0}\nスピキ風モード: ${supikiUsers.has(interaction.user.id) ? "ON" : "OFF"}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.commandName === "voices") {
      const speakers = await tts.getSpeakers();
      const lines = speakers.flatMap((speaker) => speaker.styles.map((style) => `${style.id}: ${speaker.name}（${style.name}）`)).slice(0, 35);
      await interaction.reply({ content: `**VOICEVOX話者一覧（先頭35件）**\n${lines.join("\n")}`.slice(0, 1950), flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.commandName === "dict") {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === "list") {
        const content = guildSettings.dictionary.length
          ? guildSettings.dictionary.map((entry) => `「${entry.word}」→「${entry.reading}」`).join("\n")
          : "辞書は空です。";
        await interaction.reply({ content: content.slice(0, 1900), flags: MessageFlags.Ephemeral });
        return;
      }
      const word = interaction.options.getString("word", true).trim();
      if (subcommand === "add") {
        const reading = interaction.options.getString("reading", true).trim();
        const existing = guildSettings.dictionary.findIndex((entry) => entry.word === word);
        const entry = { word, reading };
        if (existing >= 0) guildSettings.dictionary[existing] = entry;
        else guildSettings.dictionary.push(entry);
        saveGuildSettings();
        await interaction.reply({ content: `辞書に登録しました: 「${word}」→「${reading}」`, flags: MessageFlags.Ephemeral });
        return;
      }
      const existing = guildSettings.dictionary.findIndex((entry) => entry.word === word);
      if (existing < 0) {
        await interaction.reply({ content: `「${word}」は辞書にありません。`, flags: MessageFlags.Ephemeral });
        return;
      }
      guildSettings.dictionary.splice(existing, 1);
      saveGuildSettings();
      await interaction.reply({ content: `「${word}」を辞書から削除しました。`, flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.commandName === "readch") {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === "list") {
        const channels = [...textChannelIds].map((id) => `<#${id}>`).join("\n") || "なし";
        await interaction.reply({ content: `読み上げ対象チャンネル:\n${channels}`, flags: MessageFlags.Ephemeral });
        return;
      }
      const channel = interaction.options.getChannel("channel", true);
      if (subcommand === "add") {
        if (textChannelIds.has(channel.id)) {
          await interaction.reply({ content: `${channel}はすでに対象です。`, flags: MessageFlags.Ephemeral });
          return;
        }
        textChannelIds.add(channel.id);
        saveGuildSettings();
        await interaction.reply({ content: `${channel}を読み上げ対象に追加しました。`, flags: MessageFlags.Ephemeral });
        return;
      }
      if (textChannelIds.size <= 1) {
        await interaction.reply({ content: "最後の読み上げ対象は削除できません。", flags: MessageFlags.Ephemeral });
        return;
      }
      textChannelIds.delete(channel.id);
      saveGuildSettings();
      await interaction.reply({ content: `${channel}を読み上げ対象から削除しました。`, flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.commandName === "setting") {
      const announcements = interaction.options.getBoolean("announcements");
      const linkMode = interaction.options.getString("links");
      if (announcements === null && linkMode === null) {
        await interaction.reply({ content: `入退室通知: ${guildSettings.announceVoiceEvents ? "ON" : "OFF"}\nURL読み上げ: ${guildSettings.linkSpeechMode}`, flags: MessageFlags.Ephemeral });
        return;
      }
      if (announcements !== null) guildSettings.announceVoiceEvents = announcements;
      if (linkMode !== null) guildSettings.linkSpeechMode = linkMode;
      saveGuildSettings();
      await interaction.reply({ content: `設定を保存しました。入退室通知: ${guildSettings.announceVoiceEvents ? "ON" : "OFF"} / URL読み上げ: ${guildSettings.linkSpeechMode}`, flags: MessageFlags.Ephemeral });
    }
  } catch (error) {
    console.error("コマンド処理エラー:", error);
    const content = "処理に失敗しました。BotログとVOICEVOX Engineの状態を確認してください。";
    if (interaction.deferred || interaction.replied) await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }
});

client.on("error", (error) => console.error("Discord client error:", error));
await client.login(config.token);


