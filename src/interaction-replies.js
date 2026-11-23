import { MessageFlags } from "discord.js";

export async function replyPrivateError(interaction, content) {
  const payload = { content, flags: MessageFlags.Ephemeral };
  try {
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
    else await interaction.reply(payload);
  } catch (error) {
    console.warn("非公開のエラー応答を送信できません:", error.message);
  }
}
