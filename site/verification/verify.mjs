// Dependency-free browser QA. Start a separate Chrome with --remote-debugging-port=9228.
// Run from the repository root: node site/verification/verify.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const endpoint = process.env.CHROME_DEBUG_URL || 'http://127.0.0.1:9228';
const { webSocketDebuggerUrl } = await (await fetch(`${endpoint}/json/version`)).json();
const socket = new WebSocket(webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
const exceptions = [];
const remoteRequests = new Set();
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject, timeout } = pending.get(message.id);
    clearTimeout(timeout);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
  }
  if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
  if (message.method === 'Network.requestWillBeSent' && /^https?:/.test(message.params.request.url)) remoteRequests.add(message.params.request.url);
};
function send(method, params = {}, sessionId) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const command = (method, params) => send(method, params, sessionId);
async function evaluate(expression) {
  const value = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (value.exceptionDetails) throw new Error(JSON.stringify(value.exceptionDetails));
  return value.result.value;
}
await command('Page.enable');
await command('Runtime.enable');
await command('Network.enable');
await command('DOM.enable');
await command('CSS.enable');
await command('Page.bringToFront');
await command('Emulation.setFocusEmulationEnabled', { enabled: true });
const results = [];
const url = pathToFileURL(path.resolve('site/index.html')).href;
const manuscript = await fs.readFile('INPUT/keisaifenkou.html', 'utf8');
const normalizedManuscript = manuscript.replace(/<[^>]*>/g, '').replace(/\s+/g, '');
try {
  for (const width of [1440, 768, 390]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width <= 768 });
    await command('Emulation.setTouchEmulationEnabled', { enabled: width <= 768 });
    await command('Page.navigate', { url });
    await evaluate(`new Promise(resolve => {
      const ready = async () => {
        if (document.readyState !== 'complete') { setTimeout(ready, 30); return; }
        await document.fonts.ready;
        const images = [...document.images];
        images.forEach(img => img.loading = 'eager');
        await Promise.all(images.map(img => img.complete ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r; })));
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }; ready();
    })`);
    const measurement = await evaluate(`(() => {
      const visible = e => !!e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
      const clipped = e => e.closest('.sr-only, .desktop-sr-only, .hero-copy') && getComputedStyle(e.closest('.sr-only, .desktop-sr-only, .hero-copy')).position === 'absolute';
      const describe = e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().replaceAll(' ', '.') : '');
      const smallTargets = [...document.querySelectorAll('a[href], button, [data-link-status]')].filter(e => visible(e) && !clipped(e) && !e.classList.contains('skip-link')).map(e => ({ element: describe(e), text: e.textContent.trim(), width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height })).filter(e => e.width < 44 || e.height < 44);
      const overflowingText = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode, parent = node.parentElement;
        if (!node.textContent.trim() || !parent || !visible(parent) || clipped(parent) || parent.closest('script, style')) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1)) { overflowingText.push({ text: node.textContent.trim(), left: rect.left, right: rect.right }); break; }
        }
      }
      return {
        viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
        overflowingText, smallTargets,
        brokenImages: [...document.images].filter(img => !img.complete || !img.naturalWidth).map(img => img.getAttribute('src')),
        distortedImages: [...document.images].filter(img => visible(img) && !['cover','contain'].includes(getComputedStyle(img).objectFit) && Math.abs(img.clientWidth / img.clientHeight - img.naturalWidth / img.naturalHeight) > .02).map(img => img.className),
        pendingLinksValid: [...document.querySelectorAll('[data-link-status="pending"]')].every(a => !a.hasAttribute('href') && a.getAttribute('aria-disabled') === 'true'),
        internalLinksValid: [...document.querySelectorAll('a[href^="#"]')].every(a => !!document.getElementById(a.hash.slice(1))),
        realMapAbsent: !document.querySelector('iframe') && !!document.querySelector('[data-map-status="pending"]'),
        copy: [...document.querySelectorAll('.medical-card h3, .medical-card-body, .medical-description, .message-body > p:not(.eyebrow), .message-signature, .about-copy > p:not(.eyebrow), .staff-intro > p, .staff-details p, .staff-profile h3, .news-list a, .faq-list a > span:last-child')].map(e => e.textContent.trim()),
        columns: { medical: getComputedStyle(document.querySelector('.medical-grid')).gridTemplateColumns, staff: getComputedStyle(document.querySelector('.staff-grid')).gridTemplateColumns },
        sections: [...document.querySelectorAll('main > section')].map(e => ({ id: e.id || 'hero', y: Math.round(e.getBoundingClientRect().top + scrollY), height: Math.round(e.getBoundingClientRect().height) })).sort((a,b) => a.y-b.y),
        navigation: { toggleVisible: visible(document.querySelector('.nav-toggle')), initialCollapsed: getComputedStyle(document.querySelector('.primary-nav')).display === 'none' }
      };
    })()`);
    measurement.copyMatchesManuscript = measurement.copy.every(value => normalizedManuscript.includes(value.replace(/\s+/g, '')));
    delete measurement.copy;
    if (width <= 768) {
      measurement.navigation.noScriptFallback = await evaluate(`(() => { document.documentElement.classList.remove('js'); const usable = getComputedStyle(document.querySelector('.primary-nav')).display !== 'none' && getComputedStyle(document.querySelector('.nav-toggle')).display === 'none'; document.documentElement.classList.add('js'); return usable; })()`);
      await evaluate(`document.querySelector('.nav-toggle').focus()`);
      await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 36, text: '\r', unmodifiedText: '\r' });
      await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      measurement.navigation.keyboardOpens = await evaluate(`document.querySelector('.nav-toggle').getAttribute('aria-expanded') === 'true' && getComputedStyle(document.querySelector('.primary-nav')).display !== 'none'`);
      measurement.navigation.openMenuFits = await evaluate(`document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.primary-nav a')].every(a => { const r=a.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.height >= 44; })`);
      await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      measurement.navigation.escapeCloses = await evaluate(`document.querySelector('.nav-toggle').getAttribute('aria-expanded') === 'false' && document.activeElement === document.querySelector('.nav-toggle')`);
      await evaluate(`document.querySelector('.nav-toggle').click(); document.querySelector('.primary-nav a[href="#medical"]').click()`);
      measurement.navigation.selectionCloses = await evaluate(`document.querySelector('.nav-toggle').getAttribute('aria-expanded') === 'false' && document.activeElement.id === 'medical'`);
      await evaluate(`window.scrollTo({top:0,behavior:'instant'}); document.activeElement.blur()`);
    }
    const before = await evaluate(`location.href`);
    await evaluate(`document.querySelector('[data-link-status="pending"]').click()`);
    measurement.pendingClickDoesNotNavigate = before === await evaluate(`location.href`);
    const { root } = await command('DOM.getDocument');
    const { nodeId } = await command('DOM.querySelector', { nodeId: root.nodeId, selector: '.medical-card-body' });
    measurement.platformFonts = (await command('CSS.getPlatformFontsForNode', { nodeId })).fonts;
    await evaluate(`window.scrollTo({top:0,behavior:'instant'})`);
    const { data } = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: measurement.height, scale: 1 } });
    await fs.writeFile(`site/verification/${width}.png`, Buffer.from(data, 'base64'));
    const top = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: 900, scale: 1 } });
    await fs.writeFile(`site/verification/${width}-top.png`, Buffer.from(top.data, 'base64'));
    const detailSection = measurement.sections.find(section => section.id === (width === 1440 ? 'staff' : 'medical'));
    const detail = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: detailSection.y, width, height: Math.min(detailSection.height, 1100), scale: 1 } });
    await fs.writeFile(`site/verification/${width}-detail.png`, Buffer.from(detail.data, 'base64'));
    results.push(measurement);
    console.log(JSON.stringify(measurement, null, 2));
  }
  await fs.writeFile('site/verification/results.json', JSON.stringify({ checkedAt: new Date().toISOString(), exceptions, remoteRequests: [...remoteRequests], results }, null, 2) + '\n');
  const failed = exceptions.length || remoteRequests.size || results.some(r => r.horizontalOverflow || r.overflowingText.length || r.brokenImages.length || r.distortedImages.length || !r.copyMatchesManuscript || !r.pendingLinksValid || !r.internalLinksValid || !r.realMapAbsent || !r.pendingClickDoesNotNavigate || (r.viewport <= 768 && (r.smallTargets.length || !r.navigation.noScriptFallback || !r.navigation.keyboardOpens || !r.navigation.openMenuFits || !r.navigation.escapeCloses || !r.navigation.selectionCloses)));
  if (failed) process.exitCode = 1;
} finally {
  await send('Target.closeTarget', { targetId });
  socket.close();
}
