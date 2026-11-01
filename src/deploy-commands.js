import "dotenv/config";
import { REST, Routes, SlashCommandBuilder } from "discord.js";

const commands = [
  new SlashCommandBuilder().setName("join").setDescription("実行者がいるボイスチャンネルに接続します"),
  new SlashCommandBuilder().setName("leave").setDescription("読み上げを停止して切断します"),
  new SlashCommandBuilder().setName("queue").setDescription("読み上げ待ち件数と直近の遅延を表示します"),
  new SlashCommandBuilder().setName("skip").setDescription("再生中の文章をスキップします"),
  new SlashCommandBuilder()
    .setName("say")
    .setDescription("入力した文章を読み上げます")
    .addStringOption((option) => option.setName("text").setDescription("読み上げる文章").setRequired(true).setMaxLength(240)),
  new SlashCommandBuilder()
    .setName("speaker")
    .setDescription("自分の読み上げ話者を変更します")
    .addIntegerOption((option) => option.setName("id").setDescription("VOICEVOXのspeaker ID").setRequired(true).setMinValue(0)),
].map((command) => command.toJSON());

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  throw new Error("DISCORD_TOKEN, CLIENT_ID, GUILD_ID を .env に設定してください。");
}

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
console.log("サーバー専用スラッシュコマンドを登録しました。");
