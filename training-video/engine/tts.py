# Batch narration with HyperFrames' local Kokoro model (same files `hyperframes tts` uses).
import json, os, sys, soundfile as sf, numpy as np
from kokoro_onnx import Kokoro
C = '/root/.cache/hyperframes/tts'
k = Kokoro(f'{C}/models/kokoro-v1.0.onnx', f'{C}/voices/voices-v1.0.bin')
S = json.load(open('script.json'))
only = set(sys.argv[1:])
for ch in S['chapters']:
    if only and ch['id'] not in only: continue
    d = f"vo/{ch['id']}"; os.makedirs(d, exist_ok=True); beats = []
    for i, text in enumerate(ch['beats']):
        a, sr = k.create(text, voice='am_puck', speed=1.12, lang='en-us')
        a = np.asarray(a, dtype=np.float32)
        nz = np.where(np.abs(a) > 0.004)[0]          # trim leading/trailing silence
        if len(nz): a = a[max(0, nz[0] - int(.03 * sr)): nz[-1] + int(.08 * sr)]
        sf.write(f'{d}/{i:02d}.wav', a, sr); beats.append({'i': i, 'dur': round(len(a) / sr, 3), 'text': text})
    json.dump({'id': ch['id'], 'beats': beats}, open(f"vo/{ch['id']}.json", 'w'), indent=1)
    print(ch['id'], len(beats), 'beats', round(sum(b['dur'] for b in beats), 1), 's', flush=True)
