export async function probeEndpoint(url, { timeoutMs = 1500, path = "" } = {}) {
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}${path}`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { reachable: response.status < 500, status: response.status };
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    return { reachable: false, reason: timedOut ? "timeout" : "unavailable" };
  }
}

export function formatEndpointStatus(label, result) {
  if (!result.reachable) {
    return `${label}: 応答なし${result.reason === "timeout" ? "（タイムアウト）" : ""}`;
  }
  return result.status === 200
    ? `${label}: 正常応答`
    : `${label}: HTTP ${result.status}（サーバー応答あり）`;
}
