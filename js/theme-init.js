/* Runs before first paint so dark-mode users never see a white flash. */
(function () {
  var t = 'light';
  try { t = localStorage.getItem('odea-theme') || 'light'; } catch (e) {}
  if (t === 'system') t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t);
})();
