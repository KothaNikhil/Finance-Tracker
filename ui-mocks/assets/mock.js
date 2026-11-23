/*
 * Finance Tracker UI mocks — shared page behaviour.
 *  - Adds the toolbar (back to index + Light / Dark / System theme toggle).
 *  - Fills every <nav class="tabbar" data-active="home|activity|import|lending|settings" data-badge="N">
 *    with the app's five tabs (mobile/src/components/app-tabs.tsx).
 *  - Fills every <div class="status-bar"></div> with a static Android-style status bar.
 * No app runtime, no network calls beyond the Google Fonts stylesheet.
 */
(function () {
  var KEY = 'ft-mock-theme';
  var root = document.documentElement;

  function readPref() {
    try { return localStorage.getItem(KEY) || 'system'; } catch (e) { return 'system'; }
  }
  function applyPref(pref) {
    if (pref === 'light' || pref === 'dark') root.setAttribute('data-theme', pref);
    else root.removeAttribute('data-theme');
    try { localStorage.setItem(KEY, pref); } catch (e) { /* storage unavailable */ }
    var btns = document.querySelectorAll('[data-theme-btn]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-pressed', String(btns[i].getAttribute('data-theme-btn') === pref));
      btns[i].style.borderColor = btns[i].getAttribute('data-theme-btn') === pref ? 'var(--accent)' : '';
      btns[i].style.color = btns[i].getAttribute('data-theme-btn') === pref ? 'var(--accent)' : '';
    }
  }
  applyPref(readPref());

  var TABS = [
    { key: 'home', label: 'Home', icon: 'home', href: 'home.html' },
    { key: 'activity', label: 'Activity', icon: 'history', href: 'activity.html' },
    { key: 'import', label: 'Import', icon: 'file_download', href: 'import.html' },
    { key: 'lending', label: 'Lending', icon: 'swap_horiz', href: 'lending.html' },
    { key: 'settings', label: 'Settings', icon: 'settings', href: 'settings.html' },
  ];

  function fillTabbars() {
    var bars = document.querySelectorAll('nav.tabbar');
    for (var b = 0; b < bars.length; b++) {
      var bar = bars[b];
      if (bar.children.length) continue;
      var active = bar.getAttribute('data-active');
      var badge = bar.getAttribute('data-badge');
      var html = '';
      for (var i = 0; i < TABS.length; i++) {
        var t = TABS[i];
        var badgeHtml =
          t.key === 'activity' && badge && badge !== '0'
            ? '<span class="tab-badge">' + (Number(badge) > 99 ? '99+' : badge) + '</span>'
            : '';
        html +=
          '<a class="tab' + (t.key === active ? ' is-active' : '') + '" href="' + t.href + '">' +
          '<span class="tab-ind"><span class="ms">' + t.icon + '</span>' + badgeHtml + '</span>' +
          '<span>' + t.label + '</span></a>';
      }
      bar.innerHTML = html;
    }
  }

  function fillStatusBars() {
    var bars = document.querySelectorAll('.status-bar');
    for (var i = 0; i < bars.length; i++) {
      if (bars[i].children.length) continue;
      bars[i].innerHTML =
        '<span>9:41</span><span class="row gap-1"><span class="ms">signal_cellular_alt</span>' +
        '<span class="ms">wifi</span><span class="ms">battery_full</span></span>';
    }
  }

  function addToolbar() {
    if (document.querySelector('.mock-toolbar') || document.body.hasAttribute('data-no-toolbar')) return;
    var isIndex = /(^|\/)index\.html$/.test(location.pathname) || /\/ui-mocks\/?$/.test(location.pathname);
    var bar = document.createElement('div');
    bar.className = 'mock-toolbar';
    bar.innerHTML =
      (isIndex ? '' : '<a href="index.html">← All screens</a>') +
      '<span class="mock-title">' + document.title + '</span>' +
      '<span class="muted">Theme</span>' +
      '<button type="button" data-theme-btn="light">Light</button>' +
      '<button type="button" data-theme-btn="dark">Dark</button>' +
      '<button type="button" data-theme-btn="system">System</button>';
    document.body.insertBefore(bar, document.body.firstChild);
    bar.addEventListener('click', function (e) {
      var t = e.target.closest('[data-theme-btn]');
      if (t) applyPref(t.getAttribute('data-theme-btn'));
    });
    applyPref(readPref());
  }

  // Simple tab switching inside a mock: <div data-tabs> with [data-tab="x"] buttons and [data-panel="x"].
  function wireLocalTabs() {
    var groups = document.querySelectorAll('[data-tabs]');
    for (var g = 0; g < groups.length; g++) {
      (function (group) {
        group.addEventListener('click', function (e) {
          var t = e.target.closest('[data-tab]');
          if (!t || !group.contains(t)) return;
          var key = t.getAttribute('data-tab');
          var tabs = group.querySelectorAll('[data-tab]');
          for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('is-selected', tabs[i] === t);
          var panels = group.querySelectorAll('[data-panel]');
          for (var j = 0; j < panels.length; j++) panels[j].hidden = panels[j].getAttribute('data-panel') !== key;
        });
      })(groups[g]);
    }
  }

  function init() {
    addToolbar();
    fillStatusBars();
    fillTabbars();
    wireLocalTabs();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
