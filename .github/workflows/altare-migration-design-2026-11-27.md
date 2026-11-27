# Discord Bot の Altare 移行設計（2026-11-27）

前提の検証は完了済み：Altare の App 実行環境から外向きUDPが通ること（2026-11-27、STUNプローブ4サーバー全件応答OK×2回）。根拠と候補比較は `vps-comparison-2026-11-21.md`。

## 結論（構成案）

現行の Docker Compose 構成を、Altare の **Docker App × 2** にほぼそのまま移す。

| 役割 | Altareでの置き方 | イメージ | 備考 |
|---|---|---|---|
| VOICEVOX | Docker App | `voicevox/voicevox_engine:cpu-0.26.2`（現行composeと同ピン） | ポート50021。公開せず、Private Networking の内部名でのみ叩く。Data folder不要 |
| Bot本体 | Docker App | リポジトリの Dockerfile をビルドして GHCR へ（`ghcr.io/26cm0120-alt/discord-bot`） | **Data folder に `/data` を指定**し、`BOT_SETTINGS_PATH=/data/.bot-settings.json`（現行composeと同じ指定） |

### この形にする理由
- Botリポジトリは既にDocker化済みで、compose.yaml が `BOT_SETTINGS_PATH=/data/.bot-settings.json` と `VOICEVOX_URL` の環境変数化まで済んでいる。移行に必要な形が現行コードにほぼ揃っている。
- Altare の Docker App には **Data folder**（再デプロイでも保持されるフォルダ）を指定できる。これが `.bot-settings.json` の永続化の答えになる。
- GitHub連携の App Hosting には永続フォルダの仕組みが確認できなかったため、Botも Docker App に寄せる。設定の保存先を外部DB/KVへ変えるようなコード変更は不要。
- 環境変数（DISCORD_TOKEN等）は Altare の Variables（暗号化保存）に置く。トークンは本人がコンソールで直接入力し、チャットやファイルには残さない。

## リソース配分（Always Free のチームプール：メモリ6GB／CPU 150%／ディスク10GB／4台）

| アプリ | メモリ | ディスク目安 | 備考 |
|---|---|---|---|
| VOICEVOX | 2 GiB | 約2.5 GB（イメージ約1.94GB＋展開余地） | 音声合成はCPUバースト型。プール全体でCPU 150%が上限なので、長文読み上げの速度は実測ポイント |
| Bot | 1 GiB | 約1 GB | Node＋ffmpeg-static |
| プローブ（検証用） | 移行時に停止・削除 | ― | 枠を空ける |
| 合計 | 約3 GiB / 6 GiB | 約3.5 GB / 10 GB | 余裕あり。ただしDocker Appの再デプロイ時は新イメージの展開余地が要る |

## 通信
- Bot → VOICEVOX：Private Networking の内部名 `http://<voicevoxの内部名>:50021` を `VOICEVOX_URL` に設定（仕組みは確認済み。VOICEVOX側はコンテナ内で 0.0.0.0 で待ち受ける既定動作のまま）。
- Bot → Discord：ゲートウェイ接続とボイスUDP。外向きUDPは検証済み。
- Docker App への外からの通信はTCPのみだが、Botは外から受ける通信が不要なので問題なし。
- GPT-SoVITS と STT は Altare では使わない（現行設計どおり、GPT-SoVITSは自宅Windows＋Tailscale、STTは既定オフ）。Altare上では `SUPIKI_TTS_PROVIDER=voicevox` 固定。

## リージョン
- 無料枠の空きは Stockholm のみだった（2026-11-27確認、北米・フランクフルトは No capacity）。空き状況は変わるため、移行実施時に再確認する。
- 東京リージョンは無い。Stockholm〜Discordボイスサーバー間の遅延が読み上げ開始に乗る。読み上げBotの性質上は許容範囲の見込みだが、移行後に実測して判断する（我慢できない遅延なら有料VPSの再検討材料）。

## 移行手順（小さなステップで、各段で確認）
0. **現行の `.bot-settings.json` の所在を確認**（本番環境がWindows直接かVPSかで手順が変わる。運用メモの「現在の本番環境」が未記入のため要確認）
1. GitHub Actions に GHCR へイメージを push するワークフローを追加（リポジトリ変更はこれ1つ＋後述の初回インポートを入れる場合のみ、もう1つ）。イメージを public にすれば Altare 側のレジストリログインは不要
2. Altare に VOICEVOX の Docker App を作成（イメージ・ポート50021・サイズ）し、起動を確認
3. Altare に Bot の Docker App を作成（イメージ、Data folder=`/data`、Variables 一式）
4. 初回の設定投入（下記「未決事項」の方法で `.bot-settings.json` を /data へ）
5. 動作確認：/join → 読み上げ、設定変更 → Bot再起動 → 設定が残っていること（永続化の実証）、長文読み上げの速度
6. 切り替え：**旧環境を先に停止**してから Altare 側を本番にする（同じトークンで二重に接続しない）。旧環境は消さず、戻せる状態で残す

## 戻し方
- Altare側の Bot を停止し、旧環境を再起動するだけ。設定は Altare の /data にある `.bot-settings.json` を旧環境へコピーすれば移行後の変更も持ち帰れる。

## リスク・注意
- Altare は新興事業者。無料プールの空き・仕様は変わりうる。旧環境を残すことで、いつでも戻れる形を維持する。
- CPU 150% はチーム全体の上限。VOICEVOX の合成が重い場面では読み上げが遅れる可能性がある（既存のキュー上限で破綻はしない見込み）。
- Docker App の「自動更新」はオフのままにし、イメージ更新は手動で確認しながら行う（検証してから採用する運用に合わせる）。

## 未決事項（本人の判断が要ること）
1. **Botの置き方**：Docker App＋GHCR（本設計の推奨）でよいか。
2. **現在の本番環境**：Windows直接起動か、VPS（Docker Compose）か。切替手順と設定ファイルの取得元が変わる。
3. **`.bot-settings.json` の初回投入方法**：Data folder へ直接ファイルを置く手段がコンソールに無い場合、次のどちらか。
   - a. U3（S3互換ストレージ、無料10GB）に置き、初回起動時だけ読み込む小さな仕組みを Bot に足す（コード変更1つ）
   - b. まっさらから始め、辞書・誕生日などを再登録する
4. **リージョン**：Stockholm で進めてよいか（実施時に空きを再確認）。
