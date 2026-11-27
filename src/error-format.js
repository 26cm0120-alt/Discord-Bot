const MAX_CAUSE_DEPTH = 8;
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/giu;

function redactUrls(value) {
  return value.replace(URL_PATTERN, "[URL省略]");
}

function readMessage(error) {
  if (typeof error === "string") return error;
  return typeof error?.message === "string" ? error.message : "";
}

function readCode(error) {
  const code = error?.code;
  if ((typeof code === "string" || typeof code === "number") && /^[A-Z0-9_:-]+$/iu.test(String(code))) {
    return String(code);
  }
  return "";
}

export function formatErrorForLog(error) {
  const details = [];
  const seen = new Set();
  let current = error;
  let depth = 0;

  while (current != null && depth < MAX_CAUSE_DEPTH) {
    if ((typeof current === "object" || typeof current === "function") && seen.has(current)) break;
    if (typeof current === "object" || typeof current === "function") seen.add(current);

    const message = redactUrls(readMessage(current)).trim();
    const code = readCode(current);
    const detail = [message || "エラー詳細なし", code ? `code=${redactUrls(code)}` : ""].filter(Boolean).join(" ");
    details.push(depth === 0 ? detail : `cause ${depth}: ${detail}`);
    current = current?.cause;
    depth += 1;
  }

  return details.join(" | ") || "不明なエラー";
}
