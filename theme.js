// Day / night switch. With no stored choice the page follows the system
// setting; flipping the switch stores an explicit one.
//
// The inline bootstrap in <head> puts `.dark` on <html> before first paint,
// and CSS derives the knob position and icon from that class. This script
// only owns the state: the class, the stored choice, and aria-checked.
(function () {
  const root = document.documentElement;
  const control = document.getElementById('theme-switch');
  if (!control) return;

  const media = window.matchMedia('(prefers-color-scheme: dark)');

  function isDark() {
    const stored = localStorage.getItem('theme');
    return stored ? stored === 'dark' : media.matches;
  }

  function render(dark) {
    root.classList.toggle('dark', dark);
    control.setAttribute('aria-checked', String(dark));
  }

  render(isDark());

  control.addEventListener('click', () => {
    const next = !isDark();
    localStorage.setItem('theme', next ? 'dark' : 'light');
    render(next);
  });

  // Only track the system while the visitor has not chosen for themselves.
  media.addEventListener('change', () => {
    if (!localStorage.getItem('theme')) render(media.matches);
  });
})();
