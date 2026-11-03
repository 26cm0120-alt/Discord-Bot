# 1サーバー専用 Discord 読み上げBot

Node.js の Bot、VOICEVOX Engine、必要に応じて GPT-SoVITS を Windows PC 上で動かす構成です。各APIは localhost にバインドし、外部へ公開しません。メッセージ本文はログやDBに保存せず、受信から合成・再生開始までの時間だけを記録します。

「遅延ゼロ」は保証できません。Discordの音声経路、回線、マシン負荷、VOICEVOXの合成時間に左右されるためです。この実装では `/queue` と標準出力の計測値で、待ち時間を分解して確認します。

## 機能

- `.env` で指定した複数のテキストチャンネルを読み上げる
- `/help` `/join` `/leave` `/say` `/skip` `/queue` `/status` `/setvoice` `/voice` `/voices` `/dict` `/readch` `/setting` `/supiki` `/supiki-language` `/birthday` `/season` コマンド
- `/birthday set` で誕生日を登録し、日本時間の日付が変わると指定チャンネルへお祝いを投稿
- `/season` で月間ステージローテーションを表示し、管理者が更新した予定を日本時間0時に指定チャンネルへ通知
- 読み上げ待ち列の上限と、同じ文章・話者の音声キャッシュ
- `/status` で音声接続、読み上げモード、待ち列、VOICEVOX/GPT-SoVITS APIの応答と一時キャッシュ量を確認
- GPT-SoVITSの合成音声を最大32件・64 MiBまでメモリ内に一時キャッシュ（Bot停止時に消去）
- 受信から再生開始までの待ち、合成時間、合計時間の計測
- `/supiki-language` でGPT-SoVITSの言語を日本語・韓国語・自動から選択
- 日本語・韓国語それぞれの参照音声を設定し、複数ペアを順番に利用
- 参照テキストの末尾が生成音声に混ざる場合は `GPT_SOVITS_PROMPT_FREE=true` で参照テキストをAPIへ送らない
- `TTS_PLAYBACK_VOLUME` でVOICEVOX/GPT-SoVITSの読み上げ音量を調整
- メッセージ本文を保存しない。ログにも本文を出さない
- VC入退室時にVOICEVOX案内と専用効果音を順番に再生
- 「好き/like」を `chuayo.mp3`、「やめて/やめろ/stop」を登録済み効果音に置換し、文の前後をVOICEVOXで読み上げ
- URLを読み上げず「リンク省略」と案内する設定、ドメイン読み、英字略語の読み替え、管理者向け読み上げチャンネル管理
- /dict の辞書登録で人名・固有名詞・英字などの読み方を修正
- `.bot-settings.json` に読み上げチャンネル、入退室通知、URL設定、辞書、誕生日、ステージ予定を保存（Git管理対象外）

## 必要なもの

- Node.js 24.17 以上
- Discord Developer Portal のアプリ/Bot
- Windows 10/11 PC

VOICEVOX Windows版を使います。まずはCPU版で起動を確認し、必要に応じてGPU版を選んでください。使用する話者の利用規約とクレジット表記も確認してください。

## セットアップ

この方法なら、VOICEVOXのWindows版とNode.jsを直接起動できます。

1. Node.js 24.17以上とVOICEVOX Windows版をインストールします。VOICEVOXはCPU版から始めます。
2. VOICEVOXを起動し、EngineのAPIドキュメント `http://127.0.0.1:50021/docs` が開くことを確認します。
3. このリポジトリをPCへダウンロードまたはcloneし、PowerShellでリポジトリのフォルダーを開きます。
4. `Copy-Item .env.example .env` を実行し、`.env`を編集します。再生成した `DISCORD_TOKEN`、Developer Portalの `CLIENT_ID`、Discordの `GUILD_ID`、読み上げ元の `TEXT_CHANNEL_IDS` を設定します。IDはカンマ区切りで複数指定できます。
5. `npm.cmd install` を実行します。
6. `npm.cmd run deploy:commands` を実行し、その後 `npm.cmd start` でBotを起動します。
7. DiscordでBotが対象サーバーに参加していることを確認し、読み上げたいボイスチャンネルに入って `/join` を実行します。

Developer PortalでMessage Content Intentを有効にしてください。Botが読むのは `.env` に登録したチャンネルIDだけです。ボイスチャンネル内チャットも対象にする場合は、そのボイスチャンネルのIDを `TEXT_CHANNEL_IDS` に加えます。PCがスリープまたは電源オフになるとBotも停止します。

## GPT-SoVITSの参照音声モード（Windows）

GPT-SoVITS APIをBotと同じPCで起動し、`127.0.0.1:9880`だけにバインドします。GPT-SoVITS側の起動方法は公式READMEと`api_v2.py`のWebAPI説明を参照してください。APIは`POST /tts`へ読み上げ本文、参照音声のパス、参照音声の書き起こしを送り、WAVを返します。

1. GPT-SoVITSに付属するAPI起動スクリプトを実行し、APIを `http://127.0.0.1:9880` で起動します。APIのウィンドウはBotを使っている間開いたままにしてください。
2. 参照音声はリポジトリに含めていません。PC上の音声ファイルを使い、その絶対パスを `.env` に指定してください。APIを実行するPCからファイルを読み取れる必要があります。
3. `.env`で `SUPIKI_TTS_PROVIDER=gpt-sovits`、`GPT_SOVITS_URL=http://127.0.0.1:9880`、`GPT_SOVITS_TEXT_LANG=auto` を設定します。日本語と韓国語の参照音声は、それぞれ `GPT_SOVITS_REF_AUDIO_PATH_JA` / `GPT_SOVITS_REF_TEXT_JA` と `GPT_SOVITS_REF_AUDIO_PATH_KO` / `GPT_SOVITS_REF_TEXT_KO` で設定できます。複数の日本語参照ペアを使うときは、末尾に `_1`, `_2` のような番号を付けて `GPT_SOVITS_REF_AUDIO_PATH_JA_1` / `GPT_SOVITS_REF_TEXT_JA_1` の組を増やします。Botは番号順に参照ペアをローテーションします。各テキストは対応する3〜10秒の参照音声の正確な書き起こしにします。GPT-SoVITSが参照文の後半まで読み上げてしまう場合は `GPT_SOVITS_PROMPT_FREE=true` にすると参照テキストを送信せず、参照音声の特徴だけを使います。`/supiki-language`で `ja` または `ko` を指定すると、その言語の参照音声を使います。`auto`では文単位でかな・ハングルの比率を見て日本語・韓国語の文節に分け、順番にそれぞれの参照音声と言語指定で合成します。かなを含む文の漢字は日本語、英数字などは文字数比で優勢な言語に割り当てます。かな・ハングルを含まない文はGPT-SoVITSの自動判定に任せます。従来形式の `GPT_SOVITS_REF_AUDIO_PATH` / `GPT_SOVITS_REF_TEXT` は `GPT_SOVITS_PROMPT_LANG` で指定した言語の予備設定です。半角カタカナは文字判定できます。参照音声を別PCのGPT-SoVITS APIが処理する場合は、`ref_audio_path`もそのPCから読めるパスである必要があります。
4. Botを再起動して `/supiki enabled:true` にします。GPT-SoVITSの応答は生成完了後に再生されるため、VOICEVOXより開始が遅れることがあります。

参照音声は追加学習ではなく、GPT-SoVITSの参照音声合成に使います。

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


対象語句を文中で効果音に置き換えます。対象語だけを単独で送った場合（句読点のみの付加も含む）は、効果音にせずVOICEVOXでその語を読みます。話者候補はVOICEVOX Engineの `/speakers` から取得するため、話者一覧を使う際はEngineを起動してください。

`好き`、英単語の `like/likes/liked/liking` を含む箇所は `chuayo.mp3` に置換します。`やめて`、`やめてください`、`やめてくれ`、`やめなさい`、`やめてよ`、`やめろ`、英単語の `stop/stops/stopped/stopping` は登録済みの効果音に置換します。効果音の前後に残る文章はVOICEVOXで読み、同じ投稿内の順番を保ちます。

追加の効果音素材は公開リポジトリへ含めず、`assets/voice-clips.local.json` に置けます。このファイルはGit管理外で、`assets/voice-clips.json` の同名キーを上書きします。既存のローカル効果音ファイルを使う場合は、そのファイルを残して運用してください。読み上げ音声は `.env` の `TTS_PLAYBACK_VOLUME`（既定値0.65）で再生し、効果音は音量30%で再生します。

`links:omit` はリンクURLを読まず、「リンク省略」と読み上げます。入室時は「○○さんが」→ `speaki.mp3` →「しにきました。」、退出時は「○○さんが」→ `deruzibazeyoonly.mp3` →「しました。」の順に再生します。読み上げと効果音は一つの読み上げ列項目として扱い、途中に別の読み上げが割り込みません。

## 遅延の見方

`/queue` とBotのログに次の内訳が出ます。

- `queueWaitMs`: メッセージ受信から合成開始まで
- `synthesisMs`: VOICEVOXの合成時間
- `playbackStartMs`: メッセージ受信から音声プレイヤーが再生を始めるまで

`queueWaitMs` が長い場合は読み上げ列が原因です。`synthesisMs` が長い場合はマシン負荷、話者・文章長、Engine側が原因です。`playbackStartMs`だけが長い場合は接続や音声送信経路を調べます。

## 制限と次の改善

- 話者IDはメンバーごとにメモリ上で保持するため、Bot再起動で初期化されます。
- 待ち列もメモリ上です。停止・再起動で消えます。
- VOICEVOX Engineが停止した場合は読み上げできません。
- Botが参加した後、`.env` で指定したテキストチャンネルだけを読み上げます。
- 読み上げ元が複数でも、音声の出力先は `/join` で接続したボイスチャンネル1つです。ボイスチャンネル内チャットも読み上げる場合、そのボイスチャンネルのIDを `TEXT_CHANNEL_IDS` に加えます。同チャット用に別のチャンネルIDを作る必要はありません。
- より短い初動時間が必要なら、VOICEVOXの `/streaming_synthesis` とストリーム音声再生への変更を検討します。まずは現在の内訳を測り、合成待ちと接続待ちを分けてから最適化します。

## 設定ファイルとトークン

`.env` と `.bot-settings.json` はローカル専用です。Discord Botトークンは `.env` にだけ保存し、GitHubへコミットしないでください。`.env.example` は値の入っていない設定テンプレートです。
