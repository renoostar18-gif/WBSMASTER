const { Session } = require('./rec');
const path = require('path');
(async () => {
  for (const cid of process.argv.slice(2)) {
    const mod = require(path.join(__dirname, 'ch', cid + '.js'));
    const s = await new Session(cid, mod.opts || {}).start();
    try { await (mod.run || mod)(s); } catch (e) { console.log('[' + cid + '] FAILED', e.stack); }
    await s.end();
  }
})();
