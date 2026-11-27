# Altare移行設計案レビュー

レビュー日：2026年11月27日  
対象：`altare-migration-design-2026-11-27.md` と `Discord-Bot` リポジトリの現行構成

## 結論

Bot本体とVOICEVOX EngineをAltareの別々のDocker Appとして動かす案は、現行のDocker構成を活かせるため妥当です。Botの設定ファイルは `/data/.bot-settings.json` に置き、Docker AppのData folderを `/data` に指定する設計にします。AltareのDocker AppsはData folderを再デプロイ後も保持します。[Docker Apps](https://docs.altare.gg/apps/docker)

本番切り替え前に、Discordボイス接続の実地試験、初回設定ファイルの搬入方法、GHCRイメージの公開・更新方法、秘密素材のDockerビルド除外、バックアップを設計に加える必要があります。

## 現行リポジトリとの適合

- 現行の `Dockerfile` はNode.js Botをコンテナ化し、`/data` を `node` ユーザー所有にしています。
- `compose.yaml` は `BOT_SETTINGS_PATH=/data/.bot-settings.json` を指定し、`./data:/data` をマウントしています。Altare側でもアプリ変数とData folderを同じパスにすれば、設定保存先を変えるコード変更は不要です。
- `compose.yaml` のVOICEVOXイメージは `voicevox/voicevox_engine:cpu-0.26.2` に固定されています。
- 現行のGitHub ActionsデプロイはSSH/rsyncで既存VPSにソースを配置し、VPS上でDockerイメージをビルドします。GHCRへのイメージ公開はまだ行っていないため、Altare用にテスト後ビルド・公開するワークフローが必要です。
- `Dockerfile` は `assets` ディレクトリ全体をコピーします。現在の `.dockerignore` には `assets/voice-clips.local.json`、`.bot-settings.json`、`data/` の除外がありません。ローカルからビルドしてGHCRへpushする場合に、Git管理外の音声素材や設定データがイメージへ混ざる恐れがあるため、公開前に除外ルールを追加します。

## 優先して補う点

### 1. VOICEVOXのポートを外部公開しない

VOICEVOX側はAltareのPrivate NetworkingでBotから内部名経由で接続します。AltareのPrivate Networkingでは、アプリ間接続に公開ポートは不要です。[Private Networking](https://docs.altare.gg/networking)

VOICEVOX Docker Appの公開用Portは空欄にし、Engineをコンテナ内の `0.0.0.0:50021` で待ち受けさせる構成を推奨します。Botの `VOICEVOX_URL` にはAltareが表示する内部名を使います。内部接続とヘルスチェックが通ることを作成直後に確認します。

### 2. STUN確認の後にDiscord音声を実地試験

設計書にある「STUNプローブ4サーバー全件応答OK×2回」は、外向きUDP通信の事前確認として有用です。ただし、その結果だけではDiscordが割り当てる音声サーバーへの接続と実際の音声パケット送受信を確認できません。DiscordボイスではUDP通信が使われます。[Discord Voice Connection Errors](https://support.discord.com/hc/en-us/articles/115001310031-Voice-Connection-Errors)

Botを対象と同じDocker App実行環境・リージョンで動かし、`/join`、VOICEVOX読み上げ、長文、複数発話が続いた場合、VCの空室切断、再接続まで検証します。音声開始遅延と読み上げの途切れもWindows現行環境と比べます。

本番切り替え時は旧Botを先に停止します。同じDiscord BotトークンでWindowsとAltareの両方を同時起動すると、イベント処理や投稿・音声動作が二重になる可能性があります。

### 3. 設定ファイルの初回搬入

起動時にU3から設定を取り込む仕組みを新設する前に、Altare Files APIで `/data/.bot-settings.json` を直接配置できるかを確認する方法が簡潔です。Files APIはアプリのファイル読み書きに対応し、`servers:files` 権限を使います。[Files API](https://docs.altare.gg/api/files)

移行元の `.bot-settings.json` は誕生日などのサーバー設定を含む可能性があります。Botを停止してから安全な経路でコピーし、チャット、GitHub、公開ログへ内容を貼り付けないようにします。配置後に読み込みと保存権限を確認し、設定変更後の再起動でも値が残ることを検証します。

### 4. GHCRの公開と更新を固定化

GitHub Actionsでテストと `linux/amd64` ビルドを行ってからGHCRへpushします。Altare Docker Appsは `linux/amd64` を使用します。イメージタグにはコミットSHAを使い、Altare側の自動更新は無効にします。変更を確認した後、対象SHAまたはdigestを手動で更新する運用が安全です。[Docker Apps](https://docs.altare.gg/apps/docker)

現行の「Deploy Discord TTS bot」ワークフローは旧VPSへデプロイします。Altareへの切り替え後は、旧ワークフローの誤実行で旧Botが再起動しないよう、無効化するか、明示的な確認入力を必須にします。ロールバック期間中は旧VPSの設定データを保管し、同時起動はしません。

### 5. リソースと容量を実測

Altare Always Freeのメモリ6GB、CPU 150%、ディスク10GB、4スロットはチーム全体の共有枠です。VOICEVOXとBotに割り当てた後、実際のCPU負荷・メモリ・ディスク使用量を確認します。[Resources and limits](https://docs.altare.gg/platform/resources)

設計書のVOICEVOX約2.5GBというディスク見積もりは、実イメージの展開サイズと更新余地をAltareの作成画面で確認してから確定します。Docker Appsは展開したイメージと新しいイメージの配置に必要な空き容量を求め、必要な最小ディスク量を引き上げる場合があります。[Docker Apps](https://docs.altare.gg/apps/docker)

CPU 150%はチーム全体の上限であり、BotとVOICEVOXが同時に読み上げ処理をすると待ち時間が増える可能性があります。通常利用とピーク時の読み上げを試し、`queueWaitMs`、`synthesisMs`、`playbackStartMs` を現行環境と比較します。

Stockholmが移行時点で利用できるかはAltareコンソールで再確認します。日本の参加者に対する読み上げ遅延は地域名だけから判断せず、Discordの実際のボイス経路で測定します。

### 6. 永続化と別バックアップを分ける

Data folderはイメージ再デプロイ時のファイル保持用であり、それだけをバックアップとみなしません。初回移行前に設定を退避し、AltareのアプリBackupまたはSnapshotを設定します。復旧用として、暗号化した別媒体への定期コピーも残します。AltareのBackupsとSnapshotsは別機能で、Always Freeではチーム共有のSnapshot枠が3つです。[Resources and limits](https://docs.altare.gg/platform/resources)

## 推奨する移行手順

1. 現在稼働中の環境と、最新の `.bot-settings.json` の所在を運用者が確定する。
2. 設定データと旧環境を退避し、復旧手段を確認する。
3. `.dockerignore` に `.bot-settings.json*`、`data/`、`assets/voice-clips.local.json`、ローカル音声素材を追加する。
4. GHCR公開ワークフローを追加し、テスト成功後にコミットSHA付きの `linux/amd64` イメージを公開する。
5. AltareにVOICEVOX Docker Appを作成する。公開Portは設定せず、Private Networking経由で内部接続する。
6. AltareにBot Docker Appを作成し、Data folderを `/data`、`BOT_SETTINGS_PATH` を `/data/.bot-settings.json` にする。`VOICEVOX_URL`、Discord接続値、必要な任意設定をVariablesへ登録する。STT/KWSは当面無効、`SUPIKI_TTS_PROVIDER=voicevox` とする。
7. 本番Botの二重起動を避けながら、音声接続・読み上げ・設定保存・再起動後の永続化・ログを試験する。
8. 旧環境を停止してからAltareへ切り替え、一定期間旧環境を削除せずに保管する。
9. 問題があればAltare側を停止し、保管した旧環境を起動する。Altare移行後に設定を変更している場合は、その差分を考慮して設定ファイルを戻す。

## 移行前に運用者が決める項目

- 現行本番環境がWindows PCか、旧VPSか。設計書とリポジトリだけでは実稼働中の場所を確定できません。
- 現行設定を引き継ぐか、初期状態から始めるか。引き継ぐ場合は最新ファイルの所在を確認します。
- Stockholmを採用するか。作成時の空きと、実際のDiscord音声遅延で判断します。
- GHCRパッケージをPublicにするかPrivateにするか。公開リポジトリ由来であっても、ビルドに秘密素材が入らないことを確認してから選びます。

## 参照した現行資料

- [Altare Docker Apps](https://docs.altare.gg/apps/docker)
- [Altare Private Networking](https://docs.altare.gg/networking)
- [Altare Files API](https://docs.altare.gg/api/files)
- [Altare Resources and limits](https://docs.altare.gg/platform/resources)
- [Discord Voice Connection Errors](https://support.discord.com/hc/en-us/articles/115001310031-Voice-Connection-Errors)

