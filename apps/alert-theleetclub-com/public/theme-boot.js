(function () {
  try {
    var t = localStorage.getItem('alert_ui_theme_v1');
    if (t !== 'classic' && t !== 'pro') t = 'classic';
    var m = localStorage.getItem('alert_ui_color_mode_v1');
    if (m !== 'light' && m !== 'dark') m = t === 'pro' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    document.documentElement.setAttribute('data-mode', m);
    document.documentElement.style.colorScheme = m;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      if (m === 'light') meta.setAttribute('content', t === 'pro' ? '#e8edf3' : '#f4f1ec');
      else meta.setAttribute('content', t === 'pro' ? '#0b1220' : '#0c0f14');
    }
  } catch (e) {}
})();
