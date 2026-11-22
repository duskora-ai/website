// Motion and small interactions for every page: scroll reveals, parallax, the typed hero headline, the hero's example
// ticket run, the phone menu, the image viewer and the reading-progress bar. styles.css holds the looks; this file only
// adds classes and CSS variables. Each page's <head> adds the `js` class to <html> before first paint, so the styles can
// hide what gets revealed on scroll; pages stay complete without JavaScript, and with "reduce motion" set nothing moves.
(function () {
  'use strict';
  window.duskoraMotion = true;

  var root = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (sel, el) { return (el || document).querySelector(sel); };
  var $$ = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var clamp = function (n, lo, hi) { return Math.min(hi, Math.max(lo, n)); };

  // ---- Typing: wrap each letter in a span and show them one at a time. The text never leaves the page, so the
  // layout doesn't move and search engines and screen readers get the whole sentence. ----
  function splitChars(el) {
    var spans = [];
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (node) {
      var frag = document.createDocumentFragment();
      node.textContent.split('').forEach(function (c) {
        var s = document.createElement('span');
        s.className = 'ch';
        s.textContent = c;
        frag.appendChild(s);
        spans.push(s);
      });
      node.parentNode.replaceChild(frag, node);
    });
    el.classList.add('typing');
    return spans;
  }
  function typeOut(spans, ms, alive) {
    var i = 0;
    return new Promise(function (resolve) {
      (function next() {
        if (alive && !alive()) return resolve(false);
        if (i > 0) spans[i - 1].classList.remove('cur');
        if (i >= spans.length) return resolve(true);
        spans[i].classList.add('on', 'cur');
        i++;
        setTimeout(next, spans[i - 1].textContent === ' ' ? ms / 2 : ms * (0.6 + Math.random() * 0.8));
      })();
    });
  }

  // ---- Header: solid once the page scrolls, a reading-progress bar, the phone menu, and the current section. ----
  var bar = document.createElement('div');
  bar.className = 'scroll-progress';
  bar.setAttribute('aria-hidden', 'true');
  document.body.appendChild(bar);

  var header = $('header');
  var nav = $('.nav');
  if (header && nav && $('.nav-links .hide-sm')) {
    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'nav-toggle';
    toggle.setAttribute('aria-label', 'Menu');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = '<span></span><span></span><span></span>';
    nav.appendChild(toggle);
    var setMenu = function (open) {
      header.classList.toggle('nav-open', open);
      toggle.setAttribute('aria-expanded', String(open));
    };
    toggle.addEventListener('click', function () { setMenu(!header.classList.contains('nav-open')); });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });
  }

  var spy = $$('.nav-links a[href^="#"]').map(function (a) {
    return { link: a, section: document.getElementById(a.getAttribute('href').slice(1)) };
  }).filter(function (s) { return s.section; });

  // ---- Scroll-linked values, set once per frame ----
  var hero = $('.hero');
  var parallax = $$('[data-parallax]');
  var progress = $$('[data-progress]');
  var ticking = false;
  function frame() {
    ticking = false;
    var y = window.scrollY;
    var vh = window.innerHeight;
    var max = root.scrollHeight - vh;
    bar.style.setProperty('--sp', max > 0 ? clamp(y / max, 0, 1).toFixed(4) : 0);
    root.classList.toggle('scrolled', y > 12);

    var current = null;
    spy.forEach(function (s) { if (s.section.getBoundingClientRect().top < vh * 0.4) current = s; });
    spy.forEach(function (s) {
      if (s === current) s.link.setAttribute('aria-current', 'location'); else s.link.removeAttribute('aria-current');
    });

    progress.forEach(function (el) {
      var r = el.getBoundingClientRect();
      el.style.setProperty('--p', clamp((vh * 0.72 - r.top) / r.height, 0, 1).toFixed(3));
    });
    if (reduce) return;
    // The hero sky: the sun sinks and the stars drift while the hero is on screen.
    if (hero && y < hero.offsetHeight) hero.style.setProperty('--sy', y.toFixed(1));
    parallax.forEach(function (el) {
      // The value moves a background layer inside the element, never the element itself, so measuring it is stable.
      var r = el.getBoundingClientRect();
      if (r.bottom < -200 || r.top > vh + 200) return;
      var speed = parseFloat(el.getAttribute('data-parallax')) || 0;
      el.style.setProperty('--py', ((r.top + r.height / 2 - vh / 2) * speed).toFixed(1) + 'px');
    });
  }
  function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  frame();

  // ---- Scroll reveals ----
  // The home page marks its elements with data-reveal. The other pages get theirs here, for elements below the fold only,
  // so nothing already on screen is hidden and shown again.
  var IMAGE_KINDS = ['wipe-r', 'iris', 'wipe-u', 'focus'];
  [
    ['.featured, .post-cta', 'scale'],
    ['.post-list > li, .archive h2, .prose > h2, .steps li, .feature-list li, .chips, .share, .next-grid a, .post-figure figcaption, .beta-steps li, .beta-perks li, .beta-details h2, .closer:not([data-reveal])', 'up']
  ].forEach(function (pair) {
    $$(pair[0]).forEach(function (el) {
      if (!el.hasAttribute('data-reveal') && el.getBoundingClientRect().top > window.innerHeight) el.setAttribute('data-reveal', pair[1]);
    });
  });
  $$('.post-figure > picture, .post-figure > video, .compare').forEach(function (el, i) {
    if (el.getBoundingClientRect().top > window.innerHeight) el.setAttribute('data-reveal', IMAGE_KINDS[i % IMAGE_KINDS.length]);
  });

  function show(el, i, instant) {
    if (instant) { el.classList.add('in', 'done'); return; }
    el.style.setProperty('--i', i);
    var img = el.tagName === 'IMG' ? el : $('img', el);
    var go = function () {
      el.classList.add('in');
      // .done hands the element's transitions back to its own hover styles.
      setTimeout(function () { el.classList.add('done'); }, 2200 + i * 80);
    };
    // An image is revealed once it has loaded, so the effect plays on the picture and not on an empty box.
    if (img && !img.complete) {
      img.addEventListener('load', go, { once: true });
      img.addEventListener('error', go, { once: true });
    } else go();
  }
  var targets = $$('[data-reveal]');
  if (reduce || !('IntersectionObserver' in window)) {
    targets.forEach(function (el) { show(el, 0, true); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      var i = 0;
      entries.forEach(function (entry) {
        var above = !entry.isIntersecting && entry.boundingClientRect.bottom < 0;
        if (!entry.isIntersecting && !above) return;
        io.unobserve(entry.target);
        // Elements that arrive together are staggered; ones already scrolled past just appear.
        show(entry.target, above ? 0 : Math.min(i++, 6), above);
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.08 });
    targets.forEach(function (el) { io.observe(el); });
  }

  // Feature icons draw themselves: give every stroke a length of 1 for the dash animation in styles.css.
  $$('.icon svg *').forEach(function (shape) { shape.setAttribute('pathLength', '1'); });

  // Prices flip in when the billing interval or currency changes (the page's own script has re-rendered them by now).
  var plans = document.getElementById('plans');
  ['interval-switch', 'currency-switch'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el || !plans) return;
    el.addEventListener('change', function () {
      plans.classList.remove('flip');
      void plans.offsetWidth;
      plans.classList.add('flip');
    });
  });

  // ---- Pointer: a soft light that follows the cursor over cards, and a slight tilt on the hero's example run. ----
  var run = document.getElementById('run');
  if (!reduce && window.matchMedia('(hover: hover)').matches) {
    document.addEventListener('pointermove', function (e) {
      var card = e.target.closest && e.target.closest('.feature, .tl-item, .plan');
      if (card) {
        var r = card.getBoundingClientRect();
        card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        card.style.setProperty('--my', (e.clientY - r.top) + 'px');
      }
    }, { passive: true });
    if (hero && run) {
      hero.addEventListener('pointermove', function (e) {
        var r = hero.getBoundingClientRect();
        run.style.setProperty('--ry', (((e.clientX - r.left) / r.width - 0.5) * 7).toFixed(2) + 'deg');
        run.style.setProperty('--rx', (((e.clientY - r.top) / r.height - 0.5) * -5).toFixed(2) + 'deg');
      }, { passive: true });
      hero.addEventListener('pointerleave', function () { run.style.setProperty('--ry', '0deg'); run.style.setProperty('--rx', '0deg'); });
    }
  }

  // ---- Hero sky: stars drawn once on a canvas, thinning out towards the horizon. ----
  var sky = $('.hero-stars');
  function drawStars() {
    var w = sky.clientWidth, h = sky.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!w || !h) return;
    sky.width = w * dpr;
    sky.height = h * dpr;
    var ctx = sky.getContext('2d');
    ctx.scale(dpr, dpr);
    // A fixed seed, so the sky looks the same on every visit and after a resize.
    var seed = 7;
    var rand = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    var count = Math.round((w * h) / 5200);
    for (var i = 0; i < count; i++) {
      var x = rand() * w, y = Math.pow(rand(), 1.7) * h * 0.86, size = 0.4 + rand() * rand() * 1.5;
      ctx.globalAlpha = (0.25 + rand() * 0.75) * (1 - y / h);
      ctx.fillStyle = rand() > 0.85 ? '#ffd9a8' : rand() > 0.6 ? '#cfc9ff' : '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (sky && sky.getContext) {
    drawStars();
    var resizeTimer;
    var lastWidth = window.innerWidth;
    window.addEventListener('resize', function () {
      if (window.innerWidth === lastWidth) return; // phones resize when the address bar hides; only the width matters
      lastWidth = window.innerWidth;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(drawStars, 150);
    });
  }

  // ---- Hero headline: the highlighted words are typed in. ----
  var typed = $('[data-type]');
  if (typed && !reduce) {
    var letters = splitChars(typed);
    wait(650).then(function () { return typeOut(letters, 62); }).then(function () {
      // Leave the caret blinking at the end for a moment.
      var last = letters[letters.length - 1];
      last.classList.add('cur');
      setTimeout(function () { last.classList.remove('cur'); }, 2600);
    });
  }

  // ---- Hero demo: an example ticket is typed through Plan, Build, Review and QA, then waits at the approval gate.
  // Pressing Approve deploys it. The markup holds the "waiting for approval" state, which is what shows without
  // JavaScript and with reduced motion. ----
  if (run) {
    var steps = $$('.run-steps li', run);
    var names = steps.map(function (li) { return $('.run-name', li).textContent; });
    var lines = steps.map(function (li) { return $('.run-line', li); });
    var badge = document.getElementById('run-badge');
    var status = document.getElementById('run-status');
    var approve = document.getElementById('run-approve');
    var GATE = 4, DEPLOY = 5;
    var ORIG = lines.map(function (line) { return line.textContent; });
    var glyphs = [];
    var token = 0; // changes when a run restarts, so an older run stops typing
    var phase = 'gate';

    var mark = function (i, state) { steps[i].className = state; };
    var say = function (i, text) { lines[i].classList.remove('typing'); lines[i].textContent = text; };
    // Put a line's text in place with every letter hidden, ready to be typed.
    var prepare = function (i, text) { lines[i].textContent = text; glyphs[i] = splitChars(lines[i]); };
    var stage = function (i, mine) {
      mark(i, 'active');
      badge.textContent = names[i];
      run.setAttribute('data-state', names[i].toLowerCase());
      return typeOut(glyphs[i], 16, function () { return mine === token; }).then(function (ok) {
        return ok ? wait(420).then(function () { return mine === token; }) : false;
      });
    };

    var play = function () {
      var mine = ++token;
      phase = 'running';
      approve.disabled = true;
      approve.classList.remove('ready');
      approve.textContent = 'Approve';
      status.textContent = 'Agents are working.';
      steps.forEach(function (li, i) { mark(i, 'todo'); prepare(i, ORIG[i]); });
      var chain = wait(500).then(function () { return mine === token; });
      [0, 1, 2, 3].forEach(function (i) {
        chain = chain.then(function (ok) {
          return ok && stage(i, mine).then(function (done) { if (done) mark(i, 'done'); return done; });
        });
      });
      chain.then(function (ok) { return ok && stage(GATE, mine); }).then(function (ok) {
        if (!ok) return;
        phase = 'gate';
        status.textContent = 'Nothing ships without you.';
        approve.disabled = false;
        approve.classList.add('ready');
      });
    };

    var SHIPPING = 'Merged. Watching the deploy through to production.';
    var ship = function () {
      var mine = ++token;
      phase = 'running';
      approve.disabled = true;
      approve.classList.remove('ready');
      say(GATE, 'Approved by you.');
      mark(GATE, 'done');
      status.textContent = 'Deploying.';
      var finish = function () {
        mark(DEPLOY, 'done');
        badge.textContent = 'Shipped';
        run.setAttribute('data-state', 'shipped');
        status.textContent = 'Shipped to production.';
        approve.textContent = 'Run it again';
        approve.disabled = false;
        phase = 'shipped';
      };
      if (reduce) { say(DEPLOY, SHIPPING); finish(); return; }
      prepare(DEPLOY, SHIPPING);
      stage(DEPLOY, mine).then(function (ok) { if (ok) finish(); });
    };

    approve.addEventListener('click', function () {
      if (phase === 'gate') ship();
      else if (phase === 'shipped') {
        if (reduce) {
          // Back to the waiting state from the markup, without the typing.
          token++;
          [0, 1, 2, 3].forEach(function (i) { mark(i, 'done'); });
          mark(GATE, 'active');
          mark(DEPLOY, 'todo');
          say(GATE, ORIG[GATE]);
          say(DEPLOY, ORIG[DEPLOY]);
          badge.textContent = names[GATE];
          run.setAttribute('data-state', 'approval');
          status.textContent = 'Nothing ships without you.';
          approve.textContent = 'Approve';
          phase = 'gate';
        } else play();
      }
    });

    if (!reduce) {
      if ('IntersectionObserver' in window) {
        var seen = new IntersectionObserver(function (entries) {
          if (!entries[0].isIntersecting) return;
          seen.disconnect();
          play();
        }, { threshold: 0.35 });
        seen.observe(run);
      } else play();
    }
  }

  // ---- Before/after sliders: the range input's value is where the old picture ends and the new one begins.
  // The first time one scrolls into view the handle sways once, to show that it moves; any touch stops that. ----
  $$('.compare').forEach(function (el) {
    var range = $('.compare-range', el);
    var touched = false;
    var set = function (v) { el.style.setProperty('--pos', v + '%'); };
    var stop = function () { touched = true; };
    range.addEventListener('input', function () { stop(); set(range.value); });
    range.addEventListener('pointerdown', stop);
    range.addEventListener('keydown', stop);
    set(range.value);
    if (reduce || !('IntersectionObserver' in window)) return;
    var hint = new IntersectionObserver(function (entries) {
      if (!entries[0].isIntersecting) return;
      hint.disconnect();
      var start = null;
      (function sway(now) {
        if (touched) return;
        if (start === null) start = now;
        var t = (now - start) / 2200;
        if (t >= 1) { set(range.value); return; }
        // out to one side, across to the other and back to the middle
        set((+range.value + Math.sin(t * Math.PI * 2) * 16 * (1 - t * 0.3)).toFixed(2));
        requestAnimationFrame(sway);
      })(performance.now());
    }, { threshold: 0.6 });
    hint.observe(el);
  });

  // ---- Image viewer: click or press Enter on a screenshot to see it large. ----
  var box;
  function openViewer(img) {
    if (!box) {
      box = document.createElement('dialog');
      box.className = 'lightbox';
      box.setAttribute('aria-label', 'Enlarged image');
      box.innerHTML = '<button type="button" aria-label="Close">×</button><img alt="" />';
      box.addEventListener('click', function () { box.close(); });
      document.body.appendChild(box);
    }
    var big = $('img', box);
    // The page shows the 600 or 760 pixel wide file; the viewer asks for the one twice that size.
    big.src = (img.currentSrc || img.src).replace(/-(600|760)\.(avif|webp)$/, function (m, w, ext) { return '-' + w * 2 + '.' + ext; });
    big.alt = img.alt;
    box.showModal();
  }
  if (window.HTMLDialogElement) {
    $$('.shot picture, .post-figure > picture').forEach(function (pic) {
      var img = $('img', pic);
      if (!img) return;
      pic.setAttribute('role', 'button');
      pic.setAttribute('tabindex', '0');
      pic.setAttribute('aria-label', 'Enlarge image: ' + img.alt);
      pic.addEventListener('click', function () { openViewer(img); });
      pic.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openViewer(img); }
      });
    });
  }
})();
