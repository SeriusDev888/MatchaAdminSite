import extraIcons from '../shared/sticker-library.json';
import baseIcons from '../shared/base-icons.json';
const icons = {
  ...Object.fromEntries(Object.entries(baseIcons).map(([key, path]) => [key, { path }])),
  ...extraIcons,
};
window.MatchaStudioRuntime = function (initialDocument) {
  const abort = new AbortController();
  const listen = (target, type, fn, options = {}) =>
    target.addEventListener(type, fn, {
      ...(typeof options === 'boolean' ? { capture: options } : options),
      signal: abort.signal,
    });
  const SiteDefaults = {
    icons,
    isProductRoute: (route) => route === 'products' || route.startsWith('product/'),
  };
  let resizeTimer;
  const originalOrders = new Map();
  const preview = new URLSearchParams(location.search).has('editor-preview') && parent !== window;
  const main = document.querySelector('main');
  if (!main) return;
  let documentState = initialDocument || { schema: 1, theme: {}, pages: {}, global: { nodes: {} } },
    base = '',
    applying = false,
    selection = null,
    interactive = false;
  const originals = new Map(),
    elements = new Map();
  let observer, toolbar;
  const route = () =>
    new URLSearchParams(location.search).get('studio-route') ||
    location.pathname.replace(/^\/preview/, '').replace(/^\/|\/$/g, '') ||
    'home';
  const post = (type, data = {}) =>
    preview && parent.postMessage({ source: 'matcha-preview', type, ...data }, location.origin);
  const ignored = (e) =>
    e.matches(
      'script,style,svg,svg *,option,.motion-atmosphere,.motion-atmosphere *,.motion-ripple,[data-editor-ui],[data-ig4-prev]',
    );
  const scopes = () => [
    ['main', main],
    ['header', document.querySelector('body header')],
    ['footer', document.querySelector('footer')],
  ];
  function indexTree(root, prefix, keep = false) {
    if (!root) return;

    let index = 0;
    function walk(el, id) {
      if (ignored(el)) return;
      if (el.dataset.productRoot) id = 'main/product-v2-' + el.dataset.productRoot;
      if (el.dataset.pdKey) id = id.substring(0, id.lastIndexOf('/')) + '/' + el.dataset.pdKey;
      if (el.matches('.product-card')) {
        const product = el
          .querySelector('a[href^="#product/"]')
          ?.getAttribute('href')
          ?.split('/')[1];
        if (product) id = id.substring(0, id.lastIndexOf('/')) + '/product-' + product;
      }
      el.dataset.veId = id;
      elements.set(id, el);
      if (keep && !originals.has(id))
        originals.set(id, {
          html: el.innerHTML,
          children: [...el.childNodes],
          srcset: el.getAttribute('srcset'),
          style: el.getAttribute('style'),
          href: el.getAttribute('href'),
          src: el.getAttribute('src'),
          alt: el.getAttribute('alt'),
        });
      let n = 0,
        icon = 0;
      for (const child of el.children) {
        if (child.tagName.toLowerCase() === 'svg') {
          const iconId = id + '/icon-' + icon++;
          child.dataset.veId = iconId;
          elements.set(iconId, child);
          if (keep && !originals.has(iconId))
            originals.set(iconId, {
              html: child.innerHTML,
              children: [...child.childNodes],
              srcset: null,
              style: child.getAttribute('style'),
              href: null,
              src: null,
              alt: null,
            });
        } else if (!ignored(child)) walk(child, id + '/' + n++);
      }
    }
    walk(root, prefix);
  }
  function resetGlobal() {
    document.querySelectorAll('[data-ve-custom],[data-ve-decoration]').forEach((el) => el.remove());
    for (const [parent, children] of originalOrders) {
      const current = [...parent.children].filter((el) => children.includes(el));
      if (current.length !== children.length) continue;
      const slots = current.map((el) => {
        const marker = document.createComment('section');
        el.replaceWith(marker);
        return marker;
      });
      slots.forEach((slot, i) => slot.replaceWith(children[i]));
    }
    for (const [id, original] of originals) {
      const el = elements.get(id);
      if (!el) continue;
      delete el.dataset.veEmptyText;
      delete el.dataset.veEmptyLabel;
      if (el.dataset.veTextApplied) {
        el.replaceChildren(...original.children);
        delete el.dataset.veTextApplied;
      }
      if (el.dataset.vePatched) {
        for (const [key, value] of Object.entries({
          style: original.style,
          href: original.href,
          src: original.src,
          srcset: original.srcset,
          alt: original.alt,
        }))
          value === null ? el.removeAttribute(key) : el.setAttribute(key, value);
        delete el.dataset.vePatched;
        delete el.dataset.veAnimation;
        delete el.dataset.veHidden;
        delete el.dataset.veDeleted;
        el.hidden = false;
      }
    }
  }
  const groupFor = (id) =>
    id?.startsWith('main') || id?.startsWith('custom-') ? 'page' : 'global';
  const escapeCSS = (value) => String(value).replace(/["\\\n\r]/g, '');
  const nodePatch = (id) =>
    (groupFor(id) === 'global' ? documentState.global : documentState.pages?.[route()])?.nodes?.[
      id
    ] || {};
  function setText(el, text) {
    if (preview && !String(text).trim()) {
      el.dataset.veEmptyText = 'true';
      el.dataset.veEmptyLabel = (el.innerText || el.textContent || el.tagName)
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 70);
    }
    const icons = [...el.children]
      .filter((child) => child.tagName.toLowerCase() === 'svg')
      .map((e) => e.cloneNode(true));
    el.replaceChildren();
    String(text)
      .split('\n')
      .forEach((line, index) => {
        if (index) el.append(document.createElement('br'));
        el.append(document.createTextNode(line));
      });
    icons.forEach((e) => el.append(e));
    el.dataset.veTextApplied = 'true';
  }
  function makeBlock(block) {
    let el;
    if (block.type === 'clone') {
      const source = elements.get(block.source);
      if (!source) return;
      el = source.cloneNode(true);
      el.querySelectorAll('[id]').forEach((e) => e.removeAttribute('id'));
      el.removeAttribute('id');
    } else {
      el = document.createElement('section');
      el.className = 've-custom-block';
      if (block.type === 'image')
        el.innerHTML = '<img src="/images/hero-matcha.jpg" alt="รูปภาพของคุณ">';
      else if (block.type === 'banner')
        el.innerHTML =
          '<h2>หัวข้อใหม่ของคุณ</h2><p>คลิกเพื่อแก้ไขข้อความและเพิ่มเรื่องราวของคุณ</p><a href="/catalog" class="btn">ดูเพิ่มเติม</a>';
      else el.innerHTML = '<h2>หัวข้อใหม่ของคุณ</h2><p>เริ่มต้นเขียนข้อความของคุณที่นี่</p>';
    }
    el.dataset.veCustom = block.id;
    indexTree(el, block.id);
    return el;
  }
  function applyGroup(group = {}) {
    for (const block of group.additions || []) {
      const el = makeBlock(block),
        parentEl = elements.get(block.parent) || main;
      if (!el) continue;
      const after = elements.get(block.after);
      after && after.parentElement === parentEl ? after.after(el) : parentEl.append(el);
    }
    for (const [id, ids] of Object.entries(group.order || {})) {
      const parentEl = elements.get(id);
      if (!parentEl || !main.contains(parentEl) || !Array.isArray(ids)) continue;
      const children = [...parentEl.children].filter(
        (el) => el.matches('section,article') && el.dataset.veId,
      );
      if (children.length < 2) continue;
      const lookup = new Map(children.map((el) => [el.dataset.veId, el]));
      const ordered = [...new Set(ids)].map((key) => lookup.get(key)).filter(Boolean);
      for (const child of children) if (!ordered.includes(child)) ordered.push(child);
      const slots = children.map((child) => {
        const marker = document.createComment('section');
        child.replaceWith(marker);
        return marker;
      });
      slots.forEach((slot, index) => slot.replaceWith(ordered[index]));
    }
    for (const [id, patch] of Object.entries(group.nodes || {})) {
      const el = elements.get(id);
      if (!el) continue;
      el.dataset.vePatched = 'true';
      if (patch.text !== undefined) setText(el, patch.text);
      for (const [property, value] of Object.entries({
        ...patch.styles,
        ...(innerWidth <= 760 ? patch.mobileStyles : {}),
      }))
        el.style.setProperty(
          property.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()),
          value,
          'important',
        );
      if (patch.image !== undefined) {
        if (el.matches('.v2-bottle')) {
          el.classList.toggle('cms-product-replaced', !!patch.image);
          el.style.setProperty('--cms-product-image', `url("${escapeCSS(patch.image)}")`);
        } else if (el.tagName === 'IMG') {
          el.src = patch.image;
          el.srcset = '';
        } else {
          el.style.setProperty(
            'background-image',
            patch.image ? `url("${escapeCSS(patch.image)}")` : 'none',
            'important',
          );
          if (!patch.styles?.backgroundSize)
            el.style.setProperty('background-size', 'cover', 'important');
        }
      }
      if (patch.alt !== undefined)
        el.tagName === 'IMG' ? (el.alt = patch.alt) : el.setAttribute('aria-label', patch.alt);
      if (patch.href !== undefined && el.tagName === 'A') el.href = patch.href;
      if (patch.hidden) {
        el.dataset.veHidden = 'true';
        if (!preview || interactive) el.style.setProperty('display', 'none', 'important');
      }
      if (patch.deleted) {
        el.dataset.veDeleted = 'true';
        el.style.setProperty('display', 'none', 'important');
      }
      if (patch.sticker && icons[patch.sticker]) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', icons[patch.sticker].path);
        el.replaceChildren(path);
        el.dataset.veTextApplied = 'true';
      }
      if (patch.effect && !['original', 'none'].includes(patch.effect.type)) {
        const fx = patch.effect,
          layer = document.createElement('div');
        layer.dataset.veDecoration = 'true';
        layer.className = 'matcha-decoration';
        layer.style.cssText =
          'pointer-events:none;position:absolute;inset:0;overflow:hidden;z-index:1';
        if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
        for (let i = 0; i < (fx.density || 10); i++) {
          const particle = document.createElement('span');
          particle.textContent =
            { leaves: '❋', sakura: '✿', sparkles: '✧', snow: '❄' }[fx.type] || '';
          particle.style.cssText =
            'position:absolute;top:-10%;left:' +
            ((i * 73) % 100) +
            '%;font-size:' +
            (fx.size || 20) +
            'px;color:' +
            (fx.color || '#6a874e') +
            ';opacity:' +
            (fx.opacity ?? 0.7) +
            ';animation:matcha-fall ' +
            (8 + (i % 5)) +
            's linear infinite;animation-delay:-' +
            i +
            's';
          if (fx.type === 'custom' && fx.image) {
            const img = document.createElement('img');
            img.src = fx.image;
            img.style.width = (fx.size || 20) + 'px';
            particle.append(img);
          }
          layer.append(particle);
        }
        el.append(layer);
      }
    }
  }
  function applyTheme() {
    const theme = documentState.theme || {};
    let style = document.getElementById('ve-theme');
    if (!style) {
      style = document.createElement('style');
      style.id = 've-theme';
      document.head.append(style);
    }
    let css = '';
    const fonts = {
      thai: 'var(--font-prompt-thai),sans-serif',
      sans: 'var(--font-jakarta),var(--font-prompt-thai),sans-serif',
      serif: 'Georgia,"Noto Sans Thai",serif',
    };
    if (theme.text)
      css += `body{--ink:${theme.text};--muted:${theme.text}}body main :is(h1,h2,h3,h4,p,small,strong,li,dt,dd),body footer{color:${theme.text}!important}`;
    if (theme.background)
      css += `body,main,main>div,main section{background-color:${theme.background}!important}`;
    if (theme.surface)
      css += `main article,main [class$="-facts"],header{background-color:${theme.surface}!important}`;
    if (theme.accent)
      css += `:root{--color-matcha-gold:${theme.accent};--color-matcha-eco:${theme.accent};--color-matcha-bronze:${theme.accent}}.btn:not(.secondary),.line-btn{background:${theme.accent}!important;border-color:${theme.accent}!important}.ig4-nav-track button.is-active{background:${theme.accent}!important}`;
    if (fonts[theme.font])
      css += `main :is(h1,h2,h3,h4,p,a,button,small,span),header,footer{font-family:${fonts[theme.font]}!important}`;
    style.textContent = css;
    const stop = preview && !interactive;
    document.documentElement.classList.toggle('ve-no-motion', stop);
    document.documentElement.dataset.motionPaused = String(stop);
    if (stop)
      document.getAnimations().forEach((animation) => {
        // Cancelling an entrance animation leaves React's initial opacity: 0
        // in place. Finish finite transitions so their final styles are kept.
        const end = animation.effect?.getComputedTiming().endTime;
        if (Number.isFinite(end) && animation.playbackRate !== 0) animation.finish();
        else animation.cancel();
      });
  }
  function apply() {
    if (applying || !base) return;
    applying = true;
    observer?.disconnect();
    const y = scrollY;
    resetGlobal();
    for (const [id, el] of elements) if (!el.isConnected) elements.delete(id);
    applyTheme();
    applyGroup(documentState.global);
    if (!SiteDefaults.isProductRoute(route())) applyGroup(documentState.pages?.[route()]);
    document.body.classList.toggle('ve-editable', preview && !interactive);
    document.body.classList.toggle('ve-interactive', interactive);
    if (selection) elements.get(selection)?.classList.toggle('ve-selected', !interactive);
    window.scrollTo(0, y);
    observer?.observe(main, { childList: true });
    applying = false;
    postOutline();
    placeToolbar();
  }
  function capture() {
    if (applying) return;
    base = 'ready';
    for (const [key, root] of scopes()) indexTree(root, key, true);
    for (const el of elements.values()) {
      const sections = [...el.children].filter((child) => child.matches('section,article'));
      if (sections.length > 1 && !originalOrders.has(el)) originalOrders.set(el, sections);
    }
    selection = null;
    apply();
    post('ready', { route: route() });
  }
  function label(el) {
    if (el.dataset.veEmptyText) return 'ข้อความว่าง · ' + el.dataset.veEmptyLabel;
    const heading = el.querySelector('h1,h2,h3');
    return (
      el.getAttribute('aria-label') ||
      heading?.innerText ||
      el.innerText ||
      el.textContent ||
      el.tagName
    )
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 65);
  }
  function describe(el) {
    const computed = getComputedStyle(el),
      id = el.dataset.veId;
    const patch =
      (groupFor(id) === 'global' ? documentState.global : documentState.pages?.[route()])?.nodes?.[
        id
      ] || {};
    const textOK =
      /^(H[1-6]|P|A|BUTTON|SPAN|SMALL|STRONG|EM|LI|DT|DD|SUMMARY|LABEL|FIGCAPTION)$/.test(
        el.tagName,
      ) && !el.querySelector('a,button,input,select,textarea,h1,h2,h3,p,div');
    const siblings = el.parentElement
      ? [...el.parentElement.children].filter((e) => e.dataset.veId)
      : [];
    const productId =
        el.dataset.productId || el.querySelector?.(':scope > [data-product-id]')?.dataset.productId,
      effectTarget = el.closest('section') || null;
    return {
      id,
      productId,
      isSticker: el.tagName.toLowerCase() === 'svg',
      isBrand: !!el.closest('.brand'),
      effectTarget: effectTarget?.dataset.veId,
      effectLabel: effectTarget ? label(effectTarget) : '',
      scope: groupFor(id),
      tag: el.tagName,
      label: label(el),
      text: textOK ? (el.innerText || el.textContent).trim() : null,
      image: productId
        ? documentState.catalog?.find((p) => p.id === productId)?.image || ''
        : el.tagName === 'IMG'
          ? el.getAttribute('src')
          : computed.backgroundImage !== 'none'
            ? computed.backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1] || ''
            : '',
      imageKind: productId ? 'product' : el.tagName === 'IMG' ? 'img' : 'background',
      alt: el.getAttribute('alt') || el.getAttribute('aria-label') || '',
      href: el.tagName === 'A' ? el.getAttribute('href') : null,
      styles: Object.fromEntries(
        [
          'color',
          'backgroundColor',
          'fontSize',
          'fontFamily',
          'fontWeight',
          'textAlign',
          'padding',
          'borderRadius',
          'opacity',
          'backgroundPosition',
          'backgroundSize',
          'objectFit',
          'objectPosition',
          'minHeight',
          'gap',
          'boxShadow',
          'width',
          'height',
        ].map((k) => [k, computed[k]]),
      ),
      parent: el.parentElement?.dataset.veId,
      siblings: siblings.map((e) => e.dataset.veId),
      index: siblings.indexOf(el),
      patch,
    };
  }
  function postOutline() {
    if (!preview) return;
    const rows = [];
    const nodes = [
      document.querySelector('body header'),
      ...main.querySelectorAll('section,article'),
      document.querySelector('footer'),
    ].filter(Boolean);
    for (const el of nodes) {
      const id = el.dataset.veId;
      if (
        !id ||
        el.closest('[data-ve-deleted="true"],.or-map') ||
        getComputedStyle(el).display === 'none'
      )
        continue;
      const ancestor = el.parentElement?.closest('section,article'),
        depth = ancestor && main.contains(ancestor) ? 1 : 0,
        scope = groupFor(id),
        siblings =
          scope === 'page'
            ? [...el.parentElement.children]
                .filter(
                  (e) =>
                    e.matches('section,article') &&
                    e.dataset.veId &&
                    !e.closest('[data-ve-deleted="true"]'),
                )
                .map((e) => e.dataset.veId)
            : [];
      rows.push({
        id,
        label: el.matches('header')
          ? 'ส่วนหัวเว็บไซต์'
          : el.matches('footer')
            ? 'ส่วนท้ายเว็บไซต์'
            : label(el),
        depth,
        scope,
        parent: el.parentElement?.dataset.veId,
        siblings,
        reorderable: scope === 'page' && siblings.length > 1,
      });
    }
    post('outline', { items: rows, route: route() });
    post('hiddenElements', {
      items: [...elements.values()]
        .filter((el) => el.isConnected && el.dataset.veHidden === 'true')
        .map((el) => ({ id: el.dataset.veId, label: label(el) })),
      route: route(),
    });
    post('emptyTexts', {
      items: [...elements.values()]
        .filter(
          (el) =>
            el.isConnected && el.dataset.veEmptyText && !el.closest('[data-ve-deleted="true"]'),
        )
        .map((el) => ({ id: el.dataset.veId, label: el.dataset.veEmptyLabel || 'ข้อความว่าง' })),
      route: route(),
    });
  }
  function select(el) {
    if (!el?.dataset.veId || el.closest('[data-ve-deleted="true"]')) return;
    if (SiteDefaults.isProductRoute(route()) && main.contains(el)) return;
    document.querySelectorAll('.ve-selected').forEach((e) => e.classList.remove('ve-selected'));
    selection = el.dataset.veId;
    el.classList.add('ve-selected');
    post('selected', { element: describe(el), route: route() });
    placeToolbar();
  }
  function placeToolbar() {
    if (!toolbar) return;
    const el = elements.get(selection);
    toolbar.hidden =
      interactive ||
      !el ||
      describe(el).text === null ||
      el.isContentEditable ||
      !el.getClientRects().length;
    if (toolbar.hidden) return;
    const rect = el.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > innerHeight) {
      toolbar.hidden = true;
      return;
    }
    toolbar.querySelector('[data-ve-edit]').hidden = describe(el).text === null;
    toolbar.style.left =
      Math.max(6, Math.min(rect.left, innerWidth - toolbar.offsetWidth - 6)) + 'px';
    toolbar.style.top =
      Math.max(
        6,
        Math.min(rect.top - toolbar.offsetHeight - 7, innerHeight - toolbar.offsetHeight - 6),
      ) + 'px';
  }
  function beginTextEdit(el) {
    if (!el || describe(el).text === null || el.isContentEditable) return;
    if (SiteDefaults.isProductRoute(route()) && main.contains(el)) return;
    el.contentEditable = 'plaintext-only';
    el.focus();
    placeToolbar();
    const finish = () => {
      el.removeAttribute('contenteditable');
      post('inlineText', {
        id: el.dataset.veId,
        scope: groupFor(el.dataset.veId),
        text: el.innerText,
        route: route(),
      });
      el.removeEventListener('blur', finish);
      placeToolbar();
    };
    el.addEventListener('blur', finish);
  }
  if (preview) {
    toolbar = document.createElement('div');
    toolbar.dataset.editorUi = 'true';
    toolbar.className = 've-selection-tools';
    toolbar.hidden = true;
    toolbar.innerHTML = '<button type="button" data-ve-edit>แก้ข้อความ</button>';
    document.body.append(toolbar);
    toolbar.querySelector('[data-ve-edit]').onclick = () => beginTextEdit(elements.get(selection));
    listen(window, 'scroll', placeToolbar, true);
    listen(window, 'resize', placeToolbar);
    listen(
      document,
      'keydown',
      (event) => {
        const typing =
          event.target.isContentEditable || event.target.matches('input,textarea,select');
        if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing) return;
        const key = event.code?.startsWith('Key')
            ? event.code.slice(3).toLowerCase()
            : event.key.toLowerCase(),
          action =
            key === 's'
              ? 'save'
              : key === 'y' || (key === 'z' && event.shiftKey)
                ? 'redo'
                : key === 'z'
                  ? 'undo'
                  : null;
        if (!action) return;
        // Preserve native text undo while typing directly on the page or trying a form.
        if (typing && action !== 'save') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (typing) event.target.blur();
        post('shortcut', { action });
      },
      true,
    );
    listen(
      document,
      'click',
      (event) => {
        if (interactive || event.target.closest('[data-editor-ui],[contenteditable]')) return;
        const el = event.target.closest('[data-ve-id]');
        if (!el) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        select(el);
      },
      true,
    );
    listen(
      document,
      'submit',
      (event) => {
        if (!interactive) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true,
    );
    listen(
      document,
      'dblclick',
      (event) => {
        if (interactive) return;
        const el = event.target.closest('[data-ve-id]');
        if (!el || describe(el).text === null) return;
        event.preventDefault();
        beginTextEdit(el);
      },
      true,
    );
    listen(window, 'message', (event) => {
      if (
        event.origin !== location.origin ||
        event.source !== parent ||
        event.data?.source !== 'matcha-editor'
      )
        return;
      const m = event.data;
      if (m.type === 'state') {
        // The iframe can become ready before the editor has loaded its draft.
        if (m.document?.schema !== 1 || !m.document.pages || typeof m.document.pages !== 'object')
          return;
        documentState = m.document;
        apply();
      }
      if (m.type === 'select') {
        const el = elements.get(m.id);
        if (el) {
          el.scrollIntoView({ block: 'center', behavior: 'instant' });
          select(el);
        }
      }
      if (m.type === 'interactive') {
        interactive = m.value;
        apply();
      }
      if (m.type === 'parent') {
        const el = elements.get(selection)?.parentElement;
        select(el);
      }
      if (m.type === 'refresh') select(elements.get(selection));
    });
  }
  observer = new MutationObserver(capture);
  observer.observe(main, { childList: true });
  capture();
  if (preview)
    listen(
      document,
      'click',
      (event) => {
        if (!interactive) return;
        const anchor = event.target.closest('a[href]');
        if (!anchor || anchor.target === '_blank') return;
        const url = new URL(anchor.href, location.href);
        if (url.origin !== location.origin || url.pathname.startsWith('/media/')) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const pathname = url.pathname.replace(/^\/preview/, '');
        const page = pathname.replace(/^\/|\/$/g, '') || 'home';
        location.href =
          '/preview' +
          (pathname || '/') +
          '?editor-preview=1&studio-route=' +
          encodeURIComponent(page) +
          url.hash;
      },
      true,
    );
  let mobile = innerWidth <= 760;
  listen(window, 'resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const changed = mobile !== innerWidth <= 760;
      mobile = innerWidth <= 760;
      if (preview || (changed && JSON.stringify(documentState).includes('mobileStyles'))) {
        apply();
        if (preview && selection) select(elements.get(selection));
      }
    }, 180);
  });
  return () => {
    abort.abort();
    observer.disconnect();
    clearTimeout(resizeTimer);
    resetGlobal();
    toolbar?.remove();
    document.getElementById('ve-theme')?.remove();
    document.body.classList.remove('ve-editable', 've-interactive');
    document.documentElement.classList.remove('ve-no-motion');
    for (const el of elements.values()) el.classList.remove('ve-selected');
  };
};
