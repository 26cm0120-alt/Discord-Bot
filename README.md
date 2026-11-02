# Discord読み上げBot

Windows PC上でDiscord BotとVOICEVOXを動かす、1サーバー向けの読み上げBotです。GPT-SoVITSを使う場合も同じPCで起動できます。現在の標準構成では、OCI VPSやDockerは使いません。

GitHubはコードの保管と更新に使います。Botの実行にGitHub Actionsは必要ありません。Discordトークンなどの秘密情報はPC内の `.env` にだけ保存してください。`.env`、`.bot-settings.json`、GPT-SoVITSの参照音声はGit管理対象外です。

## 目次

- [運用構成](#運用構成)
- [初回セットアップ](#初回セットアップ)
- [起動と更新](#起動と更新)
- [機能とコマンド](#機能とコマンド)
- [GPT-SoVITSを使う（任意）](#gpt-sovitsを使う任意)
- [遅延の確認と制限](#遅延の確認と制限)
- [VPS運用を再開するとき（現在保留）](#vps運用を再開するとき現在保留)

## 運用構成

| 部品 | 実行場所 | 用途 |
|---|---|---|
| Discord Bot | Windows PC | Discordからメッセージを受け取り、音声を再生 |
| VOICEVOX Engine | 同じPC | 通常の読み上げ音声を合成 |
| GPT-SoVITS | 同じPC（任意） | スピキモードの音声を合成 |
| GitHub | コード保管・更新 | ソースコードを取得・更新 |

VOICEVOX Engineは `http://127.0.0.1:50021` でBotから接続します。APIをLANやインターネットに公開しないでください。PCがスリープまたは電源オフになるとBotも停止します。

## 初回セットアップ

### 必要なもの

- Windows 10/11
- Node.js 24.17以上
- Git
- Windows版VOICEVOX（最初はCPU版がおすすめ）
- Discord Developer PortalのアプリとBot
- GPT-SoVITS（スピキモードを使う場合のみ）

### 1. Discord Botを準備する

1. Discord Developer PortalでアプリとBotを作成し、Botトークンを発行します。
2. Bot設定の **Message Content Intent** を有効にします。投稿本文を読み上げるために必要です。
3. Botを対象サーバーへ招待し、テキストチャンネルの閲覧・メッセージ履歴閲覧と、ボイスチャンネルの接続・発言を許可します。

### 2. コードを取得する

PowerShellで次を実行します。

```powershell
Set-Location "$env:USERPROFILE\Documents"
git clone https://github.com/26cm0120-alt/Discord-Bot.git
Set-Location .\Discord-Bot
npm ci
```

### 3. `.env`を設定する

雛形を作り、メモ帳で開きます。

```powershell
Copy-Item .env.example .env
notepad .env
```

次の値を設定してください。

- `DISCORD_TOKEN`: Botトークン
- `CLIENT_ID`: Developer Portalに表示されるアプリケーションID
- `GUILD_ID`: 対象サーバーID
- `TEXT_CHANNEL_IDS`: 読み上げるテキストチャンネルID（複数はカンマ区切り）

ボイスチャンネル内チャットも読み上げる場合は、そのボイスチャンネルIDも `TEXT_CHANNEL_IDS` に加えます。トークンや実際のIDをGitHubに貼り付けたり、コミットしたりしないでください。

### 4. スラッシュコマンドを登録して起動する

```powershell
npm run deploy:commands
npm start
```

Botが起動したら、Discordで読み上げ先のボイスチャンネルに入り、`/join` を実行します。スラッシュコマンドの定義を変更したときは、`npm run deploy:commands` を再実行してください。

## 起動と更新

### 毎回の起動

1. VOICEVOX Windows版を起動し、`http://127.0.0.1:50021/docs` が開くことを確認します。
2. PowerShellでBotのフォルダーへ移動して起動します。

```powershell
Set-Location "$env:USERPROFILE\Documents\Discord-Bot"
npm start
```

GPT-SoVITSのスピキモードを使う日は、後述のAPIも起動しておきます。

### GitHubからコードを更新する

Botを停止してから、リポジトリのフォルダーで実行します。

```powershell
git pull
npm ci
npm start
```

依存パッケージに変更がないと分かっている場合、`npm ci` は省略できます。`.env`と`.bot-settings.json`はGitHubから取得・送信されません。

## 機能とコマンド

### 読み上げと音声

- `/join`、`/leave`: ボイスチャンネルへ接続・退出
- `/say`: 指定した文章を読み上げ
- `/skip`: 再生中の文章をスキップ
- `/queue`: 待ち列と遅延の計測値を表示
- `/voice`、`/voices`: 話者の確認・選択
- `/setvoice`: 話者、速度、高さを調整
- `/supiki enabled:true|false`: 自分の投稿をスピキモードに切り替え

話者候補はVOICEVOX Engineから取得するため、一覧を使うときはEngineを起動してください。スピキモードはBot再起動後に通常モードへ戻ります。

### 読み上げ設定

- `/readch`: 読み上げるテキストチャンネルを追加・削除
- `/dict`: 固有名詞や英字などの読み方を辞書に登録
- `/setting announcements:true|false links:omit|domain|keep`: 入退室案内とURLの読み方を設定

`/readch`、`/dict`、`/setting` の設定は `.bot-settings.json` に保存されます。このファイルはPC内にあり、GitHubには含まれません。

### 誕生日と月間予定

- `/birthday set month:<月> day:<日> channel:<チャンネル>`: 誕生日を登録
- `/birthday list`、`/birthday remove`: 登録一覧の確認・削除
- `/season`: 今月の予定を表示
- `/season year:<年> month:<月>`: 指定月の予定を表示
- `/season year:<年> month:<月> schedule:<予定>`: 管理者が予定を登録

予定は1日ごとに `日付: ステージA、ステージB` と書き、複数日は改行で並べます。日付は `5:`、`11/5:`、`11月5日(木):` の形式が使えます。通知先は `channel:<チャンネル>` で指定でき、省略時はコマンドを実行したチャンネルです。予定の通知は日本時間の日付が変わった後に行われます。誕生日と予定は `.bot-settings.json` に保存されます。

### 読み上げの動作

- メッセージ本文をデータベースやログに保存しません。
- `TEXT_CHANNEL_IDS` に設定したチャンネルだけを読み上げます。読み上げ元が複数でも、音声の出力先はBotが接続しているボイスチャンネル1つです。
- 同じ文章と話者の音声をキャッシュし、読み上げ待ち列の上限を設定できます。
- `links:omit` はURLを読まず「リンク省略」と案内します。`domain` はドメイン名を読み、`keep` はURLを読み上げます。
- 文中の「好き」や英語の `like/likes/liked/liking` を `chuayo.mp3` に、「やめて」「やめろ」や `stop/stops/stopped/stopping` を `notviolence.mp3` に置き換えます。対象語だけの投稿は効果音にせず、VOICEVOXで読みます。
- 入室時は案内音声と `speaki.mp3`、退出時は案内音声と `deruzibazeyoonly.mp3` を順番に再生します。音声は一つの読み上げ項目として扱い、途中に別の読み上げが割り込みません。

## GPT-SoVITSを使う（任意）

GPT-SoVITSはスピキモード用です。VOICEVOXの通常読み上げは引き続きVOICEVOX Engineが担当します。ローカル構成ではGPT-SoVITS APIを `127.0.0.1:9880` だけにバインドし、ポートを外部公開しないでください。

1. GPT-SoVITSフォルダー内の `start-gpt-sovits-api.bat` を実行します。Botを使う間はAPIのウィンドウを開いたままにします。
2. `.env`で `SUPIKI_TTS_PROVIDER=gpt-sovits`、`GPT_SOVITS_URL=http://127.0.0.1:9880` を設定します。
3. `GPT_SOVITS_REF_AUDIO_PATH` に参照音声の絶対パス、`GPT_SOVITS_REF_TEXT` にその音声の正確な書き起こしを設定します。参照音声はローカルに置き、GitHubへアップロードしないでください。
4. Botを再起動し、Discordで `/supiki enabled:true` を実行します。

GPT-SoVITSは音声生成が終わってから再生するため、VOICEVOXより開始が遅くなることがあります。PCの負荷を抑えるため、重い音声処理を同時に多重実行しないでください。

## 遅延の確認と制限

`/queue` とBotのログで次の値を確認できます。

| 値 | 意味 |
|---|---|
| `queueWaitMs` | メッセージ受信から音声合成開始までの待ち時間 |
| `synthesisMs` | 音声の合成にかかった時間 |
| `playbackStartMs` | メッセージ受信から再生開始までの時間 |

待ち時間が長い場合は読み上げ列、合成時間が長い場合はPCの負荷・文章の長さ・話者・Engineを確認します。再生開始だけが遅い場合はDiscordの接続や音声経路を確認します。遅延ゼロは保証できず、回線やPCの負荷にも左右されます。

- 待ち列とメンバーごとの話者IDはメモリ上にあり、Bot再起動で消去・初期化されます。
- VOICEVOX Engineが停止すると、通常の読み上げはできません。
- 誕生日と月間予定などのBot設定は `.bot-settings.json` に保存されます。
- 利用するVOICEVOX話者の利用規約とクレジット表記を確認してください。

## VPS運用を再開するとき（現在保留）

現在はWindows PCでまとめて運用するため、以下は実行しません。A1 FlexなどのVPSを再開するときの参考情報です。

### VPSへのデプロイ

1. Linux VPSにDocker EngineとDocker Composeを用意し、SSHユーザーが `/opt/discord-tts-bot` に書き込めるようにします。
2. GitHubの **Settings → Secrets and variables → Actions** に `DISCORD_TOKEN`、`VPS_HOST`、`VPS_USER`、`VPS_SSH_KEY`、`VPS_KNOWN_HOSTS` をRepository secretsとして登録します。
3. **Variables** に `CLIENT_ID`、`GUILD_ID`、`TEXT_CHANNEL_IDS`、`VOICEVOX_SPEAKER_ID` を登録します。
4. **Actions → Deploy Discord TTS bot → Run workflow** を実行します。ワークフローはSSHでVPSへコードと設定を送り、Docker Composeで起動します。実トークンはGitHubのコードに書かず、Actions Secretで管理してください。

デプロイワークフローは手動実行のみで、Pull Requestでは動きません。

### VPSから自宅PCのGPT-SoVITSを使う

この構成ではPC、GPT-SoVITS API、Tailscaleを常時オンラインにします。9880番ポートをインターネットに公開せず、Tailscale内だけで接続します。

1. VPSとPCを同じTailscaleネットワークに参加させます。
2. Windows PCでGPT-SoVITS APIを起動し、別のPowerShellで `tailscale serve --bg --http=9881 9880` を実行します。
3. PCで `tailscale ip -4` を実行し、Tailscale IPを使ってVPS側の `GPT_SOVITS_URL=http://<PCのTailscale IP>:9881` を設定します。
4. VPS側の `GPT_SOVITS_REF_AUDIO_PATH` と `GPT_SOVITS_REF_TEXT` には、GPT-SoVITSを動かすPCから読める音声ファイルパスと正確な書き起こしを設定します。

Tailscale Funnelや公開ポート転送は使わないでください。