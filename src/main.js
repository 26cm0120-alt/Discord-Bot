import "dotenv/config";
import {
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
  textChannelIds: new Set((process.env.TEXT_CHANNEL_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean)),
  voicevoxUrl: process.env.VOICEVOX_URL ?? "http://127.0.0.1:50021",
  defaultSpeakerId: Number(process.env.VOICEVOX_SPEAKER_ID ?? 1),
  maxMessageChars: Number(process.env.MAX_MESSAGE_CHARS ?? 240),
  maxQueueItems: Number(process.env.MAX_QUEUE_ITEMS ?? 30),
  voiceReadyTimeoutMs: Number(process.env.VOICE_READY_TIMEOUT_MS ?? 15000),
};
if (!config.token || !config.guildId || config.textChannelIds.size === 0) {
  throw new Error(".env の DISCORD_TOKEN, GUILD_ID, TEXT_CHANNEL_IDS を設定してください。");
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
const speakersByUser = new Map();
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

function enqueueText({ text, authorId, receivedAt = Date.now() }) {
  const normalized = text.replace(/\s+/g, " ").trim().slice(0, config.maxMessageChars);
  if (!normalized) return { accepted: false, position: null };
  return queue.enqueue({
    text: normalized,
    authorId,
    receivedAt,
    speakerId: speakersByUser.get(authorId) ?? config.defaultSpeakerId,
  });
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Bot起動: ${readyClient.user.tag}; 対象サーバー=${config.guildId}`);
  console.log(`TTS engine=${config.voicevoxUrl}; text channels=${[...config.textChannelIds].join(",")}`);
});

client.on(Events.MessageCreate, (message) => {
  if (message.guildId !== config.guildId || !config.textChannelIds.has(message.channelId)) return;
  if (message.author.bot || !connection || connection.state.status !== VoiceConnectionStatus.Ready) return;

  const text = message.cleanContent;
  if (!text) return;
  const result = enqueueText({ text, authorId: message.author.id, receivedAt: Date.now() });
  if (!result.accepted) {
    console.warn(JSON.stringify({ event: "queue_full", guildId: message.guildId }));
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.guildId !== config.guildId) return;

  try {
    if (interaction.commandName === "join") {
      const channel = interaction.member.voice?.channel;
      if (!channel) {
        await interaction.reply({ content: "先にボイスチャンネルに入ってください。", flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await connectTo(channel);
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
      const text = interaction.options.getString("text", true);
      const result = enqueueText({ text, authorId: interaction.user.id });
      await interaction.reply({
        content: result.accepted ? `読み上げ列に追加しました（${result.position}番目）。` : "読み上げ列がいっぱいです。少し待ってから試してください。",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.commandName === "speaker") {
      const speakerId = interaction.options.getInteger("id", true);
      speakersByUser.set(interaction.user.id, speakerId);
      await interaction.reply({ content: `このサーバーでのあなたの話者IDを ${speakerId} に設定しました。`, flags: MessageFlags.Ephemeral });
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

