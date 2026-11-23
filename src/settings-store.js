import {
  copyFileSync,
  constants as fsConstants,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

function createTemporaryPath(filePath, label) {
  return `${filePath}.${label}-${process.pid}-${randomUUID()}.tmp`;
}

function parseSettings(contents, filePath) {
  const value = JSON.parse(contents);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`設定ファイルの最上位はオブジェクトである必要があります: ${filePath}`);
  }
  return value;
}

function writeAtomically(filePath, contents) {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporaryPath = createTemporaryPath(filePath, "write");
  try {
    writeFileSync(temporaryPath, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
    renameSync(temporaryPath, filePath);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

export function loadSettings(filePath) {
  const backupPath = `${filePath}.bak`;
  if (!existsSync(filePath)) {
    if (!existsSync(backupPath)) return {};
    const backupContents = readFileSync(backupPath, "utf8");
    const backupSettings = parseSettings(backupContents, backupPath);
    writeAtomically(filePath, backupContents);
    console.error(`設定ファイルが見つからないため、バックアップから復旧しました: ${filePath}`);
    return backupSettings;
  }

  let currentContents;
  try {
    currentContents = readFileSync(filePath, "utf8");
    return parseSettings(currentContents, filePath);
  } catch (currentError) {
    if (!existsSync(backupPath)) {
      throw new Error(
        `設定ファイルを読み込めず、バックアップもありません。元ファイルを保持しました: ${filePath}`,
        { cause: currentError },
      );
    }

    let backupContents;
    let backupSettings;
    try {
      backupContents = readFileSync(backupPath, "utf8");
      backupSettings = parseSettings(backupContents, backupPath);
    } catch (backupError) {
      throw new Error(
        `設定ファイルとバックアップの両方を読み込めません。両方のファイルを保持しました: ${filePath}`,
        { cause: backupError },
      );
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const damagedPath = `${filePath}.corrupt-${timestamp}`;
    renameSync(filePath, damagedPath);
    writeAtomically(filePath, backupContents);
    console.error(`設定ファイルが破損していたため、バックアップから復旧しました。破損ファイル: ${damagedPath}`);
    return backupSettings;
  }
}

export function saveSettings(filePath, settings) {
  mkdirSync(dirname(filePath), { recursive: true });
  const contents = `${JSON.stringify(settings, null, 2)}\n`;
  const temporaryPath = createTemporaryPath(filePath, "write");
  const backupPath = `${filePath}.bak`;
  const backupTemporaryPath = createTemporaryPath(backupPath, "copy");

  try {
    writeFileSync(temporaryPath, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
    if (existsSync(filePath)) {
      parseSettings(readFileSync(filePath, "utf8"), filePath);
      copyFileSync(filePath, backupTemporaryPath, fsConstants.COPYFILE_EXCL);
      chmodSync(backupTemporaryPath, 0o600);
      renameSync(backupTemporaryPath, backupPath);
    }
    renameSync(temporaryPath, filePath);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    rmSync(backupTemporaryPath, { force: true });
    throw error;
  }
}
