"""Compose a recorded chapter: timestamped screencast frames -> constant 30 fps video with eased zooms.
usage: python3 comp.py <cid> [out.mp4]"""
import json, sys, os, subprocess, bisect
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FPS = 30
W, H = 1920, 1080

def ease(t):
    return 4 * t * t * t if t < .5 else 1 - (-2 * t + 2) ** 3 / 2

def rect_at(T, zs):
    cur = (0.0, 0.0, float(W), float(H))
    for z in zs:
        if T < z['t']:
            break
        tgt = (z['x'], z['y'], z['w'], z['h'])
        k = min(1.0, (T - z['t']) / max(z['dur'], 1e-3))
        if k >= 1:
            cur = tgt
        else:
            e = ease(k)
            return tuple(a + (b - a) * e for a, b in zip(cur, tgt))
    return cur

def main(cid, out=None):
    d = os.path.join(ROOT, 'rec', cid)
    log = json.load(open(os.path.join(d, 'log.json')))
    fr = sorted(log['frames'])
    ts = [f[0] - log['t0'] for f in fr]
    dur = log['dur']
    zs = sorted(log['zoom'], key=lambda z: z['t'])
    out = out or os.path.join(d, 'screen.mp4')
    n = int(dur * FPS)
    ff = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                           '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], stdin=subprocess.PIPE)
    last_key, last_bytes, cache = None, None, {}
    for i in range(n):
        T = i / FPS
        j = max(0, bisect.bisect_right(ts, T) - 1)
        r = rect_at(T, zs)
        key = (j, tuple(round(v, 1) for v in r))
        if key != last_key:
            name = fr[j][1]
            img = cache.get(name)
            if img is None:
                try:
                    img = Image.open(os.path.join(d, 'f', name)).convert('RGB')
                except Exception:
                    img = cache.get('__last')
                cache.clear(); cache[name] = img; cache['__last'] = img
            if r != (0, 0, W, H):
                x, y, w, h = r
                im = img.resize((W, H), Image.LANCZOS, box=(x, y, x + w, y + h))
            else:
                im = img if img.size == (W, H) else img.resize((W, H))
            last_bytes = im.tobytes(); last_key = key
        ff.stdin.write(last_bytes)
    ff.stdin.close(); ff.wait()
    print(cid, 'composited', n, 'frames ->', out)

if __name__ == '__main__':
    main(*sys.argv[1:])
