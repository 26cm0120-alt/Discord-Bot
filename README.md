# 1サーバー専用 Discord 読み上げBot

Node.js の Bot と VOICEVOX Engine を同じ Linux VPS 上で動かす、小規模サーバー向けの初期版です。Docker Compose の内部ネットワークで接続し、VOICEVOX API のポートはインターネットへ公開しません。メッセージ本文をログやDBに保存せず、受信から合成・再生開始までの時間だけを記録します。

「遅延ゼロ」は保証できません。Discordの音声経路、回線、マシン負荷、VOICEVOXの合成時間に左右されるためです。この実装では `/queue` と標準出力の計測値で、待ち時間を分解して確認します。

## 機能

- `.env` で指定した複数のテキストチャンネルを読み上げる
- `/help` `/join` `/leave` `/say` `/skip` `/queue` `/setvoice` `/voice` `/voices` `/dict` `/readch` `/setting` `/supiki` `/birthday` `/season` コマンド
- `/birthday set` で誕生日を登録し、日本時間の日付が変わると指定チャンネルへお祝いを投稿
- `/season` で月間ステージローテーションを表示し、管理者が更新した予定を日本時間0時に指定チャンネルへ通知
- 読み上げ待ち列の上限と、同じ文章・話者の音声キャッシュ
- 受信から再生開始までの待ち、合成時間、合計時間の計測
- メッセージ本文を保存しない。ログにも本文を出さない
- VC入退室時にVOICEVOX案内と専用効果音を順番に再生
- 「好き/like」を `chuayo.mp3`、「やめて/やめろ/stop」を `notviolence.mp3` に置換し、文の前後をVOICEVOXで読み上げ
- URLを読み上げず「リンク省略」と案内する設定、ドメイン読み、英字略語の読み替え、管理者向け読み上げチャンネル管理
- /dict の辞書登録で人名・固有名詞・英字などの読み方を修正
- `.bot-settings.json` に読み上げチャンネル、入退室通知、URL設定、辞書、誕生日、ステージ予定を保存（Git管理対象外）

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

## Windows PCで試す（VPS・Dockerなし）

この方法なら、VOICEVOXのWindows版とNode.jsを直接起動できます。

1. Node.js 24.17以上とVOICEVOX Windows版をインストールします。VOICEVOXはCPU版から始めます。
2. VOICEVOXを起動し、EngineのAPIドキュメント `http://127.0.0.1:50021/docs` が開くことを確認します。
3. このリポジトリをPCへダウンロードまたはcloneし、PowerShellでリポジトリのフォルダーを開きます。
4. `Copy-Item .env.example .env` を実行し、`.env`を編集します。再生成した `DISCORD_TOKEN`、Developer Portalの `CLIENT_ID`、Discordの `GUILD_ID`、読み上げ元の `TEXT_CHANNEL_IDS` を設定します。IDはカンマ区切りで複数指定できます。
5. `npm install` を実行します。
6. `npm run deploy:commands` を実行し、その後 `npm start` でBotを起動します。
7. DiscordでBotが対象サーバーに参加していることを確認し、読み上げたいボイスチャンネルに入って `/join` を実行します。

Developer PortalでMessage Content Intentを有効にしてください。Botが読むのは `.env` に登録したチャンネルIDだけです。ボイスチャンネル内チャットも対象にする場合は、そのボイスチャンネルのIDを `TEXT_CHANNEL_IDS` に加えます。PCがスリープまたは電源オフになるとBotも停止します。

## VPSへのデプロイ

1. Linux VPSにDocker EngineとDocker Composeを用意し、SSH接続用ユーザーが `/opt/discord-tts-bot` を書き込めるようにします。
2. GitHubの **Settings → Secrets and variables → Actions** で次のRepository secretsを登録します: `DISCORD_TOKEN`（必ず再生成した新しいBotトークン）、`VPS_HOST`、`VPS_USER`、`VPS_SSH_KEY`、`VPS_KNOWN_HOSTS`。
3. 同じ画面の **Variables** に `CLIENT_ID`、`GUILD_ID`、`TEXT_CHANNEL_IDS`、`VOICEVOX_SPEAKER_ID` を登録します。`TEXT_CHANNEL_IDS` はカンマ区切りです。
4. **Actions → Deploy Discord TTS bot → Run workflow** を実行します。ワークフローはSSH経由でコードと`.env`をVPSへ送り、`docker compose up -d --build`で起動します。`.env`はVPS上で権限を制限して保存され、GitHubにはコミットされません。

このリポジトリは公開設定です。デプロイワークフローは `workflow_dispatch` のみで、Pull Requestでは実行しません。GitHub Actions Secretは実行時にワークフローが参照するための保管場所です。`.env.example`は必須ではありませんが、必要な設定項目を示す安全な雛形として残しています。実トークンは書き込まないでください。

## VPSのBotから自宅PCのGPT-SoVITSを使う

通常読み上げのVOICEVOX CPU版はVPS上に残し、`SUPIKI_TTS_PROVIDER=gpt-sovits` のスピキモードだけをPC上のGPT-SoVITS APIへ送ります。GPT-SoVITS APIの9880番ポートをルーター転送や公開ファイアウォールでインターネットへ開放しないでください。

1. VPSとWindows PCの両方にTailscaleを入れて、同じtailnetへログインします。
2. Windows PCでGPT-SoVITS APIを起動し、別のPowerShellで `tailscale serve --bg --http=9881 9880` を実行します。これはPCのlocalhost:9880をTailscale内だけに中継し、Serve設定をバックグラウンドで維持します。
3. PCで `tailscale ip -4` を実行し、表示されたTailscale IPを使ってGitHubの **Settings → Secrets and variables → Actions → Variables** に以下を設定します。
   - `SUPIKI_TTS_PROVIDER`: `gpt-sovits`
   - `GPT_SOVITS_URL`: `http://<PCのTailscale IP>:9881`
   - `GPT_SOVITS_REF_AUDIO_PATH`: GPT-SoVITSを動かすPC上の参照音声の絶対パス（例: `C:/path/to/Discord-Bot-main/assets/gpt-sovits/reference/supiki-reference-8s.wav`）
   - `GPT_SOVITS_REF_TEXT`: その参照音声の正確な書き起こし
   - `GPT_SOVITS_TIMEOUT_MS`: `60000`
4. Actionsから `Deploy Discord TTS bot` を実行し、VPSのBotを再デプロイします。通常のVOICEVOX読み上げはVPS上で続き、`/supiki enabled:true` を有効にしたメンバーの読み上げだけPCのGPT-SoVITSを呼びます。

この構成ではPC、GPT-SoVITS API、Tailscaleをオンラインにしておく必要があります。PCがスリープするとスピキモードは合成できません。Tailscale Serveはtailnet内の端末からだけアクセスできるようにし、Funnelや公開ポート転送は使わないでください。`.bot-settings.json`はVPS上の実行時データとして再デプロイ時も保持します。初回VPS移行時は、読み上げ対象チャンネル、誕生日、ステージ予定などをDiscordコマンドでVPS側に登録してください。

`/supiki enabled:true` で自分の投稿をスピキモードにし、`/supiki enabled:false` で通常モードへ戻せます。モード状態は利用者ごとに保持され、Bot再起動時に通常モードへ戻ります。`SUPIKI_TTS_PROVIDER=voicevox` では従来どおりVOICEVOXの話者と速度・高さ・抑揚を使い、`SUPIKI_TTS_PROVIDER=gpt-sovits` ではGPT-SoVITSの参照音声合成を使います。GPT-SoVITS利用時は`.env`にAPI URL、参照音声の絶対パス、参照音声の正確な書き起こしを設定してください。

## GPT-SoVITSの参照音声モード（Windows）

GPT-SoVITS APIをBotと同じPCで起動し、`127.0.0.1:9880`だけにバインドします。GPT-SoVITS側の起動方法は公式READMEと`api_v2.py`のWebAPI説明を参照してください。APIは`POST /tts`へ読み上げ本文、参照音声のパス、参照音声の書き起こしを送り、WAVを返します。

1. GPT-SoVITSフォルダー内の `start-gpt-sovits-api.bat` をダブルクリックしてAPIを起動します。黒いウィンドウはBotを使っている間開いたままにしてください。
2. ZIPの音声は `assets/gpt-sovits/raw/`、今回提供されたM4Aから変換した参照音声は `assets/gpt-sovits/reference/supiki-lines.wav` にあります（無音を前後だけ詰めた約14.15秒、モノラル32kHz）。
3. `.env`で `SUPIKI_TTS_PROVIDER=gpt-sovits`、`GPT_SOVITS_URL=http://127.0.0.1:9880`、`GPT_SOVITS_REF_AUDIO_PATH`（参照音声の絶対パス）、`GPT_SOVITS_REF_TEXT`（その音声の正確な発話内容）を設定します。参照音声を別PCのGPT-SoVITS APIが処理する場合は、`ref_audio_path`もそのPCから読めるパスである必要があります。
4. Botを再起動して `/supiki enabled:true` にします。GPT-SoVITSの応答は生成完了後に再生されるため、VOICEVOXより開始が遅れることがあります。

ZIPの13本は合計約36.9秒で、今回のM4Aも追加学習には使わず、参照音声合成に使います。公式READMEではゼロショット参照合成は5秒音声から、few-shotの追加学習は約1分の音声からと説明されています。`GPT_SOVITS_REF_TEXT`には参照音声の正確な書き起こしを設定してください。音声ファイルはローカル専用としてGit管理から除外しています。

/setvoice speaker:<話者名> speed:<0.5-2.0> pitch:<-0.15-0.15> で自分の声を調整します。話者は入力候補から名前で選び、/speaker でも変更できます。/voices page:<番号> は話者名一覧を15種類ずつ表示します。/dict add word:<表記> reading:<読み> で辞書を追加し、/readch add channel:<チャンネル> で読み上げ元を追加できます。/setting announcements:true links:omit|domain|keep は管理者設定です。/readch・/dict・/setting の変更は .bot-settings.json に保存されます。

## ステージローテーション

- `/season` は今月の予定を表示します。`/season year:<年> month:<月>` で別の月も確認できます。
- 管理者は `/season year:<年> month:<月> schedule:<予定>` で月間予定を登録します。入力欄には1日ごとに `日付: ステージA、ステージB` と書き、複数日を改行で並べます。日付は `5:`、`11/5:`、`11月5日(木):` のいずれでも登録できます。
- 例: `5: 全ステージ`、`6: でらクランクストリート、けっこいスターパーク、東西たかさん広場、妖華帝都ケルパーズの散歩道`。1つの日付に複数ステージを登録できます。
- 予定を登録するとき `channel:<チャンネル>` で通知先を指定します。省略すると、予定登録を実行したチャンネルが通知先になります。通知先だけを変える場合は `/season channel:<チャンネル>` を使います。
- 登録済みの日は日本時間の日付が変わった後、「今日のステージローテーションは○○です。」と投稿します。Bot起動時にも当日の未投稿分を確認し、投稿に失敗した場合は再試行します。
- 予定は `.bot-settings.json` に保存されます。月間予定を再登録すると、その月の既存予定は入力内容に置き換わります。Botには通知先の閲覧・メッセージ送信権限を付けてください。
## 誕生日コマンド

- `/birthday set month:<月> day:<日> channel:<チャンネル>` で自分の誕生日を登録します。投稿先を省略すると、コマンドを実行したチャンネルを使います。
- 日本時間で日付が変わると、投稿先に「今日は○○さんの誕生日です。おめでとうございます。」と投稿します。Bot起動時にも当日の未投稿分を確認し、投稿に失敗した場合は再試行します。
- `/birthday list` で登録一覧を確認し、`/birthday remove` で自分の登録を削除します。誕生日は年を保存せず、登録内容は `.bot-settings.json` に保存されます。
- 2月29日はうるう年にだけ通知します。Botに投稿先チャンネルの閲覧・メッセージ送信権限を付けてください。


対象語句を文中で置き換えます。対象語だけを単独で送った場合（例: `好き` や `stop`）は、効果音にせずVOICEVOXでその語を読みます。話者候補はVOICEVOX Engineの `/speakers` から取得するため、話者一覧を使う際はEngineを起動してください。

`好き`、英単語の `like/likes/liked/liking` を含む箇所は `chuayo.mp3` に置換します。`やめて`、`やめてください`、`やめてくれ`、`やめなさい`、`やめてよ`、`やめろ`、英単語の `stop/stops/stopped/stopping` は `notviolence.mp3` に置換します。効果音の前後に残る文章はVOICEVOXで読み、同じ投稿内の順番を保ちます。

`links:omit` はリンクURLを読まず、「リンク省略」と読み上げます。入室時は「○○さんが」→ `speaki.mp3` →「しにきました。」、退出時は「○○さんが」→ `deruzibazeyoonly.mp3` →「しました。」の順に再生します。読み上げと効果音は一つの読み上げ列項目として扱い、途中に別の読み上げが割り込みません。

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




