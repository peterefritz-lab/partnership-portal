/* Partnership Portal .
   Static front end: GitHub Pages. Data, login, live sync: Supabase (row-level security on every table). */
(function () {
  'use strict';

  // ---------------------------------------------------------------- config / client
  var CFG = window.PORTAL_CONFIG || {};
  var configured = !!(CFG.supabaseUrl && CFG.supabaseAnonKey && !/REPLACE/.test(CFG.supabaseUrl + CFG.supabaseAnonKey));
  var initialHash = location.hash || '';
  var hashType = (/[#&?]type=(invite|recovery|magiclink|signup|email_change)/.exec(initialHash) || [])[1] || null;
  var hashErr = (/error_description=([^&]+)/.exec(initialHash) || [])[1] || null;
  var sb = null;
  if (configured && window.supabase) {
    sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' }
    });
  }

  // ---------------------------------------------------------------- constants
  var TABLES = ['members', 'deals', 'deal_terms', 'milestones', 'key_dates', 'todos', 'sites', 'site_parcels', 'comments', 'files'];
  var KEY = { site_parcels: 'apn', members: 'email' };
  var DEAL_STATUS = ['Prospect', 'LOI drafted', 'LOI submitted', 'PSA negotiation', 'Feasibility', 'Closing', 'Closed', 'Dead'];
  var SITE_STATUS = ['New', 'Reviewing', 'Owner contacted', 'In talks', 'Pursue', 'Pass'];
  var PRIORITY = ['High', 'Medium', 'Low'];
  var GRADES = ['A', 'B', 'C', 'D', 'Pass'];
  var CATEGORIES = ['Action list', 'Viable', 'Viable, uncertain', 'Impaired', 'Disqualified'];
  var DATE_KINDS = ['Upcoming', 'Deadline', 'Court date', 'Watch', 'Done'];
  var PORD = { High: 0, Medium: 1, Low: 2 };
  var TONE = {
    'New': '', 'Reviewing': 'info', 'Owner contacted': 'warn', 'In talks': 'ok', 'Pursue': 'acc', 'Pass': 'bad',
    'High': 'bad', 'Medium': 'warn', 'Low': '',
    'Prospect': '', 'LOI drafted': 'info', 'LOI submitted': 'acc', 'PSA negotiation': 'acc', 'Feasibility': 'warn', 'Closing': 'ok', 'Closed': 'ok', 'Dead': 'bad',
    'Upcoming': 'warn', 'Deadline': 'bad', 'Court date': 'info', 'Watch': '', 'Done': 'ok',
    'Action list': 'ok', 'Viable': 'info', 'Viable, uncertain': 'warn', 'Impaired': 'bad', 'Disqualified': 'bad',
    'A': 'ok', 'B': 'info', 'C': 'warn', 'D': 'bad'
  };
  var FIELD_NAMES = {
    status: 'status', priority: 'priority', owner: 'owner', notes: 'notes', contact: 'contact', title: 'title', name: 'name',
    due_date: 'due date', due_label: 'timing', done: 'done', flagged: 'flag', flag_note: 'flag note', grade: 'grade',
    category: 'category', label: 'label', value: 'value', detail: 'detail', date: 'date', kind: 'type', time_label: 'time',
    summary: 'summary', location: 'location', storage_url: 'folder link', url: 'link', body: 'comment', est_units: 'est. units',
    acres: 'acres', zone: 'zone', jurisdiction: 'jurisdiction', apn_text: 'APNs', price_signal: 'price signal', assessed: 'assessed value',
    archived_at: 'archive', deleted_at: 'deleted', code: 'site id', county: 'county', area: 'area', deal_id: 'deal', rank: 'rank', sort: 'order'
  };
  var LONG_FIELDS = ['notes', 'summary', 'body', 'detail', 'value', 'contact', 'flag_note', 'price_signal', 'assessed', 'apn_text', 'location', 'storage_url', 'url'];

  // ---------------------------------------------------------------- state
  var S = {
    session: null, me: null, loaded: false, loading: false, notMember: false, needPassword: false,
    members: [], deals: [], deal_terms: [], milestones: [], key_dates: [], todos: [], sites: [], site_parcels: [], comments: [], files: [], activity: [],
    online: {}, live: false, saving: 0, lastLoad: 0,
    ownerFilter: 'All', actFilter: 'All', todoShowDone: false,
    f: { q: '', status: '', priority: '', owner: '', cat: '', flagged: false },
    drafts: {}, editComment: null, addSite: false, loginMsg: null, loginErr: null
  };
  var root = document.getElementById('root');
  var dbChan = null, presChan = null, pending = false;

  // ---------------------------------------------------------------- helpers
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function safeUrl(u) { return /^https:\/\/[^\s"'<>]+$/i.test(String(u || '').trim()) ? String(u).trim() : ''; }
  function byKey(t, k) { var kc = KEY[t] || 'id'; return S[t].find(function (r) { return r[kc] === k; }); }
  function memberColor(name) {
    var m = S.members.find(function (x) { return x.display_name === name; });
    return (m && m.color) || (name === 'Peter' ? '#2563eb' : name === 'Brad' ? '#d97706' : '#6b7280');
  }
  function av(name, cls) {
    if (!name) return '<span class="av ' + (cls || '') + '">?</span>';
    return '<span class="av ' + (cls || '') + '" style="background:' + esc(memberColor(name)) + '">' + esc(name.charAt(0)) + '</span>';
  }
  function others() { return S.members.filter(function (m) { return !S.me || m.display_name !== S.me.display_name; }); }
  function ownerOpts() { return S.members.map(function (m) { return m.display_name; }).concat(['Both']); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function todayISO() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseD(s) { if (!s) return null; var p = String(s).slice(0, 10).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function fmtDate(s, withDow) {
    var d = parseD(s); if (!d) return '';
    return (withDow ? DOW[d.getDay()] + ' ' : '') + MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }
  function fmtTime(d) { var h = d.getHours(), m = d.getMinutes(); return ((h % 12) || 12) + ':' + pad(m) + ' ' + (h < 12 ? 'AM' : 'PM'); }
  function ago(ts) {
    if (!ts) return '';
    var d = new Date(ts), s = (Date.now() - d.getTime()) / 1000;
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    var t = new Date(); t.setHours(0, 0, 0, 0);
    if (d >= t) return Math.round(s / 3600) + 'h ago';
    var y = new Date(t.getTime() - 86400000);
    if (d >= y) return 'Yesterday ' + fmtTime(d);
    if (s < 6 * 86400) return DOW[d.getDay()] + ' ' + MON[d.getMonth()] + ' ' + d.getDate() + ', ' + fmtTime(d);
    return MON[d.getMonth()] + ' ' + d.getDate() + (d.getFullYear() !== new Date().getFullYear() ? ', ' + d.getFullYear() : '');
  }
  function edtag(r) {
    if (!r) return '';
    if (!r.updated_by) return '<span class="edtag">Imported ' + esc(ago(r.created_at)) + '</span>';
    return '<span class="edtag">&#9998; Last edited by <b>' + esc(r.updated_by) + '</b>, ' + esc(ago(r.updated_at)) + '</span>';
  }
  function toast(msg, err) {
    var t = document.getElementById('toast'); if (!t) return;
    t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.className = ''; }, err ? 5000 : 2200);
  }
  function opt(list, cur, blankLabel) {
    var h = blankLabel != null ? '<option value=""' + (cur ? '' : ' selected') + '>' + esc(blankLabel) + '</option>' : '';
    var has = !cur || list.indexOf(cur) >= 0;
    if (!has) h += '<option selected>' + esc(cur) + '</option>';
    return h + list.map(function (v) { return '<option' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('');
  }
  function attrs(t, id, f, type) {
    return 'data-save data-t="' + esc(t) + '" data-id="' + esc(id) + '" data-f="' + esc(f) + '"' + (type ? ' data-type="' + type + '"' : '');
  }
  function pill(t, id, f, val, list, blankLabel) {
    var tone = val ? (TONE[val] || '') : 'blank';
    return '<select class="pill ' + tone + '" ' + attrs(t, id, f) + '>' + opt(list, val, blankLabel) + '</select>';
  }
  function box(t, id, f, val, list, blankLabel) {
    return '<select class="box" ' + attrs(t, id, f) + '>' + opt(list, val, blankLabel) + '</select>';
  }
  function inl(t, id, f, val, o) {
    o = o || {};
    var cls = 'inl' + (o.b ? ' b' : '') + (o.h1 ? ' h1' : '') + (o.cls ? ' ' + o.cls : '');
    var req = o.req ? ' data-req="1"' : '';
    var ph = ' placeholder="' + esc(o.ph || '') + '"';
    var st = o.style ? ' style="' + o.style + '"' : '';
    if (o.multi) return '<textarea rows="1" class="' + cls + '" ' + attrs(t, id, f, o.type) + req + ph + st + '>' + esc(val) + '</textarea>';
    return '<input class="' + cls + '" ' + attrs(t, id, f, o.type) + req + ph + st + ' value="' + esc(val) + '">';
  }
  function dateIn(t, id, f, val) {
    return '<input type="date" class="date" ' + attrs(t, id, f, 'date') + ' value="' + esc(val ? String(val).slice(0, 10) : '') + '">';
  }
  function chk(t, id, f, val) { return '<input type="checkbox" ' + attrs(t, id, f, 'bool') + (val ? ' checked' : '') + '>'; }
  function delBtn(t, id, label) { return '<button class="x" title="Remove" data-act="del" data-t="' + esc(t) + '" data-id="' + esc(id) + '" data-label="' + esc(label || 'this item') + '">&times;</button>'; }
  function dealById(id) { return S.deals.find(function (d) { return d.id === id; }); }
  function siteById(id) { return S.sites.find(function (s) { return s.id === id; }); }
  function activeDeals() { return S.deals.filter(function (d) { return !d.archived_at; }).sort(function (a, b) { return (a.sort - b.sort) || String(a.name).localeCompare(b.name); }); }
  function activeSites() { return S.sites.filter(function (s) { return !s.archived_at; }); }
  function provider(u) {
    u = String(u || '').toLowerCase();
    if (/drive\.google\.com|docs\.google\.com/.test(u)) return 'drive';
    if (/sharepoint\.com/.test(u)) return 'sharepoint';
    if (/1drv\.ms|onedrive\.live\.com/.test(u)) return 'onedrive';
    if (/dropbox\.com/.test(u)) return 'dropbox';
    return 'other';
  }
  var PROV_LABEL = { drive: 'Google Drive', sharepoint: 'SharePoint', onedrive: 'OneDrive', dropbox: 'Dropbox', other: 'Link' };
  function mapLink(site, base) {
    var p = S.site_parcels.filter(function (x) { return x.site_id === site.id; }).map(function (x) { return x.apn; });
    var u = base || CFG.syncMapUrl || CFG.mapUrl || '';
    if (!u) return '';
    return p.length ? u + '#apn=' + encodeURIComponent(p[0]) : u;
  }
  function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'deal'; }
  function mentionHtml(body) {
    var h = esc(body);
    S.members.forEach(function (m) {
      var re = new RegExp('@' + m.display_name + '\\b', 'gi');
      h = h.replace(re, '<span class="men">@' + esc(m.display_name) + '</span>');
    });
    return h;
  }
  function parseMentions(body) {
    return S.members.filter(function (m) { return new RegExp('@' + m.display_name + '\\b', 'i').test(body); }).map(function (m) { return m.display_name; });
  }
  function sortTodos(list) {
    return list.slice().sort(function (a, b) {
      if (a.done !== b.done) return a.done ? 1 : -1;
      var pa = PORD[a.priority] != null ? PORD[a.priority] : 3, pb = PORD[b.priority] != null ? PORD[b.priority] : 3;
      if (pa !== pb) return pa - pb;
      var da = a.due_date || '9999', db = b.due_date || '9999';
      if (da !== db) return da < db ? -1 : 1;
      return (a.sort - b.sort) || String(a.created_at).localeCompare(String(b.created_at));
    });
  }
  function ownerMatch(o) { return S.ownerFilter === 'All' || o === S.ownerFilter || o === 'Both'; }

  // ---------------------------------------------------------------- data
  function upsertLocal(t, row) {
    if (!S[t] || !row) return;
    var kc = KEY[t] || 'id';
    var i = S[t].findIndex(function (r) { return r[kc] === row[kc]; });
    if (i >= 0) S[t][i] = row; else S[t].push(row);
  }
  function removeLocal(t, k) { var kc = KEY[t] || 'id'; S[t] = S[t].filter(function (r) { return r[kc] !== k; }); }
  function savingStart() { S.saving++; renderStatus(); }
  function savingEnd() { S.saving = Math.max(0, S.saving - 1); renderStatus(); }

  async function loadAll() {
    S.loading = true;
    var res = await Promise.all(TABLES.map(function (t) { return sb.from(t).select('*'); }).concat([
      sb.from('activity').select('*').order('at', { ascending: false }).limit(400)
    ]));
    var bad = res.find(function (r) { return r.error; });
    if (bad) { S.loading = false; throw bad.error; }
    TABLES.forEach(function (t, i) { S[t] = res[i].data || []; });
    S.activity = res[TABLES.length].data || [];
    S.loading = false; S.loaded = true; S.lastLoad = Date.now();
  }
  async function save(t, k, patch) {
    var row = byKey(t, k), prev = row ? Object.assign({}, row) : null;
    if (row) Object.assign(row, patch, { updated_by: S.me.display_name, updated_at: new Date().toISOString() });
    savingStart();
    var r = await sb.from(t).update(patch).eq(KEY[t] || 'id', k).select();
    savingEnd();
    if (r.error || !r.data || !r.data.length) {
      if (row && prev) Object.keys(prev).forEach(function (x) { row[x] = prev[x]; });
      toast('Could not save: ' + (r.error ? r.error.message : 'no access'), true);
    } else upsertLocal(t, r.data[0]);
    render();
    return !r.error;
  }
  async function insert(t, obj, quiet) {
    savingStart();
    var r = await sb.from(t).insert(obj).select();
    savingEnd();
    if (r.error) { toast('Could not add: ' + r.error.message, true); return null; }
    upsertLocal(t, r.data[0]);
    if (!quiet) render();
    return r.data[0];
  }
  async function del(t, k) {
    savingStart();
    var r = await sb.from(t).delete().eq(KEY[t] || 'id', k).select();
    savingEnd();
    if (r.error || !r.data || !r.data.length) { toast('Could not remove: ' + (r.error ? r.error.message : 'not allowed'), true); return; }
    removeLocal(t, k); render();
  }

  function applyChange(p) {
    var t = p.table;
    if (t === 'activity') {
      if (p.eventType === 'INSERT' && p.new && !S.activity.some(function (a) { return a.id === p.new.id; })) S.activity.unshift(p.new);
    } else if (S[t]) {
      if (p.eventType === 'DELETE') { var kc = KEY[t] || 'id'; if (p.old && p.old[kc] != null) removeLocal(t, p.old[kc]); }
      else if (p.new) upsertLocal(t, p.new);
    }
    scheduleRender();
  }
  var rTimer = null;
  function scheduleRender() { clearTimeout(rTimer); rTimer = setTimeout(render, 60); }

  function startRealtime() {
    stopRealtime();
    dbChan = sb.channel('portal-db')
      .on('postgres_changes', { event: '*', schema: 'public' }, applyChange)
      .subscribe(function (status) { S.live = status === 'SUBSCRIBED'; renderStatus(); });
    presChan = sb.channel('portal-presence', { config: { presence: { key: S.me.display_name } } });
    presChan.on('presence', { event: 'sync' }, function () {
      var st = presChan.presenceState(), o = {};
      Object.keys(st).forEach(function (k) { var a = st[k]; if (a && a.length) o[k] = a[a.length - 1]; });
      S.online = o; renderStatus();
    }).subscribe(function (status) { if (status === 'SUBSCRIBED') trackPresence(); });
  }
  function trackPresence() { if (presChan) try { presChan.track({ name: S.me.display_name, view: viewName(), at: Date.now() }); } catch (e) { } }
  function stopRealtime() { try { if (dbChan) sb.removeChannel(dbChan); if (presChan) sb.removeChannel(presChan); } catch (e) { } dbChan = presChan = null; S.live = false; }

  // ---------------------------------------------------------------- routing
  function route() {
    var h = location.hash.replace(/^#\/?/, '');
    if (/access_token=|error_description=|type=/.test(h)) h = '';
    var p = h.split('/').map(function (x) { try { return decodeURIComponent(x); } catch (e) { return x; } });
    switch (p[0]) {
      case 'deal': return { v: 'deal', slug: p[1] };
      case 'deals': return { v: 'deals' };
      case 'todos': return { v: 'todos' };
      case 'screening': return { v: 'screening', code: p[1] || null };
      case 'activity': return { v: 'activity' };
      default: return { v: 'dash' };
    }
  }
  function viewName() {
    var r = route();
    if (r.v === 'deal') { var d = S.deals.find(function (x) { return x.slug === r.slug; }); return d ? d.name : 'a deal'; }
    if (r.v === 'screening') return r.code ? 'site ' + r.code : 'Screening';
    return { dash: 'Dashboard', deals: 'Deals', todos: 'To-dos', activity: 'Activity' }[r.v] || 'the portal';
  }

  // ---------------------------------------------------------------- components
  function todoRow(t) {
    var deal = t.deal_id ? dealById(t.deal_id) : null;
    var area = deal ? '<a class="chip" href="#/deal/' + esc(deal.slug) + '">' + esc(deal.name) + '</a>' : (t.area ? '<span class="chip">' + esc(t.area) + '</span>' : '');
    return '<div class="todo' + (t.done ? ' done' : '') + '">' + chk('todos', t.id, 'done', t.done) +
      '<div class="tt">' + inl('todos', t.id, 'title', t.title, { req: 1, multi: 1 }) +
      '<div class="m">' + pill('todos', t.id, 'priority', t.priority, PRIORITY, 'Priority') +
      box('todos', t.id, 'owner', t.owner, ownerOpts(), 'Unassigned') +
      dateIn('todos', t.id, 'due_date', t.due_date) +
      inl('todos', t.id, 'due_label', t.due_label, { ph: 'timing', style: 'width:110px;font-size:12px' }) +
      inl('todos', t.id, 'status', t.status, { ph: 'status note', style: 'width:150px;font-size:12px' }) +
      area + edtag(t) + '</div></div>' + delBtn('todos', t.id, 'this to-do') + '</div>';
  }
  function todoAdd(dealId, area) {
    return '<div class="addrow"><input class="txt" data-add="todo" data-deal="' + esc(dealId || '') + '" data-area="' + esc(area || '') + '" placeholder="+ Add a to-do and press Enter"></div>';
  }
  function ownerSeg() {
    return '<div class="seg">' + ['All'].concat(S.members.map(function (m) { return m.display_name; })).map(function (o) {
      return '<button data-act="ownerFilter" data-v="' + esc(o) + '" class="' + (S.ownerFilter === o ? 'on' : '') + '">' + esc(o) + '</button>';
    }).join('') + '</div>';
  }
  function describe(a) {
    var who = '<b>' + esc(a.actor || 'Setup') + '</b>';
    var what = { deal: 'deal', site: 'site', todo: 'to-do', milestone: 'milestone', term: 'term', date: 'date', comment: 'comment', file: 'file link', parcel: 'APN' }[a.entity_type] || a.entity_type || '';
    var label = a.entity_label ? '<b>' + esc(a.entity_label) + '</b>' : '';
    if (a.table_name === 'setup') return who + ' ' + esc(a.entity_label);
    if (a.action === 'created') {
      if (a.entity_type === 'comment') return who + ' commented: ' + mentionHtml(a.entity_label || '');
      return who + ' added ' + what + ' ' + label;
    }
    if (a.action === 'deleted') return who + ' removed ' + what + ' ' + label;
    var ch = a.changes || {}, parts = [];
    Object.keys(ch).forEach(function (k) {
      var to = ch[k].to, fn = FIELD_NAMES[k] || k.replace(/_/g, ' ');
      if (k === 'done') parts.push(to ? 'checked off' : 'reopened');
      else if (k === 'flagged') parts.push(to ? 'flagged it: Look at this site' : 'cleared the flag');
      else if (k === 'archived_at') parts.push(to ? 'archived it' : 'restored it');
      else if (k === 'deleted_at') parts.push(to ? 'deleted a comment' : 'restored a comment');
      else if (LONG_FIELDS.indexOf(k) >= 0) parts.push('edited ' + fn);
      else if (to == null || to === '') parts.push('cleared ' + fn);
      else parts.push('set ' + fn + ' to <b>' + esc(typeof to === 'object' ? JSON.stringify(to) : to) + '</b>');
    });
    return who + ' ' + parts.join(', ') + ' on ' + what + ' ' + label;
  }
  function activityLink(a) {
    if (a.parent_type === 'deal') { var d = dealById(a.parent_id); return d ? '#/deal/' + d.slug : ''; }
    if (a.parent_type === 'site') { var s = siteById(a.parent_id); return s ? '#/screening/' + encodeURIComponent(s.code) : ''; }
    if (a.entity_type === 'todo') return '#/todos';
    return '';
  }
  function whereLabel(a) {
    if (a.parent_type === 'deal') { var d = dealById(a.parent_id); return d ? d.name : 'Deal'; }
    if (a.parent_type === 'site') { var s = siteById(a.parent_id); return s ? 'Screening ' + s.code : 'Screening'; }
    if (a.entity_type === 'todo') return 'To-dos';
    return 'Portal';
  }
  function feed(list) {
    return '<div class="feed">' + list.map(function (a) {
      var href = activityLink(a);
      return '<div class="fi">' + av(a.actor, 'sm') + '<div style="min-width:0;flex:1"><div class="tx">' + describe(a) + '</div><div class="ts">' +
        esc(ago(a.at)) + ' · ' + (href ? '<a href="' + href + '">' + esc(whereLabel(a)) + '</a>' : esc(whereLabel(a))) + '</div></div></div>';
    }).join('') + '</div>';
  }
  function commentsBlock(type, id) {
    var list = S.comments.filter(function (c) { return c.entity_type === type && c.entity_id === id && !c.deleted_at; })
      .sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });
    var key = type + ':' + id;
    var h = list.map(function (c) {
      var mine = S.me && c.author === S.me.display_name;
      var body = S.editComment === c.id
        ? '<textarea class="txt" data-cedit="' + esc(c.id) + '" rows="3">' + esc(c.body) + '</textarea><div class="row" style="display:flex;gap:6px;margin-top:6px"><button class="btn sm pri" data-act="cSave" data-id="' + esc(c.id) + '">Save</button><button class="btn sm" data-act="cCancel">Cancel</button></div>'
        : '<p>' + mentionHtml(c.body) + '</p>';
      return '<div class="cm">' + av(c.author) + '<div class="bd"><div class="hd2"><b>' + esc(c.author || '') + '</b><span>' + esc(ago(c.created_at)) +
        (c.edited_at ? ' · edited' : '') + (c.source === 'map' ? ' · from map' : '') + '</span>' +
        (mine && S.editComment !== c.id ? '<span class="acts"><button data-act="cEdit" data-id="' + esc(c.id) + '">Edit</button><button data-act="cDel" data-id="' + esc(c.id) + '">Delete</button></span>' : '') +
        '</div>' + body + '</div></div>';
    }).join('');
    var names = others().map(function (m) { return '@' + m.display_name; }).join(' or ');
    return '<div class="cmts">' + h + '<div class="compose"><textarea data-compose="' + esc(key) + '" placeholder="Write a comment. Type @ to mention ' + esc(names || 'your partner') + '.">' + esc(S.drafts[key] || '') + '</textarea>' +
      '<div class="row"><span class="muted small" style="margin-right:auto">Mentions show up on the dashboard under Mentions for you. Ctrl+Enter to post.</span><button class="btn pri sm" data-act="cPost" data-key="' + esc(key) + '">Comment</button></div></div></div>';
  }
  function filesBlock(type, id) {
    var list = S.files.filter(function (f) { return f.entity_type === type && f.entity_id === id; }).sort(function (a, b) { return (a.sort - b.sort) || String(a.created_at).localeCompare(String(b.created_at)); });
    var h = list.map(function (f) {
      var u = safeUrl(f.url), pv = f.provider || provider(f.url);
      return '<div class="link"><div class="ic ' + esc(pv) + '">' + esc((PROV_LABEL[pv] || 'Link').charAt(0)) + '</div><div class="tt">' +
        inl('files', f.id, 'title', f.title, { req: 1, b: 1 }) + inl('files', f.id, 'url', f.url, { req: 1, cls: 'small muted', type: 'url' }) + '</div>' +
        (u ? '<a class="btn sm" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">Open</a>' : '') + delBtn('files', f.id, 'this link') + '</div>';
    }).join('');
    return h + '<div class="addrow" style="flex-wrap:wrap"><input class="txt" style="flex:1 1 160px" data-fnew="title" data-key="' + esc(type + ':' + id) + '" placeholder="Link name"><input class="txt" style="flex:2 1 220px" data-fnew="url" data-key="' + esc(type + ':' + id) + '" placeholder="https:// Drive or SharePoint link"><button class="btn" data-act="fAdd" data-type="' + esc(type) + '" data-id="' + esc(id) + '">+ Add link</button></div>';
  }
  function folderRow(t, row) {
    var u = safeUrl(row.storage_url);
    return '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><div style="flex:1;min-width:200px"><label class="field"><span>Folder link (Drive or SharePoint)</span>' +
      inl(t, row.id, 'storage_url', row.storage_url, { ph: 'Paste a https:// folder link', type: 'url' }) + '</label></div>' +
      (u ? '<a class="btn" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">Open folder &#8599;</a>' : '') + '</div>';
  }

  // ---------------------------------------------------------------- views
  function vDash() {
    var deals = activeDeals(), sites = activeSites(), open = S.todos.filter(function (t) { return !t.done; });
    var flagged = sites.filter(function (s) { return s.flagged; });
    var inScreen = sites.filter(function (s) { return s.status !== 'Pass'; });
    var cats = {}; inScreen.forEach(function (s) { var c = s.category || 'Added'; cats[c] = (cats[c] || 0) + 1; });
    var byOwner = {}; open.forEach(function (t) { var o = t.owner || 'Unassigned'; byOwner[o] = (byOwner[o] || 0) + 1; });
    var hr = new Date().getHours(), greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
    var dates = S.key_dates.slice().sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
    var td = sortTodos(open.filter(function (t) { return ownerMatch(t.owner); })).slice(0, 8);
    var me = S.me.display_name, seen = +(localStorage.getItem('portal.mentionsSeen.' + me) || 0);
    var cutoff = Date.now() - 30 * 86400000;
    var mentions = S.comments.filter(function (c) { return !c.deleted_at && c.author !== me && (c.mentions || []).indexOf(me) >= 0 && new Date(c.created_at).getTime() > cutoff; })
      .sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
    var unread = mentions.filter(function (c) { return new Date(c.created_at).getTime() > seen; }).length;
    var h = '<div class="hd"><div><h1>' + greet + ', ' + esc(me) + '</h1><div class="sub">' + esc(DOW[new Date().getDay()] + ', ' + fmtDate(todayISO())) + ' · everything here is editable by both of you</div></div>' +
      '<div class="r"><a class="btn" href="#/todos">+ Add to-do</a><a class="btn" href="#/screening" data-act="openAddSite">+ Add site</a><button class="btn pri" data-act="addDeal">+ Add deal</button></div></div>';
    h += '<div class="grid g4" style="margin-bottom:16px">' +
      '<a class="card met" href="#/deals"><div class="l">Active deals</div><div class="v">' + deals.length + '</div><div class="d">' + esc(deals.map(function (d) { return d.name + (d.status ? ' · ' + d.status : ''); }).join('; ')) + '</div></a>' +
      '<a class="card met" href="#/screening"><div class="l">Sites in screening</div><div class="v">' + inScreen.length + '</div><div class="d">' + esc(Object.keys(cats).map(function (k) { return cats[k] + ' ' + k.toLowerCase(); }).join(' · ')) + '</div></a>' +
      '<a class="card met" href="#/todos"><div class="l">Open to-dos</div><div class="v">' + open.length + '</div><div class="d">' + esc(Object.keys(byOwner).map(function (k) { return k + ' ' + byOwner[k]; }).join(' · ')) + '</div></a>' +
      '<a class="card met" href="#/screening" data-act="showFlagged"><div class="l">Flagged: Look at this</div><div class="v">' + flagged.length + '</div><div class="d">' + esc(flagged.slice(0, 3).map(function (s) { return s.code + ' ' + (s.jurisdiction || ''); }).join(' · ')) + '</div></a></div>';
    h += '<div class="grid g2"><div class="stack">';
    h += '<div class="card"><div class="ch"><h2>Upcoming dates</h2><div class="r"><button class="btn link" data-act="addDate">+ Add date</button></div></div>' +
      dates.map(function (k) {
        var d = parseD(k.date);
        return '<div class="date-row"><div class="dbox"><span>' + (d ? MON[d.getMonth()] : '') + '</span><b>' + (d ? d.getDate() : '') + '</b></div><div style="flex:1;min-width:0">' +
          inl('key_dates', k.id, 'title', k.title, { req: 1, b: 1 }) + inl('key_dates', k.id, 'detail', k.detail, { ph: 'details', cls: 'small', multi: 1 }) +
          '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:3px 0 0 4px">' + dateIn('key_dates', k.id, 'date', k.date) + inl('key_dates', k.id, 'time_label', k.time_label, { ph: 'time', style: 'width:120px;font-size:12px' }) + edtag(k) + '</div></div>' +
          pill('key_dates', k.id, 'kind', k.kind, DATE_KINDS, 'Type') + delBtn('key_dates', k.id, 'this date') + '</div>';
      }).join('') + '</div>';
    h += '<div class="card"><div class="ch"><h2>Top to-dos</h2><div class="r">' + ownerSeg() + '<a class="btn link" href="#/todos">All to-dos</a></div></div>' +
      td.map(todoRow).join('') + todoAdd(null, '') + '</div>';
    h += '</div><div class="stack">';
    if (mentions.length) {
      h += '<div class="card"><div class="ch"><h2>Mentions for you' + (unread ? ' <span class="chip" style="background:var(--accbg);color:var(--acc)">' + unread + ' new</span>' : '') + '</h2><div class="r">' + (unread ? '<button class="btn link" data-act="mentionsRead">Mark read</button>' : '') + '</div></div><div class="feed">' +
        mentions.slice(0, 6).map(function (c) {
          var dl = c.entity_type === 'deal' ? dealById(c.entity_id) : null, st = c.entity_type === 'site' ? siteById(c.entity_id) : null;
          var href = dl ? '#/deal/' + dl.slug : st ? '#/screening/' + encodeURIComponent(st.code) : '';
          var where = dl ? dl.name : st ? 'Site ' + st.code : 'Portal';
          return '<div class="fi">' + av(c.author, 'sm') + '<div style="flex:1;min-width:0"><div class="tx"><b>' + esc(c.author) + '</b>: ' + mentionHtml(c.body) + '</div><div class="ts">' + esc(ago(c.created_at)) + ' · <a href="' + href + '">' + esc(where) + '</a></div></div></div>';
        }).join('') + '</div></div>';
    }
    h += '<div class="card"><div class="ch"><h2>Active deals</h2><div class="r"><button class="btn link" data-act="addDeal">+ Add deal</button></div></div>' +
      deals.map(function (d) {
        return '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:6px 0"><div style="flex:1;min-width:140px"><a href="#/deal/' + esc(d.slug) + '"><b>' + esc(d.name) + '</b></a><div class="muted small">' + edtag(d) + '</div></div>' + pill('deals', d.id, 'status', d.status, DEAL_STATUS, 'Status') + '</div>';
      }).join('') + '</div>';
    if (flagged.length) {
      h += '<div class="card"><div class="ch"><h2>&#9873; Flagged sites</h2></div>' + flagged.map(function (s) {
        return '<div style="display:flex;gap:10px;padding:7px 0;border-top:1px solid var(--line2)">' + av(s.flagged_by, 'sm') + '<div style="flex:1;min-width:0"><a href="#/screening/' + encodeURIComponent(s.code) + '"><b>' + esc(s.code) + '</b> ' + esc(s.jurisdiction || '') + '</a><div class="muted small">' + esc(s.flag_note || 'Look at this site') + ' · ' + esc(s.flagged_by || '') + ', ' + esc(ago(s.flagged_at)) + '</div></div></div>';
      }).join('') + '</div>';
    }
    h += '<div class="card"><div class="ch"><h2>Recent activity</h2><div class="r"><span class="edtag"><span class="dot' + (S.live ? '' : ' off') + '"></span>' + (S.live ? 'Live' : 'Connecting') + '</span></div></div>' + feed(S.activity.slice(0, 12)) +
      '<div style="margin-top:6px"><a class="btn link" href="#/activity">Full activity log &rarr;</a></div></div>';
    h += '</div></div>';
    return h;
  }

  function vTodos() {
    var list = sortTodos(S.todos.filter(function (t) { return ownerMatch(t.owner) && (S.todoShowDone || !t.done); }));
    var doneN = S.todos.filter(function (t) { return t.done; }).length;
    return '<div class="hd"><div><h1>To-dos</h1><div class="sub">All deals and partnership items</div></div></div>' +
      '<div class="card"><div class="ch">' + ownerSeg() + '<div class="r"><label class="small muted" style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-act="toggleDone"' + (S.todoShowDone ? ' checked' : '') + '> Show done (' + doneN + ')</label></div></div>' +
      list.map(todoRow).join('') + todoAdd(null, 'Partnership') + '</div>';
  }

  function vDeals() {
    var deals = activeDeals();
    return '<div class="hd"><div><h1>Deals</h1></div><div class="r"><button class="btn pri" data-act="addDeal">+ Add deal</button></div></div><div class="stack">' +
      deals.map(function (d) {
        var open = S.todos.filter(function (t) { return t.deal_id === d.id && !t.done; }).length;
        return '<div class="card"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><div style="flex:1;min-width:180px"><a href="#/deal/' + esc(d.slug) + '"><h2>' + esc(d.name) + '</h2></a><div class="muted small">' + esc(d.location || '') + '</div><div class="small muted">' + open + ' open to-dos · ' + edtag(d) + '</div></div>' + pill('deals', d.id, 'status', d.status, DEAL_STATUS, 'Status') + '<a class="btn sm" href="#/deal/' + esc(d.slug) + '">Open</a></div></div>';
      }).join('') + '</div>';
  }

  function vDeal(slug) {
    var d = S.deals.find(function (x) { return x.slug === slug; });
    if (!d) return '<div class="card">That deal was not found. <a href="#/deals">See all deals</a></div>';
    var terms = S.deal_terms.filter(function (t) { return t.deal_id === d.id; }).sort(function (a, b) { return a.sort - b.sort || String(a.created_at).localeCompare(b.created_at); });
    var ms = S.milestones.filter(function (m) { return m.deal_id === d.id; }).sort(function (a, b) { return a.sort - b.sort || String(a.created_at).localeCompare(b.created_at); });
    var td = sortTodos(S.todos.filter(function (t) { return t.deal_id === d.id && ownerMatch(t.owner) && (S.todoShowDone || !t.done); }));
    var act = S.activity.filter(function (a) { return a.parent_type === 'deal' && a.parent_id === d.id; }).slice(0, 10);
    var h = '<div class="hd"><div style="flex:1;min-width:260px"><div class="muted small"><a href="#/deals">Deals</a> &rsaquo;</div>' + inl('deals', d.id, 'name', d.name, { req: 1, h1: 1 }) +
      inl('deals', d.id, 'location', d.location, { ph: 'Location', cls: 'sub', multi: 1 }) + '</div>' +
      '<div class="r" style="flex-direction:column;align-items:flex-end"><div class="muted small">STATUS</div>' + pill('deals', d.id, 'status', d.status, DEAL_STATUS, 'Status') + edtag(d) + '</div></div>';
    h += '<div class="grid g2"><div class="stack">';
    h += '<div class="card"><div class="ch"><h2>Summary</h2></div>' + inl('deals', d.id, 'summary', d.summary, { multi: 1, ph: 'Site, seller, buyer' }) + '<div style="margin-top:10px">' + folderRow('deals', d) + '</div></div>';
    h += '<div class="card"><div class="ch"><h2>Terms</h2><div class="r"><button class="btn link" data-act="addTerm" data-id="' + esc(d.id) + '">+ Add term</button></div></div><div class="kv">' +
      terms.map(function (t, i) {
        var f = i === 0 ? ' first' : '';
        return '<div class="k' + f + '">' + inl('deal_terms', t.id, 'label', t.label, { req: 1 }) + '</div><div class="v' + f + '">' + inl('deal_terms', t.id, 'value', t.value, { multi: 1, ph: 'value' }) + '</div><div class="' + f.trim() + '">' + delBtn('deal_terms', t.id, 'the ' + t.label + ' term') + '</div>';
      }).join('') + '</div></div>';
    h += '<div class="card"><div class="ch"><h2>Schedule and milestones</h2></div>' +
      ms.map(function (m) {
        return '<div class="ms">' + chk('milestones', m.id, 'done', m.done) + '<div class="tt">' + inl('milestones', m.id, 'title', m.title, { req: 1, b: 1 }) +
          inl('milestones', m.id, 'detail', m.detail, { multi: 1, ph: 'details', cls: 'small muted' }) +
          '<div class="meta">' + inl('milestones', m.id, 'due_label', m.due_label, { ph: 'timing', style: 'width:200px;font-size:12px' }) + dateIn('milestones', m.id, 'due_date', m.due_date) + box('milestones', m.id, 'owner', m.owner, ownerOpts(), 'Owner') + '</div></div>' + delBtn('milestones', m.id, 'this milestone') + '</div>';
      }).join('') + '<div class="addrow"><input class="txt" data-add="milestone" data-deal="' + esc(d.id) + '" placeholder="+ Add a milestone and press Enter"></div></div>';
    h += '<div class="card"><div class="ch"><h2>To-dos</h2><div class="r">' + ownerSeg() + '<label class="small muted" style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-act="toggleDone"' + (S.todoShowDone ? ' checked' : '') + '> Show done</label></div></div>' + td.map(todoRow).join('') + todoAdd(d.id, '') + '</div>';
    h += '</div><div class="stack">';
    h += '<div class="card"><div class="ch"><h2>Notes</h2><div class="r">' + edtag(d) + '</div></div>' + inl('deals', d.id, 'notes', d.notes, { multi: 1, ph: 'Shared notes', style: 'min-height:120px' }) + '</div>';
    h += '<div class="card"><div class="ch"><h2>Comments</h2></div>' + commentsBlock('deal', d.id) + '</div>';
    h += '<div class="card"><div class="ch"><h2>Files (links)</h2></div>' + filesBlock('deal', d.id) + '</div>';
    if (act.length) h += '<div class="card"><div class="ch"><h2>Deal activity</h2></div>' + feed(act) + '</div>';
    h += '<div style="text-align:right"><button class="btn sm danger" data-act="archiveDeal" data-id="' + esc(d.id) + '">Archive deal</button></div>';
    h += '</div></div>';
    return h;
  }

  function filteredSites() {
    var f = S.f, q = f.q.trim().toLowerCase();
    var parcelsBySite = {};
    if (q) S.site_parcels.forEach(function (p) { (parcelsBySite[p.site_id] = parcelsBySite[p.site_id] || []).push(p.apn); });
    return activeSites().filter(function (s) {
      if (f.status && (f.status === '_none' ? s.status : s.status !== f.status)) return false;
      if (f.priority && (f.priority === '_none' ? s.priority : s.priority !== f.priority)) return false;
      if (f.owner && (f.owner === '_none' ? s.owner : s.owner !== f.owner)) return false;
      if (f.cat && s.category !== f.cat) return false;
      if (f.flagged && !s.flagged) return false;
      if (q) {
        var hay = [s.code, s.jurisdiction, s.county, s.apn_text, s.zone, s.contact, s.notes, s.category, s.status, s.owner, (parcelsBySite[s.id] || []).join(' ')].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0 && hay.replace(/-/g, '').indexOf(q.replace(/-/g, '')) < 0) return false;
      }
      return true;
    }).sort(function (a, b) { return (a.rank == null ? 9999 : a.rank) - (b.rank == null ? 9999 : b.rank) || String(a.code).localeCompare(b.code); });
  }
  function commentCount(type, id) { return S.comments.filter(function (c) { return c.entity_type === type && c.entity_id === id && !c.deleted_at; }).length; }
  function flagBtn(s) {
    return '<button class="btn sm flag' + (s.flagged ? ' on' : '') + '" data-act="flag" data-id="' + esc(s.id) + '" title="' + (s.flagged ? 'Flagged by ' + esc(s.flagged_by || '') + '. Click to clear.' : 'Flag: look at this site') + '">&#9873; ' + (s.flagged ? esc(s.flagged_by || 'Flagged') : 'Look at this') + '</button>';
  }
  var CHIP_STYLE = { ok: 'background:var(--okbg);color:var(--ok)', info: 'background:var(--infobg);color:var(--info)', warn: 'background:var(--warnbg);color:var(--warn)', bad: 'background:var(--badbg);color:var(--bad)' };
  function catChip(c) { return c ? '<span class="chip" style="' + (CHIP_STYLE[TONE[c]] || '') + '">' + esc(c) + '</span>' : '<span class="chip">Added</span>'; }
  function sitesBody() {
    var list = filteredSites(), mobile = window.innerWidth < 760;
    if (!list.length) return '<div style="padding:16px" class="muted">No sites match these filters.</div>';
    if (mobile) {
      return '<div class="cards">' + list.map(function (s) {
        var n = commentCount('site', s.id);
        return '<div class="sc"><div style="display:flex;gap:8px;align-items:baseline"><button class="site-link" data-act="openSite" data-code="' + esc(s.code) + '">' + esc(s.code) + '</button><span class="muted small">' + esc(s.jurisdiction || '') + '</span><span class="muted small" style="margin-left:auto">' + (s.acres != null ? esc(Number(s.acres).toFixed(2)) + ' ac' : '') + (s.est_units ? ' · ' + esc(s.est_units) + ' u' : '') + '</span></div>' +
          '<div class="row">' + catChip(s.category) + pill('sites', s.id, 'status', s.status, SITE_STATUS, 'Status') + pill('sites', s.id, 'priority', s.priority, PRIORITY, 'Priority') + box('sites', s.id, 'owner', s.owner, ownerOpts(), 'Owner') + '</div>' +
          '<div style="margin-top:6px">' + inl('sites', s.id, 'notes', s.notes, { multi: 1, ph: 'Notes', cls: 'small' }) + '</div>' +
          '<div class="row">' + flagBtn(s) + '<button class="btn sm" data-act="openSite" data-code="' + esc(s.code) + '">&#128172; ' + (n || 'Comment') + '</button>' + edtag(s) + '</div></div>';
      }).join('') + '</div>';
    }
    return '<div class="tbl-wrap"><table class="t"><thead><tr><th>#</th><th>Site</th><th style="text-align:right">Acres</th><th style="text-align:right">Units</th><th>Screen</th><th>Status</th><th>Priority</th><th>Owner</th><th>Contact</th><th>Notes</th><th>Flag</th><th></th><th>Edited</th></tr></thead><tbody>' +
      list.map(function (s) {
        var n = commentCount('site', s.id);
        return '<tr class="' + (s.flagged ? 'flagged' : '') + '"><td class="n muted">' + esc(s.rank == null ? '' : s.rank) + '</td>' +
          '<td style="min-width:110px"><button class="site-link" data-act="openSite" data-code="' + esc(s.code) + '">' + esc(s.code) + '</button><div class="muted small">' + esc(s.jurisdiction || '') + '</div></td>' +
          '<td class="n">' + (s.acres != null ? esc(Number(s.acres).toFixed(2)) : '') + '</td><td class="n">' + esc(s.est_units == null ? '' : s.est_units) + '</td>' +
          '<td>' + catChip(s.category) + '</td>' +
          '<td>' + pill('sites', s.id, 'status', s.status, SITE_STATUS, 'Status') + '</td><td>' + pill('sites', s.id, 'priority', s.priority, PRIORITY, 'Priority') + '</td><td>' + box('sites', s.id, 'owner', s.owner, ownerOpts(), 'Owner') + '</td>' +
          '<td style="min-width:150px;max-width:200px">' + inl('sites', s.id, 'contact', s.contact, { multi: 1, ph: '+ add contact', cls: 'small' }) + '</td>' +
          '<td style="min-width:220px;max-width:320px">' + inl('sites', s.id, 'notes', s.notes, { multi: 1, ph: '+ add notes', cls: 'small' }) + '</td>' +
          '<td>' + flagBtn(s) + '</td><td><button class="btn sm link cmt" data-act="openSite" data-code="' + esc(s.code) + '">&#128172; ' + (n || 'Add') + '</button></td><td>' + edtag(s).replace('Last edited by ', '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function filterSelect(k, all, noneLabel, list) {
    var f = S.f;
    return '<select class="box" data-filter="' + k + '"><option value="">' + esc(all) + '</option>' + (noneLabel ? '<option value="_none"' + (f[k] === '_none' ? ' selected' : '') + '>' + esc(noneLabel) + '</option>' : '') +
      list.map(function (x) { return '<option' + (f[k] === x ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select>';
  }
  function toolCard(href, ic, title, sub) {
    if (!href) return '';
    return '<a class="tool" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer"><div class="ic">' + ic + '</div><div class="tt"><b>' + esc(title) + '</b><small>' + esc(sub) + '</small></div><span class="btn sm">Open &#8599;</span></a>';
  }
  function vScreening(code) {
    var f = S.f;
    var h = '<div class="hd"><div><h1>Site screening</h1><div class="sub">' + activeSites().length + ' sites · every column is editable by both of you · status, notes, flags and comments sync with the shared screening map</div></div>' +
      '<div class="r"><button class="btn" data-act="exportCsv">Export CSV</button><button class="btn pri" data-act="toggleAddSite">+ Add site</button></div></div>';
    h += '<div class="tools">' +
      toolCard(CFG.syncMapUrl, '&#128506;', 'Screening map (shared notes)', 'Same status, notes, flags and comments as here') +
      toolCard(CFG.mapUrl, '&#128506;', 'San Diego County Site Map', String(CFG.mapUrl || '').replace(/^https:\/\//, '')) +
      toolCard(CFG.reviewMapUrl, '&#128221;', 'Review Map (notes, grading, CSV export)', String(CFG.reviewMapUrl || '').replace(/^https:\/\//, '')) + '</div>';
    if (S.addSite) {
      h += '<div class="card" style="margin-bottom:16px"><div class="ch"><h2>Add a site</h2><div class="r"><button class="x" data-act="toggleAddSite">&times;</button></div></div><div class="two">' +
        '<label class="field"><span>Site ID (required, e.g. S40)</span><input class="txt" data-ns="code"></label>' +
        '<label class="field"><span>Jurisdiction</span><input class="txt" data-ns="jurisdiction"></label>' +
        '<label class="field"><span>APN(s), comma separated</span><input class="txt" data-ns="apns" placeholder="e.g. 183-131-23, 183-131-24"></label>' +
        '<label class="field"><span>County</span><select class="txt" data-ns="county"><option>San Diego</option><option>Orange</option><option>Other</option></select></label>' +
        '<label class="field"><span>Acres</span><input class="txt" data-ns="acres" inputmode="decimal"></label>' +
        '<label class="field"><span>Est. units</span><input class="txt" data-ns="est_units" inputmode="numeric"></label>' +
        '</div><div style="margin-top:10px"><button class="btn pri" data-act="createSite">Add site</button></div></div>';
    }
    h += '<div class="card" style="padding:0;overflow:hidden"><div class="toolbar">' +
      '<input class="search" style="max-width:260px" data-filter="q" placeholder="Search sites, APN, notes" value="' + esc(f.q) + '">' +
      filterSelect('status', 'All statuses', 'No status yet', SITE_STATUS) + filterSelect('priority', 'All priorities', 'No priority yet', PRIORITY) +
      filterSelect('owner', 'All owners', 'Unassigned', ownerOpts()) + filterSelect('cat', 'All screen results', null, CATEGORIES) +
      '<label class="small" style="display:flex;gap:6px;align-items:center;color:var(--warn);font-weight:600"><input type="checkbox" data-filter="flagged"' + (f.flagged ? ' checked' : '') + '> &#9873; Flagged only</label>' +
      '<span class="muted small" id="site-count" style="margin-left:auto"></span></div><div id="sites-body">' + sitesBody() + '</div></div>';
    if (code) h += siteDrawer(code);
    return h;
  }
  function siteDrawer(code) {
    var s = S.sites.find(function (x) { return x.code === code; });
    if (!s) return '<div class="scrim" data-act="closeSite"></div><div class="drawer" id="drawer"><p>Site ' + esc(code) + ' was not found.</p><button class="btn" data-act="closeSite">Close</button></div>';
    var list = filteredSites(), i = list.findIndex(function (x) { return x.id === s.id; });
    var prev = i > 0 ? list[i - 1].code : null, next = i >= 0 && i < list.length - 1 ? list[i + 1].code : null;
    var parcels = S.site_parcels.filter(function (p) { return p.site_id === s.id; });
    var hist = S.activity.filter(function (a) { return a.parent_type === 'site' && a.parent_id === s.id; }).slice(0, 15);
    var h = '<div class="scrim" data-act="closeSite"></div><div class="drawer" id="drawer">';
    h += '<div style="display:flex;gap:10px;align-items:flex-start"><div style="flex:1;min-width:0"><div class="muted small">Site' + (s.rank ? ' · rank ' + esc(s.rank) : '') + (s.source === 'map' ? ' · added from the map' : '') + '</div>' +
      inl('sites', s.id, 'code', s.code, { req: 1, h1: 1 }) + inl('sites', s.id, 'jurisdiction', s.jurisdiction, { ph: 'Jurisdiction', cls: 'sub' }) + '</div>' +
      '<div style="display:flex;gap:6px">' + (prev ? '<button class="btn sm" data-act="openSite" data-code="' + esc(prev) + '">&lsaquo; Prev</button>' : '') + (next ? '<button class="btn sm" data-act="openSite" data-code="' + esc(next) + '">Next &rsaquo;</button>' : '') + '<button class="btn sm" data-act="closeSite">&times;</button></div></div>';
    h += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' + pill('sites', s.id, 'status', s.status, SITE_STATUS, 'Status') + pill('sites', s.id, 'priority', s.priority, PRIORITY, 'Priority') + box('sites', s.id, 'owner', s.owner, ownerOpts(), 'Owner') + box('sites', s.id, 'grade', s.grade, GRADES, 'Grade') + flagBtn(s) + edtag(s) + '</div>';
    if (s.flagged) h += '<div class="callout"><b>&#9873; Look at this site</b> · ' + esc(s.flagged_by || '') + ', ' + esc(ago(s.flagged_at)) + inl('sites', s.id, 'flag_note', s.flag_note, { multi: 1, ph: 'Why? (optional note)' }) + '</div>';
    var fl = function (label, inner) { return '<label class="field"><span>' + label + '</span>' + inner + '</label>'; };
    h += '<div class="sec"><h3>Details</h3><div class="two">' +
      fl('Screen result', box('sites', s.id, 'category', s.category, CATEGORIES, 'Not set')) +
      fl('County', inl('sites', s.id, 'county', s.county)) +
      fl('Acres', inl('sites', s.id, 'acres', s.acres, { type: 'num' })) +
      fl('Est. units', inl('sites', s.id, 'est_units', s.est_units, { type: 'int' })) +
      fl('Zoning', inl('sites', s.id, 'zone', s.zone)) +
      fl('APNs (as written)', inl('sites', s.id, 'apn_text', s.apn_text, { multi: 1 })) +
      fl('Price signal', inl('sites', s.id, 'price_signal', s.price_signal, { multi: 1, ph: '+ add' })) +
      fl('Assessed', inl('sites', s.id, 'assessed', s.assessed, { multi: 1, ph: '+ add' })) +
      '</div><div style="margin-top:6px">' + fl('Owner / contact', inl('sites', s.id, 'contact', s.contact, { multi: 1, ph: '+ add contact' })) + '</div>' +
      '<div style="margin-top:6px">' + fl('Notes (shared with the map)', inl('sites', s.id, 'notes', s.notes, { multi: 1, ph: '+ add notes' })) + '</div></div>';
    h += '<div class="sec"><h3>Map parcels (APNs that link this site to the screening map)</h3><div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
      parcels.map(function (p) { return '<span class="chip">' + esc(p.apn) + ' <button class="x" style="font-size:13px;padding:0 2px" data-act="del" data-t="site_parcels" data-id="' + esc(p.apn) + '" data-label="APN ' + esc(p.apn) + ' from this site">&times;</button></span>'; }).join('') +
      '<input class="txt" style="width:180px;padding:4px 8px" data-addapn="' + esc(s.id) + '" placeholder="+ APN, press Enter"></div>' +
      '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">' + (mapLink(s) ? '<a class="btn sm" target="_blank" rel="noopener noreferrer" href="' + esc(mapLink(s)) + '">Open on screening map &#8599;</a>' : '') +
      (CFG.reviewMapUrl ? '<a class="btn sm" target="_blank" rel="noopener noreferrer" href="' + esc(mapLink(s, CFG.reviewMapUrl)) + '">Open on review map &#8599;</a>' : '') + '</div></div>';
    h += '<div class="sec"><h3>Files</h3>' + folderRow('sites', s) + '<div style="margin-top:6px">' + filesBlock('site', s.id) + '</div></div>';
    h += '<div class="sec"><h3>Comments</h3>' + commentsBlock('site', s.id) + '</div>';
    if (hist.length) h += '<div class="sec"><h3>Change history</h3>' + hist.map(function (a) { return '<div class="tl"><span>' + describe(a) + ', ' + esc(ago(a.at)) + '</span></div>'; }).join('') + '</div>';
    h += '<div style="text-align:right"><button class="btn sm danger" data-act="archiveSite" data-id="' + esc(s.id) + '">Archive site</button></div>';
    return h + '</div>';
  }
  function vActivity() {
    var list = S.activity.filter(function (a) { return S.actFilter === 'All' || a.actor === S.actFilter; });
    return '<div class="hd"><div><h1>Activity log</h1><div class="sub">Every change either of you makes, newest first</div></div></div><div class="card"><div class="ch"><div class="seg">' +
      ['All'].concat(S.members.map(function (m) { return m.display_name; })).map(function (o) { return '<button data-act="actFilter" data-v="' + esc(o) + '" class="' + (S.actFilter === o ? 'on' : '') + '">' + esc(o) + '</button>'; }).join('') +
      '</div></div>' + feed(list.slice(0, 400)) + '</div>';
  }

  // ---------------------------------------------------------------- shell / auth views
  function vLogin() {
    var msg = S.loginMsg ? '<div class="okmsg">' + esc(S.loginMsg) + '</div>' : '';
    var err = S.loginErr ? '<div class="err">' + esc(S.loginErr) + '</div>' : '';
    if (!configured) err = '<div class="err">This portal is not connected to its database yet. Add the Supabase project URL and anon key in config.js.</div>';
    var dis = configured ? '' : ' disabled';
    return '<div class="login"><div class="lc"><div class="logo" style="padding:0 0 4px"><i>AB</i>Partnership Portal</div>' +
      '<h1 style="font-size:22px;margin-top:10px">Welcome back</h1><div class="sub">Private workspace. Invite only.</div>' +
            '<div class="fld"><label for="li-email">Email</label><input id="li-email" type="email" autocomplete="username" inputmode="email"></div>' +
      '<div class="fld"><label for="li-pw">Password</label><input id="li-pw" type="password" autocomplete="current-password"></div>' + err + msg +
      '<button class="btn pri" data-act="signIn" style="width:100%;justify-content:center;padding:11px;margin-top:4px"' + dis + '>Sign in</button>' +
      '<div style="display:flex;justify-content:space-between;gap:10px;margin-top:14px;font-size:12.5px;flex-wrap:wrap"><span></span><button class="btn link" data-act="forgot"' + dis + '>Forgot password?</button></div>' +
      '<div style="margin-top:18px;padding-top:12px;border-top:1px solid var(--line);color:var(--tx3);font-size:12px">Every edit is stamped with who made it and when.</div></div></div>';
  }
  function vSetPassword() {
    return '<div class="login"><div class="lc"><div class="logo" style="padding:0 0 4px"><i>AB</i>Partnership Portal</div><h1 style="font-size:22px;margin-top:10px">Set your password</h1>' +
      '<div class="sub">Signed in as ' + esc(S.session && S.session.user ? S.session.user.email : '') + '. Choose a password of at least 10 characters.</div><div style="height:14px"></div>' +
      '<div class="fld"><label for="np1">New password</label><input id="np1" type="password" autocomplete="new-password"></div>' +
      '<div class="fld"><label for="np2">Repeat password</label><input id="np2" type="password" autocomplete="new-password"></div>' + (S.loginErr ? '<div class="err">' + esc(S.loginErr) + '</div>' : '') +
      '<button class="btn pri" data-act="setPw" style="width:100%;justify-content:center;padding:11px">Save password</button></div></div>';
  }
  function vNotMember() {
    return '<div class="login"><div class="lc"><h1 style="font-size:20px">No access</h1><p class="sub">' + esc(S.session && S.session.user ? S.session.user.email : 'This account') + ' is not on this portal\'s member list.</p><button class="btn" data-act="signOut">Sign out</button></div></div>';
  }
  function statusHtml() {
    var o = others().map(function (m) {
      var p = S.online[m.display_name];
      return '<span><span class="dot' + (p ? '' : ' off') + '"></span>' + esc(m.display_name) + (p ? ' is online' + (p.view ? ' · ' + esc(p.view) : '') : ' is offline') + '</span>';
    }).join('');
    var sv = S.saving ? '<span class="save-dot">Saving...</span>' : '<span class="save-dot">' + (S.live ? 'All changes saved · live' : 'All changes saved') + '</span>';
    return o + sv + '<span class="editing">Editing as ' + esc(S.me.display_name) + '</span>';
  }
  function renderStatus() { var el = document.getElementById('pres'); if (el && S.me) el.innerHTML = statusHtml(); }
  function shell(body, r) {
    var deals = activeDeals();
    var nav = function (href, label, on, n) { return '<a href="' + href + '" class="' + (on ? 'on' : '') + '">' + esc(label) + (n != null ? '<span class="n">' + n + '</span>' : '') + '</a>'; };
    var openT = S.todos.filter(function (t) { return !t.done; }).length;
    var side = '<aside class="side"><div class="logo"><i>AB</i>Partnership Portal</div><nav class="nav"><small>Workspace</small>' +
      nav('#/', 'Dashboard', r.v === 'dash') + nav('#/todos', 'To-dos', r.v === 'todos', openT) + nav('#/activity', 'Activity log', r.v === 'activity') +
      '<small>Deals</small>' + deals.map(function (d) { return nav('#/deal/' + encodeURIComponent(d.slug), d.name, r.v === 'deal' && r.slug === d.slug); }).join('') +
      '<button class="add" data-act="addDeal">+ Add deal</button><small>Screening</small>' + nav('#/screening', 'Site screening', r.v === 'screening', activeSites().length) + '</nav>' +
      '<div class="me">' + av(S.me.display_name) + '<div><div class="t">' + esc(S.me.full_name || S.me.display_name) + '</div><div class="s"><button data-act="signOut">Sign out</button></div></div></div></aside>';
    var tab = function (href, ic, label, on) { return '<a href="' + href + '" class="' + (on ? 'on' : '') + '"><i>' + ic + '</i>' + label + '</a>'; };
    var tabbar = '<nav class="tabbar">' + tab('#/', '&#8962;', 'Home', r.v === 'dash') + tab('#/todos', '&#9745;', 'To-dos', r.v === 'todos') + tab('#/deals', '&#9776;', 'Deals', r.v === 'deals' || r.v === 'deal') + tab('#/screening', '&#9873;', 'Screening', r.v === 'screening') + tab('#/activity', '&#128172;', 'Activity', r.v === 'activity') + '</nav>';
    return '<div class="app">' + side + '<div class="main"><div class="top"><input class="search" data-gsearch placeholder="Search sites, APN, notes (Enter)" value=""><div class="pres" id="pres">' + statusHtml() + '</div></div>' +
      '<div class="page' + (r.v === 'screening' ? ' wide' : '') + '">' + body + '</div></div>' + tabbar + '</div>';
  }

  function isEditing() {
    var a = document.activeElement;
    return !!(a && root.contains(a) && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !/checkbox|date/.test(a.type))) && !a.hasAttribute('data-filter') && !a.hasAttribute('data-gsearch'));
  }
  function render() {
    if (S.me && S.loaded && isEditing()) { pending = true; return; }
    pending = false;
    var dr = document.getElementById('drawer'), drScroll = dr ? dr.scrollTop : 0;
    var html;
    if (!sb || !S.session) html = vLogin();
    else if (S.needPassword) html = vSetPassword();
    else if (S.notMember) html = vNotMember();
    else if (!S.loaded) html = '<div class="boot">Loading portal...</div>';
    else {
      var r = route(), body;
      if (r.v === 'deal') body = vDeal(r.slug);
      else if (r.v === 'deals') body = vDeals();
      else if (r.v === 'todos') body = vTodos();
      else if (r.v === 'screening') body = vScreening(r.code);
      else if (r.v === 'activity') body = vActivity();
      else body = vDash();
      html = shell(body, r);
    }
    root.innerHTML = html;
    var dr2 = document.getElementById('drawer'); if (dr2 && drScroll) dr2.scrollTop = drScroll;
    root.querySelectorAll('textarea.inl').forEach(grow);
    var sc = document.getElementById('site-count'); if (sc) sc.textContent = filteredSites().length + ' shown';
  }
  function grow(el) { el.style.height = 'auto'; el.style.height = (el.scrollHeight + 2) + 'px'; }
  document.addEventListener('focusout', function () { setTimeout(function () { if (pending && !isEditing()) render(); }, 30); });

  // ---------------------------------------------------------------- editing events
  function readVal(el) {
    var type = el.getAttribute('data-type');
    if (type === 'bool') return el.checked;
    var v = el.value;
    if (typeof v === 'string') v = v.trim();
    if (v === '') return null;
    if (type === 'num') { var n = Number(String(v).replace(/,/g, '')); return isFinite(n) ? n : undefined; }
    if (type === 'int') { var i = parseInt(String(v).replace(/,/g, ''), 10); return isFinite(i) ? i : undefined; }
    if (type === 'url') return safeUrl(v) ? v : undefined;
    return v;
  }
  function commit(el) {
    var t = el.getAttribute('data-t'), id = el.getAttribute('data-id'), f = el.getAttribute('data-f');
    var row = byKey(t, id); if (!row) return;
    var v = readVal(el);
    if (v === undefined) { toast(el.getAttribute('data-type') === 'url' ? 'Links must start with https://' : 'That value is not a number', true); el.value = row[f] == null ? '' : row[f]; return; }
    if (v === null && el.hasAttribute('data-req')) { el.value = row[f] == null ? '' : row[f]; return; }
    var cur = row[f]; if (cur === undefined) cur = null;
    if (f === 'due_date' || f === 'date') cur = cur ? String(cur).slice(0, 10) : null;
    if (String(cur) === String(v)) return;
    var patch = {}; patch[f] = v;
    if (t === 'sites' && f === 'code') {
      if (S.sites.some(function (s) { return s.id !== id && String(s.code).toLowerCase() === String(v).toLowerCase(); })) { toast('That site ID is already used', true); el.value = row.code; return; }
      save(t, id, patch).then(function (ok) { if (ok && route().code) location.hash = '#/screening/' + encodeURIComponent(v); });
      return;
    }
    if (t === 'todos' && f === 'done' && v === true) toast('Checked off');
    save(t, id, patch);
  }
  root.addEventListener('change', function (e) {
    var el = e.target;
    if (el.hasAttribute('data-save') && (el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'date')) commit(el);
    if (el.hasAttribute('data-filter')) {
      var k = el.getAttribute('data-filter');
      S.f[k] = el.type === 'checkbox' ? el.checked : el.value;
      updateSitesBody();
    }
    if (el.getAttribute('data-act') === 'toggleDone') { S.todoShowDone = el.checked; render(); }
  });
  root.addEventListener('focusout', function (e) {
    var el = e.target;
    if (el.hasAttribute && el.hasAttribute('data-save') && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !/checkbox|date/.test(el.type)))) commit(el);
  });
  root.addEventListener('input', function (e) {
    var el = e.target;
    if (el.tagName === 'TEXTAREA' && el.classList.contains('inl')) grow(el);
    if (el.getAttribute('data-filter') === 'q') { S.f.q = el.value; updateSitesBody(); }
    if (el.hasAttribute('data-compose')) { S.drafts[el.getAttribute('data-compose')] = el.value; mentionPopup(el); }
  });
  root.addEventListener('keydown', function (e) {
    var el = e.target;
    if (e.key === 'Enter' && el.tagName === 'INPUT' && el.hasAttribute('data-save')) { e.preventDefault(); el.blur(); return; }
    if (e.key === 'Escape' && el.hasAttribute && el.hasAttribute('data-save')) {
      var row = byKey(el.getAttribute('data-t'), el.getAttribute('data-id'));
      if (row) el.value = row[el.getAttribute('data-f')] == null ? '' : row[el.getAttribute('data-f')];
      el.blur(); return;
    }
    if (e.key === 'Enter' && el.hasAttribute('data-add')) { e.preventDefault(); addFromInput(el); return; }
    if (e.key === 'Enter' && el.hasAttribute('data-addapn')) { e.preventDefault(); addApn(el); return; }
    if (e.key === 'Enter' && el.hasAttribute('data-gsearch')) {
      e.preventDefault(); S.f = { q: el.value, status: '', priority: '', owner: '', cat: '', flagged: false };
      if (route().v !== 'screening') location.hash = '#/screening'; else render();
      return;
    }
    if (el.hasAttribute('data-compose')) {
      var pop = document.getElementById('mpop');
      if (pop && (e.key === 'Enter' || e.key === 'Tab')) { var b = pop.querySelector('button'); if (b) { e.preventDefault(); pickMention(el, b.getAttribute('data-name')); return; } }
      if (pop && e.key === 'Escape') { pop.remove(); return; }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); postComment(el.getAttribute('data-compose')); }
      return;
    }
    if (el.id === 'li-pw' && e.key === 'Enter') signIn();
    if (el.id === 'np2' && e.key === 'Enter') setPw();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && route().code && !isEditing()) location.hash = '#/screening';
  });
  function updateSitesBody() {
    var b = document.getElementById('sites-body'); if (!b) return;
    b.innerHTML = sitesBody(); b.querySelectorAll('textarea.inl').forEach(grow);
    var sc = document.getElementById('site-count'); if (sc) sc.textContent = filteredSites().length + ' shown';
  }
  function mentionPopup(el) {
    var old = document.getElementById('mpop'); if (old) old.remove();
    var pre = el.value.slice(0, el.selectionStart), m = /(^|\s)@(\w*)$/.exec(pre);
    if (!m) return;
    var q = m[2].toLowerCase();
    var list = S.members.filter(function (x) { return x.display_name.toLowerCase().indexOf(q) === 0; });
    if (!list.length) return;
    var pop = document.createElement('div'); pop.className = 'pop'; pop.id = 'mpop';
    pop.innerHTML = list.map(function (x, i) { return '<button type="button" class="' + (i === 0 ? 'hl' : '') + '" data-name="' + esc(x.display_name) + '">' + av(x.display_name, 'sm') + ' ' + esc(x.full_name || x.display_name) + '</button>'; }).join('');
    pop.addEventListener('mousedown', function (ev) { var b = ev.target.closest('button'); if (b) { ev.preventDefault(); pickMention(el, b.getAttribute('data-name')); } });
    el.parentNode.appendChild(pop);
  }
  function pickMention(el, name) {
    var pos = el.selectionStart, pre = el.value.slice(0, pos).replace(/@(\w*)$/, '@' + name + ' ');
    el.value = pre + el.value.slice(pos); el.focus(); el.setSelectionRange(pre.length, pre.length);
    S.drafts[el.getAttribute('data-compose')] = el.value;
    var p = document.getElementById('mpop'); if (p) p.remove();
  }
  async function postComment(key) {
    var el = root.querySelector('[data-compose="' + key + '"]');
    var body = (el ? el.value : S.drafts[key] || '').trim(); if (!body) return;
    var parts = key.split(':');
    var r = await insert('comments', { entity_type: parts[0], entity_id: parts[1], body: body, mentions: parseMentions(body), source: 'portal' }, true);
    if (r) { S.drafts[key] = ''; if (el) { el.value = ''; el.blur(); } render(); toast('Comment posted'); }
  }
  async function addFromInput(el) {
    var title = el.value.trim(); if (!title) return;
    var kind = el.getAttribute('data-add'), deal = el.getAttribute('data-deal') || null;
    var r;
    if (kind === 'todo') {
      var area = el.getAttribute('data-area') || null;
      r = await insert('todos', { title: title, deal_id: deal, area: deal ? null : (area || 'Partnership'), owner: S.ownerFilter !== 'All' ? S.ownerFilter : null, priority: 'Medium' }, true);
    } else if (kind === 'milestone') {
      var n = S.milestones.filter(function (m) { return m.deal_id === deal; }).length;
      r = await insert('milestones', { title: title, deal_id: deal, sort: n }, true);
    }
    if (r) { el.value = ''; el.blur(); render(); var again = root.querySelector('[data-add="' + kind + '"]'); if (again) again.focus(); }
  }
  function normApn(a) { return String(a || '').replace(/\D/g, ''); }
  async function addApn(el) {
    var apn = normApn(el.value), siteId = el.getAttribute('data-addapn');
    if (apn.length < 7 || apn.length > 12) { toast('APN should be 7 to 12 digits', true); return; }
    var ex = S.site_parcels.find(function (p) { return p.apn === apn; });
    if (ex) { var o = siteById(ex.site_id); toast('APN ' + apn + ' already belongs to site ' + (o ? o.code : ''), true); return; }
    var r = await insert('site_parcels', { apn: apn, site_id: siteId }, true);
    if (r) { el.value = ''; el.blur(); render(); }
  }

  // ---------------------------------------------------------------- click actions
  var ACTS = {
    ownerFilter: function (b) { S.ownerFilter = b.getAttribute('data-v'); render(); },
    actFilter: function (b) { S.actFilter = b.getAttribute('data-v'); render(); },
    openSite: function (b) { location.hash = '#/screening/' + encodeURIComponent(b.getAttribute('data-code')); },
    closeSite: function () { location.hash = '#/screening'; },
    showFlagged: function () { S.f = { q: '', status: '', priority: '', owner: '', cat: '', flagged: true }; },
    openAddSite: function () { S.addSite = true; },
    toggleAddSite: function () { S.addSite = !S.addSite; render(); },
    mentionsRead: function () { localStorage.setItem('portal.mentionsSeen.' + S.me.display_name, String(Date.now())); render(); },
    del: function (b) {
      if (!confirm('Remove ' + b.getAttribute('data-label') + '? This is recorded in the activity log.')) return;
      del(b.getAttribute('data-t'), b.getAttribute('data-id'));
    },
    flag: function (b) { var s = siteById(b.getAttribute('data-id')); if (s) save('sites', s.id, { flagged: !s.flagged }); },
    addDeal: async function () {
      var name = prompt('Name of the new deal (for example: Oak Street, Escondido)'); if (!name || !name.trim()) return;
      var slug = slugify(name); if (S.deals.some(function (d) { return d.slug === slug; })) slug += '-' + Math.random().toString(36).slice(2, 6);
      var r = await insert('deals', { name: name.trim(), slug: slug, status: 'Prospect', sort: S.deals.length + 1 });
      if (r) location.hash = '#/deal/' + r.slug;
    },
    archiveDeal: function (b) {
      if (confirm('Archive this deal? It disappears from lists but stays in the database and the log.'))
        save('deals', b.getAttribute('data-id'), { archived_at: new Date().toISOString() }).then(function () { location.hash = '#/deals'; });
    },
    archiveSite: function (b) {
      if (confirm('Archive this site? It disappears from the list but stays in the database and the log.'))
        save('sites', b.getAttribute('data-id'), { archived_at: new Date().toISOString() }).then(function () { location.hash = '#/screening'; });
    },
    addTerm: function (b) { var id = b.getAttribute('data-id'); insert('deal_terms', { deal_id: id, label: 'New term', value: null, sort: S.deal_terms.filter(function (t) { return t.deal_id === id; }).length }); },
    addDate: function () { insert('key_dates', { date: todayISO(), title: 'New date', kind: 'Upcoming' }); },
    cPost: function (b) { postComment(b.getAttribute('data-key')); },
    cEdit: function (b) { S.editComment = b.getAttribute('data-id'); render(); },
    cCancel: function () { S.editComment = null; render(); },
    cSave: function (b) {
      var id = b.getAttribute('data-id'), ta = root.querySelector('[data-cedit="' + id + '"]'), body = ta ? ta.value.trim() : '';
      if (!body) return; S.editComment = null; if (ta) ta.blur(); save('comments', id, { body: body, mentions: parseMentions(body) });
    },
    cDel: function (b) { if (confirm('Delete your comment?')) save('comments', b.getAttribute('data-id'), { deleted_at: new Date().toISOString() }); },
    fAdd: async function (b) {
      var type = b.getAttribute('data-type'), id = b.getAttribute('data-id'), key = type + ':' + id;
      var ti = root.querySelector('[data-fnew="title"][data-key="' + key + '"]'), ui = root.querySelector('[data-fnew="url"][data-key="' + key + '"]');
      var url = ui.value.trim(), title = ti.value.trim();
      if (!safeUrl(url)) { toast('Paste a link that starts with https://', true); return; }
      if (!title) title = PROV_LABEL[provider(url)] + ' link';
      var r = await insert('files', { entity_type: type, entity_id: id, title: title, url: url, provider: provider(url), sort: S.files.filter(function (f) { return f.entity_id === id; }).length });
      if (r) toast('Link added');
    },
    createSite: async function () {
      var g = function (k) { var el = root.querySelector('[data-ns="' + k + '"]'); return el ? el.value.trim() : ''; };
      var code = g('code'); if (!code) { toast('Site ID is required', true); return; }
      if (S.sites.some(function (s) { return String(s.code).toLowerCase() === code.toLowerCase(); })) { toast('That site ID already exists', true); return; }
      var apns = g('apns').split(/[,;\s]+/).map(normApn).filter(function (a) { return a.length >= 7 && a.length <= 12; });
      var clash = apns.filter(function (a) { return S.site_parcels.some(function (p) { return p.apn === a; }); });
      if (clash.length) { toast('APN ' + clash[0] + ' already belongs to another site', true); return; }
      var acres = g('acres') ? Number(g('acres')) : null, units = g('est_units') ? parseInt(g('est_units'), 10) : null;
      var s = await insert('sites', { code: code, jurisdiction: g('jurisdiction') || null, county: g('county') || null, apn_text: g('apns') || null, acres: isFinite(acres) ? acres : null, est_units: isFinite(units) ? units : null, source: 'portal' }, true);
      if (!s) return;
      for (var i = 0; i < apns.length; i++) await insert('site_parcels', { apn: apns[i], site_id: s.id }, true);
      S.addSite = false; location.hash = '#/screening/' + encodeURIComponent(s.code); render(); toast('Site added');
    },
    exportCsv: function () {
      var cols = ['code', 'rank', 'category', 'jurisdiction', 'county', 'apn_text', 'acres', 'zone', 'est_units', 'status', 'priority', 'owner', 'grade', 'flagged', 'flag_note', 'contact', 'notes', 'price_signal', 'assessed', 'storage_url', 'updated_by', 'updated_at'];
      var q = function (v) { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      var lines = [cols.join(',')].concat(filteredSites().map(function (s) { return cols.map(function (c) { return q(s[c]); }).join(','); }));
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv' })); a.download = 'screening-sites-' + todayISO() + '.csv';
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    },
    signIn: function () { signIn(); },
    magic: async function () {
      var email = (document.getElementById('li-email') || {}).value; if (!email) { S.loginErr = 'Enter your email first.'; render(); return; }
      var r = await sb.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname } });
      S.loginErr = r.error ? r.error.message : null; S.loginMsg = r.error ? null : 'Check your email for a sign-in link.'; render();
    },
    forgot: async function () {
      var email = (document.getElementById('li-email') || {}).value; if (!email) { S.loginErr = 'Enter your email first.'; render(); return; }
      var r = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin + location.pathname });
      S.loginErr = r.error ? r.error.message : null; S.loginMsg = r.error ? null : 'If that email is a member, a reset link is on its way.'; render();
    },
    setPw: function () { setPw(); },
    signOut: async function () { stopRealtime(); await sb.auth.signOut(); }
  };
  root.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b || !root.contains(b)) return;
    var a = b.getAttribute('data-act'); if (!ACTS[a]) return;
    if (b.tagName === 'BUTTON' || b.classList.contains('scrim')) e.preventDefault();
    ACTS[a](b, e);
  });
  async function signIn() {
    var email = (document.getElementById('li-email') || {}).value || '', pw = (document.getElementById('li-pw') || {}).value || '';
    if (!email || !pw) { S.loginErr = 'Enter your email and password.'; render(); return; }
    var r = await sb.auth.signInWithPassword({ email: email.trim(), password: pw });
    if (r.error) { S.loginErr = r.error.message === 'Invalid login credentials' ? 'That email and password do not match.' : r.error.message; S.loginMsg = null; render(); }
  }
  async function setPw() {
    var a = (document.getElementById('np1') || {}).value || '', b = (document.getElementById('np2') || {}).value || '';
    if (a.length < 10) { S.loginErr = 'Use at least 10 characters.'; render(); return; }
    if (a !== b) { S.loginErr = 'The two passwords do not match.'; render(); return; }
    var r = await sb.auth.updateUser({ password: a });
    if (r.error) { S.loginErr = r.error.message; render(); return; }
    S.needPassword = false; S.loginErr = null; history.replaceState(null, '', location.pathname + '#/'); toast('Password saved'); boot();
  }

  // ---------------------------------------------------------------- boot
  async function boot() {
    if (!S.session || S.loading) { render(); return; }
    if (S.needPassword) { render(); return; }
    try {
      S.loading = true; render();
      await loadAll();
      var email = String(S.session.user.email || '').toLowerCase();
      S.me = S.members.find(function (m) { return m.email === email; }) || null;
      S.notMember = !S.me;
      if (S.me) startRealtime();
    } catch (err) {
      S.loading = false; S.loaded = false;
      toast('Could not load data: ' + (err.message || err), true);
    }
    render();
  }
  window.addEventListener('hashchange', function () { render(); trackPresence(); });
  window.addEventListener('resize', function () { clearTimeout(window.__rz); window.__rz = setTimeout(function () { if (route().v === 'screening') updateSitesBody(); }, 150); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && S.me && Date.now() - S.lastLoad > 60000) loadAll().then(render).catch(function () { });
  });
  setInterval(function () { if (S.me && !isEditing() && !document.hidden) render(); }, 60000); // refresh the "2h ago" labels

  if (!sb) { render(); return; }
  if (hashErr) S.loginErr = decodeURIComponent(hashErr.replace(/\+/g, ' '));
  sb.auth.onAuthStateChange(function (event, session) {
    var had = !!S.session;
    S.session = session;
    if (event === 'PASSWORD_RECOVERY') S.needPassword = true;
    if (!session) { stopRealtime(); S.me = null; S.loaded = false; S.notMember = false; render(); return; }
    if (!had || (event === 'SIGNED_IN' && !S.loaded)) setTimeout(boot, 0);
  });
  sb.auth.getSession().then(function (r) {
    S.session = r.data.session;
    if (S.session && (hashType === 'invite' || hashType === 'recovery')) S.needPassword = true;
    if (S.session && /access_token=/.test(location.hash)) history.replaceState(null, '', location.pathname + '#/');
    boot();
  });
})();
