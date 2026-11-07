// Google Analytics 4, loaded on every page. GA_ID is the property's measurement ID (G-…). It only loads on the live
// site (duskora.ai), so local previews and test runs don't send fake visits; elsewhere, or with GA_ID empty, nothing
// loads and window.gtag stays undefined, so callers must guard with `window.gtag &&`.
// Events: page views (automatic), sign_up_click (sign-up and pricing CTAs), beta_request_submitted (beta/index.html).
(function () {
  var GA_ID = 'G-CGBBLYCXMM';
  if (!GA_ID || location.hostname !== 'duskora.ai') return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', GA_ID, { anonymize_ip: true });

  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID);
  document.head.appendChild(s);
})();

// Funnel clicks: the hero/closing "Start free trial" buttons (data-signup) and the pricing plan buttons (data-cta).
document.addEventListener('click', function (e) {
  var a = e.target.closest && e.target.closest('a[data-signup], a[data-cta]');
  if (!a || !window.gtag) return;
  var params = { link_url: a.href, page_path: location.pathname };
  if (a.hasAttribute('data-cta')) params.plan = a.getAttribute('data-cta');
  window.gtag('event', 'sign_up_click', params);
});
