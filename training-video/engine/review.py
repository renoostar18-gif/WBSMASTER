# Contact sheet: 3 frames per beat (start, middle, end) from the raw capture, with zoom ignored.
import json, sys, os, bisect
from PIL import Image, ImageDraw, ImageFont
cid = sys.argv[1]; only = [int(x) for x in sys.argv[2:]] if len(sys.argv) > 2 else None
d = f'rec/{cid}'; L = json.load(open(f'{d}/log.json')); fr = sorted(L['frames']); ts = [f[0] - L['t0'] for f in fr]
f = ImageFont.truetype('fonts/IBMPlexSans-600.ttf', 22)
beats = [b for b in L['beats'] if only is None or b['i'] in only]
W, H = 640, 360; g = Image.new('RGB', (W * 3, H * len(beats)), 'white'); dr = ImageDraw.Draw(g)
for r, b in enumerate(beats):
    for c, t in enumerate([b['t0'] + .4, (b['t0'] + b['t1']) / 2, b['t1'] - .3]):
        j = max(0, bisect.bisect_right(ts, t) - 1); im = Image.open(f'{d}/f/{fr[j][1]}').resize((W, H))
        g.paste(im, (c * W, r * H)); dr.text((c * W + 8, r * H + 6), f"b{b['i']} t={t:.1f}", fill='red', font=f)
g.save(f'shots/rev_{cid}.jpg', quality=80); print(f'shots/rev_{cid}.jpg', len(beats))
