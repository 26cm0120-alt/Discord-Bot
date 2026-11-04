import "dotenv/config";
import { ChannelType, PermissionFlagsBits, REST, Routes, SlashCommandBuilder } from "discord.js";

const admin = PermissionFlagsBits.ManageGuild;
const commands = [
  new SlashCommandBuilder().setName("community").setDescription("話題投稿と募集パネルを設定します")
    .addSubcommand((subcommand) => subcommand.setName("access").setDescription("話題・募集機能を使えるロールを設定します（管理者）")
      .addRoleOption((option) => option.setName("role").setDescription("使用を許可するロール。省略すると管理者のみになります")))
    .addSubcommand((subcommand) => subcommand.setName("prompts").setDescription("週次投稿する話題を管理します")
      .addStringOption((option) => option.setName("action").setDescription("操作").addChoices(
        { name: "話題を追加", value: "add" }, { name: "一覧を見る", value: "list" }, { name: "話題を削除", value: "remove" },
      ).setRequired(true))
      .addStringOption((option) => option.setName("text").setDescription("追加する話題（300文字以内）").setMaxLength(300))
      .addIntegerOption((option) => option.setName("index").setDescription("一覧に表示された番号").setMinValue(1).setMaxValue(30)))
    .addSubcommand((subcommand) => subcommand.setName("topics").setDescription("週1回の話題投稿を設定します")
      .addChannelOption((option) => option.setName("channel").setDescription("話題を投稿するチャンネル").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
      .addIntegerOption((option) => option.setName("day").setDescription("曜日（日本時間）").addChoices(
        { name: "日曜日", value: 0 }, { name: "月曜日", value: 1 }, { name: "火曜日", value: 2 }, { name: "水曜日", value: 3 },
        { name: "木曜日", value: 4 }, { name: "金曜日", value: 5 }, { name: "土曜日", value: 6 },
      ).setRequired(true))
      .addIntegerOption((option) => option.setName("hour").setDescription("投稿時刻（日本時間の0〜23時）").setMinValue(0).setMaxValue(23).setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName("topics-clear").setDescription("週次話題の自動投稿設定を解除します"))
    .addSubcommand((subcommand) => subcommand.setName("panel").setDescription("このチャンネルに募集作成ボタンを設置します")),
  new SlashCommandBuilder().setName("join").setDescription("VCに接続し、実行チャンネルを読み上げ元にします"),
  new SlashCommandBuilder().setName("help").setDescription("読み上げBotのコマンド一覧を表示します"),
  new SlashCommandBuilder().setName("leave").setDescription("読み上げを停止して切断します（同じVCの参加者または管理者）"),
  new SlashCommandBuilder().setName("queue").setDescription("読み上げ待ち件数と直近の遅延を表示します"),
  new SlashCommandBuilder().setName("status").setDescription("Bot、音声接続、音声エンジンの状態を確認します"),
  new SlashCommandBuilder().setName("skip").setDescription("接続中VCの参加者が再生中の文章をスキップします"),
  new SlashCommandBuilder()
    .setName("say")
    .setDescription("入力した文章を読み上げます")
    .addStringOption((option) => option.setName("text").setDescription("読み上げる文章").setRequired(true).setMaxLength(240)),
  new SlashCommandBuilder()
    .setName("speaker")
    .setDescription("自分の読み上げ話者を変更します")
    .addStringOption((option) => option.setName("speaker").setDescription("話者名・スタイル名で検索して選択").setRequired(true).setAutocomplete(true)),
  new SlashCommandBuilder()
    .setName("setvoice")
    .setDescription("自分の話者・速度・高さを調整します")
    .addStringOption((option) => option.setName("speaker").setDescription("話者名・スタイル名で検索して選択").setAutocomplete(true))
    .addNumberOption((option) => option.setName("speed").setDescription("速度（0.5〜2.0、初期値1.0）").setMinValue(0.5).setMaxValue(2.0))
    .addNumberOption((option) => option.setName("pitch").setDescription("高さ（-0.15〜0.15、初期値0）").setMinValue(-0.15).setMaxValue(0.15)),
  new SlashCommandBuilder().setName("voice").setDescription("自分の現在の音声設定を表示します"),
  new SlashCommandBuilder().setName("voices").setDescription("VOICEVOXの話者名一覧をページ表示します")
    .addIntegerOption((option) => option.setName("page").setDescription("表示するページ番号（1ページ15種類）").setMinValue(1)),
  new SlashCommandBuilder()
    .setName("supiki")
    .setDescription("自分の読み上げをスピキ風モードに切り替えます")
    .addBooleanOption((option) => option.setName("enabled").setDescription("trueで有効、falseで通常モードに戻します").setRequired(true)),
  new SlashCommandBuilder()
    .setName("supiki-language")
    .setDescription("自分のGPT-SoVITS読み上げ言語を変更します")
    .addStringOption((option) => option.setName("language").setDescription("読み上げ言語")
      .addChoices(
        { name: "自動判定", value: "auto" },
        { name: "日本語", value: "ja" },
        { name: "韓国語", value: "ko" },
      ).setRequired(true)),
  new SlashCommandBuilder()
    .setName("dict")
    .setDescription("読み上げ辞書を管理します（管理者）")
    .addSubcommand((subcommand) => subcommand.setName("add").setDescription("単語の読み方を登録します")
      .addStringOption((option) => option.setName("word").setDescription("置き換える単語").setRequired(true).setMaxLength(80))
      .addStringOption((option) => option.setName("reading").setDescription("読み上げる文字").setRequired(true).setMaxLength(120)))
    .addSubcommand((subcommand) => subcommand.setName("remove").setDescription("辞書から単語を削除します")
      .addStringOption((option) => option.setName("word").setDescription("削除する単語").setRequired(true).setMaxLength(80)))
    .addSubcommand((subcommand) => subcommand.setName("list").setDescription("登録済み辞書を表示します"))
    .setDefaultMemberPermissions(admin),
  new SlashCommandBuilder()
    .setName("setting")
    .setDescription("読み上げ設定を変更・表示します（管理者）")
    .addBooleanOption((option) => option.setName("announcements").setDescription("入退室通知のON/OFF"))
    .addStringOption((option) => option.setName("links").setDescription("URLの読み方")
      .addChoices({ name: "URLを省略", value: "omit" }, { name: "ドメインだけ読む", value: "domain" }, { name: "URL全体を読む", value: "keep" }))
    .setDefaultMemberPermissions(admin),
  new SlashCommandBuilder()
    .setName("birthday")
    .setDescription("誕生日を登録して当日にお祝いを投稿します")
    .addSubcommand((subcommand) => subcommand.setName("set").setDescription("自分の誕生日を登録・変更します")
      .addIntegerOption((option) => option.setName("month").setDescription("誕生月（1〜12）").setRequired(true).setMinValue(1).setMaxValue(12))
      .addIntegerOption((option) => option.setName("day").setDescription("誕生日の日（1〜31）").setRequired(true).setMinValue(1).setMaxValue(31))
      .addChannelOption((option) => option.setName("channel").setDescription("お祝いを投稿するチャンネル（省略時はこのチャンネル）").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice)))
    .addSubcommand((subcommand) => subcommand.setName("remove").setDescription("自分の誕生日登録を削除します"))
    .addSubcommand((subcommand) => subcommand.setName("list").setDescription("登録済みの誕生日一覧を表示します")),
  new SlashCommandBuilder()
    .setName("season")
    .setDescription("ゲームのステージローテーションを表示・更新します")
    .addIntegerOption((option) => option.setName("year").setDescription("対象年（省略時は現在の年）").setMinValue(2020).setMaxValue(2100))
    .addIntegerOption((option) => option.setName("month").setDescription("対象月（省略時は現在の月）").setMinValue(1).setMaxValue(12))
    .addStringOption((option) => option.setName("schedule").setDescription("日付: ステージ1、ステージ2 の形式で1日ずつ入力すると月間予定を更新").setMaxLength(4000))
    .addChannelOption((option) => option.setName("channel").setDescription("毎日の通知先（更新時、省略すると実行チャンネル）").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice)),
].map((command) => command.toJSON());

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  throw new Error("DISCORD_TOKEN, CLIENT_ID, GUILD_ID を .env に設定してください。");
}

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
console.log("サーバー専用スラッシュコマンドを登録しました。");
