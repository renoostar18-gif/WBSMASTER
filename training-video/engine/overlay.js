// Injected into every page before the app runs. Draws the presentation layer that the
// screencast captures: cursor, click ripple, key badges, callouts, spotlight, captions-safe toasts.
(() => {
  if (window.__ov) return;
  const css = `
  #__ov{position:fixed;inset:0;pointer-events:none;z-index:2147483000;font-family:"IBM Plex Sans",system-ui,sans-serif}
  #__ov .cur{position:fixed;left:0;top:0;width:30px;height:30px;transform:translate(-3px,-2px);will-change:transform;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35));transition:opacity .25s}
  #__ov .cur svg{width:30px;height:30px;display:block}
  #__ov .cur.down svg{transform:scale(.88);transform-origin:4px 3px}
  #__ov .rip{position:fixed;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;border:3px solid #08776C;background:rgba(8,119,108,.18);animation:__rip .55s ease-out forwards}
  @keyframes __rip{from{transform:scale(.4);opacity:1}to{transform:scale(3.4);opacity:0}}
  #__ov .keys{position:fixed;left:50%;bottom:205px;transform:translateX(-50%);display:flex;gap:10px;align-items:center;opacity:0;transition:opacity .2s, transform .2s}
  #__ov .keys.on{opacity:1;transform:translateX(-50%) translateY(-6px)}
  #__ov .keys kbd{font:600 26px/1 "IBM Plex Mono",monospace;color:#0D1821;background:#fff;border:1px solid #BCC8C5;border-bottom-width:4px;border-radius:10px;padding:12px 18px;box-shadow:0 8px 24px rgba(13,24,33,.25)}
  #__ov .keys i{font:600 22px "IBM Plex Sans";color:#fff;text-shadow:0 1px 4px rgba(0,0,0,.6);font-style:normal}
  #__ov .keys .cap{font:500 20px "IBM Plex Sans";color:#fff;background:rgba(13,24,33,.82);padding:10px 14px;border-radius:10px;margin-left:6px}
  #__ov .co{position:fixed;border:3px solid #FF8A00;border-radius:10px;box-shadow:0 0 0 4px rgba(255,138,0,.22);animation:__in .35s ease-out}
  #__ov .co.teal{border-color:#08776C;box-shadow:0 0 0 4px rgba(8,119,108,.22)}
  #__ov .co .n{position:absolute;left:-17px;top:-17px;width:32px;height:32px;border-radius:50%;background:#FF8A00;color:#fff;font:700 17px/32px "IBM Plex Sans";text-align:center;box-shadow:0 3px 8px rgba(0,0,0,.3)}
  #__ov .co.teal .n{background:#08776C}
  #__ov .co .l{position:absolute;white-space:nowrap;background:#0D1821;color:#fff;font:600 17px/1.2 "IBM Plex Sans";padding:7px 12px;border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,.3)}
  @keyframes __in{from{opacity:0;transform:scale(1.08)}to{opacity:1;transform:none}}
  #__ov .spot{position:fixed;border-radius:12px;box-shadow:0 0 0 9999px rgba(9,14,19,.55);transition:all .45s cubic-bezier(.4,0,.2,1)}
  #__ov .fake{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:620px;background:#fff;color:#0D1821;border-radius:14px;box-shadow:0 30px 80px rgba(0,0,0,.45);overflow:hidden;animation:__in .3s ease-out}
  #__ov .fake .h{background:#ECF0EF;padding:14px 20px;font:600 16px "IBM Plex Sans";border-bottom:1px solid #D9E1DF;display:flex;justify-content:space-between}
  #__ov .fake .b{padding:20px;display:flex;flex-direction:column;gap:12px;font:15px "IBM Plex Sans"}
  #__ov .fake .row{display:flex;gap:10px;align-items:center}
  #__ov .fake .row b{width:90px;color:#46535E;font-weight:500}
  #__ov .fake .in{flex:1;border:1px solid #BCC8C5;border-radius:8px;padding:9px 12px;background:#fff}
  #__ov .fake .f{display:flex;justify-content:flex-end;gap:10px;padding:0 20px 20px}
  #__ov .fake .f span{padding:9px 18px;border-radius:8px;border:1px solid #BCC8C5;font:600 14px "IBM Plex Sans"}
  #__ov .fake .f span.p{background:#08776C;border-color:#08776C;color:#fff}
  #__ov .dl{position:fixed;right:24px;top:70px;background:#fff;border:1px solid #BCC8C5;border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.25);padding:14px 18px;display:flex;gap:12px;align-items:center;font:500 15px "IBM Plex Sans";color:#0D1821;animation:__in .3s ease-out}
  #__ov .dl i{width:36px;height:36px;border-radius:8px;background:#107C41;color:#fff;display:grid;place-items:center;font:700 13px "IBM Plex Sans";font-style:normal}
  #__ov .dl i.h{background:#08776C}
  #__ov .dl small{display:block;color:#46535E;font-size:13px}

  #__ov .card{position:fixed;background:rgba(255,255,255,.98);color:#0D1821;border-radius:16px;box-shadow:0 24px 70px rgba(9,14,19,.38);padding:26px 30px;animation:__up .45s cubic-bezier(.2,.8,.2,1);border-top:6px solid #08776C}
  #__ov .card.c{left:50%;top:50%;transform:translate(-50%,-50%);animation:__inc .45s cubic-bezier(.2,.8,.2,1)}
  #__ov .card.lt{left:48px;bottom:150px}
  #__ov .card h3{margin:0 0 6px;font:700 30px/1.15 "IBM Plex Sans";letter-spacing:-.01em}
  #__ov .card .k{font:600 13px "IBM Plex Sans";letter-spacing:.14em;text-transform:uppercase;color:#08776C;margin-bottom:8px}
  #__ov .card ul{list-style:none;margin:14px 0 0;padding:0;display:flex;flex-direction:column;gap:12px}
  #__ov .card li{display:flex;gap:14px;align-items:flex-start;font:500 20px/1.35 "IBM Plex Sans";opacity:0;animation:__li .4s ease-out forwards}
  #__ov .card li b.sw{flex:none;width:22px;height:22px;border-radius:6px;margin-top:3px}
  #__ov .card li kbd{font:600 18px/1 "IBM Plex Mono";border:1px solid #BCC8C5;border-bottom-width:3px;border-radius:7px;padding:6px 10px;background:#F4F7F6;min-width:30px;text-align:center;display:inline-block}
  #__ov .card li .q{font-weight:700}
  #__ov .card li small{display:block;font:400 17px/1.35 "IBM Plex Sans";color:#46535E}
  #__ov .card .ic{width:56px;height:56px;border-radius:14px;background:#08776C;color:#fff;display:grid;place-items:center;font:700 22px "IBM Plex Sans";float:left;margin:2px 18px 0 0}
  @keyframes __up{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}
  @keyframes __inc{from{opacity:0;transform:translate(-50%,-46%)}to{opacity:1;transform:translate(-50%,-50%)}}
  @keyframes __li{from{opacity:0;transform:translateX(-10px)}to{opacity:1;transform:none}}
  #__ov .sheet{position:fixed;left:60px;right:60px;top:60px;bottom:60px;background:#fff;border-radius:12px;box-shadow:0 30px 90px rgba(0,0,0,.45);display:flex;flex-direction:column;overflow:hidden;animation:__inc2 .4s ease-out;font-family:"IBM Plex Sans"}
  @keyframes __inc2{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:none}}
  #__ov .sheet .tb{background:#1F6B47;color:#fff;padding:12px 18px;font:600 16px "IBM Plex Sans";display:flex;gap:14px;align-items:center}
  #__ov .sheet .tb span{opacity:.8;font-weight:400}
  #__ov .sheet .fx{display:flex;gap:10px;align-items:center;padding:6px 12px;border-bottom:1px solid #D9E1DF;font:14px "IBM Plex Mono";color:#46535E}
  #__ov .sheet .fx b{background:#F1F4F3;border:1px solid #D9E1DF;padding:2px 10px;border-radius:4px;color:#0D1821;min-width:60px}
  #__ov .sheet .gr{flex:1;overflow:hidden}
  #__ov .sheet table{border-collapse:collapse;font:13.5px "IBM Plex Sans";color:#0D1821}
  #__ov .sheet th{background:#F1F4F3;color:#46535E;font-weight:500;border:1px solid #D9E1DF;padding:4px 8px;position:sticky;top:0}
  #__ov .sheet td{border:1px solid #E3E9E7;padding:4px 8px;white-space:nowrap;max-width:260px;overflow:hidden;text-overflow:ellipsis;height:22px}
  #__ov .sheet td.rn{background:#F1F4F3;color:#46535E;text-align:center}
  #__ov .sheet tr.h td{font-weight:600;background:#E6F2EC}
  #__ov .sheet td.calc{color:#7A8790;background:#FAFBFB}
  #__ov .sheet td.sel{outline:2px solid #1F6B47;outline-offset:-2px;background:#fff}
  #__ov .sheet td.ed{background:#FFF4D6}
  #__ov .sheet .tabs{display:flex;gap:2px;padding:0 12px;border-top:1px solid #D9E1DF;background:#F1F4F3}
  #__ov .sheet .tabs span{padding:8px 16px;font:500 14px "IBM Plex Sans";color:#46535E}
  #__ov .sheet .tabs span.on{background:#fff;color:#1F6B47;border-bottom:3px solid #1F6B47;font-weight:600}
  #__ov .pv{position:fixed;left:140px;right:140px;top:50px;bottom:50px;background:#fff;border-radius:12px;box-shadow:0 30px 90px rgba(0,0,0,.45);overflow:hidden;animation:__inc2 .4s ease-out;display:flex;flex-direction:column}
  #__ov .pv .tb{background:#E8EDEC;padding:10px 16px;font:500 14px "IBM Plex Sans";color:#46535E;border-bottom:1px solid #D9E1DF}
  #__ov .pv iframe{flex:1;border:0;width:100%}
  .toast{bottom:175px!important}
  `;
  const st = document.createElement('style'); st.textContent = css;
  const root = document.createElement('div'); root.id = '__ov';
  root.innerHTML = `<div class="cur" style="opacity:0"><svg viewBox="0 0 24 24"><path d="M3 2.2 3.1 19.6 7.6 15.4 10.6 22 13.6 20.7 10.7 14.2 16.9 14.1Z" fill="#fff" stroke="#0D1821" stroke-width="1.6" stroke-linejoin="round"/></svg></div><div class="keys"></div>`;
  const mount = () => { if (!document.documentElement) return setTimeout(mount, 5); document.documentElement.appendChild(st); document.documentElement.appendChild(root); };
  mount();
  const cur = () => root.querySelector('.cur');
  let cx = -100, cy = -100;
  const place = (x, y) => { cx = x; cy = y; const c = cur(); c.style.transform = `translate(${x - 3}px,${y - 2}px)`; };
  const track = e => { if (e.clientX || e.clientY) place(e.clientX, e.clientY); };
  addEventListener('mousemove', track, true); addEventListener('pointermove', track, true); addEventListener('dragover', track, true); addEventListener('drag', track, true);
  addEventListener('mousedown', e => { cur().classList.add('down'); ripple(e.clientX, e.clientY); }, true);
  addEventListener('mouseup', () => cur().classList.remove('down'), true);
  addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') return; }, true);
  function ripple(x, y) { const r = document.createElement('div'); r.className = 'rip'; r.style.left = x + 'px'; r.style.top = y + 'px'; root.appendChild(r); setTimeout(() => r.remove(), 600); }
  let keyT;
  const ov = window.__ov = {
    show(on = true) { cur().style.opacity = on ? 1 : 0; },
    place,
    keys(list, caption) {
      const k = root.querySelector('.keys');
      k.innerHTML = list.map(x => `<kbd>${x}</kbd>`).join('<i>+</i>') + (caption ? `<span class="cap">${caption}</span>` : '');
      k.classList.add('on'); clearTimeout(keyT); keyT = setTimeout(() => k.classList.remove('on'), 1600);
    },
    callout(rect, { n, label, pos = 'below', teal = false, id } = {}) {
      const pad = 6; const d = document.createElement('div'); d.className = 'co' + (teal ? ' teal' : ''); if (id) d.dataset.id = id;
      Object.assign(d.style, { left: rect.x - pad + 'px', top: rect.y - pad + 'px', width: rect.w + pad * 2 + 'px', height: rect.h + pad * 2 + 'px' });
      if (n != null) d.innerHTML += `<div class="n">${n}</div>`;
      if (label) { const l = document.createElement('div'); l.className = 'l'; l.textContent = label; d.appendChild(l);
        const s = l.style; if (pos === 'below') { s.top = 'calc(100% + 10px)'; s.left = '0'; } else if (pos === 'above') { s.bottom = 'calc(100% + 10px)'; s.left = '0'; } else if (pos === 'right') { s.left = 'calc(100% + 12px)'; s.top = '50%'; s.transform = 'translateY(-50%)'; } else if (pos === 'left') { s.right = 'calc(100% + 12px)'; s.top = '50%'; s.transform = 'translateY(-50%)'; } else if (pos === 'below-right') { s.top = 'calc(100% + 10px)'; s.right = '0'; } }
      root.appendChild(d); return d;
    },
    clear(sel = '.co,.spot,.fake,.dl,.card,.sheet,.pv') { root.querySelectorAll(sel).forEach(x => x.remove()); },

    card({ kicker = '', title = '', items = [], pos = 'c', width = 760, icon = '', id = 'card' } = {}) {
      root.querySelectorAll('.card').forEach(x => x.remove());
      const d = document.createElement('div'); d.className = 'card ' + pos; d.style.width = width + 'px';
      d.innerHTML = (icon ? `<div class="ic">${icon}</div>` : '') + (kicker ? `<div class="k">${kicker}</div>` : '') + (title ? `<h3>${title}</h3>` : '') + (items.length ? '<ul>' + items.map((x, i) => `<li style="animation-delay:${0.25 + i * (x.delay ?? 0.35)}s">${x.html}</li>`).join('') + '</ul>' : '');
      root.appendChild(d); return d;
    },
    sheet(html) { root.querySelectorAll('.sheet').forEach(x => x.remove()); const d = document.createElement('div'); d.className = 'sheet'; d.innerHTML = html; root.appendChild(d); return d; },
    cell(r, c, text, cls = 'ed') { const td = root.querySelector(`.sheet td[data-rc="${r}:${c}"]`); if (!td) return null; root.querySelectorAll('.sheet td.sel').forEach(x => x.classList.remove('sel')); td.classList.add('sel'); if (text != null) { td.textContent = text; td.classList.add(cls); const fx = root.querySelector('.sheet .fx b + span'); if (fx) fx.textContent = text; } const b = td.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; },
    preview(title, html) { root.querySelectorAll('.pv').forEach(x => x.remove()); const d = document.createElement('div'); d.className = 'pv'; d.innerHTML = `<div class="tb">${title}</div>`; const f = document.createElement('iframe'); f.srcdoc = html; d.appendChild(f); root.appendChild(d); return d; },
    scrollPreview(y) { const f = root.querySelector('.pv iframe'); if (f && f.contentWindow) f.contentWindow.scrollTo({ top: y, behavior: 'smooth' }); },
    spot(rect) { let s = root.querySelector('.spot'); if (!s) { s = document.createElement('div'); s.className = 'spot'; root.appendChild(s); } const p = 8; Object.assign(s.style, { left: rect.x - p + 'px', top: rect.y - p + 'px', width: rect.w + p * 2 + 'px', height: rect.h + p * 2 + 'px' }); return s; },
    fakeSave(title, name, folder) { const d = document.createElement('div'); d.className = 'fake'; d.innerHTML = `<div class="h"><span>${title}</span><span>✕</span></div><div class="b"><div class="row"><b>Folder</b><div class="in">${folder}</div></div><div class="row"><b>File name</b><div class="in">${name}</div></div></div><div class="f"><span>Cancel</span><span class="p">Save</span></div>`; root.appendChild(d); return d; },
    download(name, sub, kind = 'x') { const d = document.createElement('div'); d.className = 'dl'; d.innerHTML = `<i class="${kind === 'h' ? 'h' : ''}">${kind === 'h' ? 'HTML' : 'XLSX'}</i><div>${name}<small>${sub}</small></div>`; root.appendChild(d); setTimeout(() => d.remove(), 3200); return d; },
  };

  // File System Access pickers → real handles in the origin-private file system, so sync code runs for real.
  const opfs = name => navigator.storage.getDirectory().then(d => d.getFileHandle(name, { create: true }));
  const wrap = async name => { const h = await opfs(name); h.queryPermission = async () => 'granted'; h.requestPermission = async () => 'granted'; return h; };
  window.__pick = { save: 'WBS Projects.xlsx', open: 'WBS Projects.xlsx' };
  window.__gate = null; const gate = async () => { if (window.__gate) await window.__gate; };
  window.showSaveFilePicker = async (o) => { await gate(); return wrap((o && o.suggestedName) || window.__pick.save); };
  window.showOpenFilePicker = async () => { await gate(); return [await wrap(window.__pick.open)]; };
  window.__hold = () => { let r; window.__gate = new Promise(x => r = x); window.__release = () => { window.__gate = null; r(); }; };
  window.__opfs = { async write(name, buf) { const h = await opfs(name); const w = await h.createWritable(); await w.write(buf); await w.close(); }, async read(name) { const h = await opfs(name); const f = await h.getFile(); return new Uint8Array(await f.arrayBuffer()); } };
})();
