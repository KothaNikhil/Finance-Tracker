/*
 * Finance Tracker — WEBSITE mock runtime (no app code, no network).
 *
 *  - URL params: ?theme=light|dark|system  &state=<page state>  &sync=saved|saving|unsaved|offline|reconnect|conflict|inuse|viewonly|moved
 *  - Builds the responsive shell around <main class="w-main">: sidebar (desktop/tablet), top bar with the
 *    Drive save status, phone bottom tabs, and the shell-level sync banner / conflict dialog.
 *  - Page states: <body data-states="key=Label|key2=Label2">. Elements with data-only="a b" show only in
 *    those states; data-except="a b" hide in them. A page can define window.PAGE.init(state) for extra setup.
 *  - Talks to the viewer (index.html) with postMessage, so it works from file:// too.
 */
(function () {
  var params = new URLSearchParams(location.search);
  var root = document.documentElement;
  var inFrame = window.parent !== window;

  /* ---------- Theme ---------- */
  var theme = params.get('theme') || 'system';
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);

  /* ---------- Formatting ---------- */
  function inr(n, opts) {
    opts = opts || {};
    var neg = n < 0; n = Math.abs(n);
    var fixed = n.toFixed(opts.noPaise ? 0 : 2);
    var parts = fixed.split('.');
    var int = parts[0];
    var last3 = int.slice(-3), rest = int.slice(0, -3);
    if (rest) last3 = ',' + last3;
    var grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + last3;
    var s = '₹' + grouped + (parts[1] ? '.' + parts[1] : '');
    if (opts.sign) return (neg ? '−' : '+') + s;
    return (neg ? '−' : '') + s;
  }

  /* ---------- Shared sample data ---------- */
  var EM = {
    'Food & Dining': '🍽️', Groceries: '🛒', Commute: '🚕', Shopping: '🛍️', 'Bills & Utilities': '💡',
    'Medicine & Health': '💊', Rent: '🏠', EMI: '🚗', Investments: '📈', Entertainment: '🎬',
    Travel: '✈️', Salary: '💼', CashBack: '🎁', Transfers: '🔁', Education: '🎓', 'Personal Care': '💇',
    Uncategorized: '❔',
  };
  // [id, date, time, payee, category, sub, amount(+in/−out), account, for, flags]
  var T = [
    [1301, '2026-11-22', '20:14', 'Zomato', 'Food & Dining', 'Restaurant', -452, 'HDFC Bank - 09', 'Self', ''],
    [1300, '2026-11-22', '13:02', 'BigBasket', 'Groceries', 'Monthly groceries', -2318.5, 'HDFC Bank - 09', 'Family', ''],
    [1299, '2026-11-21', '19:40', 'Rahul Verma', 'Uncategorized', '', -1200, 'HDFC Bank - 09', '', 'review'],
    [1298, '2026-11-21', '09:15', 'Uber India', 'Commute', 'Cab', -218.4, 'Axis Credit Card', 'Self', ''],
    [1297, '2026-11-20', '18:22', 'Flipkart Payments', 'CashBack', 'Refund', 1299, 'HDFC Bank - 09', 'Self', 'refund'],
    [1296, '2026-11-20', '11:05', 'Tata Power', 'Bills & Utilities', 'Electricity', -3140, 'HDFC Bank - 09', 'Family', ''],
    [1295, '2026-11-19', '21:48', 'BookMyShow', 'Entertainment', 'Movies', -640, 'Axis Credit Card', 'Self', ''],
    [1294, '2026-11-19', '08:31', 'MedPlus Pharmacy', 'Medicine & Health', 'Medicines', -386, 'HDFC Bank - 09', 'Amma', ''],
    [1293, '2026-11-18', '16:10', 'Self · HDFC → SBI', 'Transfers', 'Self-transfer', -25000, 'HDFC Bank - 09', '', 'self'],
    [1292, '2026-11-18', '10:00', 'Swiggy Instamart', 'Uncategorized', '', -764, 'HDFC Bank - 09', '', 'review'],
    [1291, '2026-11-17', '19:12', 'Amazon Pay', 'Shopping', 'Electronics', -4499, 'Axis Credit Card', 'Self', ''],
    [1290, '2026-11-16', '12:45', 'Indian Oil', 'Commute', 'Fuel', -2000, 'Axis Credit Card', 'Self', ''],
    [1289, '2026-11-15', '09:00', 'Zerodha', 'Investments', 'SIP', -10000, 'HDFC Bank - 09', 'Self', ''],
    [1288, '2026-11-12', '07:58', 'Kotak Prime · Car EMI', 'EMI', 'Car', -27000, 'HDFC Bank - 09', 'Self', ''],
    [1287, '2026-11-10', '22:05', 'Arjun Mehta', 'Transfers', 'Money lent', 20000, 'HDFC Bank - 09', 'Arjun', 'lent'],
    [1286, '2026-11-05', '08:00', 'Landlord · S. Iyer', 'Rent', 'House rent', -32000, 'HDFC Bank - 09', 'Family', ''],
    [1285, '2026-11-01', '09:30', 'Tektron Pvt Ltd', 'Salary', 'Monthly salary', 182500, 'HDFC Bank - 09', 'Self', ''],
    [1284, '2026-10-31', '20:14', 'Dominos', 'Food & Dining', 'Restaurant', -689, 'HDFC Bank - 09', 'Self', ''],
    [1283, '2026-10-30', '18:40', 'Airtel', 'Bills & Utilities', 'Mobile', -599, 'Axis Credit Card', 'Self', ''],
    [1282, '2026-10-29', '13:20', 'Reliance Smart', 'Groceries', 'Vegetables', -1146, 'HDFC Bank - 09', 'Family', ''],
    [1281, '2026-10-28', '17:05', 'Axis Bank · Card bill', 'Transfers', 'Card bill', -18420, 'HDFC Bank - 09', '', 'card'],
    [1280, '2026-10-27', '10:11', 'Cult.fit', 'Personal Care', 'Gym', -1999, 'Axis Credit Card', 'Self', ''],
    [1279, '2026-10-26', '21:30', 'Unknown UPI · 98xxxx2210', 'Uncategorized', '', -350, 'HDFC Bank - 09', '', 'review'],
    [1278, '2026-10-25', '15:55', 'IRCTC', 'Travel', 'Train', -2140, 'HDFC Bank - 09', 'Family', ''],
  ];
  var TXNS = T.map(function (r) {
    return { id: r[0], date: r[1], time: r[2], payee: r[3], cat: r[4], sub: r[5], amt: r[6], acc: r[7], who: r[8], flag: r[9], em: EM[r[4]] || '•' };
  });
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function dshort(iso) { var p = iso.split('-'); return Number(p[2]) + ' ' + MONTHS[Number(p[1]) - 1]; }
  function dlong(iso) { var p = iso.split('-'); return Number(p[2]) + ' ' + MONTHS[Number(p[1]) - 1] + ' ' + p[0]; }
  function monthKey(iso) { return iso.slice(0, 7); }
  function monthLabel(key) { var p = key.split('-'); return MONTHS_LONG[Number(p[1]) - 1] + ' ' + p[0]; }

  /* ---------- Page states ---------- */
  var states = (document.body.getAttribute('data-states') || '').split('|').filter(Boolean).map(function (s) {
    var i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)];
  });
  var state = params.get('state') || (states[0] && states[0][0]) || 'default';
  var sync = params.get('sync') || document.body.getAttribute('data-sync') || 'saved';
  document.body.setAttribute('data-state', state);

  function applyStateVisibility(scope) {
    var only = (scope || document).querySelectorAll('[data-only]');
    for (var i = 0; i < only.length; i++) only[i].hidden = only[i].getAttribute('data-only').split(' ').indexOf(state) < 0;
    var exc = (scope || document).querySelectorAll('[data-except]');
    for (var j = 0; j < exc.length; j++) exc[j].hidden = exc[j].getAttribute('data-except').split(' ').indexOf(state) >= 0;
  }

  /* ---------- Shell ---------- */
  var NAV = [
    { key: 'home', label: 'Home', icon: 'home', href: 'home.html' },
    { key: 'activity', label: 'Activity', icon: 'history', href: 'activity.html', count: 12 },
    { key: 'import', label: 'Import', icon: 'file_download', href: 'import.html' },
    { key: 'lending', label: 'Lending', icon: 'swap_horiz', href: 'lending.html' },
    { key: 'settings', label: 'Settings', icon: 'settings', href: 'settings.html' },
  ];
  function withParams(href) {
    var q = new URLSearchParams();
    if (theme !== 'system') q.set('theme', theme);
    if (sync !== 'saved') q.set('sync', sync);
    var s = q.toString();
    return s ? href + '?' + s : href;
  }

  var SYNC = {
    saved: { icon: 'cloud_done', text: 'Saved to Drive · 2 min ago' },
    saving: { icon: 'progress_activity', text: 'Saving…' },
    unsaved: { icon: 'cloud_upload', text: 'Unsaved · 3 changes' },
    offline: { icon: 'cloud_off', text: 'Offline · will retry' },
    reconnect: { icon: 'link_off', text: 'Reconnect Drive' },
    conflict: { icon: 'error', text: 'Conflict · action needed' },
    // Single-editor lock (finance-session.json in Drive). Only the device holding it saves.
    inuse: { icon: 'devices', text: 'In use on your phone' },
    viewonly: { icon: 'visibility', text: 'View only' },
    moved: { icon: 'phonelink_lock', text: 'View only · editing moved' },
  };
  var READ_ONLY = { offline: 1, reconnect: 1, inuse: 1, viewonly: 1, moved: 1 };
  if (READ_ONLY[sync]) document.documentElement.classList.add('is-viewonly');

  function buildShell() {
    var app = document.querySelector('.w-app');
    if (!app) return;
    var active = document.body.getAttribute('data-nav');
    var title = document.body.getAttribute('data-title') || document.title;
    var col = app.querySelector('.w-col');

    // Sidebar
    var side = document.createElement('aside');
    side.className = 'w-side';
    var nav = NAV.map(function (n) {
      return '<a class="w-nav__item' + (n.key === active ? ' is-active' : '') + '" href="' + withParams(n.href) + '" title="' + n.label + '">' +
        '<span class="ms">' + n.icon + '</span><span class="w-nav__label">' + n.label + '</span>' +
        (n.count ? '<span class="pill-count w-nav__count" title="' + n.count + ' need review">' + n.count + '</span>' : '') + '</a>';
    }).join('');
    side.innerHTML =
      '<div class="w-brand"><span class="w-brand__mark"><span class="ms">account_balance_wallet</span></span>' +
      '<span class="w-brand__name t-heading">Finance Tracker</span></div>' +
      '<nav class="w-nav" aria-label="Main">' + nav + '</nav>' +
      '<div class="w-side__spacer"></div>' +
      '<div class="w-side__foot">' +
      '<a class="w-nav__item" href="#" title="Keyboard shortcuts"><span class="ms">keyboard</span><span class="w-nav__label">Shortcuts</span><span class="kbd w-nav__count">?</span></a>' +
      '<a class="w-account" href="' + withParams('settings.html?section=account') + '" title="Priya Sharma"><span class="avatar">PS</span>' +
      '<span class="w-account__copy col gap-0" style="min-width:0"><span class="t-small-em truncate">Priya Sharma</span><span class="t-caption muted truncate">priya.sharma@gmail.com</span></span></a>' +
      '</div>';
    app.insertBefore(side, app.firstChild);

    // Top bar
    var top = document.createElement('header');
    top.className = 'w-top';
    var tpl = document.getElementById('top-actions');
    var s = SYNC[sync] || SYNC.saved;
    top.innerHTML =
      '<h1 class="w-top__title t-heading truncate">' + title + '</h1>' +
      '<div class="w-top__spacer"></div>' +
      (document.body.hasAttribute('data-search')
        ? '<label class="w-search"><span class="ms">search</span><span class="grow t-small">Search payee, note, amount…</span><span class="kbd">/</span></label>'
        : '') +
      '<span class="anchor"><button class="sync sync--' + sync + '" type="button" data-sync-btn aria-haspopup="dialog">' +
      '<span class="ms">' + s.icon + '</span><span class="sync__text">' + s.text + '</span></button></span>' +
      (tpl ? tpl.innerHTML : '');
    col.insertBefore(top, col.firstChild);

    // Shell banner for reconnect / offline / view only
    var BANNERS = {
      reconnect: '<div class="banner banner--review banner--wrap"><span class="ms">link_off</span><div class="banner__copy"><div class="t-small-em">Google Drive disconnected · editing paused</div><div class="t-small muted">Your 3 changes are kept in this tab. Reconnect to save them. Don’t close the tab until then.</div></div><span class="banner__action">Reconnect</span></div>',
      offline: '<div class="banner banner--review banner--wrap"><span class="ms">cloud_off</span><div class="banner__copy"><div class="t-small-em">You’re offline · editing paused</div><div class="t-small muted">You can still browse. 3 changes not yet saved are kept in this tab and save when you’re back, unless another device takes over editing first.</div></div></div>',
      viewonly: '<div class="banner banner--wrap"><span class="ms">visibility</span><div class="banner__copy"><div class="t-small-em">View only</div><div class="t-small muted">Your phone is editing (since 10:32). You can browse and search, but nothing here is saved.</div></div><span class="banner__action">Take over</span></div>',
      moved: '<div class="banner banner--review banner--wrap"><span class="ms">phonelink_lock</span><div class="banner__copy"><div class="t-small-em">Editing moved to your phone at 10:32</div><div class="t-small muted">This tab is now view only. 2 changes it hadn’t saved yet were kept as a Drive snapshot for 30 days.</div></div><span class="banner__action">Take over</span></div>',
    };
    if (BANNERS[sync]) {
      var b = document.createElement('div');
      b.className = 'w-shell-banner';
      b.innerHTML = BANNERS[sync];
      col.insertBefore(b, top.nextSibling);
    }

    // Phone bottom tabs
    var tabs = document.createElement('nav');
    tabs.className = 'w-tabs';
    tabs.setAttribute('aria-label', 'Main');
    tabs.innerHTML = NAV.map(function (n) {
      return '<a class="tab' + (n.key === active ? ' is-active' : '') + '" href="' + withParams(n.href) + '"><span class="tab-ind"><span class="ms">' + n.icon + '</span>' +
        (n.count ? '<span class="tab-badge">' + n.count + '</span>' : '') + '</span><span>' + n.label + '</span></a>';
    }).join('');
    app.appendChild(tabs);

    // Scrim for the slide-over panel
    if (app.querySelector('.w-panel')) {
      var scrim = document.createElement('div');
      scrim.className = 'w-scrim';
      scrim.addEventListener('click', closePanel);
      app.appendChild(scrim);
    }

    // Sync details popover
    top.querySelector('[data-sync-btn]').addEventListener('click', function (e) {
      var anchor = e.currentTarget.parentNode;
      var existing = anchor.querySelector('.pop');
      if (existing) { existing.remove(); return; }
      var pop = document.createElement('div');
      pop.className = 'pop';
      pop.style.cssText = 'top:40px;right:0;width:320px';
      pop.innerHTML =
        '<div style="padding:var(--sp-3) var(--sp-3) var(--sp-2)" class="col gap-1"><span class="t-overline muted">GOOGLE DRIVE</span>' +
        '<span class="t-small-em">' + s.text + '</span></div>' +
        '<div class="dl" style="padding:0 var(--sp-3)">' +
        '<div class="dl__row"><span class="dl__k">File</span><span class="dl__v">Finance Tracker / finance-live.db</span></div>' +
        '<div class="dl__row"><span class="dl__k">Last saved</span><span class="dl__v">Today, 9:41 PM · this tab</span></div>' +
        '<div class="dl__row"><span class="dl__k">Loaded at</span><span class="dl__v">Today, 8:02 PM · rev 412</span></div>' +
        '<div class="dl__row"><span class="dl__k">Size</span><span class="dl__v">2.4 MB</span></div></div>' +
        '<div class="pop__foot"><a class="btn btn--sm btn--ghost" href="' + withParams('settings.html?state=drive') + '">Snapshots</a><span class="btn btn--sm btn--primary"><span class="ms">cloud_upload</span>Save now</span></div>';
      anchor.appendChild(pop);
    });

    // "In use on another device" dialog, shown after sign-in when another device holds the lock
    if (sync === 'inuse') {
      var iu = document.createElement('div');
      iu.className = 'w-modal';
      iu.innerHTML =
        '<div class="w-dialog" role="alertdialog" aria-labelledby="iu-t">' +
        '<div class="w-dialog__head"><span class="w-dialog__icon w-dialog__icon--review"><span class="ms">devices</span></span>' +
        '<div class="col gap-1"><span id="iu-t" class="t-heading">In use on your phone</span>' +
        '<span class="t-small muted">Only one device can edit at a time, so changes never overwrite each other. Your phone has been editing since 10:32 and was last active 1 min ago.</span></div></div>' +
        '<div class="card card--subtle col gap-2">' +
        '<div class="row gap-2"><span class="ms ms-24 c-accent">edit</span><div class="col gap-0"><span class="t-small-em">Take over</span><span class="t-caption muted">This tab edits. The phone switches to view only. Anything it hasn’t saved yet is kept as a Drive snapshot.</span></div></div>' +
        '<div class="row gap-2"><span class="ms ms-24 muted">visibility</span><div class="col gap-0"><span class="t-small-em">View only</span><span class="t-caption muted">Browse and search here. Nothing is saved. You can take over later from the banner.</span></div></div></div>' +
        '<div class="w-dialog__actions"><span class="btn">View only</span><span class="btn btn--primary"><span class="ms">edit</span>Take over</span></div>' +
        '</div>';
      document.body.appendChild(iu);
    }

    // Conflict dialog (backstop: with the edit lock this should only appear after a lock bug or race)
    if (sync === 'conflict') {
      var m = document.createElement('div');
      m.className = 'w-modal';
      m.innerHTML =
        '<div class="w-dialog" role="alertdialog" aria-labelledby="cf-t">' +
        '<div class="w-dialog__head"><span class="w-dialog__icon w-dialog__icon--danger"><span class="ms">sync_problem</span></span>' +
        '<div class="col gap-1"><span id="cf-t" class="t-heading">Drive has a newer version</span>' +
        '<span class="t-small muted">Your phone saved changes to Drive at 9:12 PM, after this tab loaded the file at 8:02 PM. This tab also has 3 unsaved changes. Only one version can be kept.</span></div></div>' +
        '<div class="card card--subtle col gap-2">' +
        '<div class="row row--between"><span class="t-small">On Drive</span><span class="t-small-em">Pixel 8 · Today 9:12 PM</span></div>' +
        '<div class="row row--between"><span class="t-small">In this tab</span><span class="t-small-em">3 changes · not saved</span></div></div>' +
        '<div class="row gap-1 t-caption muted"><span class="ms ms-14">history</span>A snapshot of the version you don’t keep is saved to Drive, so you can restore it from Settings.</div>' +
        '<div class="w-dialog__actions"><span class="btn btn--danger">Keep this tab’s version</span><span class="btn btn--primary"><span class="ms">download</span>Load Drive’s version</span></div>' +
        '</div>';
      document.body.appendChild(m);
    }
  }

  /* ---------- Panel helpers ---------- */
  function openPanel() {
    var p = document.querySelector('.w-panel'); if (!p) return;
    p.classList.add('is-open');
    var s = document.querySelector('.w-scrim'); if (s) s.classList.add('is-open');
    document.body.classList.add('has-panel');
  }
  function closePanel() {
    var p = document.querySelector('.w-panel'); if (!p) return;
    p.classList.remove('is-open');
    var s = document.querySelector('.w-scrim'); if (s) s.classList.remove('is-open');
    document.body.classList.remove('has-panel');
    document.dispatchEvent(new CustomEvent('panelclose'));
  }

  /* ---------- Local tabs: [data-tabs] > [data-tab] + [data-panel] ---------- */
  function wireTabs(scope) {
    var groups = (scope || document).querySelectorAll('[data-tabs]');
    for (var g = 0; g < groups.length; g++) {
      (function (group) {
        if (group.__wired) return; group.__wired = true;
        group.addEventListener('click', function (e) {
          var t = e.target.closest('[data-tab]');
          if (!t || !group.contains(t)) return;
          var key = t.getAttribute('data-tab');
          var tabs = group.querySelectorAll('[data-tab]');
          for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('is-selected', tabs[i].getAttribute('data-tab') === key);
          var panels = group.querySelectorAll('[data-panel]');
          for (var j = 0; j < panels.length; j++) panels[j].hidden = panels[j].getAttribute('data-panel') !== key;
        });
      })(groups[g]);
    }
  }

  /* ---------- Mock controls ---------- */
  function announce() {
    var page = (location.pathname.split('/').pop() || '').replace(/\.html$/, '');
    var msg = { type: 'mock-ready', page: page, title: document.title, states: states, state: state, sync: sync };
    try { window.parent.postMessage(msg, '*'); } catch (e) { /* ignore */ }
  }
  function floatControls() {
    if (inFrame || !states.length) return;
    var f = document.createElement('div');
    f.className = 'mock-float';
    f.innerHTML = '<span class="muted">Mock</span><select aria-label="State">' +
      states.map(function (s) { return '<option value="' + s[0] + '"' + (s[0] === state ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') +
      '</select><a class="t-link" href="index.html">Viewer</a>';
    f.querySelector('select').addEventListener('change', function (e) {
      params.set('state', e.target.value); location.search = params.toString();
    });
    document.body.appendChild(f);
  }

  window.MOCK = {
    inr: inr, TXNS: TXNS, EM: EM, MONTHS: MONTHS, dshort: dshort, dlong: dlong, monthKey: monthKey, monthLabel: monthLabel,
    state: state, sync: sync, params: params, openPanel: openPanel, closePanel: closePanel, wireTabs: wireTabs,
    applyStateVisibility: applyStateVisibility, withParams: withParams,
  };

  function init() {
    buildShell();
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-close-panel]')) closePanel();
      if (!e.target.closest('.anchor')) {
        var pops = document.querySelectorAll('.w-top .pop');
        for (var i = 0; i < pops.length; i++) pops[i].remove();
      }
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePanel(); });
    if (window.PAGE && typeof window.PAGE.init === 'function') window.PAGE.init(state);
    applyStateVisibility();
    wireTabs();
    floatControls();
    announce();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
