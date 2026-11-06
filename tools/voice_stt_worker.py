import argparse
import base64
from contextlib import redirect_stdout
from io import BytesIO
import json
import sys


def emit(message):
    sys.stdout.write(json.dumps(message, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="base")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    args = parser.parse_args()

    try:
        with redirect_stdout(sys.stderr):
            from faster_whisper import WhisperModel

            model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)
    except Exception as error:
        print(f"音声認識モデルを起動できません: {error}", file=sys.stderr, flush=True)
        return 1

    emit({"type": "ready", "model": args.model, "device": args.device})
    for line in sys.stdin:
        request = None
        try:
            request = json.loads(line)
            wav = base64.b64decode(request["wav"], validate=True)
            with redirect_stdout(sys.stderr):
                segments, _info = model.transcribe(
                    BytesIO(wav),
                    language="ja",
                    beam_size=5,
                    best_of=5,
                    temperature=0,
                    condition_on_previous_text=False,
                    vad_filter=False,
                    no_speech_threshold=0.6,
                    hotwords=request.get("hotwords") or None,
                )
                recognized = list(segments)
            text = "".join(segment.text for segment in recognized).strip()
            avg_logprob = (
                sum(segment.avg_logprob for segment in recognized) / len(recognized)
                if recognized else -99
            )
            no_speech_prob = (
                sum(segment.no_speech_prob for segment in recognized) / len(recognized)
                if recognized else 1
            )
            emit({
                "id": request.get("id"),
                "userId": request.get("userId"),
                "text": text,
                "avgLogProb": avg_logprob,
                "noSpeechProb": no_speech_prob,
            })
        except Exception as error:
            emit({"id": request.get("id") if isinstance(request, dict) else None, "error": str(error)})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

