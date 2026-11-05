import json, sys, subprocess, os
from PIL import Image, ImageDraw, ImageFont
f = ImageFont.truetype('fonts/IBMPlexSans-600.ttf', 20)
for cid in sys.argv[1:]:
    L = json.load(open(f'rec/{cid}/log.json')); zs = [z for z in L['zoom'] if z['w'] < 1919]
    if not zs: continue
    W, H = 480, 270; cols = 4; rows = (len(zs) + cols - 1) // cols
    g = Image.new('RGB', (W * cols, H * rows), 'white'); d = ImageDraw.Draw(g)
    for k, z in enumerate(zs):
        t = z['t'] + z['dur'] + 0.5
        out = f'/tmp/claude-0/-home-user-WBSMASTER/5284c64b-d3d5-5866-83db-80645616f652/scratchpad/zr.jpg'
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-ss', f'{t:.2f}', '-i', f'rec/{cid}/screen.mp4', '-frames:v', '1', '-vf', f'scale={W}:{H}', out])
        beat = max([b['i'] for b in L['beats'] if b['t0'] <= z['t']] or [len(L['beats'])])
        im = Image.open(out); g.paste(im, ((k % cols) * W, (k // cols) * H)); d.text(((k % cols) * W + 6, (k // cols) * H + 4), f"z{k} b{beat} {z['w']:.0f}", fill='red', font=f)
    g.save(f'shots/zr_{cid}.jpg', quality=78); print(cid, len(zs))
