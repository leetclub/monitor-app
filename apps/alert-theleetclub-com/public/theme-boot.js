(function () {
  try {
    var t = localStorage.getItem('alert_ui_theme_v1');
    if (t !== 'classic' && t !== 'pro') t = 'classic';
    document.documentElement.setAttribute('data-theme', t);
    document.documentElement.style.colorScheme = 'dark';
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'pro' ? '#060d19' : '#0c0f14');
  } catch (e) {}
})();
