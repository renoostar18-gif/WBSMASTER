# Local MusicGen (the free offline route HyperFrames uses): a few seed clips for the music bed.
import sys, torch, numpy as np, soundfile as sf
from transformers import AutoProcessor, MusicgenForConditionalGeneration
torch.set_num_threads(4)
proc = AutoProcessor.from_pretrained('facebook/musicgen-small'); model = MusicgenForConditionalGeneration.from_pretrained('facebook/musicgen-small')
sr = model.config.audio_encoder.sampling_rate
jobs = [
 ('intro', 'uplifting modern corporate technology, bright piano and warm synth pads, light percussion, confident, 108 bpm, clean mix', 1),
 ('bed', 'calm minimal corporate underscore for a software tutorial, soft electric piano, warm ambient pads, gentle pulse, no drums, relaxed, 90 bpm', 4),
]
for name, prompt, n in jobs:
    for k in range(n):
        torch.manual_seed(100 + k)
        x = proc(text=[prompt], padding=True, return_tensors='pt')
        a = model.generate(**x, do_sample=True, guidance_scale=3.0, max_new_tokens=1000)[0, 0].numpy()
        sf.write(f'music/{name}_{k}.wav', a, sr); print(name, k, round(len(a) / sr, 1), 's', flush=True)
