# WBS Builder training video: production kit

Everything needed to rebuild the WBS Builder training video when the tool changes. The finished
videos are not stored here; they are too large for git.

## What it makes

- Two masters of about 19 minutes at 1080p with chapter markers: English captions, and Arabic subtitles.
- 14 chapter clips (cold open plus chapters 1 to 13) with WebVTT subtitles for the training page.
- `.srt` caption files in English and Arabic.

## How it works

| Step | Files | Notes |
| --- | --- | --- |
| Script | `script.json`, `ar.json` | 14 chapters, 112 narration beats. `ar.json` holds the Arabic subtitle for each beat (same count per chapter). |
| Voice | `engine/tts.py` | Kokoro (`am_puck`, 1.12×) through HyperFrames' local TTS model. Free, runs offline. One WAV per beat in `vo/<chapter>/`. |
| Demo data | `engine/mkxlsx.js`, `engine/setup.js`, `engine/setup2.js`, `data/` | The substation task list for the import chapter, and saved browser states (projects, links, portfolio history) that each chapter starts from. |
| Recording | `engine/rec.js`, `engine/overlay.js`, `engine/ch/cXX.js`, `engine/run.js` | Drives the real tool (`site/wbs-builder.html`, served on `localhost:8765`) in Chromium. A screencast records every frame with its time. The overlay draws the cursor, click ripples, key badges, callouts and info cards. Each beat lasts at least as long as its narration. |
| Zooms | `engine/comp.py` | Turns the timed frames into 30 fps video with eased zoom-ins from the logged keyframes. |
| Cards | `cards/index.html`, `cards/batch.json` | HyperFrames composition for the title, chapter and outro cards (`npx hyperframes render --batch cards/batch.json -o "renders/card_{index}.mp4"`). |
| Intro | `intro/index.html` | HyperFrames composition for the presentation-style cold open (three scenes timed to the cold-open narration). Render it and use it as `rec/c00/screen.mp4`. |
| Music | `engine/music.py` | MusicGen small, run locally (HyperFrames' free offline route). |
| Edit | `engine/assemble.py` | Narration, the sound effects bundled with HyperFrames (Pixabay licence), music that dips under the voice, burned captions (libass, Arabic right to left), chapter metadata, per-chapter clips. `assemble.py both` builds the masters; `assemble.py portal` builds the training-page clips and `site/clips.json`. |
| Checks | `engine/review.py`, `engine/zoomrev.py`, `engine/landtest.js` | Contact sheets of each beat and of every zoom, and landing page screenshots. |
| Training page | `site/training.tpl.html`, `site/build_training.py` | The standalone player page (no link to the tool): chapters, English/Arabic WebVTT tracks, asset URLs. |

## Rebuild after a change to the tool

1. Put the new tool page in `site/wbs-builder.html` and copy it to the served folder with an empty
   `<script id="wbs-data" type="application/json">{}</script>` before the SheetJS script tag, so the
   "This tool file" options of Share & sync appear as in the downloaded file.
2. Edit the affected beats in `script.json` and `ar.json`, and their actions in `engine/ch/`.
3. `python engine/tts.py <chapter ids>`, then `node engine/run.js <chapter ids>`, then
   `python engine/comp.py <chapter id>`.
4. Check with `python engine/review.py <chapter>` and `python engine/zoomrev.py <chapter>`.
5. `python engine/assemble.py both`, then `python engine/assemble.py portal`.

The scripts expect the scratchpad layout they were written in: the tool served from `app/`, the
HyperFrames cards in `../hf/cards`, the Kokoro and MusicGen Python environment in `../hf/kvenv`, and
IBM Plex fonts in `fonts/`. Adjust those paths when running elsewhere.

## Needs

Node 22 with Playwright and Chromium, Python 3 with Pillow and NumPy, FFmpeg with libass,
HarfBuzz and FriBidi, and `hyperframes@0.9.12` (with `kokoro-onnx`, `soundfile`, `torch` and
`transformers` in its Python environment).
