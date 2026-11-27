import { formatErrorForLog } from "./error-format.js";

export async function logVoicevoxConnectionCheck(voicevoxClient, logger = console) {
  try {
    await voicevoxClient.checkConnection();
    logger.info("VOICEVOX接続確認: 成功");
    return true;
  } catch (error) {
    logger.error("VOICEVOX接続確認エラー:", formatErrorForLog(error));
    return false;
  }
}
