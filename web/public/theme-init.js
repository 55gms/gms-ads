(function () {
  var pref = 'system';
  try {
    pref = localStorage.getItem('theme') || 'system';
  } catch (e) {
    /* storage unavailable */
  }
  var dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
