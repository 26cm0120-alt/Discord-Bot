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
import { GptSovitsClient } from "./gpt-sovits.js";

const config = {
  token: process.env.DISCORD_TOKEN,
  guildId: process.env.GUILD_ID,
  envTextChannelIds: (process.env.TEXT_CHANNEL_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean),
  voicevoxUrl: process.env.VOICEVOX_URL ?? "http://127.0.0.1:50021",
  defaultSpeakerId: Number(process.env.VOICEVOX_SPEAKER_ID ?? 1),
  supikiSpeakerId: Number(process.env.SUPIKI_SPEAKER_ID ?? process.env.VOICEVOX_SPEAKER_ID ?? 1),
  supikiTtsProvider: process.env.SUPIKI_TTS_PROVIDER ?? "voicevox",
  gptSovitsUrl: process.env.GPT_SOVITS_URL ?? "http://127.0.0.1:9880",
  gptSovitsReferenceAudioPath: process.env.GPT_SOVITS_REF_AUDIO_PATH ?? "",
  gptSovitsReferenceText: process.env.GPT_SOVITS_REF_TEXT ?? "",
  gptSovitsTimeoutMs: Number(process.env.GPT_SOVITS_TIMEOUT_MS ?? 60000),
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
  birthdays: [],
  seasonEntries: [],
  seasonChannelId: null,
  seasonLastAnnouncedDate: null,
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
  birthdays: Array.isArray(savedSettings.birthdays) ? savedSettings.birthdays : [],
  seasonEntries: Array.isArray(savedSettings.seasonEntries) ? savedSettings.seasonEntries : [],
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
if (!["voicevox", "gpt-sovits"].includes(config.supikiTtsProvider)) {
  throw new Error("SUPIKI_TTS_PROVIDER は voicevox または gpt-sovits を指定してください。");
}
const gptSovitsTts = new GptSovitsClient({
  baseUrl: config.gptSovitsUrl,
  referenceAudioPath: config.gptSovitsReferenceAudioPath,
  referenceText: config.gptSovitsReferenceText,
  timeoutMs: config.gptSovitsTimeoutMs,
});
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
const intentionalDisconnects = new WeakSet();
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
let speakerStylesCache = [];
let speakerStylesCacheAt = 0;

async function getSpeakerStyles() {
  if (Date.now() - speakerStylesCacheAt < 60_000 && speakerStylesCache.length) return speakerStylesCache;
  const speakers = await tts.getSpeakers();
  speakerStylesCache = speakers.flatMap((speaker) => speaker.styles.map((style) => ({
    id: String(style.id),
    label: `${speaker.name} — ${style.name}`.slice(0, 100),
  })));
  speakerStylesCacheAt = Date.now();
  return speakerStylesCache;
}

async function getSpeakerLabel(speakerId) {
  try {
    const styles = await getSpeakerStyles();
    return styles.find((style) => style.id === String(speakerId))?.label ?? "VOICEVOX既定話者";
  } catch {
    return "VOICEVOX Engine未接続";
  }
}

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
const standaloneSoundCuePattern = /^(?:好き|like(?:s|d)?|liking|やめてください|やめてくれ|やめなさい|やめてよ|やめろ|やめて|stop(?:s|ped|ping)?)[\s。.!！?？、,]*$/iu;

function buildSpeechSegments(input) {
  const text = replaceLinks(input.slice(0, config.maxMessageChars).replace(/\s+/g, " ")).trim();
  if (standaloneSoundCuePattern.test(text)) return [{ type: "text", text }];
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
  const synthesizer = isSupiki && config.supikiTtsProvider === "gpt-sovits" ? gptSovitsTts : tts;
  return queue.enqueue({
    text,
    segments: normalizedSegments,
    authorId,
    receivedAt,
    speakerId: isSupiki ? config.supikiSpeakerId : (preference.speakerId ?? config.defaultSpeakerId),
    voiceSettings,
    synthesizer,
  });
}

function enqueueText({ text, authorId, receivedAt = Date.now() }) {
  return enqueueSegments({ segments: buildSpeechSegments(text), authorId, receivedAt });
}

async function connectTo(channel) {
  if (connection) {
    intentionalDisconnects.add(connection);
    connection.destroy();
  }
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
    if (reconnecting || intentionalDisconnects.has(activeConnection)) return;
    reconnecting = true;
    void (async () => {
      try {
        await new Promise((resolve) => setTimeout(resolve, 750));
        if (connection !== activeConnection || intentionalDisconnects.has(activeConnection)) return;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          if (connection !== activeConnection || intentionalDisconnects.has(activeConnection)) return;
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
          intentionalDisconnects.add(activeConnection);
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
  console.log(`Supiki TTS provider=${config.supikiTtsProvider}${config.supikiTtsProvider === "gpt-sovits" ? ` (${config.gptSovitsUrl})` : ""}`);
  console.log(`入退室通知=${guildSettings.announceVoiceEvents}; URL読み=${guildSettings.linkSpeechMode}`);
  void announceBirthdaysForToday();
  void announceTodaysSeason();
  setInterval(() => void announceBirthdaysForToday(), 15_000);
  scheduleNextSeasonMidnight();
});

const birthdayRetryAt = new Map();
function getJstDateParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map(({ type, value }) => [type, Number(value)]));
}

async function announceBirthdaysForToday() {
  const { year, month, day } = getJstDateParts();
  for (const birthday of guildSettings.birthdays) {
    if (birthday.month !== month || birthday.day !== day || birthday.lastAnnouncedYear === year) continue;
    const previousAttempt = birthdayRetryAt.get(birthday.userId) ?? 0;
    if (Date.now() - previousAttempt < 60_000) continue;
    birthdayRetryAt.set(birthday.userId, Date.now());
    try {
      const channel = await client.channels.fetch(birthday.channelId);
      if (!channel?.isTextBased() || channel.guildId !== config.guildId) {
        throw new Error(`誕生日の投稿先チャンネルが見つからないか、対象サーバー外です: ${birthday.channelId}`);
      }
      const guild = client.guilds.cache.get(config.guildId);
      const member = await guild?.members.fetch(birthday.userId).catch(() => null);
      const user = member?.displayName ?? (await client.users.fetch(birthday.userId).catch(() => null))?.username ?? "メンバー";
      await channel.send({
        content: `今日は${user}さんの誕生日です。おめでとうございます。`,
        allowedMentions: { parse: [] },
      });
      birthday.lastAnnouncedYear = year;
      saveGuildSettings();
      console.log(`誕生日のお祝いを投稿しました: user=${birthday.userId}; channel=${birthday.channelId}; year=${year}`);
    } catch (error) {
      console.error(`誕生日のお祝いを投稿できませんでした（1分後に再試行）: user=${birthday.userId};`, error.message);
    }
  }
}

function parseSeasonSchedule(raw, year, month) {
  const entries = new Map();
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error("スケジュールが空です。");
  for (const line of lines) {
    const separator = line.search(/[:：]/);
    if (separator < 0) throw new Error(`「${line}」に「:」がありません。例: 5: ステージA、ステージB`);
    const dateLabel = line.slice(0, separator).trim();
    const stageText = line.slice(separator + 1).trim();
    const dateMatch = dateLabel.match(/^(?:(\d{1,2})\s*(?:\/|月)\s*)?(\d{1,2})\s*日?(?:\s*[（(][^）)]*[）)])?(?:\s*[※＊].*)?$/);
    if (!dateMatch) throw new Error(`日付「${dateLabel}」を読めません。例: 5: ステージA、ステージB`);
    if (dateMatch[1] && Number(dateMatch[1]) !== month) {
      throw new Error(`「${dateLabel}」の月が指定月の${month}月と一致しません。`);
    }
    const day = Number(dateMatch[2]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      throw new Error(`日付「${dateLabel}」は${year}年${month}月に存在しません。`);
    }
    const stages = stageText.split(/[、,，|;；]+/).map((stage) => stage.trim()).filter(Boolean);
    if (!stages.length) throw new Error(`「${dateLabel}」のステージが空です。`);
    const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (entries.has(dateKey)) throw new Error(`${month}月${day}日の予定が重複しています。`);
    entries.set(dateKey, { date: dateKey, stages });
  }
  return [...entries.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function formatSeasonEntry(entry) {
  const [year, month, day] = entry.date.split("-").map(Number);
  const weekday = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", weekday: "short" })
    .format(new Date(Date.UTC(year, month - 1, day, 12)));
  return `${month}/${day}（${weekday}）: ${entry.stages.join("、")}`;
}

const seasonRetryAt = { value: 0 };
function scheduleNextSeasonMidnight() {
  const { year, month, day } = getJstDateParts();
  const nextJstMidnightUtc = Date.UTC(year, month - 1, day + 1) - 9 * 60 * 60 * 1000;
  const timer = setTimeout(() => {
    void announceTodaysSeason();
    scheduleNextSeasonMidnight();
  }, Math.max(0, nextJstMidnightUtc - Date.now()));
  timer.unref?.();
}

async function announceTodaysSeason() {
  const { year, month, day } = getJstDateParts();
  const today = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (guildSettings.seasonLastAnnouncedDate === today || !guildSettings.seasonChannelId) return;
  const entry = guildSettings.seasonEntries.find((item) => item.date === today);
  if (!entry || Date.now() - seasonRetryAt.value < 60_000) return;
  seasonRetryAt.value = Date.now();
  try {
    const channel = await client.channels.fetch(guildSettings.seasonChannelId);
    if (!channel?.isTextBased() || channel.guildId !== config.guildId) {
      throw new Error(`通知先チャンネルが見つからないか、対象サーバー外です: ${guildSettings.seasonChannelId}`);
    }
    await channel.send({
      content: `今日のステージローテーションは${entry.stages.join("、")}です。`,
      allowedMentions: { parse: [] },
    });
    guildSettings.seasonLastAnnouncedDate = today;
    saveGuildSettings();
    console.log(`本日のステージローテーションを投稿しました: date=${today}; channel=${guildSettings.seasonChannelId}`);
  } catch (error) {
    console.error("ステージローテーションを投稿できませんでした（1分後に再試行）:", error.message);
    const retryTimer = setTimeout(() => {
      seasonRetryAt.value = 0;
      void announceTodaysSeason();
    }, 60_000);
    retryTimer.unref?.();
  }
}

client.on(Events.MessageCreate, (message) => {
  if (message.guildId !== config.guildId || !textChannelIds.has(message.channelId)) return;
  if (message.author.bot || !connection || connection.state.status !== VoiceConnectionStatus.Ready) return;

  const result = enqueueText({ text: message.cleanContent, authorId: message.author.id, receivedAt: Date.now() });
  if (!result.accepted && result.reason !== "empty") {
    console.warn(JSON.stringify({ event: "queue_full", guildId: message.guildId }));
  }
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  if (oldState.guild.id !== config.guildId) return;
  const activeConnection = connection;
  if (
    activeConnection
    && newState.id === client.user?.id
    && oldState.channelId === activeConnection.joinConfig.channelId
    && newState.channelId !== oldState.channelId
  ) {
    console.info("BotがDiscord上で切断または移動されたため、自動再接続を停止します。");
    intentionalDisconnects.add(activeConnection);
    connection = null;
    queue.clear();
    activeConnection.destroy();
    return;
  }
  if (!guildSettings.announceVoiceEvents) return;
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
  if (interaction.isAutocomplete()) {
    if (interaction.guildId !== config.guildId) return;
    const isSpeakerCommand = interaction.commandName === "speaker" || interaction.commandName === "setvoice";
    if (!isSpeakerCommand || interaction.options.getFocused(true).name !== "speaker") return;
    try {
      const focused = String(interaction.options.getFocused()).toLocaleLowerCase();
      const styles = await getSpeakerStyles();
      const choices = styles
        .filter((style) => style.label.toLocaleLowerCase().includes(focused))
        .slice(0, 25)
        .map((style) => ({ name: style.label, value: style.id }));
      await interaction.respond(choices);
    } catch (error) {
      console.error("話者候補の取得エラー:", error.message);
      await interaction.respond([]).catch(() => {});
    }
    return;
  }
  if (!interaction.isChatInputCommand() || interaction.guildId !== config.guildId) return;

  try {
    if (interaction.commandName === "help") {
      await interaction.reply({
        content: [
          "**読み上げBot コマンド一覧**",
          "`/join` — VCに接続して読み上げ開始。`/leave` — 切断。",
          "`/say text:<文章>` — 文章を直接読み上げ。`/skip` — 再生中をスキップ。`/queue` — 待ち状況。",
          "`/setvoice speaker/speed/pitch` — 話者は名前から候補選択。`/speaker` — 話者変更。`/voice` — 自分の設定。`/voices page:<番号>` — 全話者一覧。",
          "`/supiki enabled:true/false` — 自分の投稿をスピキ風/通常に切替。",
          "`/dict add|remove|list` — 読み方辞書。`/readch add|remove|list` — 読み上げ対象チャンネル。",
          "`/birthday set month day [channel]` — 誕生日とお祝い投稿先を登録。`/birthday list` — 一覧。`/birthday remove` — 自分の登録を削除。投稿は日本時間の日付が変わった後に行われます。",
          "`/season` — 今月のローテーションを表示。`/season year month schedule` — 月間予定を登録（管理者）。登録時に通知先を選べます。",
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
      if (connection) {
        intentionalDisconnects.add(connection);
        connection.destroy();
      }
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
          ? "あなたの投稿をスピキモード（" + (config.supikiTtsProvider === "gpt-sovits" ? "GPT-SoVITS参照音声" : "VOICEVOX調整音声") + "）で読み上げます。通常に戻すには `/supiki enabled:false` を実行してください。"
          : "あなたの投稿を通常モードで読み上げます。",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.commandName === "speaker" || interaction.commandName === "setvoice") {
      const preference = { ...(voicePreferencesByUser.get(interaction.user.id) ?? {}) };
      const speakerValue = interaction.options.getString("speaker");
      const selectedSpeakerId = speakerValue === null ? null : Number(speakerValue);
      if (speakerValue !== null && (!Number.isInteger(selectedSpeakerId) || selectedSpeakerId < 0)) {
        await interaction.reply({ content: "話者候補から名前を選んでください。", flags: MessageFlags.Ephemeral });
        return;
      }
      if (interaction.commandName === "speaker") {
        if (selectedSpeakerId === null) {
          await interaction.reply({ content: "話者名を候補から選んでください。", flags: MessageFlags.Ephemeral });
          return;
        }
        preference.speakerId = selectedSpeakerId;
      } else {
        const speedScale = interaction.options.getNumber("speed");
        const pitchScale = interaction.options.getNumber("pitch");
        if (selectedSpeakerId === null && speedScale === null && pitchScale === null) {
          await interaction.reply({ content: "speaker、speed、pitchのいずれかを指定してください。", flags: MessageFlags.Ephemeral });
          return;
        }
        if (selectedSpeakerId !== null) preference.speakerId = selectedSpeakerId;
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
      const speakerLabel = await getSpeakerLabel(preference.speakerId ?? config.defaultSpeakerId);
      await interaction.reply({
        content: `話者: ${speakerLabel}\n速度: ${preference.speedScale ?? 1}\n高さ: ${preference.pitchScale ?? 0}\nスピキ風モード: ${supikiUsers.has(interaction.user.id) ? "ON" : "OFF"}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.commandName === "voices") {
      const styles = await getSpeakerStyles();
      const pageSize = 15;
      const pageCount = Math.max(1, Math.ceil(styles.length / pageSize));
      const page = interaction.options.getInteger("page") ?? 1;
      if (page > pageCount) {
        await interaction.reply({ content: `ページは1〜${pageCount}で指定してください。`, flags: MessageFlags.Ephemeral });
        return;
      }
      const lines = styles.slice((page - 1) * pageSize, page * pageSize).map((style) => `• ${style.label}`);
      await interaction.reply({
        content: `**VOICEVOX話者一覧 ${page}/${pageCount}**\n${lines.join("\n")}\n\n変更するには /setvoice speaker で話者名を検索して選んでください。`,
        flags: MessageFlags.Ephemeral,
      });
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
      return;
    }

    if (interaction.commandName === "season") {
      const yearOption = interaction.options.getInteger("year");
      const monthOption = interaction.options.getInteger("month");
      const scheduleText = interaction.options.getString("schedule");
      const channelOption = interaction.options.getChannel("channel");
      const canManage = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;

      if (channelOption && !canManage) {
        await interaction.reply({ content: "通知先を設定できるのはサーバー管理権限を持つメンバーです。", flags: MessageFlags.Ephemeral });
        return;
      }
      if (channelOption && !channelOption.isTextBased()) {
        await interaction.reply({ content: "通知先にはテキストチャンネルを指定してください。", flags: MessageFlags.Ephemeral });
        return;
      }
      if (scheduleText !== null) {
        if (!canManage) {
          await interaction.reply({ content: "月間予定を更新できるのはサーバー管理権限を持つメンバーです。", flags: MessageFlags.Ephemeral });
          return;
        }
        if (yearOption === null || monthOption === null) {
          await interaction.reply({ content: "予定を登録するときは year と month を両方指定してください。", flags: MessageFlags.Ephemeral });
          return;
        }
        const channel = channelOption ?? interaction.channel;
        if (!channel?.isTextBased() || channel.guildId !== config.guildId) {
          await interaction.reply({ content: "通知先にできるサーバー内のテキストチャンネルを選んでください。", flags: MessageFlags.Ephemeral });
          return;
        }
        let importedEntries;
        try {
          importedEntries = parseSeasonSchedule(scheduleText, yearOption, monthOption);
        } catch (error) {
          await interaction.reply({ content: `予定を登録できませんでした: ${error.message}`, flags: MessageFlags.Ephemeral });
          return;
        }
        const monthPrefix = `${yearOption}-${String(monthOption).padStart(2, "0")}-`;
        guildSettings.seasonEntries = [
          ...guildSettings.seasonEntries.filter((entry) => !entry.date.startsWith(monthPrefix)),
          ...importedEntries,
        ].sort((a, b) => a.date.localeCompare(b.date));
        guildSettings.seasonChannelId = channel.id;
        saveGuildSettings();
        await interaction.reply({
          content: `${yearOption}年${monthOption}月の予定を${importedEntries.length}日分登録しました。毎日の通知先: <#${channel.id}>`,
          flags: MessageFlags.Ephemeral,
        });
        void announceTodaysSeason();
        return;
      }

      if (channelOption) {
        guildSettings.seasonChannelId = channelOption.id;
        saveGuildSettings();
        await interaction.reply({ content: `毎日のステージ通知先を <#${channelOption.id}> に設定しました。`, flags: MessageFlags.Ephemeral });
        return;
      }
      if ((yearOption === null) !== (monthOption === null)) {
        await interaction.reply({ content: "月間表示では year と month を両方指定するか、両方省略してください。", flags: MessageFlags.Ephemeral });
        return;
      }
      const currentDate = getJstDateParts();
      const year = yearOption ?? currentDate.year;
      const month = monthOption ?? currentDate.month;
      const monthPrefix = `${year}-${String(month).padStart(2, "0")}-`;
      const entries = guildSettings.seasonEntries.filter((entry) => entry.date.startsWith(monthPrefix));
      if (!entries.length) {
        await interaction.reply({ content: `${year}年${month}月の予定はまだ登録されていません。`, flags: MessageFlags.Ephemeral });
        return;
      }
      const chunks = [];
      let chunk = `**${year}年${month}月 ステージローテーション**`;
      for (const entry of entries) {
        const line = formatSeasonEntry(entry);
        if (chunk.length + line.length + 1 > 1800) {
          chunks.push(chunk);
          chunk = "";
        }
        chunk += `${chunk ? "\n" : ""}${line}`;
      }
      if (chunk) chunks.push(chunk);
      await interaction.reply({ content: chunks[0] });
      for (const followup of chunks.slice(1)) await interaction.followUp({ content: followup });
      return;
    }

    if (interaction.commandName === "birthday") {
      const subcommand = interaction.options.getSubcommand();
      const existingIndex = guildSettings.birthdays.findIndex((entry) => entry.userId === interaction.user.id);
      if (subcommand === "set") {
        const month = interaction.options.getInteger("month", true);
        const day = interaction.options.getInteger("day", true);
        const maxDay = new Date(Date.UTC(2024, month, 0)).getUTCDate();
        if (day > maxDay) {
          await interaction.reply({ content: `${month}月は${maxDay}日までです。`, flags: MessageFlags.Ephemeral });
          return;
        }
        const channel = interaction.options.getChannel("channel") ?? interaction.channel;
        if (!channel?.isTextBased() || channel.guildId !== config.guildId) {
          await interaction.reply({ content: "投稿先にできるサーバー内のテキストチャンネルを選んでください。", flags: MessageFlags.Ephemeral });
          return;
        }
        const previous = existingIndex >= 0 ? guildSettings.birthdays[existingIndex] : null;
        const birthday = {
          userId: interaction.user.id,
          month,
          day,
          channelId: channel.id,
          lastAnnouncedYear: previous?.month === month && previous?.day === day ? previous.lastAnnouncedYear ?? null : null,
        };
        if (existingIndex >= 0) guildSettings.birthdays[existingIndex] = birthday;
        else guildSettings.birthdays.push(birthday);
        saveGuildSettings();
        await interaction.reply({
          content: `${month}月${day}日を誕生日として登録しました。お祝いは <#${channel.id}> に日本時間の日付が変わった後に投稿します。`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (subcommand === "remove") {
        if (existingIndex < 0) {
          await interaction.reply({ content: "誕生日は登録されていません。", flags: MessageFlags.Ephemeral });
          return;
        }
        guildSettings.birthdays.splice(existingIndex, 1);
        saveGuildSettings();
        await interaction.reply({ content: "誕生日の登録を削除しました。", flags: MessageFlags.Ephemeral });
        return;
      }
      const entries = [...guildSettings.birthdays].sort((a, b) => a.month - b.month || a.day - b.day);
      const lines = entries.map((entry) => `• ${entry.month}月${entry.day}日 — <@${entry.userId}>（<#${entry.channelId}>）`);
      await interaction.reply({
        content: lines.length ? `**登録済みの誕生日**\n${lines.join("\n")}`.slice(0, 1900) : "誕生日はまだ登録されていません。",
        flags: MessageFlags.Ephemeral,
      });
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


