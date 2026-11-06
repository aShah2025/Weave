# /// script
# requires-python = ">=3.10,<3.14"
# dependencies = ["faster-whisper==1.2.1", "av==15.1.0"]
# ///
"""Print timestamped speech segments for a media file as JSON. Runs locally."""
import json
import sys

from faster_whisper import WhisperModel

model = WhisperModel("base.en", compute_type="int8")
segments, _ = model.transcribe(sys.argv[1], vad_filter=False, word_timestamps=True)
# Word times, because segment times drift into the silence around speech.
print(json.dumps([
    {"start": round(s.words[0].start, 2), "end": round(s.words[-1].end, 2), "text": s.text.strip()}
    for s in segments if s.words
]))
