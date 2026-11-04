# Fill the training page template: chapters, durations, asset URLs and inline WebVTT captions.
import json, os, sys
V = '../video'; S = json.load(open(f'{V}/script.json'))
assets = json.load(open('assets.json')) if os.path.exists('assets.json') else {}
clips = json.load(open('clips.json')) if os.path.exists('clips.json') else {}
tool = sys.argv[1] if len(sys.argv) > 1 else '#'
chs = []
for c in S['chapters']:
    num = '00' if c['id'] == 'c00' else c['num']; cl = clips.get(num, {})
    chs.append({'id': c['id'], 'num': num, 'title': 'Welcome' if num == '00' else c['title'], 'kicker': 'Cold open and course overview' if num == '00' else c['kicker'],
                'dur': round(cl.get('dur', 60)), 'src': assets.get(num, ''), 'poster': assets.get('poster', ''), 'vtt_en': cl.get('vtt_en', ''), 'vtt_ar': cl.get('vtt_ar', '')})
data = json.dumps({'chapters': chs}, ensure_ascii=False).replace('</', '<\\/')
t = open('training.tpl.html').read().replace('__DATA__', data).replace('__TOOL_URL__', tool)
open('training.html', 'w').write(t); print('training.html', len(t), 'bytes;', sum(1 for c in chs if c['src']), 'videos')
