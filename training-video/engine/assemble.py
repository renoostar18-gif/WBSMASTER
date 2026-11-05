"""Final edit: cards + chapter captures, narration, SFX, ducked music, EN/AR captions, chapters, clips.
usage: python3 assemble.py [en|ar|both]"""
import json, os, re, subprocess, sys
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
SR = 48000
SFXD = '/root/.npm/_npx/8a100992a21bdc5c/node_modules/hyperframes/dist/skills/media-use/audio/assets/sfx'
CARDS = os.path.join(ROOT, '..', 'hf', 'cards', 'renders')
OUT = os.path.join(ROOT, 'out'); os.makedirs(OUT, exist_ok=True); os.makedirs('build', exist_ok=True)
S = json.load(open('script.json')); AR = json.load(open('ar.json'))
CH = S['chapters']
VO_OFF = 0.25
langs = {'en', 'ar'} if (len(sys.argv) < 2 or sys.argv[1] in ('both', 'portal')) else {sys.argv[1]}

def run(a): subprocess.run(a, check=True)
def dur(f): return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).decode())
def load(f, mono=True):
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', f, '-f', 'f32le', '-ac', '1' if mono else '2', '-ar', str(SR), '-'])
    a = np.frombuffer(raw, dtype=np.float32).copy()
    return a if mono else a.reshape(-1, 2)

# ---------- timeline ----------
segs = []  # (kind, cid, video_file, duration)
def card(i, d): return ('card', i, os.path.join(CARDS, f'card_{i}.mp4'), d)
segs.append(('ch', 'c00', f'rec/c00/screen.mp4', None))
segs.append(card(0, 6.5))
for k, c in enumerate(CH[1:], start=1):
    segs.append(card(k, 3.8)); segs.append(('ch', c['id'], f"rec/{c['id']}/screen.mp4", None))
segs.append(card(14, 7.0))
for i, s in enumerate(segs):
    if s[0] == 'ch' and (not os.path.exists(s[2]) or os.path.getmtime(s[2]) < os.path.getmtime(f'rec/{s[1]}/log.json')):
        run(['python3', 'engine/comp.py', s[1]])
    segs[i] = (s[0], s[1], s[2], s[3] if s[3] else json.load(open(f'rec/{s[1]}/log.json'))['dur'])
t = 0; starts = []
for s in segs: starts.append(t); t += s[3]
TOTAL = t
print(f'timeline {TOTAL/60:.1f} min, {len(segs)} segments')

# ---------- captions ----------
def chunks(text, n=84):
    parts = re.split(r'(?<=[.!?:;،؛])\s+|(?<=,)\s+(?=\S{3,})', text.strip())
    out, cur = [], ''
    for p in parts:
        if cur and len(cur) + 1 + len(p) > n: out.append(cur); cur = p
        else: cur = (cur + ' ' + p).strip()
    if cur: out.append(cur)
    fin = []
    for c in out:  # hard-wrap very long pieces at word boundaries
        while len(c) > n * 1.35:
            cut = c.rfind(' ', 0, n); fin.append(c[:cut]); c = c[cut + 1:]
        fin.append(c)
    return fin
def cues(lang, seg_i):
    kind, cid, _, _ = segs[seg_i]; L = json.load(open(f'rec/{cid}/log.json')); V = json.load(open(f'vo/{cid}.json'))['beats']
    texts = AR[cid] if lang == 'ar' else [b['text'] for b in V]; res = []
    for b in L['beats']:
        a0 = b['t0'] + VO_OFF; d = V[b['i']]['dur']; cs = chunks(texts[b['i']]); tot = sum(len(c) for c in cs); x = a0
        for c in cs:
            dd = d * len(c) / tot; res.append((x, x + dd + (0.15 if c is cs[-1] else 0), c)); x += dd
    return res
def ts_ass(x): h = int(x // 3600); m = int(x % 3600 // 60); s = x % 60; return f'{h}:{m:02d}:{s:05.2f}'
def ts_srt(x): ms = int(round(x * 1000)); return f'{ms//3600000:02d}:{ms//60000%60:02d}:{ms//1000%60:02d},{ms%1000:03d}'
def ass(lang, cs, path):
    font = 'IBM Plex Sans Arabic' if lang == 'ar' else 'IBM Plex Sans'; size = 44 if lang == 'ar' else 42
    head = f"""[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: C,{font},{size},&H00FFFFFF,&H00FFFFFF,&H40140D0B,&H40140D0B,0,0,0,0,100,100,0,0,3,14,0,2,260,260,40,{-1 if lang == 'ar' else 1}\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"""
    with open(path, 'w') as f:
        f.write(head)
        for a, b, c in cs: f.write(f"Dialogue: 0,{ts_ass(a)},{ts_ass(b)},C,,0,0,0,,{c}\n")

# ---------- video ----------
ENC = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', '30', '-g', '60', '-an']
def build_video(lang):
    files = []; allc = []
    for i, (kind, cid, f, d) in enumerate(segs):
        o = f'build/seg{i:02d}_{lang if kind == "ch" else "card"}.mp4'; files.append(o)
        if kind == 'card':
            if not os.path.exists(o): run(['ffmpeg', '-y', '-v', 'error', '-i', f, '-t', f'{d:.3f}', *ENC, o])
            continue
        if lang == 'none':
            if not (os.path.exists(o) and os.path.getmtime(o) > os.path.getmtime(f)): run(['ffmpeg', '-y', '-v', 'error', '-i', f, '-t', f'{d:.3f}', *ENC, o])
            continue
        cs = cues(lang, i); allc += [(a + starts[i], b + starts[i], c) for a, b, c in cs]
        sub = f'build/seg{i:02d}_{lang}.ass'; ass(lang, cs, sub)
        if os.path.exists(o) and os.path.getmtime(o) > os.path.getmtime(f) and os.path.getmtime(o) > os.path.getmtime('ar.json'): continue
        run(['ffmpeg', '-y', '-v', 'error', '-i', f, '-vf', f"ass={sub}:fontsdir={ROOT}/fonts", '-t', f'{d:.3f}', *ENC, o]); print('  encoded', o, flush=True)
    with open(f'build/list_{lang}.txt', 'w') as fl: fl.writelines(f"file '{os.path.abspath(x)}'\n" for x in files)
    run(['ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', f'build/list_{lang}.txt', '-c', 'copy', f'build/video_{lang}.mp4'])
    if lang == 'none': return f'build/video_{lang}.mp4'
    with open(f'{OUT}/WBS Builder Training - captions {lang.upper()}.srt', 'w') as fs:
        for k, (a, b, c) in enumerate(allc, 1): fs.write(f'{k}\n{ts_srt(a)} --> {ts_srt(b)}\n{c}\n\n')
    return f'build/video_{lang}.mp4'

# ---------- audio ----------
def build_audio():
    n = int(TOTAL * SR) + SR; vo = np.zeros(n, np.float32); fx = np.zeros(n, np.float32)
    lib = {}
    def sfx(name):
        if name not in lib: a = load(f'{SFXD}/{name}.mp3'); lib[name] = a / max(1e-4, np.abs(a).max()) * 0.7
        return lib[name]
    def put(buf, a, t, g):
        i = int(t * SR); j = min(len(buf), i + len(a));
        if j > i: buf[i:j] += a[:j - i] * g
    MAP = {'click': ('click-soft', .30), 'key': ('key-press', .09), 'pop': ('pop', .22), 'chime': ('chime', .26), 'zoom': ('whoosh-short', .05)}
    last = {}
    for i, (kind, cid, f, d) in enumerate(segs):
        T0 = starts[i]
        if kind == 'card':
            put(fx, sfx('whoosh-cinematic' if cid in (0, 14) else 'whoosh'), T0 - 0.15 if T0 > .2 else 0, .32)
            if cid == 0: put(fx, sfx('impact-bass-1'), T0 + 0.35, .22)
            if cid == 14: put(fx, sfx('sparkle'), T0 + 0.6, .22)
            continue
        L = json.load(open(f'rec/{cid}/log.json'))
        for b in L['beats']:
            a = load(f"vo/{cid}/{b['i']:02d}.wav"); put(vo, a, T0 + b['t0'] + VO_OFF, 1.0)
        for e in L['sfx']:
            if e['kind'] not in MAP: continue
            nm, g = MAP[e['kind']]; t = T0 + e['t']
            if t - last.get(e['kind'], -9) < (0.07 if e['kind'] == 'key' else 0.9 if e['kind'] == 'zoom' else 0.05): continue
            last[e['kind']] = t; put(fx, sfx(nm), t, g)
    # music: intro sting under cold open/title and outro, calm bed under the chapters
    intro = load('music/intro_0.wav'); _x = int(2 * SR); intro = np.concatenate([intro[:-_x], intro[-_x:] * np.linspace(1, 0, _x) + intro[:_x] * np.linspace(0, 1, _x), intro[_x:]]); beds = [load(f'music/bed_{k}.wav') for k in range(4) if os.path.exists(f'music/bed_{k}.wav')]
    xf = int(2.0 * SR); bed = beds[0]
    for b in beds[1:] * 8:
        r = np.linspace(0, 1, xf, dtype=np.float32); bed = np.concatenate([bed[:-xf], bed[-xf:] * (1 - r) + b[:xf] * r, b[xf:]])
    while len(bed) < n: bed = np.concatenate([bed[:-xf], bed[-xf:] * np.linspace(1, 0, xf) + bed[:xf] * np.linspace(0, 1, xf), bed[xf:]])
    mus = bed[:n] * 1.0
    def fade(a, i0, i1, g0, g1): mus_g[i0:i1] = np.linspace(g0, g1, max(0, i1 - i0))
    # base gain per region
    mus_g = np.full(n, 0.14, np.float32)
    t_title_end = starts[1] + segs[1][3]; t_outro = starts[-1]
    a = intro[: int(t_title_end * SR) + xf]; m = len(a)
    mix = np.zeros(n, np.float32); mix[:m] += a * 0.9 * np.minimum(1, np.linspace(m / xf, 0, m))  # intro fades out into the bed
    mus *= np.minimum(1, np.maximum(0, (np.arange(n) / SR - (t_title_end - 2)) / 2))  # bed fades in after title
    o = intro[: n - int(t_outro * SR)]; mix[int(t_outro * SR): int(t_outro * SR) + len(o)] += o * 0.9 * np.linspace(1, 0, len(o)) ** .5
    mus *= np.where(np.arange(n) / SR > t_outro + 1, 0, 1)
    # ducking from the narration envelope
    env = np.sqrt(np.convolve(vo ** 2, np.ones(2400) / 2400, mode='same')); active = (env > 0.01).astype(np.float32)
    k = np.ones(int(.5 * SR), np.float32) / int(.5 * SR); active = np.clip(np.convolve(active, k, mode='same') * 1.6, 0, 1)
    duck = 1 - 0.62 * active
    music = (mus * 0.14 + mix * 0.45) * duck
    out = vo * 1.0 + fx + music
    st = np.stack([out, out], 1); st = st / max(1.0, np.abs(st).max() / 0.98)
    st.astype(np.float32).tofile('build/mix.f32')
    run(['ffmpeg', '-y', '-v', 'error', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', 'build/mix.f32', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', str(SR), '-c:a', 'pcm_s16le', 'build/mix.wav'])
    return 'build/mix.wav'

def chapters_meta():
    lines = [';FFMETADATA1', 'title=WBS Builder — Complete Training', 'artist=PMO']
    marks = [(0, 'Welcome')] + [(starts[i], f"{segs[i+1][1][1:]} · " + next(c['title'] for c in CH if c['id'] == segs[i + 1][1])) for i, s in enumerate(segs[:-1]) if s[0] == 'card' and s[1] not in (0, 14)] + [(starts[-1], 'Wrap-up')]
    for k, (a, title) in enumerate(marks):
        b = marks[k + 1][0] if k + 1 < len(marks) else TOTAL
        lines += ['[CHAPTER]', 'TIMEBASE=1/1000', f'START={int(a*1000)}', f'END={int(b*1000)}', f'title={title}']
    open('build/chapters.txt', 'w').write('\n'.join(lines) + '\n'); return marks


def ts_vtt(x): ms = int(round(max(0, x) * 1000)); return f'{ms//3600000:02d}:{ms//60000%60:02d}:{ms//1000%60:02d}.{ms%1000:03d}'
def build_portal(marks, mix):
    v = build_video('none'); pd = f'{OUT}/portal'; os.makedirs(pd, exist_ok=True); clips = {}
    allc = {l: [] for l in ('en', 'ar')}
    for l in allc:
        for i, sg in enumerate(segs):
            if sg[0] == 'ch': allc[l] += [(a + starts[i], b + starts[i], c) for a, b, c in cues(l, i)]
    for k, (a, title) in enumerate(marks[:-1]):
        b = marks[k + 1][0] if k + 2 < len(marks) else TOTAL; num = f'{k:02d}'; fn = f'{pd}/{num}.mp4'
        run(['ffmpeg', '-y', '-v', 'error', '-ss', f'{a:.3f}', '-t', f'{b - a:.3f}', '-i', v, '-ss', f'{a:.3f}', '-t', f'{b - a:.3f}', '-i', mix, '-map', '0:v', '-map', '1:a',
             '-c:v', 'libx264', '-preset', 'slow', '-crf', '25', '-maxrate', '1600k', '-bufsize', '3200k', '-pix_fmt', 'yuv420p', '-r', '30', '-g', '90', '-c:a', 'aac', '-b:a', '112k', '-movflags', '+faststart', fn])
        ent = {'dur': b - a, 'size': os.path.getsize(fn)}
        for l in ('en', 'ar'):
            ent['vtt_' + l] = 'WEBVTT\n\n' + ''.join(f'{ts_vtt(x - a)} --> {ts_vtt(y - a)}\n{c}\n\n' for x, y, c in allc[l] if a <= x < b)
        clips[num] = ent; print('  portal', fn, f"{ent['size']/1e6:.1f} MB", flush=True)
    run(['ffmpeg', '-y', '-v', 'error', '-ss', '3', '-i', f'{pd}/01.mp4', '-frames:v', '1', '-vf', 'scale=1280:-1', f'{pd}/poster.jpg'])
    json.dump(clips, open(os.path.join(ROOT, '..', 'site', 'clips.json'), 'w'), ensure_ascii=False)

if __name__ == '__main__':
    marks = chapters_meta(); mix = build_audio(); print('audio done', flush=True)
    if 'portal' in sys.argv: build_portal(marks, mix); print('done'); sys.exit()
    for lang in sorted(langs):
        v = build_video(lang); name = f'{OUT}/WBS Builder Training ({"English captions" if lang == "en" else "Arabic subtitles"}).mp4'
        run(['ffmpeg', '-y', '-v', 'error', '-i', v, '-i', mix, '-i', 'build/chapters.txt', '-map', '0:v', '-map', '1:a', '-map_metadata', '2', '-map_chapters', '2', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', name])
        print('master', name, f'{dur(name)/60:.1f} min', flush=True)
        if lang == 'en':  # per-chapter clips for an LMS or Teams
            cd = f'{OUT}/Chapters'; os.makedirs(cd, exist_ok=True)
            for f0 in os.listdir(cd): os.remove(os.path.join(cd, f0))
            for k, (a, title) in enumerate(marks[:-1]):
                b = marks[k + 1][0] if k + 2 < len(marks) else TOTAL
                safe = re.sub(r'[\\/:*?"<>|]', '-', re.sub(r'^\d\d · ', '', title)); fn = f'{cd}/{k:02d} - {safe}.mp4'
                run(['ffmpeg', '-y', '-v', 'error', '-ss', f'{a:.3f}', '-i', name, '-t', f'{b - a:.3f}', '-c', 'copy', '-movflags', '+faststart', fn])
    print('done')
