// Google Analytics 4 with Google Consent Mode v2, loaded on every page. GA_ID is the property's measurement ID (G-…).
// It only loads on the live site (duskora.ai), so local previews and test runs don't send fake visits; elsewhere, or
// with GA_ID empty, nothing loads, no consent banner shows and window.gtag stays undefined, so callers must guard with
// `window.gtag &&`.
// Consent: every signal defaults to denied before gtag.js loads, so GA sets no cookies until the visitor accepts in the
// banner. The choice is kept in localStorage under CONSENT_KEY ('granted' or 'denied'); the footer "Cookie settings"
// button reopens the banner. The privacy page's "Cookies and analytics" section describes this.
// Events: page views (automatic), sign_up_click (sign-up and pricing CTAs), beta_request_submitted (beta/index.html).
(function () {
  var GA_ID = 'G-CGBBLYCXMM';
  if (!GA_ID || location.hostname !== 'duskora.ai') return;

  var CONSENT_KEY = 'duskora-consent';
  var SIGNALS = ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage'];

  function consent(value) {
    var c = {};
    for (var i = 0; i < SIGNALS.length; i++) c[SIGNALS[i]] = value;
    return c;
  }
  function stored() {
    try { var v = localStorage.getItem(CONSENT_KEY); return v === 'granted' || v === 'denied' ? v : null; } catch (e) { return null; }
  }
  function store(v) {
    try { localStorage.setItem(CONSENT_KEY, v); } catch (e) { /* private mode: the choice lasts for this page only */ }
  }

  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag('consent', 'default', consent('denied'));
  window.gtag('set', 'ads_data_redaction', true);
  var choice = stored();
  if (choice === 'granted') window.gtag('consent', 'update', consent('granted'));
  window.gtag('js', new Date());
  window.gtag('config', GA_ID, { anonymize_ip: true });

  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID);
  document.head.appendChild(s);

  var banner;
  function hide() { if (banner) banner.hidden = true; }
  function decide(v) {
    store(v);
    window.gtag('consent', 'update', consent(v));
    hide();
  }
  function show() {
    if (!banner) {
      banner = document.createElement('section');
      banner.className = 'consent';
      banner.setAttribute('aria-label', 'Cookie consent');
      banner.innerHTML =
        '<p>We use Google Analytics cookies to see how people find this site and how many go on to sign up. ' +
        'They are only set if you accept. <a href="/privacy/#cookies">Privacy policy</a></p>' +
        '<div class="consent-actions">' +
        '<button type="button" class="btn btn-ghost" data-consent="denied">Reject</button>' +
        '<button type="button" class="btn btn-ghost" data-consent="granted">Accept</button>' +
        '</div>';
      banner.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('button[data-consent]');
        if (b) decide(b.getAttribute('data-consent'));
      });
      document.body.appendChild(banner);
    }
    banner.hidden = false;
  }

  function init() {
    var legal = document.querySelector('footer nav[aria-label="Legal"]');
    if (legal) {
      var settings = document.createElement('button');
      settings.type = 'button';
      settings.className = 'foot-button';
      settings.textContent = 'Cookie settings';
      settings.addEventListener('click', show);
      legal.appendChild(settings);
    }
    if (!choice) show();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

// Funnel clicks: the hero/closing "Start free trial" buttons (data-signup) and the pricing plan buttons (data-cta).
document.addEventListener('click', function (e) {
  var a = e.target.closest && e.target.closest('a[data-signup], a[data-cta]');
  if (!a || !window.gtag) return;
  var params = { link_url: a.href, page_path: location.pathname };
  if (a.hasAttribute('data-cta')) params.plan = a.getAttribute('data-cta');
  window.gtag('event', 'sign_up_click', params);
});
