# 日本語KWSの試験設定

KWS（Keyword Spotting）は会話全文を文字起こしせず、登録した語だけを音声から検出する方式です。このBotではVC音声をPC内のPythonワーカーへ送り、キーワード検出後に登録済みの効果音を再生します。音声や認識文は保存・出力しません。

## 先に確認する点

この機能は実験用です。日本語向け公開モデルは読み上げ音声の評価で再現率74%、誤検出53.93回/無音等の音声1時間という結果です。新しい語、DiscordのVC音声、ゲーム音が混ざる環境での精度は確認されていません。Whisperより誤検出が減るとは限らないため、まず短時間で試してください。モデルの[評価結果](https://huggingface.co/mitsu-h/icefall-ja-phoneme-kws-cv25)も参照してください。

## Windowsでの準備

以下はBotのプロジェクトルートで実行します。KWSランタイムはPython 3.11〜3.13を要求します。GPT-SoVITS付属のPython 3.9環境は利用できません。

1. [Python公式のWindowsダウンロード](https://www.python.org/downloads/windows/)からPython Install Managerをダウンロードしてインストールします。
2. PowerShellを開き、次のコマンドでPython 3.11を追加します。既存のPythonやGPT-SoVITSの環境は置き換えません。

```powershell
py install 3.11
py -V:3.11 --version
Set-Location -LiteralPath 'C:\Users\stake\Downloads\Discord-Bot-main'
py -V:3.11 -m venv .venv-kws
.venv-kws\Scripts\python.exe -m pip install --upgrade pip
.venv-kws\Scripts\python.exe -m pip install "https://huggingface.co/mitsu-h/icefall-ja-phoneme-kws-cv25/resolve/main/releases/japanese_phone_kws-0.1.0-py3-none-any.whl"
New-Item -ItemType Directory -Force assets\voice-kws-model | Out-Null
Invoke-WebRequest "https://huggingface.co/mitsu-h/icefall-ja-phoneme-kws-cv25/resolve/main/releases/japanese-phone-kws-onnx-v0.1.0.tar.gz" -OutFile "$env:TEMP\japanese-phone-kws-onnx-v0.1.0.tar.gz"
tar -xzf "$env:TEMP\japanese-phone-kws-onnx-v0.1.0.tar.gz" -C assets\voice-kws-model --strip-components 1 japanese-phone-kws-onnx-v0.1.0/sherpa-onnx
```

モデルのONNXアーカイブは約11.1MiBです。Python 3.11は[公式リリース一覧](https://www.python.org/downloads/windows/)からも入手できます。ダウンロードページの「Python install manager」を使うと、`py install 3.11` で3.11系列を指定して追加できます。

OpenJTalkの辞書は登録語の読みを準備する際に初回ダウンロードされます。初回起動時はインターネット接続が必要です。音声推論自体はローカルで行います。

`.env` でWhisperを止めてKWSを有効にします。

```dotenv
VOICE_STT_ENABLED=false
VOICE_KWS_ENABLED=true
VOICE_KWS_PYTHON_PATH=.venv-kws/Scripts/python.exe
VOICE_KWS_MODEL_DIR=assets/voice-kws-model/sherpa-onnx
```

Botを再起動し、`/status` に `VCキーワード音声: 日本語KWS稼働中` と表示されることを確認してください。`VOICE_KWS_ENABLED=true` の場合、KWSが起動していない間にWhisperへ自動で切り替わることはありません。

## 登録語を変える

[`assets/voice-kws-keywords.json`](../assets/voice-kws-keywords.json) の `keyword`（検出時に返す語）、`reading`（発音。ひらがな/カタカナ）、`soundKey`（音源キー）を編集します。新しい漢字語や固有名詞は `reading` を明記してください。読みが同じ語はモデルが区別できないため、重複登録すると起動に失敗します。

既定の登録語は「無限の剣製」「アンリミテッドブレイドワークス」「キュムロニンバス」「キュムロ」です。Botの音源設定に該当する `ubw` または `cumulo` がない語は読み込まれません。

## 参考資料

- [日本語KWSモデルと評価](https://huggingface.co/mitsu-h/icefall-ja-phoneme-kws-cv25)
- [KWSランタイムのAPI・Python要件](https://huggingface.co/mitsu-h/icefall-ja-phoneme-kws-cv25/blob/main/runtime/README.md)
- [ランタイムのソースコードとライセンス](https://huggingface.co/mitsu-h/icefall-ja-phoneme-kws-cv25/tree/main/runtime)
