# 1サーバー専用 Discord 読み上げBot

Node.js の Bot と VOICEVOX Engine を同じ Linux VPS 上で動かす、小規模サーバー向けの初期版です。Docker Compose の内部ネットワークで接続し、VOICEVOX API のポートはインターネットへ公開しません。メッセージ本文をログやDBに保存せず、受信から合成・再生開始までの時間だけを記録します。

「遅延ゼロ」は保証できません。Discordの音声経路、回線、マシン負荷、VOICEVOXの合成時間に左右されるためです。この実装では `/queue` と標準出力の計測値で、待ち時間を分解して確認します。

## 機能

- `.env` で指定した複数のテキストチャンネルを読み上げる
- `/join` `/leave` `/say` `/skip` `/queue` `/speaker` コマンド
- 読み上げ待ち列の上限と、同じ文章・話者の音声キャッシュ
- 受信から再生開始までの待ち、合成時間、合計時間の計測
- メッセージ本文を保存しない。ログにも本文を出さない

## 必要なもの

- Node.js 24.17 以上
- Discord Developer Portal のアプリ/Bot
- Docker Engine と Docker Compose が使える Linux VPS

VOICEVOX Engine は公式 CPU コンテナを使用します。VPSのCPU性能によって合成速度が変わるため、まずは小さな文章で計測し、遅延が大きい場合はVPSのCPU/RAMを増やしてください。使用する話者の利用規約とクレジット表記も確認してください。

## セットアップ

1. Discord Developer Portalでアプリを作り、Bot Tokenを発行します。
2. Botの **Message Content Intent** を有効にします。自分の1サーバーだけで使う場合も、テキスト投稿本文を読む用途で必要です。
3. Botを対象サーバーに招待し、対象テキストチャンネルの閲覧・メッセージ履歴閲覧と、ボイスチャンネルの接続・発言権限を付けます。
4. `.env.example` はローカル起動用の雛形です。ローカルで試す場合だけ `.env` にコピーして、`DISCORD_TOKEN`、`CLIENT_ID`、`GUILD_ID`、`TEXT_CHANNEL_IDS` を設定します。`TEXT_CHANNEL_IDS` はカンマ区切りで複数登録できます。例: `TEXT_CHANNEL_IDS=聞き専チャンネルID,別の聞き専チャンネルID,ボイスチャンネルID`
5. `npm install` を実行します。
6. `npm run deploy:commands` で対象サーバー限定コマンドを登録します。
7. `npm start` を実行し、Discordで `/join` を使います。

ローカル起動ではVOICEVOX Engineを同じマシンで動かし、EngineをLANや外部に公開しないでください。

## VPSへのデプロイ

1. Linux VPSにDocker EngineとDocker Composeを用意し、SSH接続用ユーザーが `/opt/discord-tts-bot` を書き込めるようにします。
2. GitHubの **Settings → Secrets and variables → Actions** で次のRepository secretsを登録します: `DISCORD_TOKEN`（必ず再生成した新しいBotトークン）、`VPS_HOST`、`VPS_USER`、`VPS_SSH_KEY`、`VPS_KNOWN_HOSTS`。
3. 同じ画面の **Variables** に `CLIENT_ID`、`GUILD_ID`、`TEXT_CHANNEL_IDS`、`VOICEVOX_SPEAKER_ID` を登録します。`TEXT_CHANNEL_IDS` はカンマ区切りです。
4. **Actions → Deploy Discord TTS bot → Run workflow** を実行します。ワークフローはSSH経由でコードと`.env`をVPSへ送り、`docker compose up -d --build`で起動します。`.env`はVPS上で権限を制限して保存され、GitHubにはコミットされません。

このリポジトリは公開設定です。デプロイワークフローは `workflow_dispatch` のみで、Pull Requestでは実行しません。GitHub Actions Secretは実行時にワークフローが参照するための保管場所です。`.env.example`は必須ではありませんが、必要な設定項目を示す安全な雛形として残しています。実トークンは書き込まないでください。

## 遅延の見方

`/queue` とBotのログに次の内訳が出ます。

- `queueWaitMs`: メッセージ受信から合成開始まで
- `synthesisMs`: VOICEVOXの合成時間
- `playbackStartMs`: メッセージ受信から音声プレイヤーが再生を始めるまで

`queueWaitMs` が長い場合は読み上げ列が原因です。`synthesisMs` が長い場合はマシン負荷、話者・文章長、Engine側が原因です。`playbackStartMs`だけが長い場合は接続や音声送信経路を調べます。

## オリジナル機能の初期案

- `/queue`: 待ち数と遅延内訳を表示
- `/skip`: 再生中の文章をスキップ
- `/speaker`: メンバーごとに話者を選ぶ

次に追加しやすい候補は、読み上げの割り込み、NGワード/読み飛ばし、辞書登録コマンド、時間帯ごとの読み上げ速度です。機能は利用者の好みに合わせて追加してください。

## 制限と次の改善

- 話者IDはメンバーごとにメモリ上で保持するため、Bot再起動で初期化されます。
- 待ち列もメモリ上です。停止・再起動で消えます。
- VOICEVOX Engineが停止した場合は読み上げできません。
- Botが参加した後、`.env` で指定したテキストチャンネルだけを読み上げます。
- 読み上げ元が複数でも、音声の出力先は `/join` で接続したボイスチャンネル1つです。ボイスチャンネル内チャットも読み上げる場合、そのボイスチャンネルのIDを `TEXT_CHANNEL_IDS` に加えます。同チャット用に別のチャンネルIDを作る必要はありません。
- より短い初動時間が必要なら、VOICEVOXの `/streaming_synthesis` とストリーム音声再生への変更を検討します。まずは現在の内訳を測り、合成待ちと接続待ちを分けてから最適化します。

## GitHub Actions とBotトークン

`.env.example` の `DISCORD_TOKEN=replace_me` は記入例なので公開して問題ありません。実際のトークンは記入しないでください。VPSデプロイではGitHub Actions SecretからVPSへ渡し、VPS上の`.env`に保存します。Actions Secretはワークフロー実行中のみ利用可能で、公開リポジトリのフォークPull Requestには渡されません。

