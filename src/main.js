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
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
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
import { splitTextByLanguage } from "./language-segments.js";
import { formatEndpointStatus, probeEndpoint } from "./engine-health.js";

const config = {
  token: process.env.DISCORD_TOKEN,
  guildId: process.env.GUILD_ID,
  voicevoxUrl: process.env.VOICEVOX_URL ?? "http://127.0.0.1:50021",
  defaultSpeakerId: Number(process.env.VOICEVOX_SPEAKER_ID ?? 1),
  supikiSpeakerId: Number(process.env.SUPIKI_SPEAKER_ID ?? process.env.VOICEVOX_SPEAKER_ID ?? 1),
  supikiTtsProvider: process.env.SUPIKI_TTS_PROVIDER ?? "voicevox",
  gptSovitsUrl: process.env.GPT_SOVITS_URL ?? "http://127.0.0.1:9880",
  gptSovitsReferenceAudioPath: process.env.GPT_SOVITS_REF_AUDIO_PATH ?? "",
  gptSovitsReferenceText: process.env.GPT_SOVITS_REF_TEXT ?? "",
  gptSovitsPromptLanguage: process.env.GPT_SOVITS_PROMPT_LANG ?? "ja",
  gptSovitsReferenceAudioPathJa: process.env.GPT_SOVITS_REF_AUDIO_PATH_JA ?? "",
  gptSovitsReferenceTextJa: process.env.GPT_SOVITS_REF_TEXT_JA ?? "",
  gptSovitsReferenceAudioPathKo: process.env.GPT_SOVITS_REF_AUDIO_PATH_KO ?? "",
  gptSovitsReferenceTextKo: process.env.GPT_SOVITS_REF_TEXT_KO ?? "",
  gptSovitsTextLanguage: process.env.GPT_SOVITS_TEXT_LANG ?? "auto",
  gptSovitsTimeoutMs: Number(process.env.GPT_SOVITS_TIMEOUT_MS ?? 60000),
  gptSovitsPromptFree: process.env.GPT_SOVITS_PROMPT_FREE === "true",
  supikiVoiceSettings: {
    speedScale: Number(process.env.SUPIKI_SPEED_SCALE ?? 1.12),
    pitchScale: Number(process.env.SUPIKI_PITCH_SCALE ?? 0.08),
    intonationScale: Number(process.env.SUPIKI_INTONATION_SCALE ?? 1.2),
  },
  announceVoiceEvents: process.env.ANNOUNCE_VOICE_EVENTS !== "false",
  linkSpeechMode: process.env.LINK_SPEECH_MODE ?? "omit",
  maxMessageChars: Number(process.env.MAX_MESSAGE_CHARS ?? 240),
  maxQueueItems: Number(process.env.MAX_QUEUE_ITEMS ?? 30),
  ttsPlaybackVolume: Number.parseFloat(process.env.TTS_PLAYBACK_VOLUME ?? "0.65"),
  voiceReadyTimeoutMs: Number(process.env.VOICE_READY_TIMEOUT_MS ?? 15000),
};
function loadGptSovitsReferenceSet(language) {
  const suffix = language.toUpperCase();
  const indexes = Object.keys(process.env)
    .map((key) => key.match(new RegExp(`^GPT_SOVITS_REF_AUDIO_PATH_${suffix}_(\\d+)$`)))
    .filter(Boolean)
    .map((match) => Number(match[1]))
    .sort((a, b) => a - b);
  return indexes.map((index) => ({
    audioPath: process.env[`GPT_SOVITS_REF_AUDIO_PATH_${suffix}_${index}`] ?? "",
    text: process.env[`GPT_SOVITS_REF_TEXT_${suffix}_${index}`] ?? "",
  })).filter((reference) => reference.audioPath.trim() && reference.text.trim());
}
if (!config.token || !config.guildId) {
  throw new Error(".env の DISCORD_TOKEN, GUILD_ID を設定してください。");
}

const settingsPath = resolve(process.cwd(), ".bot-settings.json");
const defaultSettings = {
  announceVoiceEvents: config.announceVoiceEvents,
  linkSpeechMode: ["omit", "domain", "keep"].includes(config.linkSpeechMode) ? config.linkSpeechMode : "omit",
  dictionary: [],
  gptSovitsLanguages: {},
  birthdays: [],
  seasonEntries: [],
  seasonChannelId: null,
  seasonLastAnnouncedDate: null,
  community: {
    managerRoleId: null,
    topicChannelId: null,
    topicDay: 0,
    topicHour: 20,
    topicIndex: 0,
    topicLastPostedDate: null,
    customTopics: [],
    recruitmentPanels: {},
    recruitments: {},
  },
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
  dictionary: Array.isArray(savedSettings.dictionary) ? savedSettings.dictionary : [],
  gptSovitsLanguages: savedSettings.gptSovitsLanguages && typeof savedSettings.gptSovitsLanguages === "object" && !Array.isArray(savedSettings.gptSovitsLanguages)
    ? savedSettings.gptSovitsLanguages
    : {},
  birthdays: Array.isArray(savedSettings.birthdays) ? savedSettings.birthdays : [],
  seasonEntries: Array.isArray(savedSettings.seasonEntries) ? savedSettings.seasonEntries : [],
  community: {
    ...defaultSettings.community,
    ...(savedSettings.community && typeof savedSettings.community === "object" && !Array.isArray(savedSettings.community) ? savedSettings.community : {}),
    customTopics: Array.isArray(savedSettings.community?.customTopics)
      ? savedSettings.community.customTopics.filter((topic) => typeof topic === "string" && topic.trim()).slice(0, 30)
      : [],
    recruitmentPanels: savedSettings.community?.recruitmentPanels && typeof savedSettings.community.recruitmentPanels === "object" && !Array.isArray(savedSettings.community.recruitmentPanels)
      ? savedSettings.community.recruitmentPanels
      : {},
    recruitments: savedSettings.community?.recruitments && typeof savedSettings.community.recruitments === "object" && !Array.isArray(savedSettings.community.recruitments)
      ? savedSettings.community.recruitments
      : {},
  },
};
if (!["omit", "domain", "keep"].includes(guildSettings.linkSpeechMode)) guildSettings.linkSpeechMode = "omit";
if (!Number.isInteger(guildSettings.community.topicDay) || guildSettings.community.topicDay < 0 || guildSettings.community.topicDay > 6) guildSettings.community.topicDay = 0;
if (!Number.isInteger(guildSettings.community.topicHour) || guildSettings.community.topicHour < 0 || guildSettings.community.topicHour > 23) guildSettings.community.topicHour = 20;
if (!Number.isInteger(guildSettings.community.topicIndex) || guildSettings.community.topicIndex < 0) guildSettings.community.topicIndex = 0;
if (typeof guildSettings.community.managerRoleId !== "string") guildSettings.community.managerRoleId = null;
function saveGuildSettings() {
  delete guildSettings.textChannelIds;
  delete guildSettings.listeningChannelId;
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
  promptLanguage: config.gptSovitsPromptLanguage,
  referenceAudioPathJa: config.gptSovitsReferenceAudioPathJa,
  referenceTextJa: config.gptSovitsReferenceTextJa,
  referenceAudioPathKo: config.gptSovitsReferenceAudioPathKo,
  referenceTextKo: config.gptSovitsReferenceTextKo,
  referencesJa: loadGptSovitsReferenceSet("ja"),
  referencesKo: loadGptSovitsReferenceSet("ko"),
  textLanguage: config.gptSovitsTextLanguage,
  timeoutMs: config.gptSovitsTimeoutMs,
  promptFree: config.gptSovitsPromptFree,
});
const player = createAudioPlayer();
const voiceClipsPath = resolve(process.cwd(), "assets", "voice-clips.json");
const localVoiceClipsPath = resolve(process.cwd(), "assets", "voice-clips.local.json");
let voiceClips = { join: null, leave: null, like: null, stop: null, phrase: [], clean: null, dislike: null, hide: null, pumpkin: null };
try {
  const encodedClips = JSON.parse(readFileSync(voiceClipsPath, "utf8"));
  if (existsSync(localVoiceClipsPath)) {
    Object.assign(encodedClips, JSON.parse(readFileSync(localVoiceClipsPath, "utf8")));
  }
  voiceClips = {
    join: Buffer.from(encodedClips.join ?? "", "base64"),
    leave: Buffer.from(encodedClips.leave ?? "", "base64"),
    like: Buffer.from(encodedClips.like ?? "", "base64"),
    stop: Buffer.from(encodedClips.stop ?? "", "base64"),
    phrase: [encodedClips.aau, encodedClips.a, encodedClips.uaa].every(Boolean)
      ? [encodedClips.aau, encodedClips.a, encodedClips.uaa].map((clip) => Buffer.from(clip, "base64"))
      : encodedClips.phrase
        ? [Buffer.from(encodedClips.phrase, "base64")]
        : [encodedClips.aau, encodedClips.a, encodedClips.uaa]
          .filter(Boolean)
          .map((clip) => Buffer.from(clip, "base64")),
    clean: Buffer.from(encodedClips.murugorureziru ?? "", "base64"),
    dislike: Buffer.from(encodedClips.morijabadangizibazeyo ?? "", "base64"),
    hide: Buffer.from(encodedClips.sunbakochi ?? "", "base64"),
    pumpkin: Buffer.from(encodedClips.squash ?? "", "base64"),
  };
} catch (error) {
  console.error("入退室音声を読み込めません。音声なしで案内します:", error.message);
}
const voicePreferencesByUser = new Map();
const supikiUsers = new Set();
const gptSovitsLanguageByUser = new Map(
  Object.entries(guildSettings.gptSovitsLanguages).filter(([, language]) => ["auto", "ja", "ko"].includes(language)),
);
let connection = null;
let activeListeningChannelId = null;
let lastMetric = null;
const intentionalDisconnects = new WeakSet();
const queue = new SpeechQueue({
  player,
  tts,
  maxItems: config.maxQueueItems,
  ttsVolume: config.ttsPlaybackVolume,
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

const soundCuePattern = /ああう\s*あ\s*うああ|お掃除|掃除|ダメ|嫌|かくれんぼ|隠れる|かぼちゃ|パンプキン|好き|(?<![A-Za-z])(?:like(?:s|d)?|liking)(?![A-Za-z])|やめてください|やめてくれ|やめなさい|やめてよ|やめろ|やめて|(?<![A-Za-z])stop(?:s|ped|ping)?(?![A-Za-z])/giu;
const standaloneSoundCuePattern = /^(?:お掃除|掃除|ダメ|嫌|かくれんぼ|隠れる|かぼちゃ|パンプキン|好き|like(?:s|d)?|liking|やめてください|やめてくれ|やめなさい|やめてよ|やめろ|やめて|stop(?:s|ped|ping)?)[\s。.!！?？、,]*$/iu;
const standalonePhrasePattern = /^ああう\s*あ\s*うああ[\s。.!！?？、,]*$/iu;

function buildSpeechSegments(input) {
  const text = replaceLinks(input.slice(0, config.maxMessageChars).replace(/\s+/g, " ")).trim();
  if (standalonePhrasePattern.test(text)) {
    const clips = voiceClips.phrase.filter((buffer) => buffer.length > 0);
    return clips.length ? clips.map((buffer) => ({ type: "audio", buffer })) : [{ type: "text", text }];
  }
  if (standaloneSoundCuePattern.test(text)) return [{ type: "text", text }];
  const segments = [];
  let cursor = 0;
  for (const match of text.matchAll(soundCuePattern)) {
    const index = match.index ?? 0;
    if (index > cursor) segments.push({ type: "text", text: text.slice(cursor, index) });
    const cue = match[0].toLowerCase();
    if (standalonePhrasePattern.test(match[0])) {
      if (voiceClips.phrase.length) {
        segments.push(...voiceClips.phrase.map((buffer) => ({ type: "audio", buffer })));
      } else {
        segments.push({ type: "text", text: match[0] });
      }
      cursor = index + match[0].length;
      continue;
    }
    const clip = ["お掃除", "掃除"].includes(match[0])
      ? voiceClips.clean
      : ["ダメ", "嫌"].includes(match[0])
        ? voiceClips.dislike
        : ["かくれんぼ", "隠れる"].includes(match[0])
          ? voiceClips.hide
          : ["かぼちゃ", "パンプキン"].includes(match[0])
            ? voiceClips.pumpkin
            : cue === "好き" || ["like", "likes", "liked", "liking"].includes(cue)
              ? voiceClips.like
              : voiceClips.stop;
    segments.push(clip?.length ? { type: "audio", buffer: clip } : { type: "text", text: match[0] });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) segments.push({ type: "text", text: text.slice(cursor) });
  return segments.length ? segments : [{ type: "text", text }];
}

function enqueueSegments({ segments, authorId, receivedAt = Date.now() }) {
  const preference = voicePreferencesByUser.get(authorId) ?? {};
  const isSupiki = supikiUsers.has(authorId);
  const usesGptSovits = isSupiki && config.supikiTtsProvider === "gpt-sovits";
  const textLanguage = gptSovitsLanguageByUser.get(authorId) ?? config.gptSovitsTextLanguage;
  const normalizedSegments = segments.flatMap((segment) => {
    if (segment.type === "text") {
      const text = normalizeForSpeech(segment.text);
      if (!text) return [];
      const languageSegments = usesGptSovits
        ? splitTextByLanguage(text, textLanguage, config.gptSovitsPromptLanguage)
        : [{ text, textLanguage }];
      return languageSegments.map((part) => ({ type: "text", ...part }));
    }
    if (segment.type === "audio" && segment.buffer?.length) return [segment];
    return [];
  });
  const text = normalizedSegments.filter((segment) => segment.type === "text").map((segment) => segment.text).join(" ");
  if (!normalizedSegments.length) return { accepted: false, position: null, reason: "empty" };
  const voiceSettings = isSupiki
    ? config.supikiVoiceSettings
    : Object.fromEntries(["speedScale", "pitchScale", "intonationScale"].filter((key) => Number.isFinite(preference[key])).map((key) => [key, preference[key]]));
  const synthesizer = usesGptSovits
    ? { synthesize: (text, _speakerId, _voiceSettings, language) => gptSovitsTts.synthesize(text, language) }
    : tts;
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

function getConnectedVoiceChannelId() {
  return connection?.joinConfig?.channelId ?? null;
}

function isInConnectedVoiceChannel(interaction) {
  const connectedChannelId = getConnectedVoiceChannelId();
  return Boolean(connectedChannelId && interaction.member?.voice?.channelId === connectedChannelId);
}

function hasCommunityAccess(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  const roleId = guildSettings.community.managerRoleId;
  if (!roleId) return false;
  const roles = interaction.member?.roles;
  return Array.isArray(roles) ? roles.includes(roleId) : Boolean(roles?.cache?.has(roleId));
}
async function connectTo(channel, sourceChannelId) {
  activeListeningChannelId = sourceChannelId === channel.id ? null : sourceChannelId;
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
          activeListeningChannelId = null;
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
  console.log(`TTS engine=${config.voicevoxUrl}; /join実行チャンネルと接続VCのチャットを読み上げます`);
  console.log(`Supiki TTS provider=${config.supikiTtsProvider}${config.supikiTtsProvider === "gpt-sovits" ? ` (${config.gptSovitsUrl})` : ""}`);
  console.log(`入退室通知=${guildSettings.announceVoiceEvents}; URL読み=${guildSettings.linkSpeechMode}`);
  void announceBirthdaysForToday();
  void announceTodaysSeason();
  setInterval(() => void announceBirthdaysForToday(), 15_000);
  void announceWeeklyTopicIfDue();
  setInterval(() => void announceWeeklyTopicIfDue(), 60_000);
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

const weeklyTopics = [
  "最近遊んで「これは人におすすめしたい」と思ったゲームは？どこが好きでしたか？",
  "初めて遊ぶ人に、最初の1時間で知っておくと楽になることを教えるなら？",
  "最近ゲームで一番笑った出来事は？",
  "今一緒に遊ぶ人を探しているゲームはありますか？初心者歓迎・聞き専OKなども気軽にどうぞ。",
  "時間を忘れて遊んだゲームは何ですか？どんなところに夢中になりましたか？",
  "好きな協力プレイや、みんなで遊ぶと盛り上がるゲームを教えてください。",
  "積んでいるゲーム、また始めたいゲームはありますか？一緒に遊ぶ人がいたら始められそう？",
  "ゲーム内で好きな景色、音楽、キャラクターをひとつ紹介してください。",
  "初見でも参加しやすかったゲームや、遊びやすかった募集の雰囲気は？",
  "次の休みに誰かと遊ぶなら、何をやってみたいですか？",
  "最近覚えた小さなコツや、知って便利だった設定はありますか？",
  "対戦ゲームと協力ゲーム、今日はどちらの気分？理由もあればぜひ。",
];

function recruitmentPanelPayload() {
  return {
    embeds: [new EmbedBuilder()
      .setTitle("一緒に遊ぶ人を募集しよう")
      .setDescription("下のボタンから募集を作れます。ゲーム名・時間・募集人数・初心者歓迎かどうかを入力してください。募集を見た人は参加ボタンで表明できます。\n\n`@everyone` は使わず、気軽に募集してください。")
      .setColor(0x5865f2)],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("community:recruit:create").setLabel("募集を作る").setStyle(ButtonStyle.Primary),
    )],
  };
}

function recruitmentModal() {
  const modal = new ModalBuilder().setCustomId("community:recruit:submit").setTitle("ゲーム募集を作成");
  const fields = [
    new TextInputBuilder().setCustomId("game").setLabel("ゲーム名").setStyle(TextInputStyle.Short).setMaxLength(80).setRequired(true),
    new TextInputBuilder().setCustomId("when").setLabel("日時・集合時間").setStyle(TextInputStyle.Short).setPlaceholder("例：今日 21時ごろ / 11月8日 20:00").setMaxLength(100).setRequired(true),
    new TextInputBuilder().setCustomId("capacity").setLabel("募集人数（主催者を含む）").setStyle(TextInputStyle.Short).setPlaceholder("例：4").setMaxLength(2).setRequired(true),
    new TextInputBuilder().setCustomId("audience").setLabel("参加しやすさを選んで入力").setStyle(TextInputStyle.Short).setPlaceholder("初心者歓迎 / 誰でも / 経験者向け").setMaxLength(20).setRequired(true),
    new TextInputBuilder().setCustomId("details").setLabel("遊び方・補足（任意）").setStyle(TextInputStyle.Paragraph).setPlaceholder("聞き専OK、途中参加OK、やりたいモードなど").setMaxLength(800).setRequired(false),
  ];
  for (const field of fields) modal.addComponents(new ActionRowBuilder().addComponents(field));
  return modal;
}

function recruitmentMessagePayload(recruitment) {
  const attendees = recruitment.participants ?? [];
  const total = attendees.length + 1;
  const attendeeText = [`<@${recruitment.hostId}>`, ...attendees.map((id) => `<@${id}>`)].join("、");
  const description = [
    `**日時:** ${recruitment.when}`,
    `**参加しやすさ:** ${recruitment.audience}`,
    `**主催:** <@${recruitment.hostId}>`,
    `**参加:** ${total}/${recruitment.capacity}（${attendeeText}）`,
    recruitment.details ? `\n${recruitment.details}` : "",
  ].filter(Boolean).join("\n");
  const embed = new EmbedBuilder()
    .setTitle(`${recruitment.game} の募集${recruitment.closed ? "（締切）" : ""}`.slice(0, 256))
    .setDescription(description.slice(0, 4000))
    .setColor(recruitment.closed ? 0x747f8d : 0x57f287)
    .setFooter({ text: recruitment.closed ? "この募集は締め切られました" : "参加ボタンで参加・取り消しができます" });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`community:recruit:join:${recruitment.messageId}`)
      .setLabel(recruitment.closed ? "募集締切" : "参加 / 取り消し")
      .setStyle(ButtonStyle.Success)
      .setDisabled(recruitment.closed),
    new ButtonBuilder()
      .setCustomId(`community:recruit:close:${recruitment.messageId}`)
      .setLabel("募集を締め切る")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(recruitment.closed),
  );
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

function getJstDateTimeParts() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map(({ type, value }) => [type, value]));
  const weekday = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[values.weekday];
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day), hour: Number(values.hour), weekday };
}

const weeklyTopicRetryAt = { value: 0 };
async function announceWeeklyTopicIfDue() {
  const settings = guildSettings.community;
  if (!settings.topicChannelId) return;
  const now = getJstDateTimeParts();
  const today = `${now.year}-${String(now.month).padStart(2, "0")}-${String(now.day).padStart(2, "0")}`;
  if (now.weekday !== settings.topicDay || now.hour < settings.topicHour || settings.topicLastPostedDate === today
    || Date.now() - weeklyTopicRetryAt.value < 60_000) return;
  weeklyTopicRetryAt.value = Date.now();
  try {
    const channel = await client.channels.fetch(settings.topicChannelId);
    if (!channel?.isTextBased() || channel.guildId !== config.guildId) {
      throw new Error(`話題の投稿先が見つからないか、対象サーバー外です: ${settings.topicChannelId}`);
    }
    const topicList = settings.customTopics.length ? settings.customTopics : weeklyTopics;
    const topic = topicList[settings.topicIndex % topicList.length];
    await channel.send({
      embeds: [new EmbedBuilder()
        .setTitle("今週のゲーム話題")
        .setDescription(topic)
        .setColor(0x5865f2)
        .setFooter({ text: "答えやすい範囲でどうぞ。返信で気軽に話してください。" })],
      allowedMentions: { parse: [] },
    });
    settings.topicLastPostedDate = today;
    settings.topicIndex = (settings.topicIndex + 1) % topicList.length;
    saveGuildSettings();
    console.info(JSON.stringify({ event: "weekly_topic_posted", date: today, channelId: settings.topicChannelId }));
  } catch (error) {
    console.error("今週のゲーム話題を投稿できませんでした:", error.message);
  }
}

function pruneRecruitments() {
  const recruitments = guildSettings.community.recruitments;
  const entries = Object.entries(recruitments).sort((a, b) => a[1].createdAt - b[1].createdAt);
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const [id, entry] of entries) {
    if (!Number.isFinite(entry.createdAt) || entry.createdAt < cutoff) delete recruitments[id];
  }
  const remaining = Object.entries(recruitments).sort((a, b) => a[1].createdAt - b[1].createdAt);
  while (remaining.length > 100) delete recruitments[remaining.shift()[0]];
}

async function handleCommunityComponent(interaction) {
  if (interaction.isButton()) {
    const [scope, kind, action, messageId] = interaction.customId.split(":");
    if (scope !== "community") return false;
    if (kind === "recruit" && action === "create") {
      await interaction.showModal(recruitmentModal());
      return true;
    }
    if (kind !== "recruit" || !["join", "close"].includes(action) || !messageId) return false;
    const recruitment = guildSettings.community.recruitments[messageId];
    if (!recruitment || recruitment.guildId !== config.guildId) {
      await interaction.reply({ content: "この募集情報は見つからないか、期限切れです。", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (action === "close") {
      const canManage = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
      if (interaction.user.id !== recruitment.hostId && !canManage) {
        await interaction.reply({ content: "募集を締め切れるのは主催者かサーバー管理者です。", flags: MessageFlags.Ephemeral });
        return true;
      }
      recruitment.closed = true;
      saveGuildSettings();
      await interaction.update(recruitmentMessagePayload(recruitment));
      return true;
    }
    if (recruitment.closed) {
      await interaction.reply({ content: "この募集は締め切られています。", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (interaction.user.id === recruitment.hostId) {
      await interaction.reply({ content: "主催者はすでに参加者に含まれています。", flags: MessageFlags.Ephemeral });
      return true;
    }
    const participants = recruitment.participants ?? (recruitment.participants = []);
    const index = participants.indexOf(interaction.user.id);
    if (index >= 0) {
      participants.splice(index, 1);
      saveGuildSettings();
      await interaction.update(recruitmentMessagePayload(recruitment));
      return true;
    }
    if (participants.length + 1 >= recruitment.capacity) {
      await interaction.reply({ content: "この募集は満員です。", flags: MessageFlags.Ephemeral });
      return true;
    }
    participants.push(interaction.user.id);
    saveGuildSettings();
    await interaction.update(recruitmentMessagePayload(recruitment));
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId === "community:recruit:submit") {
    const audience = interaction.fields.getTextInputValue("audience").trim();
    if (!["初心者歓迎", "誰でも", "経験者向け"].includes(audience)) {
      await interaction.reply({ content: "参加しやすさは「初心者歓迎」「誰でも」「経験者向け」から選んで入力してください。", flags: MessageFlags.Ephemeral });
      return true;
    }
    const capacity = Number(interaction.fields.getTextInputValue("capacity").trim());
    if (!Number.isInteger(capacity) || capacity < 2 || capacity > 99) {
      await interaction.reply({ content: "募集人数は主催者を含めて2〜99人で入力してください。", flags: MessageFlags.Ephemeral });
      return true;
    }
    const channel = interaction.channel;
    if (!channel?.isTextBased() || channel.guildId !== config.guildId) {
      await interaction.reply({ content: "サーバー内のテキストチャンネルから募集を作成してください。", flags: MessageFlags.Ephemeral });
      return true;
    }
    const recruitment = {
      guildId: config.guildId,
      channelId: channel.id,
      hostId: interaction.user.id,
      game: interaction.fields.getTextInputValue("game").trim(),
      when: interaction.fields.getTextInputValue("when").trim(),
      capacity,
      audience,
      details: interaction.fields.getTextInputValue("details").trim(),
      participants: [],
      createdAt: Date.now(),
      closed: false,
    };
    const message = await channel.send(recruitmentMessagePayload({ ...recruitment, messageId: "pending" }));
    recruitment.messageId = message.id;
    await message.edit(recruitmentMessagePayload(recruitment));
    guildSettings.community.recruitments[message.id] = recruitment;
    pruneRecruitments();
    saveGuildSettings();
    await interaction.reply({ content: `募集を ${channel} に投稿しました。`, flags: MessageFlags.Ephemeral });
    return true;
  }
  return false;
}

client.on(Events.MessageCreate, (message) => {
  const connectedVoiceChannelId = getConnectedVoiceChannelId();
  const isConnectedVoiceChat = Boolean(connectedVoiceChannelId && message.channelId === connectedVoiceChannelId);
  const isListeningOnlyChat = Boolean(activeListeningChannelId && message.channelId === activeListeningChannelId);
  if (message.guildId !== config.guildId || (!isConnectedVoiceChat && !isListeningOnlyChat)) return;
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
    activeListeningChannelId = null;
    queue.clear();
    activeConnection.destroy();
    return;
  }
  const connectedVoiceChannelId = activeConnection?.joinConfig?.channelId;
  if (activeConnection && oldState.channelId === connectedVoiceChannelId && newState.channelId !== connectedVoiceChannelId) {
    const voiceChannel = oldState.guild.channels.cache.get(connectedVoiceChannelId);
    const hasHumanMembers = voiceChannel?.members.some((member) => !member.user.bot) ?? true;
    if (!hasHumanMembers && connection === activeConnection) {
      console.info(JSON.stringify({ event: "voice_auto_disconnect_empty", guildId: oldState.guild.id, channelId: connectedVoiceChannelId }));
      intentionalDisconnects.add(activeConnection);
      activeConnection.destroy();
      connection = null;
      activeListeningChannelId = null;
      queue.clear();
      return;
    }
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
        { type: "text", text: isJoining ? "になりました。" : "しました。" },
      ]
    : [{ type: "text", text: isJoining ? `${name}さんが来ました。` : `${name}さんが退出しました。` }];
  enqueueSegments({ segments, authorId: member.id });
});

client.on(Events.InteractionCreate, async (interaction) => {
  if ((interaction.isButton() || interaction.isModalSubmit()) && interaction.guildId === config.guildId) {
    try {
      await handleCommunityComponent(interaction);
    } catch (error) {
      console.error("コミュニティ機能エラー:", error);
      const content = "処理に失敗しました。Botの権限とチャンネル設定を確認してください。";
      if (interaction.deferred || interaction.replied) await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    return;
  }
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
    if (interaction.commandName === "community") {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === "access") {
        if (!(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false)) {
          await interaction.reply({ content: "使用できるロールを設定できるのはサーバー管理者です。", flags: MessageFlags.Ephemeral });
          return;
        }
        const role = interaction.options.getRole("role");
        guildSettings.community.managerRoleId = role?.id ?? null;
        saveGuildSettings();
        await interaction.reply({
          content: role
            ? `${role} とサーバー管理者が /community topics を使えるようになりました。/community panel は全メンバーが使えます。`
            : "追加の使用ロールを解除しました。今後はサーバー管理者のみ /community topics を使えます。/community panel は全メンバーが使えます。",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (subcommand === "prompts") {
        if (!hasCommunityAccess(interaction)) {
          await interaction.reply({ content: "話題を管理できるのはサーバー管理者または設定された使用ロールのメンバーです。", flags: MessageFlags.Ephemeral });
          return;
        }
        const action = interaction.options.getString("action", true);
        const topics = guildSettings.community.customTopics;
        if (action === "add") {
          const text = interaction.options.getString("text")?.trim();
          if (!text) {
            await interaction.reply({ content: "追加する話題を text に入力してください。", flags: MessageFlags.Ephemeral });
            return;
          }
          if (topics.length >= 30) {
            await interaction.reply({ content: "登録できる話題は30件までです。不要な話題を削除してから追加してください。", flags: MessageFlags.Ephemeral });
            return;
          }
          if (topics.some((topic) => topic.toLocaleLowerCase() === text.toLocaleLowerCase())) {
            await interaction.reply({ content: "同じ話題がすでに登録されています。", flags: MessageFlags.Ephemeral });
            return;
          }
          topics.push(text);
          saveGuildSettings();
          await interaction.reply({ content: `話題を追加しました（${topics.length}件）。登録した話題を週次投稿で順番に使います。`, flags: MessageFlags.Ephemeral });
          return;
        }
        if (action === "remove") {
          const index = interaction.options.getInteger("index");
          if (!index || index > topics.length) {
            await interaction.reply({ content: `削除する番号を1〜${topics.length}から選んでください。`, flags: MessageFlags.Ephemeral });
            return;
          }
          topics.splice(index - 1, 1);
          if (topics.length === 0) guildSettings.community.topicIndex = 0;
          else guildSettings.community.topicIndex %= topics.length;
          saveGuildSettings();
          await interaction.reply({ content: `話題 ${index} を削除しました。${topics.length ? `登録中: ${topics.length}件` : "登録話題がなくなったため、Bot内蔵の話題に戻ります。"}`, flags: MessageFlags.Ephemeral });
          return;
        }
        if (topics.length === 0) {
          await interaction.reply({ content: "独自の話題は未登録です。Bot内蔵の話題を投稿しています。`action:add` で追加できます。", flags: MessageFlags.Ephemeral });
          return;
        }
        const chunks = [];
        let chunk = "**週次投稿する話題**";
        for (const [index, topic] of topics.entries()) {
          const line = `${index + 1}. ${topic}`;
          if (chunk.length + line.length + 1 > 1800) {
            chunks.push(chunk);
            chunk = "";
          }
          chunk += `${chunk ? "\n" : ""}${line}`;
        }
        if (chunk) chunks.push(chunk);
        await interaction.reply({ content: chunks[0], flags: MessageFlags.Ephemeral });
        for (const followup of chunks.slice(1)) await interaction.followUp({ content: followup, flags: MessageFlags.Ephemeral });
        return;
      }
      if (subcommand === "topics-clear") {
        if (!hasCommunityAccess(interaction)) {
          await interaction.reply({ content: "週次話題の設定を解除できるのはサーバー管理者または設定された使用ロールのメンバーです。", flags: MessageFlags.Ephemeral });
          return;
        }
        guildSettings.community.topicChannelId = null;
        guildSettings.community.topicLastPostedDate = null;
        saveGuildSettings();
        await interaction.reply({
          content: "週次話題の自動投稿を停止しました。登録済みの独自話題は保存されています。再開するには `/community topics` を設定してください。",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (subcommand === "topics") {
        if (!hasCommunityAccess(interaction)) {
          await interaction.reply({ content: "話題設定はサーバー管理者または設定された使用ロールのメンバーが実行できます。", flags: MessageFlags.Ephemeral });
          return;
        }
        const channel = interaction.options.getChannel("channel", true);
        if (!channel.isTextBased() || channel.guildId !== config.guildId) {
          await interaction.reply({ content: "話題の投稿先にはサーバー内のテキストチャンネルを指定してください。", flags: MessageFlags.Ephemeral });
          return;
        }
        guildSettings.community.topicChannelId = channel.id;
        guildSettings.community.topicDay = interaction.options.getInteger("day", true);
        guildSettings.community.topicHour = interaction.options.getInteger("hour", true);
        saveGuildSettings();
        const weekday = ["日", "月", "火", "水", "木", "金", "土"][guildSettings.community.topicDay];
        await interaction.reply({
          content: `毎週${weekday}曜日 ${guildSettings.community.topicHour}:00（日本時間）に、${channel} へ話題を投稿します。`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (subcommand === "panel") {
        if (!interaction.channel?.isTextBased()) {
          await interaction.reply({ content: "募集ボタンはテキストチャンネルで設置してください。", flags: MessageFlags.Ephemeral });
          return;
        }
        const existingMessageId = guildSettings.community.recruitmentPanels[interaction.channelId];
        let panelMessage = existingMessageId
          ? await interaction.channel.messages.fetch(existingMessageId).catch(() => null)
          : null;
        const updated = Boolean(panelMessage);
        if (panelMessage) await panelMessage.edit(recruitmentPanelPayload());
        else {
          panelMessage = await interaction.channel.send(recruitmentPanelPayload());
          guildSettings.community.recruitmentPanels[interaction.channelId] = panelMessage.id;
          saveGuildSettings();
        }
        await interaction.reply({ content: `${updated ? "募集ボタンを更新しました" : "募集作成ボタンを設置しました"}: ${interaction.channel}`, flags: MessageFlags.Ephemeral });
        return;
      }
    }

    if (interaction.commandName === "help") {
      await interaction.reply({
        content: [
          "**読み上げBot コマンド一覧**",
          "`/join` — VCに接続。別VCへの接続先変更は管理者のみ。`/leave` — 同じVCの参加者か管理者が切断。",
          "`/say text:<文章>` — 文章を直接読み上げ。`/skip` — 接続中VCの参加者が再生中をスキップ。`/queue` — 待ち状況。",
          "`/status` — 音声接続、Engine/APIの応答、読み上げ設定、一時キャッシュを確認。",
          "`/setvoice speaker/speed/pitch` — 話者は名前から候補選択。`/speaker` — 話者変更。`/voice` — 自分の設定。`/voices page:<番号>` — 全話者一覧。",
          "`/supiki enabled:true/false` — 自分の投稿をスピキ風/通常に切替。",
          "`/supiki-language language:auto|ja|ko` — GPT-SoVITSの読み上げ言語を自分用に設定。",
          "`/dict add|remove|list` — 読み方辞書。読み上げ対象は `/join` を実行した聞き専チャンネルと、Botが接続中のVCチャットです。",
          "`/birthday set month day [channel]` — 誕生日とお祝い投稿先を登録。`/birthday list` — 一覧。`/birthday remove` — 自分の登録を削除。投稿は日本時間の日付が変わった後に行われます。",
          "`/season` — 今月のローテーションを表示。`/season year month schedule` — 月間予定を登録（管理者・設定ロール）。通知先の変更は管理者のみです。",
          "`/community access role:<ロール>` — 話題設定ロールを指定（管理者）。`/community topics` — 週1回の投稿先・時刻を設定。`/community topics-clear` — 自動投稿を停止。`/community prompts` — 投稿する話題を追加・一覧・削除。`/community panel` — 募集ボタンを設置（全メンバー）。話題設定・管理は管理者と設定ロールが使えます。",
          "設置されたボタンから募集を作成でき、参加者は参加ボタンで参加・取り消しを表明できます。",
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
      const sourceChannel = interaction.channel;
      if (!sourceChannel || ![ChannelType.GuildText, ChannelType.GuildVoice].includes(sourceChannel.type)) {
        await interaction.reply({ content: "`/join` は聞き専チャンネル、または読み上げたいVC内チャットで実行してください。", flags: MessageFlags.Ephemeral });
        return;
      }
      const sourceChannelId = sourceChannel.id;
      const connectedChannelId = getConnectedVoiceChannelId();
      if (connectedChannelId === channel.id && connection?.state.status === VoiceConnectionStatus.Ready) {
        activeListeningChannelId = sourceChannelId === channel.id ? null : sourceChannelId;
        const readSources = activeListeningChannelId ? `VC内チャットと <#${activeListeningChannelId}>` : "接続中VCのチャット";
        await interaction.reply({ content: `すでに ${channel.name} に接続しています。読み上げ対象: ${readSources}。`, flags: MessageFlags.Ephemeral });
        return;
      }
      if (connectedChannelId && connectedChannelId !== channel.id
        && !(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false)) {
        await interaction.reply({ content: "Botは別のボイスチャンネルで使用中です。接続先を変更できるのはサーバー管理権限を持つメンバーです。", flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await connectTo(channel, sourceChannelId);
      enqueueText({ text: "接続しました。", authorId: interaction.user.id });
      const readSources = activeListeningChannelId ? `VC内チャットと <#${activeListeningChannelId}>` : "接続中VCのチャット";
      await interaction.editReply(`${channel.name} に接続しました。読み上げ対象: ${readSources}。`);
      return;
    }

    if (interaction.commandName === "leave") {
      if ((connection || queue.size > 0) && !isInConnectedVoiceChannel(interaction)
        && !(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false)) {
        await interaction.reply({ content: "Botが接続中のボイスチャンネルに参加している場合に `/leave` を使えます。", flags: MessageFlags.Ephemeral });
        return;
      }
      queue.clear();
      if (connection) {
        intentionalDisconnects.add(connection);
        connection.destroy();
      }
      connection = null;
      activeListeningChannelId = null;
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

    if (interaction.commandName === "status") {
      const [voicevoxStatus, gptSovitsStatus] = await Promise.all([
        probeEndpoint(config.voicevoxUrl, { path: "/version" }),
        probeEndpoint(config.gptSovitsUrl, { path: "/docs" }),
      ]);
      const channelId = connection?.joinConfig?.channelId;
      const channel = channelId ? client.channels.cache.get(channelId) : null;
      const connectionLabel = connection?.state.status === VoiceConnectionStatus.Ready
        ? `接続中${channel ? `（${channel.name}）` : ""}`
        : connection ? `接続状態: ${connection.state.status}` : "未接続";
      const language = gptSovitsLanguageByUser.get(interaction.user.id) ?? config.gptSovitsTextLanguage;
      const mode = supikiUsers.has(interaction.user.id)
        ? config.supikiTtsProvider === "gpt-sovits"
          ? `GPT-SoVITS（${language}）`
          : `VOICEVOXスピキ調整（話者 ${config.supikiSpeakerId}）`
        : `VOICEVOX話者 ${voicePreferencesByUser.get(interaction.user.id)?.speakerId ?? config.defaultSpeakerId}`;
      const cache = gptSovitsTts.audioCache.stats;
      const cacheMiB = (cache.bytes / (1024 * 1024)).toFixed(1);
      const content = [
        `音声接続: ${connectionLabel}`,
        `あなたの読み上げ: ${mode}`,
        `待ち列: ${queue.size}件`,
        formatEndpointStatus("VOICEVOX Engine", voicevoxStatus),
        formatEndpointStatus("GPT-SoVITS API", gptSovitsStatus),
        `GPT-SoVITS一時キャッシュ: ${cache.entries}/${cache.maxEntries}件、${cacheMiB}/${(cache.maxBytes / (1024 * 1024)).toFixed(0)} MiB（メモリ内）`,
      ].join("\n");
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.commandName === "skip") {
      if (!isInConnectedVoiceChannel(interaction)) {
        await interaction.reply({ content: "Botが接続中のボイスチャンネルに参加している場合に `/skip` を使えます。", flags: MessageFlags.Ephemeral });
        return;
      }
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

    if (interaction.commandName === "supiki-language") {
      const language = interaction.options.getString("language", true);
      if (!["auto", "ja", "ko"].includes(language)) {
        await interaction.reply({ content: "言語は auto、ja、ko から選択してください。", flags: MessageFlags.Ephemeral });
        return;
      }
      supikiUsers.add(interaction.user.id);
      gptSovitsLanguageByUser.set(interaction.user.id, language);
      guildSettings.gptSovitsLanguages[interaction.user.id] = language;
      saveGuildSettings();
      const languageLabel = { auto: "自動判定", ja: "日本語", ko: "韓国語" }[language];
      await interaction.reply({
        content: `GPT-SoVITSの読み上げ言語を${languageLabel}に設定し、スピキモードをONにしました。通常のVOICEVOXへ戻すには /supiki enabled:false を実行してください。`,
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
        content: `話者: ${speakerLabel}\n速度: ${preference.speedScale ?? 1}\n高さ: ${preference.pitchScale ?? 0}\nスピキ風モード: ${supikiUsers.has(interaction.user.id) ? "ON" : "OFF"}\nGPT-SoVITS言語: ${{ auto: "自動", ja: "日本語", ko: "韓国語" }[gptSovitsLanguageByUser.get(interaction.user.id) ?? config.gptSovitsTextLanguage]}`,
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
      const canManageCommunity = hasCommunityAccess(interaction);

      if (channelOption && !canManage) {
        await interaction.reply({ content: "通知先を設定できるのはサーバー管理権限を持つメンバーです。", flags: MessageFlags.Ephemeral });
        return;
      }
      if (channelOption && !channelOption.isTextBased()) {
        await interaction.reply({ content: "通知先にはテキストチャンネルを指定してください。", flags: MessageFlags.Ephemeral });
        return;
      }
      if (scheduleText !== null) {
        if (!canManageCommunity) {
          await interaction.reply({ content: "月間予定を更新できるのはサーバー管理者または設定された使用ロールのメンバーです。", flags: MessageFlags.Ephemeral });
          return;
        }
        if (yearOption === null || monthOption === null) {
          await interaction.reply({ content: "予定を登録するときは year と month を両方指定してください。", flags: MessageFlags.Ephemeral });
          return;
        }
        const channel = channelOption
          ?? (canManage ? interaction.channel : guildSettings.seasonChannelId ? await client.channels.fetch(guildSettings.seasonChannelId).catch(() => null) : null);
        if (!channel?.isTextBased() || channel.guildId !== config.guildId) {
          await interaction.reply({ content: canManage
            ? "通知先にできるサーバー内のテキストチャンネルを選んでください。"
            : "ステージ通知先が未設定です。先に管理者が /season channel で通知先を設定してください。", flags: MessageFlags.Ephemeral });
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

