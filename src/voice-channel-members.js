export function hasHumanVoiceMember(guild, channelId, botUserId) {
  const voiceStates = guild?.voiceStates?.cache;
  if (!voiceStates) return true;

  return voiceStates.some((state) => {
    if (state.channelId !== channelId || state.id === botUserId) return false;
    const member = state.member ?? guild.members?.cache?.get(state.id);
    // If Discord has a voice state but its member is not cached, count it as a
    // human conservatively so a cache gap cannot disconnect the bot early.
    return !member?.user?.bot;
  });
}
