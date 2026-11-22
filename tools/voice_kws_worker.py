import argparse
import json
import sys
from contextlib import redirect_stdout


def emit(message):
    sys.stdout.write(json.dumps(message, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--keywords-json", required=True)
    args = parser.parse_args()

    try:
        import base64
        import numpy as np
        from ja_kws import JapaneseKeywordSpotter, Keyword

        configured = json.loads(args.keywords_json)
        keywords = [Keyword(text=item["keyword"], reading=item["reading"]) for item in configured]
        with redirect_stdout(sys.stderr):
            spotter = JapaneseKeywordSpotter(args.model_dir, keywords, num_threads=1)
        streams = {}
    except Exception as error:
        emit({"type": "error", "message": f"日本語KWSを初期化できません: {error}"})
        return 1

    emit({"type": "ready", "keywordCount": len(configured)})
    for line in sys.stdin:
        try:
            request = json.loads(line)
            user_id = str(request["userId"])
            operation = request.get("op")
            if operation == "start":
                streams[user_id] = spotter.create_stream()
            elif operation == "end":
                stream = streams.pop(user_id, None)
                if stream is not None:
                    with redirect_stdout(sys.stderr):
                        hits = spotter.finish_stream(stream)
                    for hit in hits:
                        emit({"type": "hit", "userId": user_id, "keyword": hit.keyword})
            elif operation == "audio":
                stream = streams.get(user_id)
                if stream is None:
                    continue
                pcm = base64.b64decode(request["pcm"], validate=True)
                samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
                stream.accept_waveform(16000, samples)
                with redirect_stdout(sys.stderr):
                    hits = spotter.decode_ready(stream)
                for hit in hits:
                    emit({"type": "hit", "userId": user_id, "keyword": hit.keyword})
        except Exception as error:
            emit({"type": "error", "message": str(error)[:500]})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
