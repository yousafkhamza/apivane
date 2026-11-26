// Runs before first paint so there is no light/dark flash. Default follows the device.
(function () {
  var p = 'system';
  try { p = localStorage.getItem('apivane.theme') || 'system'; } catch (e) { /* private mode */ }
  var dark = p === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches : p === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
