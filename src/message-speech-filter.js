const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>]+|\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s<>]*)?/giu;

export function markLinksForSpeech(text) {
  return text
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|www\.)[^)\s]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^)\s]*)?)\)/giu, "$1 リンク省略")
    .replace(/<(?:(?:https?:\/\/)|www\.)[^>]+>/giu, "リンク省略")
    .replace(URL_PATTERN, "リンク省略")
    .replace(/(?:リンク省略\s*){2,}/giu, "リンク省略 ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function getMessageTextForSpeech(message) {
  let text = typeof message?.cleanContent === "string" ? message.cleanContent : "";
  const attachments = message?.attachments;
  if (!attachments) return text;

  const entries = typeof attachments.values === "function" ? attachments.values() : [];
  let hasImage = false;
  let hasOtherFile = false;
  for (const attachment of entries) {
    for (const url of [attachment?.url, attachment?.proxyURL]) {
      if (typeof url === "string" && url) text = text.split(url).join("");
    }
    const isImage = attachment?.contentType?.startsWith("image/")
      || /\.(?:avif|bmp|gif|jpe?g|png|svg|tiff?|webp)$/iu.test(attachment?.name ?? "");
    if (isImage) hasImage = true;
    else hasOtherFile = true;
  }
  if (hasImage) text = `${text} 画像ファイルが添付されました`;
  if (hasOtherFile) text = `${text} 添付ファイルが送信されました`;
  return text.trim();
}
