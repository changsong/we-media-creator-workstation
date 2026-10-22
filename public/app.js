(function(){
  var API = '/api';
  var suppressUntil = 0;
  var reloadTimer = null;
  var staleWhileEditing = false;

  function request(path, options){
    var opt = options || {};
    var headers = { 'Content-Type': 'application/json' };
    if(opt.headers){
      Object.keys(opt.headers).forEach(function(k){ headers[k] = opt.headers[k]; });
    }
    opt.headers = headers;
    return fetch(API + path, opt).then(function(res){
      return res.text().then(function(text){
        var body = null;
        if(text){
          try{ body = JSON.parse(text); }catch(err){ body = null; }
        }
        if(!res.ok){
          var msg = (body && (body.error || body.message)) || ('请求失败（HTTP ' + res.status + '）');
          throw new Error(msg);
        }
        return body;
      });
    }, function(){
      throw new Error('连不上本地服务，请确认 npm start 仍在运行');
    });
  }

  function makeOps(key){
    var base = '/tables/' + key + '/records';
    return {
      schema: function(){ return request('/schema/' + key); },
      page: function(cursor){
        return request(base + '?pageSize=200' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
      },
      add: function(props){ return request(base, { method: 'POST', body: JSON.stringify({ properties: props }) }); },
      upd: function(id, props){
        return request(base + '/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ properties: props }) });
      },
      del: function(id){ return request(base + '/' + encodeURIComponent(id), { method: 'DELETE' }); }
    };
  }

  var OPS = {};
  ['topic','calendar','review','asset'].forEach(function(key){ OPS[key] = makeOps(key); });

  var ID_FIELD = { topic:'选题ID', calendar:'排期ID', review:'复盘ID', asset:'素材ID' };
  var DB_LABEL = { topic:'选题池', calendar:'内容日历', review:'数据复盘', asset:'素材库' };

  var DATA = { topic:[], calendar:[], review:[], asset:[] };
  var SCHEMAS = {};
  var PROFILE = { name:'Alexandra', role:'主理人', hasAvatar:false, avatarUrl:'/assets/img-4.png' };
  var STAGES = ['选题确认','脚本撰写','待补素材','制作中','待审核','待发布','已发布','二次分发','已复盘'];
  var STATUS = ['待写','写作中','已发布','废弃'];
  var PLATFORMS = ['抖音','视频号','快手','微博','公众号','小红书','B站','知乎'];
  var PLATFORM_COLOR = {
    '公众号':'#2f8f5b','小红书':'#c25454','视频号':'#3b7ea1','抖音':'#5c5470',
    'B站':'#4a7fa5','知乎':'#5f5a9e','微博':'#b8863b','快手':'#d9531e'
  };
  var STAGE_COLORS = ['#82877e','#b8863b','#c25454','#6f66a8','#3b7ea1','#a07e00','#2f8f5b','#2c7465','#5f5a9e'];
  var TAGS = ['干货','观点','故事','合集','热点','测评'];
  var ASSET_TAGS = TAGS.concat(['封面','标题','排版','转化']);

  var state = {
    view:'home', platform:'all', status:'all', stage:'all', q:'', month:null,
    assetId:null, reviewMode:'agg', reviewRange:'all',
    lifecyclePage:1, lifecycleSize:30, reviewListPage:1, reviewListSize:30,
    inlineTopic:null, topicDraft:null, topicSort:'desc', assetKeyword:'all', inspectCode:null,
    topicChecked:{}
  };
  var editing = { dbKey:null, recordId:null, record:null };
  var loading = false;
  var PUB = { tasks:[], status:null, loaded:false, detailId:null, timer:null, mode:'detail', watch:null };
  var PUB_UPLOAD = { kind:'video', items:[], pendingIds:[], uploading:false, progress:0, previewUrls:[], kept:false, xhrs:[] };
  var MEDIA_EDIT = { scheduleId:null, format:'', kind:null, items:[], pendingIds:[], uploading:false, xhrs:[], otherCount:0 };
  var CAL_COVER = newCalendarCoverState();
  var CROP = { active:false, img:null, natW:0, natH:0, scale:1, stageW:0, stageH:0, ratio:'original', rect:{x:0,y:0,w:0,h:0}, drag:null };

  function newCalendarCoverState(){
    return {
      scheduleId:null, format:'', supported:false, loading:false,
      current:null, original:null, pendingIds:[], uploading:false,
      dirty:false, source:null, xhrs:[], uploadRun:0
    };
  }

  /* ---------- utils ---------- */
  function $(id){ return document.getElementById(id); }
  function esc(s){
    return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function pad(n){ return n < 10 ? '0' + n : String(n); }
  function isoDay(d){ return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
  function parseDate(v){
    if(!v) return null;
    if(v instanceof Date) return v;
    var s = String(v);
    var d = new Date(s);
    if(isNaN(d.getTime()) && s.length >= 10){
      d = new Date(s.substring(0,10) + 'T00:00:00');
    }
    return isNaN(d.getTime()) ? null : d;
  }
  function dayKey(v){
    var d = parseDate(v);
    return d ? isoDay(new Date(d.getFullYear(), d.getMonth(), d.getDate())) : '';
  }
  function fmtDate(v){
    var d = parseDate(v);
    if(!d) return '—';
    return (d.getMonth()+1) + '月' + d.getDate() + '日';
  }
  function fmtDateTime(v){
    var d = parseDate(v);
    if(!d) return '—';
    return (d.getMonth()+1) + '月' + d.getDate() + '日 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function fmtTimeOnly(v){
    var d = parseDate(v);
    return d ? pad(d.getHours()) + ':' + pad(d.getMinutes()) : '';
  }
  function startOfDay(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function startOfWeek(d){
    var x = startOfDay(d); var wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); return x;
  }
  function addDays(d, n){ var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  function num(v){ var n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function fmtNum(n){
    var v = Math.round(num(n));
    return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function pct(a, b){ if(!b) return '—'; return (a / b * 100).toFixed(1) + '%'; }
  function urlOf(v){
    if(!v) return '';
    if(typeof v === 'string') return v;
    if(v.link) return v.link;
    if(v.length && v[0] && v[0].link) return v[0].link;
    return '';
  }
  function urlText(v){
    if(!v) return '';
    if(typeof v === 'string') return v;
    if(v.text) return v.text;
    if(v.length && v[0] && v[0].text) return v[0].text;
    return '';
  }
  function truncate(s, n){
    s = String(s || '');
    if(s.length <= n) return s;
    return s.substring(0, n) + '…';
  }
  function hostOf(u){
    try{ return new URL(u).hostname.replace(/^www\./,''); }catch(err){ return ''; }
  }
  function cnWeekday(d){
    return ['周日','周一','周二','周三','周四','周五','周六'][d.getDay()];
  }
  function stageClass(s){
    var i = STAGES.indexOf(s);
    return 'stage-' + (i >= 0 ? i : 0);
  }
  function statusClass(s){
    var i = STATUS.indexOf(s);
    return 'status-' + (i >= 0 ? i : 0);
  }
  function platformList(p){
    if(Array.isArray(p)) return p.filter(function(x){ return !!x; });
    return p ? [String(p)] : [];
  }
  function platformText(p){
    var list = platformList(p);
    return list.length ? list.join('、') : '未填';
  }
  function platformPill(p){
    var cls = PLATFORMS.indexOf(p) >= 0 ? p : 'default';
    return '<span class="pf-pill pf-' + cls + '">' + esc(p || '未填') + '</span>';
  }
  function platformChip(p){
    var list = platformList(p);
    if(list.length > 1){
      return '<span class="pf-group">' + list.map(platformPill).join('') + '</span>';
    }
    return platformPill(list[0] || '');
  }
  function starPill(score){
    if(score == null || score === '') return '<span class="text-label-sm text-outline">—</span>';
    var v = num(score);
    var high = v >= 8.5;
    var bg = high ? 'bg-secondary-fixed text-on-secondary-fixed-variant' : 'bg-surface-container text-on-surface-variant';
    return '<span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-label-sm font-label-sm ' + bg + '">' +
      '<span class="material-symbols-outlined text-[13px]" style="font-variation-settings:\'FILL\' ' + (high ? 1 : 0) + '">star</span>' +
      v.toFixed(1) + '</span>';
  }
  function quickSelect(dbKey, r, field, options, cls){
    var v = r[field] || '';
    var c = (cls || '').replace(/\bst\b/g,'').trim();
    var html = '<span class="qsel-wrap"><select class="qsel ' + c + '" data-quick="' + dbKey + '" data-id="' + esc(r['_id']) + '" data-qfield="' + field + '" title="点击直接修改，选完即存">';
    options.forEach(function(o){
      html += '<option value="' + esc(o) + '"' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>';
    });
    html += '</select></span>';
    return html;
  }
  function avatarInitial(name){
    var s = String(name || '未');
    return s.substring(0, 1);
  }
  function emptyState(title, sub, icon){
    return '<div class="empty"><span class="material-symbols-outlined">' + (icon || 'inbox') + '</span><b>' + esc(title) + '</b><span class="text-label-sm">' + esc(sub || '') + '</span></div>';
  }

  function quickUpdate(dbKey, id, field, value){
    var rec = null;
    DATA[dbKey].forEach(function(r){ if(r['_id'] === id) rec = r; });
    if(!rec || rec[field] === value) return;
    var patch = {};
    patch[field] = { select: value };
    suppressUntil = Date.now() + 1500;
    OPS[dbKey].upd(id, patch).then(function(){
      return loadTable(dbKey);
    }).then(function(){
      render();
      toast('「' + field + '」已更新为「' + value + '」 · ' + hhmm(), 'ok');
      if(dbKey === 'calendar'){
        var saved = null;
        DATA.calendar.forEach(function(r){ if(r['_id'] === id) saved = r; });
        syncTopicStatus(saved);
        if(field === '当前阶段' && value === '已发布') askTodaySnapshot(saved);
        if(field === '当前阶段' && value === '待发布') autoQueuePublish(saved);
      }
    }).catch(function(err){
      loadTable(dbKey).then(render);
      toast('更新失败：' + errMsg(err), 'err');
    });
  }

  function promptToast(msg, okLabel, cb){
    var box = $('toasts');
    var el = document.createElement('div');
    el.className = 'toast ask';
    el.innerHTML = '<div class="flex items-start gap-2"><span class="material-symbols-outlined text-lg" style="color:#a07e00">notifications_active</span><span class="text-body-sm">' + esc(msg) + '</span></div>';
    var row = document.createElement('div');
    row.className = 'trow justify-end';
    var ok = document.createElement('button');
    ok.className = 'tbtn'; ok.textContent = okLabel;
    var no = document.createElement('button');
    no.className = 'tbtn ghost'; no.textContent = '先不记';
    row.appendChild(no); row.appendChild(ok);
    el.appendChild(row);
    box.appendChild(el);
    setTimeout(function(){ el.classList.add('on'); }, 10);
    var dismissed = false;
    function dismiss(){
      if(dismissed) return;
      dismissed = true;
      el.classList.remove('on');
      setTimeout(function(){ if(el.parentNode) el.parentNode.removeChild(el); }, 320);
    }
    ok.addEventListener('click', function(){ dismiss(); cb(); });
    no.addEventListener('click', dismiss);
    setTimeout(dismiss, 12000);
  }

  function hasSnapshotToday(scheduleCode){
    var today = isoDay(new Date());
    var hit = false;
    DATA.review.forEach(function(r){
      if(r['排期ID'] === scheduleCode && dayKey(r['统计日期']) === today) hit = true;
    });
    return hit;
  }

  function askTodaySnapshot(calRec){
    if(!calRec || !calRec['排期ID'] || calRec['当前阶段'] !== '已发布') return;
    if(hasSnapshotToday(calRec['排期ID'])) return;
    promptToast('「' + (calRec['标题'] || calRec['排期ID']) + '」已发布，今天的数据快照还没建', '记一条', function(){
      openEditor('review', null, {
        fill: { '排期ID': calRec['排期ID'], '平台': platformList(calRec['平台'])[0] || '' },
        subText: '已带出排期与平台，数字可以先估一份，明天再记累计值'
      });
    });
  }

  function bindText(el, text){
    if(!el) return el;
    el.textContent = text;
    return el;
  }
  function toast(msg, kind){
    var box = $('toasts');
    var el = document.createElement('div');
    el.className = 'toast' + (kind === 'err' ? ' err' : '');
    el.innerHTML = '<span class="material-symbols-outlined text-lg" style="' + (kind === 'err' ? '' : 'color:#ffdf91') + '">' + (kind === 'err' ? 'error' : 'check_circle') + '</span><span>' + esc(msg) + '</span>';
    box.appendChild(el);
    setTimeout(function(){ el.classList.add('on'); }, 10);
    setTimeout(function(){
      el.classList.remove('on');
      setTimeout(function(){ if(el.parentNode) el.parentNode.removeChild(el); }, 320);
    }, 3400);
  }
  function scrollTop(){
    try{
      if(document.documentElement) document.documentElement.scrollTop = 0;
      if(document.body) document.body.scrollTop = 0;
    }catch(err){}
  }
  function setSync(text, kind){
    bindText($('syncText'), text);
    var dot = $('syncDot');
    if(!dot) return;
    if(kind === 'err') dot.className = 'w-2 h-2 rounded-full bg-red-500';
    else if(kind === 'ok') dot.className = 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse';
    else dot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-pulse';
  }
  function errMsg(err){
    if(!err) return '未知错误';
    if(typeof err === 'string') return err;
    return err.message || err.msg || err.error || '写入未生效，请重试';
  }

  /* ---------- data ---------- */
  function loadTable(dbKey){
    var ops = OPS[dbKey];
    return ops.page(null).then(function(first){
      var acc = [];
      function step(res, cursor, guard){
        acc = acc.concat(res.results || []);
        var next = res.nextCursor;
        if(res.hasMore && next && next !== cursor && (res.results || []).length && guard < 100){
          return ops.page(next).then(function(r2){
            return step(r2, next, guard + 1);
          });
        }
        return acc;
      }
      return step(first, null, 0);
    }).then(function(rows){
      DATA[dbKey] = rows || [];
      return DATA[dbKey];
    });
  }
  function loadSchema(dbKey){
    return OPS[dbKey].schema().then(function(schema){
      SCHEMAS[dbKey] = (schema && schema.properties) ? schema.properties : [];
      return SCHEMAS[dbKey];
    }).catch(function(){
      SCHEMAS[dbKey] = SCHEMAS[dbKey] || [];
      return SCHEMAS[dbKey];
    });
  }
  function profileAvatarUrl(){
    return (PROFILE && PROFILE.avatarUrl) ? PROFILE.avatarUrl : '/assets/img-4.png';
  }
  function applyProfileChrome(){
    var name = (PROFILE && PROFILE.name) || 'Alexandra';
    var av = $('headerAvatar');
    if(av) av.src = profileAvatarUrl();
    var nm = $('headerName');
    if(nm) nm.textContent = name;
  }
  function loadProfile(){
    return request('/profile').then(function(p){
      if(p && p.name) PROFILE = p;
      applyProfileChrome();
      return PROFILE;
    });
  }
  function loadAllData(){
    if(loading) return Promise.resolve();
    loading = true;
    setSync('同步中…', '');
    var keys = ['topic','calendar','review','asset'];
    function step(i){
      if(i >= keys.length) return Promise.resolve();
      var k = keys[i];
      return loadSchema(k).then(function(){ return loadTable(k); }).then(function(){ return step(i + 1); });
    }
    return step(0).then(function(){
      loading = false;
      var n = DATA.topic.length + DATA.calendar.length + DATA.review.length + DATA.asset.length;
      setSync('已同步 · ' + n + ' 条记录', 'ok');
      render();
    }).catch(function(err){
      loading = false;
      setSync('同步失败', 'err');
      toast('读取失败：' + errMsg(err), 'err');
      render();
    });
  }

  function loadPublishData(){
    return Promise.all([
      request('/publish/tasks'),
      request('/publish/status')
    ]).then(function(res){
      PUB.tasks = (res[0] && res[0].tasks) || [];
      PUB.status = res[1] || null;
      PUB.loaded = true;
    });
  }

  function syncChannel(api, label, unit, btn){
    if(btn && btn.disabled) return;
    var old = btn ? btn.innerHTML : '';
    if(btn){
      btn.disabled = true;
      btn.classList.add('opacity-60','cursor-wait');
      btn.innerHTML = '<span class="material-symbols-outlined text-base animate-spin">progress_activity</span>同步中…';
    }
    function restore(){
      if(!btn) return;
      btn.disabled = false;
      btn.classList.remove('opacity-60','cursor-wait');
      btn.innerHTML = old;
    }
    request(api, { method: 'POST' }).then(function(res){
      restore();
      var snaps = (res.snapshotsCreated || 0) + (res.snapshotsUpdated || 0);
      var msg = '已同步 ' + (res.fetched || 0) + ' ' + unit + ' · 新增排期 ' + (res.schedulesCreated || 0) + ' · 快照 ' + snaps;
      if(res.warnings && res.warnings.length) msg += '；' + res.warnings.join('；');
      toast(msg, 'ok');
      return loadAllData();
    }).catch(function(err){
      restore();
      toast(label + '同步失败：' + errMsg(err), 'err');
    });
  }
  function syncXhs(btn){ syncChannel('/collectors/xiaohongshu/run', '小红书', '篇笔记', btn); }
  function syncDouyin(btn){ syncChannel('/collectors/douyin/run', '抖音', '条作品', btn); }
  function syncChannels(btn){ syncChannel('/collectors/channels/run', '视频号', '条作品', btn); }

  /* ---------- filters ---------- */
  function byPlatform(rows){
    if(state.platform === 'all') return rows;
    return rows.filter(function(r){ return platformList(r['平台']).indexOf(state.platform) >= 0; });
  }
  function topicRows(){
    var rows = byPlatform(DATA.topic);
    if(state.status !== 'all') rows = rows.filter(function(r){ return r['状态'] === state.status; });
    if(state.q){
      var q = state.q.toLowerCase();
      rows = rows.filter(function(r){
        return (String(r['选题']||'') + String(r['切入角度']||'') + String(r['选题ID']||'')).toLowerCase().indexOf(q) >= 0;
      });
    }
    return rows;
  }
  function reviewRangeStart(){
    if(state.reviewRange === 'all') return null;
    var n = parseInt(state.reviewRange, 10) || 7;
    var d = startOfDay(new Date());
    return addDays(d, -(n - 1));
  }
  function reviewRows(){
    var start = reviewRangeStart();
    var rows = byPlatform(DATA.review).filter(function(r){
      if(!start) return true;
      var d = parseDate(r['统计日期']);
      return d && startOfDay(d) >= start;
    });
    rows.sort(function(a,b){
      var da = parseDate(a['统计日期']), db_ = parseDate(b['统计日期']);
      if(da && db_ && da - db_ !== 0) return db_ - da;
      return String(b['复盘ID'] || '').localeCompare(String(a['复盘ID'] || ''));
    });
    return rows;
  }
  function calendarByCode(code){
    var found = null;
    DATA.calendar.forEach(function(r){ if(r['排期ID'] === code) found = r; });
    return found;
  }
  function reviewGroups(){
    var groups = {};
    DATA.review.forEach(function(r){
      var code = r['排期ID'] || '—';
      if(!groups[code]) groups[code] = [];
      groups[code].push(r);
    });
    var arr = Object.keys(groups).map(function(code){
      var g = groups[code].slice().sort(function(a,b){ return parseDate(a['统计日期']) - parseDate(b['统计日期']); });
      var latest = g[g.length - 1];
      var cal = calendarByCode(code);
      var reads = g.map(function(r){ return num(r['阅读播放']); });
      return {
        code: code,
        platform: latest['平台'] || (cal ? platformList(cal['平台'])[0] || '' : ''),
        title: cal ? (cal['标题'] || '（未命名）') : '(排期已删除)',
        stage: cal ? cal['当前阶段'] : '—',
        calExists: !!cal,
        calId: cal ? cal['_id'] : '',
        count: g.length,
        latest: latest,
        reads: reads,
        snapshots: g
      };
    });
    arr.sort(function(a,b){ return parseDate(b.latest['统计日期']) - parseDate(a.latest['统计日期']); });
    return arr;
  }
  function filteredGroups(){
    var start = reviewRangeStart();
    return reviewGroups().filter(function(g){
      if(!start) return true;
      var d = parseDate(g.latest['统计日期']);
      return d && startOfDay(d) >= start;
    });
  }
  function last7Stats(){
    var d0 = addDays(startOfDay(new Date()), -6);
    var rr = byPlatform(DATA.review).filter(function(r){
      var d = parseDate(r['统计日期']);
      return d && startOfDay(d) >= d0;
    });
    var read = rr.reduce(function(a,b){ return a + num(b['阅读播放']); }, 0);
    var like = rr.reduce(function(a,b){ return a + num(b['点赞']); }, 0);
    var fans = rr.reduce(function(a,b){ return a + num(b['涨粉']); }, 0);
    return { read:read, like:like, fans:fans, rate: read ? like / read * 100 : 0 };
  }
  function missingSnapshots(){
    return byPlatform(DATA.calendar).filter(function(r){
      return ['已发布','二次分发','已复盘'].indexOf(r['当前阶段']) >= 0 && !hasSnapshotToday(r['排期ID']);
    });
  }

  /* ---------- chart helpers ---------- */
  function smoothLine(pts){
    if(!pts.length) return '';
    if(pts.length === 1) return 'M' + pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1);
    var d = 'M' + pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1);
    for(var i = 1; i < pts.length; i++){
      var p = pts[i], prev = pts[i-1];
      var mx = (prev[0] + p[0]) / 2;
      d += ' C' + mx.toFixed(1) + ',' + prev[1].toFixed(1) + ' ' + mx.toFixed(1) + ',' + p[1].toFixed(1) + ' ' + p[0].toFixed(1) + ',' + p[1].toFixed(1);
    }
    return d;
  }
  function normalizedPoints(vals, w, h, pad, forceMax){
    var max = Math.max.apply(null, vals.concat([forceMax || 1]));
    var step = vals.length > 1 ? (w - pad * 2) / (vals.length - 1) : 0;
    return vals.map(function(v, i){
      return [pad + step * i, h - pad - (v / max) * (h - pad * 2)];
    });
  }
  function seriesPath(vals, w, h, pad, forceMax){
    var pts = normalizedPoints(vals, w, h, pad, forceMax);
    var line = smoothLine(pts);
    var area = line + ' L' + pts[pts.length-1][0].toFixed(1) + ',' + (h - pad) + ' L' + pts[0][0].toFixed(1) + ',' + (h - pad) + ' Z';
    return { line: line, area: area, pts: pts };
  }
  function chartSvg(series, opts){
    var o = opts || {};
    var w = o.w || 680, h = o.h || 190, pad = o.pad || 10;
    var s = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" class="w-full" style="height:' + (o.height || 190) + 'px;display:block">';
    s += '<defs>';
    series.forEach(function(se, i){
      s += '<linearGradient id="g' + (o.id || 'c') + i + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="' + se.color + '" stop-opacity="' + (o.areaOpacity || .18) + '"/><stop offset="100%" stop-color="' + se.color + '" stop-opacity="0"/></linearGradient>';
    });
    s += '</defs>';
    if(o.grid !== false){
      for(var g = 1; g <= 3; g++){
        var gy = pad + (h - pad * 2) * g / 4;
        s += '<line x1="' + pad + '" y1="' + gy + '" x2="' + (w - pad) + '" y2="' + gy + '" stroke="#e7e8eb" stroke-width="1" stroke-dasharray="3 5"/>';
      }
    }
    series.forEach(function(se, i){
      var r = seriesPath(se.vals, w, h, pad, se.max);
      s += '<path d="' + r.area + '" fill="url(#g' + (o.id || 'c') + i + ')"/>';
      s += '<path d="' + r.line + '" fill="none" stroke="' + se.color + '" stroke-width="' + (se.width || 2) + '" stroke-linecap="round" stroke-linejoin="round" ' + (se.dash ? 'stroke-dasharray="4 4"' : '') + '/>';
      var last = r.pts[r.pts.length - 1];
      s += '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="3.5" fill="#fff" stroke="' + se.color + '" stroke-width="2"/>';
    });
    return s + '</svg>';
  }
  function miniSpark(vals, color, w, h){
    w = w || 96; h = h || 24;
    if(!vals || !vals.length) return '<span class="text-label-sm text-outline">—</span>';
    var pad = 3;
    var max = Math.max.apply(null, vals.concat([1]));
    var min = Math.min.apply(null, vals.concat([0]));
    var span = (max - min) || 1;
    var step = vals.length > 1 ? (w - pad * 2) / (vals.length - 1) : 0;
    var pts = vals.map(function(v, i){
      var x = pad + step * i;
      var y = h - pad - ((v - min) / span) * (h - pad * 2);
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    var line = 'M' + pts.join(' L');
    var area = line + ' L' + (w - pad) + ',' + (h - pad) + ' L' + pad + ',' + (h - pad) + ' Z';
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" style="width:' + w + 'px;height:' + h + 'px;display:inline-block;vertical-align:middle">' +
      '<path d="' + area + '" fill="' + color + '" opacity="0.10"/>' +
      '<path d="' + line + '" fill="none" stroke="' + color + '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  function waveHtml(){
    var bars = [4,9,14,20,11,6,16,24,18,9,5,13,22,17,8,4,11,19,26,20,12,6,3,9,15,11,7,13,19,8,4,10,16,9,5];
    var html = '<div class="wave">';
    bars.forEach(function(b){ html += '<i style="height:' + b + 'px;opacity:' + (0.35 + b / 40) + '"></i>'; });
    html += '</div>';
    return html;
  }
  function audioCard(){
    var latest = VOICE.recordings[0];
    var head = '<div class="flex items-center justify-between mb-2">' +
      '<span class="text-label-sm font-label-sm uppercase tracking-wide text-on-surface-variant">语音速记</span>' +
      (latest
        ? '<span class="chip chip-line"><span class="material-symbols-outlined text-[13px]">graphic_eq</span>' + esc(fmtDuration(latest.durationSec)) + '</span>'
        : '<span class="chip chip-line"><span class="material-symbols-outlined text-[13px]">mic</span>待录制</span>') +
      '</div>';
    if(!latest){
      return '<div class="soft-card p-space-lg">' + head +
        '<h3 class="text-headline-sm font-headline-sm text-on-surface mb-1">随手录一段语音速记</h3>' +
        '<p class="text-label-sm text-on-surface-variant mb-3">录音只保存在本机；浏览器听写失败也能手动补文字。</p>' +
        waveHtml() +
        '<div class="flex items-center justify-between mt-3">' +
          '<button class="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary text-on-primary text-label-sm font-semibold hover:opacity-90" data-act="voiceMemo" type="button"><span class="material-symbols-outlined text-base">mic</span>录制语音</button>' +
          '<span class="text-label-sm text-on-surface-variant">支持 Chrome / Edge</span>' +
        '</div>' +
      '</div>';
    }
    var excerpt = latest.transcript ? String(latest.transcript).replace(/\s+/g, ' ') : '尚无转写文本，可打开速记手动补充。';
    if(excerpt.length > 84) excerpt = excerpt.slice(0, 84) + '…';
    return '<div class="soft-card p-space-lg">' + head +
      '<h3 class="text-headline-sm font-headline-sm text-on-surface mb-1">' + esc(latest.title) + '</h3>' +
      '<p class="text-label-sm text-on-surface-variant mb-3">' + esc(excerpt) + '</p>' +
      waveHtml() +
      '<div class="flex items-center justify-between mt-3">' +
        '<div class="flex items-center gap-2">' +
          '<button class="w-9 h-9 rounded-full bg-primary text-on-primary flex items-center justify-center shadow-sm" data-act="voicePlay" data-id="' + esc(latest.id) + '" type="button" title="播放最新录音"><span class="material-symbols-outlined text-lg">play_arrow</span></button>' +
          '<button class="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-surface-container-low text-label-sm font-semibold text-on-surface hover:bg-surface-container-high" data-act="voiceMemo" type="button"><span class="material-symbols-outlined text-base">mic</span>新建录音</button>' +
        '</div>' +
        '<span class="text-label-sm text-on-surface-variant">' + esc(latest.code) + ' · ' + esc(fmtVoiceDate(latest.createdAt)) + '</span>' +
      '</div>' +
    '</div>';
  }

  /* ---------- shared view pieces ---------- */
  function kpiPastel(theme, label, value, foot, action, act, actVal, badge, attrs){
    var themes = {
      lilac: { bg:'bg-tertiary-fixed', ink:'text-tertiary', sub:'text-on-tertiary-fixed-variant' },
      sky: { bg:'bg-[#D5EAF7]', ink:'text-[#0F283C]', sub:'text-[#2C495E]' },
      butter: { bg:'bg-secondary-fixed', ink:'text-secondary', sub:'text-on-secondary-fixed-variant' },
      mint: { bg:'bg-[#DCF3E5]', ink:'text-[#0F3B23]', sub:'text-[#23583A]' }
    };
    var t = themes[theme] || themes.lilac;
    var html = '<div class="relative overflow-hidden rounded-xl ' + t.bg + ' p-space-lg flex flex-col justify-between shadow-sm transition-transform hover:-translate-y-0.5">';
    html += '<div class="flex items-center justify-between gap-space-sm">';
    html += '<span class="text-label-md font-label-md ' + t.sub + ' tracking-wide uppercase">' + esc(label) + '</span>';
    if(badge){
      html += '<span class="flex items-center gap-0.5 text-label-sm font-label-sm ' + (badge.up ? 'text-[#1B6F43]' : 'text-[#9A3B3B]') + ' bg-surface-container-lowest px-2 py-0.5 rounded-full shadow-sm"><span class="material-symbols-outlined text-xs">' + (badge.up ? 'north' : 'south') + '</span>' + esc(badge.text) + '</span>';
    } else if(action){
      html += '<button class="px-3 py-1 rounded-full bg-surface-container-lowest text-on-surface text-label-sm font-label-sm shadow-sm hover:bg-surface-container-high transition-all" data-act="' + act + '"' + (actVal != null ? ' data-val="' + esc(actVal) + '"' : '') + (attrs || '') + ' type="button">' + esc(action) + '</button>';
    }
    html += '</div>';
    html += '<div class="mt-space-md"><div class="text-display-lg font-display-lg ' + t.ink + ' leading-none tracking-tight">' + value + '</div>';
    html += '<p class="mt-2 text-label-sm font-label-sm ' + t.sub + '/80">' + esc(foot) + '</p></div>';
    html += '<div class="absolute -right-4 -bottom-4 w-20 h-20 bg-surface-container-lowest/25 rounded-full pointer-events-none blur-xl"></div>';
    html += '</div>';
    return html;
  }
  function pageHeader(title, subtitle, actions){
    return '<div class="flex flex-col md:flex-row md:items-center justify-between gap-space-md mb-space-lg">' +
      '<div><h2 class="text-headline-lg font-headline-lg text-on-surface tracking-tight">' + title + '</h2>' +
      '<p class="text-body-md font-body-md text-on-surface-variant">' + subtitle + '</p></div>' +
      '<div class="flex items-center gap-space-sm flex-wrap">' + (actions || '') + '</div></div>';
  }
  function iconBtn(icon, act, attrs, title, cls){
    return '<button class="w-8 h-8 rounded-full ' + (cls || 'bg-surface-container-low hover:bg-surface-container-high') + ' flex items-center justify-center text-on-surface-variant transition-colors" data-act="' + act + '" ' + (attrs || '') + ' type="button" title="' + esc(title || '') + '"><span class="material-symbols-outlined text-base">' + icon + '</span></button>';
  }

  /* ---------- view: home ---------- */
  function viewHome(){
    var now = new Date();
    var ws = startOfWeek(now);
    var we = addDays(ws, 7);
    var cal = byPlatform(DATA.calendar);

    var pending = cal.filter(function(r){
      var d = parseDate(r['计划发布时间']);
      return d && d >= ws && d < we && (r['当前阶段'] === '待审核' || r['当前阶段'] === '待发布');
    }).sort(function(a,b){ return parseDate(a['计划发布时间']) - parseDate(b['计划发布时间']); });

    var publishedThisWeek = cal.filter(function(r){
      var d = parseDate(r['计划发布时间']);
      return d && d >= ws && d < we && ['已发布','二次分发','已复盘'].indexOf(r['当前阶段']) >= 0;
    });

    var plannedThisWeek = cal.filter(function(r){
      var d = parseDate(r['计划发布时间']);
      return d && d >= ws && d < we;
    });

    var pendingTopics = byPlatform(DATA.topic).filter(function(r){ return r['状态'] === '待写'; });

    var now0 = startOfDay(now);
    var overdue = cal.filter(function(r){
      var d = parseDate(r['计划发布时间']);
      return d && d < now0 && ['已发布','二次分发','已复盘'].indexOf(r['当前阶段']) < 0;
    }).sort(function(a,b){ return parseDate(a['计划发布时间']) - parseDate(b['计划发布时间']); });

    var toRecord = cal.filter(function(r){
      return ['已发布','二次分发','已复盘'].indexOf(r['当前阶段']) >= 0 && !hasSnapshotToday(r['排期ID']);
    });

    var today = startOfDay(now);
    var days = [];
    for(var i = 6; i >= 0; i--){ days.push(addDays(today, -i)); }
    var prevDays = [];
    for(var j = 13; j >= 7; j--){ prevDays.push(addDays(today, -j)); }
    function sumRange(list){
      var set = {};
      days.forEach(function(d){ set[isoDay(d)] = { read:0, like:0, fans:0, conv:0 }; });
      byPlatform(DATA.review).forEach(function(r){
        var k = dayKey(r['统计日期']);
        if(set[k]){
          set[k].read += num(r['阅读播放']);
          set[k].like += num(r['点赞']);
          set[k].fans += num(r['涨粉']);
          set[k].conv += num(r['转化']);
        }
      });
      return days.map(function(d){
        var k = isoDay(d);
        var v = set[k];
        return { key:k, label:(d.getMonth()+1) + '/' + d.getDate(), read:v.read, like:v.like, fans:v.fans, conv:v.conv };
      });
    }
    var trend = sumRange(days);
    var sumFans = trend.reduce(function(a,b){ return a + b.fans; }, 0);
    var sumRead = trend.reduce(function(a,b){ return a + b.read; }, 0);
    var sumLike = trend.reduce(function(a,b){ return a + b.like; }, 0);
    var prevFans = 0;
    byPlatform(DATA.review).forEach(function(r){
      var k = dayKey(r['统计日期']);
      for(var p = 0; p < prevDays.length; p++){
        if(isoDay(prevDays[p]) === k) prevFans += num(r['涨粉']);
      }
    });
    var growth = prevFans > 0 ? ((sumFans - prevFans) / prevFans * 100) : null;
    var progress = plannedThisWeek.length ? Math.round(publishedThisWeek.length / plannedThisWeek.length * 100) : 0;

    var hour = now.getHours();
    var greet = hour < 11 ? '早安' : hour < 18 ? '午安' : '晚上好';

    var html = '';
    html += '<div class="w-full fade-in">';

    /* welcome */
    html += '<div class="flex flex-col md:flex-row md:items-center justify-between gap-space-md mb-space-lg">';
    html += '<div>';
    html += '<div class="flex items-center gap-space-sm mb-1"><h2 class="text-headline-lg font-headline-lg text-on-surface tracking-tight">' + greet + '，' + esc(PROFILE.name || 'Alexandra') + '</h2>';
    html += '<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-label-sm font-label-sm bg-surface-container-lowest text-on-surface-variant shadow-sm"><span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>运行正常 · ' + cnWeekday(now) + '发布窗口期</span></div>';
    html += '<p class="text-body-md font-body-md text-on-surface-variant">今天是 ' + now.getFullYear() + '年' + (now.getMonth()+1) + '月' + now.getDate() + '日。本周内容规划已推进 ' + progress + '%，' + pending.length + ' 篇内容待最终确认发布。</p>';
    html += '</div>';
    html += '<div class="flex items-center gap-space-sm flex-wrap">';
    html += '<button class="inline-flex items-center gap-1.5 px-space-md py-2 bg-primary text-on-primary rounded-full text-label-md font-label-md shadow-sm hover:opacity-90 transition-all" data-act="new" data-db="calendar" type="button"><span class="material-symbols-outlined text-base">add_circle</span><span>新建排期</span></button>';
    html += '<button class="inline-flex items-center gap-1.5 px-space-md py-2 bg-surface-container-lowest text-on-surface rounded-full text-label-md font-label-md shadow-sm hover:bg-surface-container-high transition-all" data-act="new" data-db="topic" type="button"><span class="material-symbols-outlined text-base">auto_awesome</span><span>录入选题</span></button>';
    html += '<div class="h-6 w-px bg-outline-variant/40 mx-1 hidden sm:block"></div>';
    html += '<button class="w-9 h-9 rounded-full bg-surface-container-lowest text-on-surface flex items-center justify-center shadow-sm hover:bg-surface-container-high transition-all" data-act="goto" data-view="review" type="button" title="去数据复盘"><span class="material-symbols-outlined text-base">tune</span></button>';
    html += '</div></div>';

    /* KPI */
    html += '<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md mb-space-lg">';
    html += kpiPastel('lilac', '待写选题', fmtNum(pendingTopics.length), '选题池里状态为「待写」', '查看', 'goto', null, null, ' data-view="topics" data-status="待写"');
    html += kpiPastel('sky', '本周待发布', fmtNum(pending.length), '本周区间 ' + weekLabel(ws, we), '排期', 'goto', null, null, ' data-view="calendar" data-stage="待发布"');
    html += kpiPastel('butter', '本周已发布', fmtNum(publishedThisWeek.length), '含二次分发与已复盘', '明细', 'goto', null, null, ' data-view="calendar" data-stage="已发布"');
    html += kpiPastel('mint', '近 7 天净增粉', (sumFans >= 0 ? '+' : '') + fmtNum(sumFans),
      '同期总阅读 ' + fmtNum(sumRead) + ' · 互动率 ' + pct(sumLike, sumRead),
      null, null, null,
      growth == null ? null : { up: growth >= 0, text: '+' + Math.abs(growth).toFixed(1) + '%' });
    html += '</div>';

    /* main grid */
    html += '<div class="grid grid-cols-12 gap-space-md items-start">';
    html += '<div class="col-span-12 xl:col-span-8 flex flex-col gap-space-md">';

    /* flow card */
    html += '<div class="soft-card p-space-lg">';
    html += '<div class="flex items-start justify-between gap-space-md mb-space-md">';
    html += '<div><div class="flex items-center gap-2 mb-1"><span class="kicker-dot"></span><span class="text-label-sm font-label-sm uppercase tracking-wider text-on-surface-variant">Performance Flow</span></div>';
    html += '<h3 class="text-headline-md font-headline-md text-on-surface">全网表现走势</h3>';
    html += '<p class="text-label-sm text-on-surface-variant">近 7 天阅读 / 互动 / 涨粉三轨对照，已按平台筛选归一化。</p></div>';
    html += '<div class="flex items-center gap-4 text-right">';
    html += '<div><div class="text-label-sm text-on-surface-variant">总阅读</div><div class="text-headline-md font-headline-md text-on-surface">' + fmtNum(sumRead) + '</div></div>';
    html += '<div><div class="text-label-sm text-on-surface-variant">互动率</div><div class="text-headline-md font-headline-md text-on-surface">' + pct(sumLike, sumRead) + '</div></div>';
    html += '<div><div class="text-label-sm text-on-surface-variant">净增粉</div><div class="text-headline-md font-headline-md text-[#1B6F43]">' + (sumFans >= 0 ? '+' : '') + fmtNum(sumFans) + '</div></div>';
    html += '</div></div>';
    html += chartSvg([
      { vals: trend.map(function(t){ return t.read; }), color:'#6f66a8', width:2.2 },
      { vals: trend.map(function(t){ return t.like; }), color:'#b8863b', width:1.8 },
      { vals: trend.map(function(t){ return t.fans; }), color:'#2f8f5b', width:1.8 }
    ], { id:'home', height:172, w:680, h:190, areaOpacity:.14 });
    html += '<div class="flex items-center justify-between mt-2 text-label-sm text-on-surface-variant">';
    html += '<div class="flex items-center gap-3"><span class="inline-flex items-center gap-1"><i class="w-2 h-2 rounded-full" style="background:#6f66a8"></i>阅读/播放</span><span class="inline-flex items-center gap-1"><i class="w-2 h-2 rounded-full" style="background:#b8863b"></i>点赞</span><span class="inline-flex items-center gap-1"><i class="w-2 h-2 rounded-full" style="background:#2f8f5b"></i>涨粉</span></div>';
    html += '<span>' + trend[0].label + ' – ' + trend[trend.length-1].label + '</span></div>';
    html += '<div class="grid grid-cols-3 gap-space-sm mt-space-md pt-space-md border-t border-surface-container">';
    var platRead = {};
    byPlatform(DATA.review).forEach(function(r){
      var k = dayKey(r['统计日期']);
      if(!k) return;
      if(days.some(function(d){ return isoDay(d) === k; })){
        var p = r['平台'] || '未标注';
        platRead[p] = (platRead[p] || 0) + num(r['阅读播放']);
      }
    });
    var platTop = Object.keys(platRead).sort(function(a,b){ return platRead[b] - platRead[a]; }).slice(0, 3);
    if(!platTop.length) platTop = ['抖音','视频号','快手'];
    platTop.forEach(function(p, idx){
      var v = platRead[p] || 0;
      html += '<div class="rounded-lg bg-surface-container-low px-3 py-2"><div class="flex items-center justify-between text-label-sm text-on-surface-variant"><span>' + esc(p) + '</span><span>' + fmtNum(v) + '</span></div>';
      html += '<div class="h-1 rounded-full bg-surface-container-high mt-1.5 overflow-hidden"><div class="h-full rounded-full" style="width:' + Math.min(100, (v / Math.max(1, platRead[platTop[0]] || 1)) * 100) + '%;background:' + ['#6f66a8','#b8863b','#2f8f5b'][idx] + '"></div></div></div>';
    });
    html += '</div></div>';

    /* pending list */
    html += '<div class="soft-card">';
    html += '<div class="flex items-center justify-between px-space-lg pt-space-lg pb-space-sm"><div><h3 class="text-headline-sm font-headline-sm text-on-surface">本周待发布清单</h3><p class="text-label-sm text-on-surface-variant">' + weekLabel(ws, we) + ' · 阶段可下拉直接更新</p></div>';
    html += '<span class="chip chip-honey">' + pending.length + ' 篇待上线</span></div>';
    if(!pending.length){
      html += emptyState('本周暂无待发布内容', '去内容日历里加一条排期，它会自动出现在这里', 'event_available');
    } else {
      html += '<div class="divide-y divide-surface-container-low">';
      pending.forEach(function(r){
        html += '<div class="flex items-center gap-3 px-space-lg py-3 row-hover">';
        html += '<span class="w-4 h-4 rounded-[5px] border border-outline-variant shrink-0"></span>';
        html += '<div class="min-w-0 flex-1"><div class="flex items-center gap-2"><span class="text-body-md font-medium text-on-surface truncate">' + esc(r['标题'] || '（未命名）') + '</span>' + platformChip(r['平台']) + '</div>';
        html += '<div class="text-label-sm text-on-surface-variant mt-0.5">' + esc(r['排期ID'] || '') + (r['负责人'] ? ' · 负责人：' + esc(r['负责人']) : '') + ' · 计划 ' + esc(fmtDateTime(r['计划发布时间'])) + '</div></div>';
        html += '<div class="flex items-center gap-2 shrink-0">' + quickSelect('calendar', r, '当前阶段', STAGES, stageClass(r['当前阶段']));
        if(pubScheduleReady(r)){
          html += '<button class="px-3 py-1.5 rounded-full bg-secondary-fixed text-on-secondary-fixed-variant text-label-sm font-label-sm hover:brightness-95 transition-all" data-act="pubNew" data-id="' + esc(r['_id']) + '" type="button">准备发布</button>';
        }
        html += '<button class="px-3 py-1.5 rounded-full bg-primary text-on-primary text-label-sm font-label-sm hover:opacity-90 transition-all" data-act="publish" data-id="' + esc(r['_id']) + '" type="button">标记已发布</button></div>';
        html += '</div>';
      });
      html += '</div>';
    }
    html += '</div>';

    /* week bars */
    html += '<div class="soft-card p-space-lg">';
    html += '<div class="flex items-center justify-between mb-space-md"><div><h3 class="text-headline-sm font-headline-sm text-on-surface">近 8 周更新频率节奏</h3><p class="text-label-sm text-on-surface-variant">已发布内容条数（含二次分发），目标 5 篇/周</p></div><span class="chip chip-line">' + weekBarsTotal(now) + ' 条 / 8 周</span></div>';
    html += weekBars(now);
    html += '</div>';

    html += '</div>'; /* left col */

    /* right col */
    html += '<div class="col-span-12 xl:col-span-4 flex flex-col gap-space-md">';

    /* profile */
    html += '<div class="soft-card p-space-lg">';
    html += '<div class="flex items-center gap-3">';
    html += '<img alt="Profile" class="w-12 h-12 rounded-full object-cover bg-surface-container" src="' + esc(profileAvatarUrl()) + '">';
    html += '<div class="min-w-0"><div class="flex items-center gap-2"><h3 class="text-headline-sm font-headline-sm text-on-surface">' + esc(PROFILE.name || 'Alexandra') + '</h3><span class="chip chip-honey">主理人</span></div><p class="text-label-sm text-on-surface-variant">内容运营全流程负责人</p></div>';
    html += '<button class="ml-auto w-8 h-8 rounded-full bg-surface-container-low hover:bg-surface-container-high flex items-center justify-center text-on-surface-variant transition-colors shrink-0" data-act="editProfile" type="button" title="编辑主理人信息"><span class="material-symbols-outlined text-base">edit</span></button>';
    html += '</div>';
    html += '<div class="grid grid-cols-3 gap-2 mt-space-md">';
    html += '<div class="rounded-lg bg-surface-container-low p-2 text-center"><div class="text-headline-sm font-headline-md text-on-surface">' + DATA.topic.length + '</div><div class="text-label-sm text-on-surface-variant">选题</div></div>';
    html += '<div class="rounded-lg bg-surface-container-low p-2 text-center"><div class="text-headline-sm font-headline-md text-on-surface">' + DATA.calendar.length + '</div><div class="text-label-sm text-on-surface-variant">排期</div></div>';
    html += '<div class="rounded-lg bg-surface-container-low p-2 text-center"><div class="text-headline-sm font-headline-md text-on-surface">' + DATA.asset.length + '</div><div class="text-label-sm text-on-surface-variant">成稿</div></div>';
    html += '</div>';
    html += '<div class="mt-space-md"><div class="flex items-center justify-between text-label-sm text-on-surface-variant mb-1"><span>本周推进节奏</span><span>' + progress + '%</span></div>';
    html += '<div class="h-2 rounded-full bg-surface-container-high overflow-hidden"><div class="h-full rounded-full bg-secondary-container" style="width:' + Math.min(100, progress) + '%"></div></div></div>';
    html += '</div>';

    /* overdue */
    html += '<div class="soft-card border-l-4 border-error p-space-lg">';
    html += '<div class="flex items-center justify-between mb-2"><h3 class="text-headline-sm font-headline-sm text-on-surface flex items-center gap-2"><span class="material-symbols-outlined text-error text-lg">warning</span>逾期排期警示</h3><span class="chip chip-coral">' + overdue.length + ' 条</span></div>';
    if(!overdue.length){
      html += '<p class="text-label-sm text-on-surface-variant">所有排期都按时发布或尚未到期。</p>';
    } else {
      html += '<div class="flex flex-col gap-2">';
      overdue.slice(0, 4).forEach(function(r){
        var days = Math.max(1, Math.round((now0 - parseDate(r['计划发布时间'])) / 86400000));
        html += '<div class="rounded-lg bg-surface-container-low px-3 py-2">';
        html += '<div class="flex items-center justify-between gap-2"><span class="text-body-sm font-medium truncate">' + esc(r['标题'] || '（未命名）') + '</span><span class="text-label-sm text-error shrink-0">' + days + ' 天前</span></div>';
        html += '<div class="flex items-center justify-between mt-1.5"><span class="text-label-sm text-on-surface-variant">' + esc(r['排期ID'] || '') + '</span>';
        html += '<div class="flex items-center gap-1"><button class="px-2 py-0.5 rounded-full bg-surface-container-lowest text-[10px] font-semibold text-on-surface-variant hover:bg-surface-container-high" data-act="postpone" data-id="' + esc(r['_id']) + '" type="button">一键顺延</button>';
        html += '<button class="px-2 py-0.5 rounded-full bg-secondary-fixed text-[10px] font-semibold text-on-secondary-fixed-variant hover:brightness-95" data-act="publish" data-id="' + esc(r['_id']) + '" type="button">补录发布</button></div></div></div>';
      });
      html += '</div>';
      if(overdue.length > 4) html += '<button class="text-label-sm text-[#785d00] mt-2 hover:underline" data-act="goto" data-view="calendar" type="button">查看全部 ' + overdue.length + ' 条 →</button>';
    }
    html += '</div>';

    /* today snapshot */
    html += '<div class="soft-card p-space-lg">';
    html += '<div class="flex items-center justify-between mb-2"><h3 class="text-headline-sm font-headline-sm text-on-surface flex items-center gap-2"><span class="material-symbols-outlined text-lg" style="color:#785d00">edit_note</span>今日待录数据清单</h3><span class="chip chip-sky">' + toRecord.length + ' 条</span></div>';
    if(!toRecord.length){
      html += '<p class="text-label-sm text-on-surface-variant">今天都记过了，所有已发布内容均已有快照。</p>';
    } else {
      html += '<div class="flex flex-col gap-1.5">';
      toRecord.slice(0, 4).forEach(function(r){
        html += '<div class="flex items-center justify-between gap-2">';
        html += '<div class="min-w-0"><div class="text-body-sm font-medium truncate">' + esc(r['标题'] || '（未命名）') + '</div><div class="text-label-sm text-on-surface-variant">' + esc(r['排期ID'] || '') + ' · 已发布</div></div>';
        html += '<button class="px-3 py-1 rounded-full bg-surface-container-lowest border border-surface-container text-label-sm font-semibold hover:bg-surface-container-high shrink-0" data-act="rec" data-calcode="' + esc(r['排期ID']) + '" data-platform="' + esc(platformList(r['平台'])[0] || '') + '" type="button">记一条</button></div>';
      });
      html += '</div>';
      if(toRecord.length > 4) html += '<button class="text-label-sm text-[#785d00] mt-2 hover:underline" data-act="goto" data-view="review" type="button">查看全部 →</button>';
    }
    html += '</div>';

    html += audioCard();
    html += '</div></div>';
    html += '</div>';
    return html;
  }
  function weekLabel(a, b){
    return (a.getMonth()+1) + '月' + a.getDate() + '日 – ' + (b.getMonth()+1) + '月' + (b.getDate()-1) + '日';
  }
  function weekBuckets(now){
    var ws = startOfWeek(now);
    var buckets = [];
    for(var i = 7; i >= 0; i--){
      var s = addDays(ws, -7 * i);
      buckets.push({ start:s, end:addDays(s, 7), n:0 });
    }
    DATA.calendar.forEach(function(r){
      var d = parseDate(r['计划发布时间']);
      if(!d) return;
      if(['已发布','二次分发','已复盘'].indexOf(r['当前阶段']) < 0) return;
      if(state.platform !== 'all' && platformList(r['平台']).indexOf(state.platform) < 0) return;
      for(var j = 0; j < buckets.length; j++){
        if(d >= buckets[j].start && d < buckets[j].end){ buckets[j].n += 1; break; }
      }
    });
    return buckets;
  }
  function weekBarsTotal(now){
    return weekBuckets(now).reduce(function(a,b){ return a + b.n; }, 0);
  }
  function weekBars(now){
    var buckets = weekBuckets(now);
    var max = Math.max.apply(null, buckets.map(function(b){ return b.n; }).concat([5]));
    var html = '<div class="flex items-end justify-between gap-2 h-[104px] px-1">';
    buckets.forEach(function(b, i){
      var hgt = Math.max(6, Math.round((b.n / max) * 74));
      var current = i === buckets.length - 1;
      html += '<div class="flex-1 flex flex-col items-center gap-1 group" title="' + (b.start.getMonth()+1) + '/' + b.start.getDate() + ' 当周 · ' + b.n + ' 条">';
      html += '<span class="text-label-sm ' + (current ? 'text-on-surface font-semibold' : 'text-on-surface-variant') + '">' + (b.n || '') + '</span>';
      html += '<div class="w-full max-w-[30px] rounded-t-lg rounded-b-sm transition-all ' + (current ? 'bg-secondary-container' : 'bg-surface-container-high group-hover:bg-tertiary-fixed') + '" style="height:' + hgt + 'px"></div>';
      html += '<span class="text-[10px] ' + (current ? 'text-on-surface font-semibold' : 'text-on-surface-variant') + '">W' + pad(i + 4) + '</span></div>';
    });
    html += '</div>';
    html += '<div class="flex items-center justify-between mt-2 text-label-sm text-on-surface-variant"><span>近 8 周累计 ' + weekBarsTotal(now) + ' 条</span><span>目标节奏 5 篇/周' + (buckets[buckets.length-1].n >= 5 ? ' · 本周已达标' : '') + '</span></div>';
    return html;
  }

  /* ---------- view: topics ---------- */
  function viewTopics(){
    var base = byPlatform(DATA.topic);
    var counts = { 'all': base.length };
    STATUS.forEach(function(s){ counts[s] = base.filter(function(r){ return r['状态'] === s; }).length; });
    var high = base.filter(function(r){ return num(r['爆款潜力评分']) >= 8.5; }).length;
    var avgScore = base.length ? base.reduce(function(a,b){ return a + num(b['爆款潜力评分']); }, 0) / base.length : 0;

    var rows = topicRows().slice();
    rows.sort(function(a,b){
      var d = num(b['爆款潜力评分']) - num(a['爆款潜力评分']);
      return state.topicSort === 'desc' ? d : -d;
    });

    var html = '';
    html += '<div class="fade-in">';
    html += '<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md mb-space-lg">';
    html += kpiPastel('lilac', '待写选题池', pad2(counts['待写']), '状态为待写的选题，优先筛查', '立即筛查', 'statusTab', '待写');
    html += kpiPastel('sky', '进行中写作', pad2(counts['写作中']), '正在打磨脚本与素材', '查看进度', 'statusTab', '写作中');
    html += kpiPastel('butter', '高潜爆款储备', pad2(high), '爆款潜力评分 ≥ 8.5', '高潜置顶', 'sortTopic', null);
    html += '<div class="relative overflow-hidden rounded-xl bg-surface-container-lowest p-space-lg flex flex-col justify-between shadow-sm">' +
      '<div class="flex items-center justify-between gap-space-sm"><span class="text-label-md font-label-md text-on-surface-variant tracking-wide uppercase">选题平均潜力</span>' +
      '<span class="chip chip-mint">' + (avgScore >= 8 ? '优质储备' : '持续打磨') + '</span></div>' +
      '<div class="mt-space-md"><div class="text-display-lg font-display-lg text-on-surface leading-none tracking-tight">' + avgScore.toFixed(1) + '<span class="text-headline-md font-headline-md text-on-surface-variant"> / 10</span></div>' +
      '<p class="mt-2 text-label-sm font-label-sm text-on-surface-variant">' + base.length + ' 条选题综合评分</p></div>' +
      '<div class="absolute -right-4 -bottom-4 w-20 h-20 bg-tertiary-fixed/40 rounded-full pointer-events-none blur-xl"></div></div>';
    html += '</div>';

    html += '<div class="grid grid-cols-12 gap-space-md items-start">';
    html += '<div class="col-span-12 xl:col-span-8 flex flex-col gap-space-md min-w-0">';

    /* title + toolbar */
    html += '<div class="soft-card px-space-lg py-space-md flex items-center justify-between gap-space-md">';
    html += '<div class="flex items-center gap-2 min-w-0"><span class="kicker-dot"></span><h3 class="text-headline-sm font-headline-sm text-on-surface truncate">灵感与选题池</h3><span class="chip chip-line">PRD 3.2 规范</span></div>';
    html += '<div class="flex items-center gap-2 shrink-0"><button class="inline-flex items-center gap-1.5 px-space-md py-2 bg-primary text-on-primary rounded-full text-label-md font-label-md shadow-sm hover:opacity-90 transition-all" data-act="topicNew" type="button"><span class="material-symbols-outlined text-base">add</span>录入新选题</button></div>';
    html += '</div>';

    /* filter ribbon */
    html += '<div class="soft-card px-space-lg py-space-md">';
    html += '<div class="flex flex-wrap items-center gap-space-sm">';
    html += '<div class="input-wrap flex-1 min-w-[200px]"><span class="material-symbols-outlined">search</span><input id="qTopic" class="inp" placeholder="搜索选题名称 / 切入角度 / 选题 ID" value="' + esc(state.q) + '"></div>';
    html += '<div class="seg" role="tablist">';
    html += '<button class="stab' + (state.status === 'all' ? ' on' : '') + '" data-act="statusTab" data-val="all" type="button">全部<span class="n">' + counts.all + '</span></button>';
    STATUS.forEach(function(s){
      html += '<button class="stab' + (state.status === s ? ' on' : '') + '" data-act="statusTab" data-val="' + esc(s) + '" type="button">' + esc(s) + '<span class="n">' + counts[s] + '</span></button>';
    });
    html += '</div>';
    html += '<button class="inline-flex items-center gap-1 px-3 py-2 rounded-full bg-surface-container-low text-label-md font-label-md text-on-surface hover:bg-surface-container-high transition-colors" data-act="sortTopic" type="button"><span class="material-symbols-outlined text-base">swap_vert</span>爆款评分 ' + (state.topicSort === 'desc' ? '↓ 降序' : '↑ 升序') + '</button>';
    html += '</div></div>';

    /* table */
    html += '<div class="soft-card overflow-hidden">';
    if(!rows.length){
      html += emptyState('还没有符合条件的选题', '点右上角「录入新选题」，或切换平台 / 状态筛选', 'lightbulb');
    } else {
      html += '<div class="overflow-x-auto"><table class="w-full text-[12px]">';
      html += '<thead><tr class="text-label-sm text-on-surface-variant bg-surface-container-low/60">';
      html += '<th class="w-8 py-2.5 pl-4"><label class="inline-flex items-center justify-center w-5 h-5 -ml-1 cursor-pointer"><input id="topicCheckAll" type="checkbox" class="tbl-check" aria-label="全选当前列表" title="全选当前列表"></label></th>';
      html += '<th class="text-left font-semibold py-2.5 px-2 whitespace-nowrap">选题 ID / 目标平台</th>';
      html += '<th class="text-left font-semibold py-2.5 px-2">选题名称 &amp; 切入角度</th>';
      html += '<th class="text-left font-semibold py-2.5 px-2 whitespace-nowrap">爆款潜力</th>';
      html += '<th class="text-left font-semibold py-2.5 px-2 whitespace-nowrap">内容标签</th>';
      html += '<th class="text-left font-semibold py-2.5 px-2 whitespace-nowrap">参考来源</th>';
      html += '<th class="text-left font-semibold py-2.5 px-2 whitespace-nowrap">状态落库</th>';
      html += '<th class="text-right font-semibold py-2.5 pr-4 pl-2 whitespace-nowrap">业务操作</th>';
      html += '</tr></thead><tbody class="divide-y divide-surface-container-low">';
      rows.forEach(function(r){
        var ref = urlOf(r['参考链接']);
        var canSchedule = ['待写','写作中'].indexOf(r['状态']) >= 0;
        var checked = !!state.topicChecked[r['_id']];
        html += '<tr class="row-hover' + (checked ? ' topic-row-checked' : '') + '" data-row-topic="' + esc(r['_id']) + '">';
        html += '<td class="py-3 pl-4 align-top"><label class="inline-flex items-center justify-center w-5 h-5 -ml-1 mt-0.5 cursor-pointer"><input type="checkbox" class="tbl-check" data-topic-check="' + esc(r['_id']) + '"' + (checked ? ' checked' : '') + ' aria-label="选择该选题"></label></td>';
        html += '<td class="py-3 px-2 align-top whitespace-nowrap"><div class="mono text-[11px] font-semibold text-on-surface">' + esc(r['选题ID'] || '—') + '</div><div class="mt-1">' + platformChip(r['平台']) + '</div></td>';
        html += '<td class="py-3 px-2 align-top min-w-[160px]"><div class="font-semibold text-on-surface leading-snug">' + esc(r['选题'] || '（未命名）') + '</div>';
        html += '<div class="text-label-sm text-on-surface-variant mt-0.5 line-clamp-2">' + esc(truncate(r['切入角度'], 46) || '待补充切入角度') + '</div></td>';
        html += '<td class="py-3 px-2 align-top whitespace-nowrap">' + starPill(r['爆款潜力评分']) + '</td>';
        html += '<td class="py-3 px-2 align-top"><div class="flex flex-wrap gap-1 max-w-[120px]">' + ((r['标签'] && r['标签'].length) ? r['标签'].map(function(t){ return '<span class="chip chip-line">#' + esc(t) + '</span>'; }).join('') : '<span class="text-outline">—</span>') + '</div></td>';
        html += '<td class="py-3 px-2 align-top max-w-[110px]">' + (ref ? '<a href="' + esc(ref) + '" target="_blank" rel="noopener" class="link-arrow text-label-sm inline-flex items-center gap-0.5" title="' + esc(ref) + '"><span class="material-symbols-outlined text-[13px]">link</span>' + esc(hostOf(ref) || '链接') + '</a>' : '<span class="text-outline text-label-sm">—</span>') + '</td>';
        html += '<td class="py-3 px-2 align-top">' + quickSelect('topic', r, '状态', STATUS, statusClass(r['状态'])) + '</td>';
        html += '<td class="py-3 pr-4 pl-2 align-top"><div class="flex items-center justify-end gap-1">';
        if(canSchedule) html += '<button class="inline-flex items-center gap-0.5 px-2.5 py-1 rounded-full bg-tertiary-fixed text-[10px] font-semibold text-on-tertiary-fixed-variant hover:brightness-95 whitespace-nowrap" data-act="toSchedule" data-db="topic" data-id="' + esc(r['_id']) + '" type="button"><span class="material-symbols-outlined text-[13px]">calendar_add_on</span>排期</button>';
        html += '<button class="w-7 h-7 rounded-full hover:bg-surface-container flex items-center justify-center text-on-surface-variant" data-act="editInlineTopic" data-id="' + esc(r['_id']) + '" type="button" title="编辑"><span class="material-symbols-outlined text-base">edit</span></button>';
        html += '<button class="w-7 h-7 rounded-full hover:bg-error-container/60 flex items-center justify-center text-on-surface-variant hover:text-error" data-act="del" data-db="topic" data-id="' + esc(r['_id']) + '" data-name="' + esc(r['选题']) + '" type="button" title="删除"><span class="material-symbols-outlined text-base">delete</span></button>';
        html += '</div></td></tr>';
      });
      html += '</tbody></table></div>';
      var checkedRows = rows.filter(function(r){ return state.topicChecked[r['_id']]; });
      html += '<div class="flex flex-wrap items-center justify-between gap-2 px-space-lg py-3 border-t border-surface-container-low text-label-sm text-on-surface-variant">';
      html += '<div class="flex flex-wrap items-center gap-2"><span>显示 ' + rows.length + ' / ' + base.length + ' 条 · 双击行可直接编辑</span>';
      if(checkedRows.length){
        html += '<span class="chip chip-honey">已选 ' + checkedRows.length + ' 条</span>';
        html += '<button class="text-label-sm text-on-surface-variant underline underline-offset-2 hover:text-on-surface" data-act="clearTopicChecked" type="button">清空选择</button>';
      }
      html += '</div>';
      html += '<div class="flex items-center gap-1"><button class="w-7 h-7 rounded-full bg-surface-container-low flex items-center justify-center text-outline" disabled type="button"><span class="material-symbols-outlined text-base">chevron_left</span></button>';
      html += '<span class="px-2 font-semibold text-on-surface">第 1 页</span>';
      html += '<button class="w-7 h-7 rounded-full bg-surface-container-low flex items-center justify-center text-outline" disabled type="button"><span class="material-symbols-outlined text-base">chevron_right</span></button></div></div>';
    }
    html += '</div>';

    /* stream card */
    html += '<div class="soft-card p-space-lg">';
    html += '<div class="flex items-start justify-between mb-space-md"><div><div class="flex items-center gap-2 mb-1"><span class="kicker-dot"></span><span class="text-label-sm font-label-sm uppercase tracking-wider text-on-surface-variant">Topic Stream &amp; Density</span></div>';
    html += '<h3 class="text-headline-sm font-headline-sm text-on-surface">选题热度流向与爆款分布</h3><p class="text-label-sm text-on-surface-variant">评分越高越靠右；圆点越大代表该平台选题越密集。</p></div>';
    html += '<span class="chip chip-line">' + base.length + ' 条在池</span></div>';
    html += topicStreamSvg(base);
    html += '</div>';

    html += '</div>'; /* left */

    /* inspector */
    html += '<div class="col-span-12 xl:col-span-4"><div class="sticky-inspector soft-card overflow-hidden" id="inlineInspector">';
    html += inlineTopicForm();
    html += '</div></div>';
    html += '</div></div>';
    return html;
  }
  function pad2(n){ return n < 10 ? '0' + n : String(n); }
  function syncTopicCheckAll(){
    var box = $('topicCheckAll');
    if(!box) return;
    var rows = topicRows();
    var n = rows.filter(function(r){ return state.topicChecked[r['_id']]; }).length;
    box.checked = rows.length > 0 && n === rows.length;
    box.indeterminate = n > 0 && n < rows.length;
  }
  function topicStreamSvg(rows){
    var w = 640, h = 150, pad = 24;
    var byPlat = {};
    rows.forEach(function(r){
      var p = r['平台'] || '未标注';
      if(!byPlat[p]) byPlat[p] = { count:0, score:0 };
      byPlat[p].count++;
      byPlat[p].score += num(r['爆款潜力评分']);
    });
    var plats = Object.keys(byPlat).sort(function(a,b){ return byPlat[b].count - byPlat[a].count; }).slice(0, 6);
    var s = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" class="w-full" style="height:148px;display:block">';
    plats.forEach(function(p, i){
      var y = pad + (h - pad * 2) * (i + 1) / (plats.length + 1);
      var cnt = byPlat[p].count;
      var x2 = pad + (cnt / Math.max(1, byPlat[plats[0]].count)) * (w - pad * 2);
      s += '<path d="M' + pad + ',' + y + ' C' + (pad + (x2-pad)/2) + ',' + (y-16) + ' ' + (pad + (x2-pad)/2) + ',' + (y+16) + ' ' + x2 + ',' + y + '" fill="none" stroke="' + (PLATFORM_COLOR[p] || '#82877e') + '" stroke-width="' + (1.4 + cnt * .4) + '" opacity=".5" stroke-linecap="round"/>';
      for(var d = 0; d < Math.min(cnt, 9); d++){
        var dx = pad + ((d + 1) / (Math.min(cnt, 9) + 1)) * (x2 - pad);
        s += '<circle cx="' + dx + '" cy="' + (y + Math.sin((d + i) * 1.7) * 4) + '" r="3.4" fill="' + (PLATFORM_COLOR[p] || '#82877e') + '" opacity=".75"/>';
      }
      s += '<text x="' + (w - pad) + '" y="' + (y + 4) + '" text-anchor="end" font-size="10" fill="#75777a" font-family="Be Vietnam Pro, sans-serif">' + esc(p) + ' · ' + cnt + '</text>';
    });
    s += '</svg>';
    var html = s;
    html += '<div class="grid grid-cols-3 gap-2 mt-1">';
    var bands = [['≥ 8.5 高潜', rows.filter(function(r){ return num(r['爆款潜力评分']) >= 8.5; }).length, 'bg-secondary-fixed text-on-secondary-fixed-variant'],
      ['7.0 – 8.4 稳健', rows.filter(function(r){ var v = num(r['爆款潜力评分']); return v >= 7 && v < 8.5; }).length, 'bg-tertiary-fixed text-on-tertiary-fixed-variant'],
      ['< 7.0 待打磨', rows.filter(function(r){ return num(r['爆款潜力评分']) < 7; }).length, 'bg-surface-container text-on-surface-variant']];
    bands.forEach(function(b){
      html += '<div class="rounded-lg ' + b[2] + ' px-3 py-2"><div class="text-label-sm font-semibold">' + b[0] + '</div><div class="text-headline-sm font-headline-md mt-0.5">' + b[1] + '</div></div>';
    });
    html += '</div>';
    return html;
  }
  function inlineTopicForm(){
    var rec = null;
    if(state.inlineTopic){
      DATA.topic.forEach(function(r){ if(r['_id'] === state.inlineTopic) rec = r; });
    }
    var d = state.topicDraft || {};
    function val(key, fallback){
      return d[key] != null ? d[key] : fallback;
    }
    var name = val('name', rec ? (rec['选题'] || '') : '');
    var platform = rec ? (rec['平台'] || '') : (state.platform && state.platform !== 'all' ? state.platform : (d.platform != null ? d.platform : '公众号'));
    var status = val('status', rec ? (rec['状态'] || '待写') : '待写');
    var angle = val('angle', rec ? (rec['切入角度'] || '') : '');
    var score = val('score', rec && rec['爆款潜力评分'] != null ? num(rec['爆款潜力评分']) : 7.5);
    var ref = val('url', rec ? urlOf(rec['参考链接']) : '');
    var tags = val('tags', rec && rec['标签'] ? rec['标签'].slice() : []);
    var html = '';
    html += '<div class="flex items-start justify-between px-space-lg pt-space-lg pb-space-sm border-b border-surface-container-low">';
    html += '<div class="flex items-center gap-2"><span class="kicker-dot"></span><div><h3 class="text-headline-sm font-headline-sm text-on-surface">' + (state.inlineTopic ? '编辑选题 / 快速录入' : '快速录入 / 编辑抽屉') + '</h3>';
    html += '<p class="text-label-sm text-on-surface-variant">严格匹配 PRD 4.1 字段约束规范</p></div></div>';
    html += '<button class="text-label-sm text-on-surface-variant inline-flex items-center gap-0.5 hover:text-on-surface" data-act="inlineReset" type="button"><span class="material-symbols-outlined text-base">restart_alt</span>重置</button>';
    html += '</div>';
    html += '<div class="px-space-lg py-space-md max-h-[calc(100vh-14rem)] overflow-y-auto">';
    html += '<div class="fld"><label class="lab">选题名称 <b>*</b></label><input id="inlineName" class="inp" maxlength="60" data-draft="name" placeholder="一句话说清选题，例如：AI 工具如何重构剪辑工作流" value="' + esc(name) + '"><span class="helper">最多 60 字，建议带对象 + 利益点</span></div>';
    html += '<div class="form-grid">';
    html += '<div class="fld"><label class="lab">目标平台 <b>*</b></label><select id="inlinePlatform" class="sel" data-draft="platform">' + PLATFORMS.map(function(p){ return '<option value="' + p + '"' + (p === platform ? ' selected' : '') + '>' + p + '</option>'; }).join('') + '</select></div>';
    html += '<div class="fld"><label class="lab">当前状态</label><select id="inlineStatus" class="sel" data-draft="status">' + STATUS.map(function(p){ return '<option value="' + p + '"' + (p === status ? ' selected' : '') + '>' + p + '</option>'; }).join('') + '</select></div>';
    html += '</div>';
    html += '<div class="fld"><label class="lab">切入角度</label><textarea id="inlineAngle" class="ta" rows="3" data-draft="angle" placeholder="目标读者是谁？用什么反常识角度切入？">' + esc(angle) + '</textarea></div>';
    html += '<div class="fld"><label class="lab">爆款潜力评分</label><div class="score-row"><input id="inlineScore" type="range" min="0" max="10" step="0.1" value="' + score + '" data-draft="score"><span id="inlineScoreBadge" class="score-badge">' + Number(score).toFixed(1) + ' 分</span></div><span class="helper">≥ 8.5 会进入「高潜爆款储备」并置顶展示</span></div>';
    html += '<div class="fld"><label class="lab">内容标签</label><div class="tag-cloud">' + TAGS.map(function(t){
      return '<label class="tag-opt"><input type="checkbox" data-inline-tag="' + esc(t) + '"' + (tags.indexOf(t) >= 0 ? ' checked' : '') + '><span>#' + esc(t) + '</span></label>';
    }).join('') + '</div></div>';
    html += '<div class="fld"><label class="lab">参考来源</label><div class="input-wrap"><span class="material-symbols-outlined">link</span><input id="inlineUrl" class="inp" data-draft="url" placeholder="https://…" value="' + esc(ref) + '"></div><span id="inlineUrlHint" class="helper">粘贴完整的 http / https 链接</span></div>';
    html += '</div>';
    html += '<div class="px-space-lg py-space-md bg-surface-container-low/60 flex items-center justify-between gap-2">';
    html += '<span class="text-label-sm text-on-surface-variant">' + (state.inlineTopic ? '修改后将直接写回数据库' : '保存后自动生成选题 ID') + '</span>';
    html += '<div class="flex items-center gap-2"><button class="px-4 py-2 rounded-full bg-surface-container-lowest text-label-sm font-semibold text-on-surface-variant hover:bg-surface-container-high" data-act="inlineReset" type="button">清空</button>';
    html += '<button class="inline-flex items-center gap-1 px-5 py-2 rounded-full bg-primary text-on-primary text-label-sm font-semibold shadow-sm hover:opacity-90" data-act="inlineSave" type="button"><span class="material-symbols-outlined text-base">save</span>' + (state.inlineTopic ? '保存修改' : '保存选题') + '</button></div></div>';
    html += '<div class="mx-space-lg mb-space-lg mt-space-sm rounded-lg bg-tertiary-fixed/50 px-3 py-2 flex items-start gap-2"><span class="material-symbols-outlined text-base text-on-tertiary-fixed-variant mt-0.5">info</span><p class="text-label-sm text-on-tertiary-fixed-variant">从选题确认到复盘沉淀，状态会随内容日历的阶段自动联动；「废弃」状态不会被覆盖。</p></div>';
    return html;
  }

  /* ---------- view: calendar ---------- */
  function viewCalendar(){
    if(!state.month){
      var n0 = new Date();
      state.month = { y:n0.getFullYear(), m:n0.getMonth() };
    }
    var y = state.month.y, m = state.month.m;
    var first = new Date(y, m, 1);
    var startOffset = (first.getDay() + 6) % 7;
    var gridStart = addDays(first, -startOffset);
    var todayKey = isoDay(new Date());

    var stage = state.stage || 'all';
    var calRows = byPlatform(DATA.calendar).filter(function(r){
      return stage === 'all' || r['当前阶段'] === stage;
    });
    var byDay = {};
    calRows.forEach(function(r){
      var k = dayKey(r['计划发布时间']);
      if(!k) return;
      if(!byDay[k]) byDay[k] = [];
      byDay[k].push(r);
    });
    Object.keys(byDay).forEach(function(k){
      byDay[k].sort(function(a,b){ return parseDate(a['计划发布时间']) - parseDate(b['计划发布时间']); });
    });

    var monthRows = calRows.filter(function(r){
      var d = parseDate(r['计划发布时间']);
      return d && d.getFullYear() === y && d.getMonth() === m;
    }).sort(function(a,b){ return parseDate(a['计划发布时间']) - parseDate(b['计划发布时间']); });
    var monthAll = byPlatform(DATA.calendar).filter(function(r){
      var d = parseDate(r['计划发布时间']);
      return d && d.getFullYear() === y && d.getMonth() === m;
    });
    var monthPending = monthAll.filter(function(r){ return ['已发布','二次分发','已复盘'].indexOf(r['当前阶段']) < 0; }).length;
    var monthWorking = monthAll.filter(function(r){ return ['选题确认','脚本撰写','待补素材','制作中'].indexOf(r['当前阶段']) >= 0; }).length;
    var monthPublished = monthAll.filter(function(r){ return ['已发布','二次分发','已复盘'].indexOf(r['当前阶段']) >= 0; }).length;
    var monthReviewed = monthAll.filter(function(r){ return r['当前阶段'] === '已复盘'; }).length;
    var reviewRate = monthPublished ? (monthReviewed / monthPublished * 100) : 0;

    var html = '';
    html += '<div class="fade-in">';

    /* banners */
    html += '<div class="grid grid-cols-1 md:grid-cols-3 gap-space-md mb-space-lg">';
    html += '<div class="rounded-xl bg-tertiary-fixed p-space-lg flex flex-col justify-between shadow-sm"><div class="flex items-center justify-between"><span class="text-label-md font-label-md uppercase tracking-wide text-on-tertiary-fixed-variant">当月待发布计划</span><button class="px-3 py-1 rounded-full bg-surface-container-lowest text-label-sm font-label-sm shadow-sm" data-act="calStage" data-val="待发布" type="button">查看待发</button></div><div class="mt-space-md"><div class="text-display-lg font-display-lg text-tertiary leading-none">' + pad2(monthPending) + '</div><p class="mt-2 text-label-sm text-on-tertiary-fixed-variant/80">篇待审核上线 · ' + (m+1) + ' 月排期</p></div></div>';
    html += '<div class="rounded-xl bg-surface-container p-space-lg flex flex-col justify-between shadow-sm"><div class="flex items-center justify-between"><span class="text-label-md font-label-md uppercase tracking-wide text-on-surface-variant">进行中创作流</span><button class="px-3 py-1 rounded-full bg-surface-container-lowest text-label-sm font-label-sm shadow-sm" data-act="calStage" data-val="脚本撰写" type="button">追踪流向</button></div><div class="mt-space-md"><div class="text-display-lg font-display-lg text-on-surface leading-none">' + pad2(monthWorking) + '</div><p class="mt-2 text-label-sm text-on-surface-variant/80">篇脚本 / 素材正在流转</p></div></div>';
    html += '<div class="rounded-xl bg-secondary-fixed p-space-lg flex flex-col justify-between shadow-sm"><div class="flex items-center justify-between"><span class="text-label-md font-label-md uppercase tracking-wide text-on-secondary-fixed-variant">已完成复盘率</span><button class="px-3 py-1 rounded-full bg-surface-container-lowest text-label-sm font-label-sm shadow-sm" data-act="goto" data-view="review" type="button">复盘台账</button></div><div class="mt-space-md"><div class="text-display-lg font-display-lg text-secondary leading-none">' + reviewRate.toFixed(1) + '%</div><p class="mt-2 text-label-sm text-on-secondary-fixed-variant/80">' + monthReviewed + ' / ' + monthPublished + ' 篇已复盘</p></div></div>';
    html += '</div>';

    html += '<div class="grid grid-cols-12 gap-space-md items-start">';

    /* calendar card */
    html += '<div class="col-span-12 xl:col-span-8 soft-card p-space-lg min-w-0">';
    html += '<div class="flex flex-wrap items-start justify-between gap-space-md mb-space-md">';
    html += '<div><div class="flex items-center gap-2 mb-1"><span class="kicker-dot"></span><span class="text-label-sm font-label-sm uppercase tracking-wider text-on-surface-variant">Schedule Cockpit</span></div>';
    html += '<h3 class="text-headline-md font-headline-md text-on-surface">内容排期与发布日历</h3>';
    html += '<p class="text-label-sm text-on-surface-variant">周一为一周起点 · 点击格内 + 直接排期，拖动阶段可快速更新。</p></div>';
    html += '<div class="flex items-center gap-space-sm flex-wrap">';
    html += '<div class="flex items-center bg-surface-container-low rounded-full p-0.5">';
    html += '<button class="w-7 h-7 rounded-full hover:bg-surface-container-high flex items-center justify-center" data-act="prevMonth" type="button"><span class="material-symbols-outlined text-base">chevron_left</span></button>';
    html += '<span class="px-2 text-label-md font-label-md font-semibold text-on-surface whitespace-nowrap">' + y + ' 年 ' + (m+1) + ' 月</span>';
    html += '<button class="w-7 h-7 rounded-full hover:bg-surface-container-high flex items-center justify-center" data-act="nextMonth" type="button"><span class="material-symbols-outlined text-base">chevron_right</span></button>';
    html += '</div>';
    html += '<button class="px-3 py-1.5 rounded-full bg-surface-container-low text-label-sm font-semibold text-on-surface hover:bg-surface-container-high" data-act="todayMonth" type="button">今天</button>';
    html += '<div class="relative"><select id="stageFilter" class="appearance-none bg-surface-container-low text-label-sm font-semibold text-on-surface pl-3 pr-8 py-1.5 rounded-full focus:outline-none cursor-pointer">';
    html += '<option value="all">全部阶段</option>';
    STAGES.forEach(function(s, i){ html += '<option value="' + s + '"' + (stage === s ? ' selected' : '') + '>' + (i+1) + ' · ' + s + '</option>'; });
    html += '</select><span class="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none text-base">expand_more</span></div>';
    html += '<button class="inline-flex items-center gap-1.5 px-space-md py-2 bg-primary text-on-primary rounded-full text-label-sm font-semibold shadow-sm hover:opacity-90" data-act="new" data-db="calendar" type="button"><span class="material-symbols-outlined text-base">add</span>新建排期计划</button>';
    html += '</div></div>';

    /* weekdays */
    html += '<div class="grid grid-cols-7 gap-2 mb-1">';
    ['周一','周二','周三','周四','周五','周六','周日'].forEach(function(d, i){
      html += '<div class="text-center py-1"><div class="text-label-sm font-label-sm text-on-surface-variant">' + d + '</div><div class="text-[9px] text-outline uppercase tracking-wider">' + ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i] + '</div></div>';
    });
    html += '</div>';

    /* grid */
    html += '<div class="grid grid-cols-7 gap-2">';
    var cursor = new Date(gridStart.getTime());
    for(var cells = 0; cells < 42; cells++){
      var inMonth = cursor.getMonth() === m;
      var k = isoDay(cursor);
      var events = byDay[k] || [];
      html += '<div class="cal-cell' + (inMonth ? '' : ' out') + (k === todayKey ? ' today' : '') + '" data-act="day" data-date="' + k + '">';
      html += '<div class="flex items-center justify-between"><span class="text-[11px] font-semibold ' + (k === todayKey ? 'bg-secondary-container text-on-secondary-fixed-variant rounded-full w-5 h-5 flex items-center justify-center' : inMonth ? 'text-on-surface' : 'text-outline') + '">' + cursor.getDate() + '</span>';
      if(k === todayKey) html += '<span class="text-[9px] font-bold text-[#785d00]">今天</span>';
      html += '</div>';
      html += '<button class="cal-add" data-act="day" data-date="' + k + '" type="button" title="新建排期"><span class="material-symbols-outlined">add</span></button>';
      var shown = 0;
      for(var e = 0; e < events.length; e++){
        if(shown >= 2){
          html += '<button class="cal-more" data-act="dayMore" data-date="' + k + '" type="button">＋ 还有 ' + (events.length - shown) + ' 条</button>';
          break;
        }
        var ev = events[e];
        var color = PLATFORM_COLOR[platformList(ev['平台'])[0]] || '#82877e';
        html += '<button class="cal-ev" data-act="edit" data-db="calendar" data-id="' + esc(ev['_id']) + '" type="button" title="' + esc((ev['标题']||'') + ' · ' + (ev['当前阶段']||'')) + '"><span class="cal-bar" style="background:' + color + '"></span><span class="t">' + fmtTimeOnly(ev['计划发布时间']) + ' ' + esc(truncate(ev['标题'], 10)) + '</span></button>';
        shown++;
      }
      html += '</div>';
      cursor = addDays(cursor, 1);
    }
    html += '</div>';

    /* legend */
    html += '<div class="flex flex-wrap items-center justify-between gap-2 mt-space-md pt-space-md border-t border-surface-container-low">';
    html += '<div class="flex flex-wrap items-center gap-3 text-label-sm text-on-surface-variant">';
    PLATFORMS.slice(0, 6).forEach(function(p){
      html += '<span class="inline-flex items-center gap-1"><i class="w-2 h-2 rounded-full" style="background:' + (PLATFORM_COLOR[p]||'#82877e') + '"></i>' + esc(p) + '</span>';
    });
    html += '</div><span class="text-label-sm text-on-surface-variant">本月 ' + monthAll.length + ' 条排期</span></div>';
    html += '</div>';

    /* right column */
    html += '<div class="col-span-12 xl:col-span-4 flex flex-col gap-space-md">';
    var wk = monthWeekBuckets(monthAll);
    html += '<div class="soft-card p-space-lg">';
    html += '<div class="flex items-start justify-between mb-1"><div><div class="flex items-center gap-2 mb-1"><span class="kicker-dot"></span><span class="text-label-sm font-label-sm uppercase tracking-wider text-on-surface-variant">Distribution Flow</span></div><h3 class="text-headline-sm font-headline-sm text-on-surface">' + (m+1) + '月分发趋势流向</h3></div><span class="chip chip-sky">' + monthAll.length + ' 条</span></div>';
    html += '<p class="text-label-sm text-on-surface-variant mb-2">按内容形式拆分本月排期，流带粗细代表数量。</p>';
    html += chartSvg([
      { vals: wk.图文, color:'#6f66a8' },
      { vals: wk.短视频, color:'#b8863b' },
      { vals: wk.长图, color:'#2f8f5b' }
    ], { id:'cal', height:120, w:420, h:130, pad:8, areaOpacity:.12 });
    html += '<div class="grid grid-cols-3 gap-2 mt-1">';
    [['图文资讯','图文','#6f66a8'],['短视频流','短视频','#b8863b'],['长图复盘','长图','#2f8f5b']].forEach(function(f){
      var total = monthAll.filter(function(r){ return r['内容形式'] === f[1]; }).length;
      html += '<div class="rounded-lg bg-surface-container-low px-2.5 py-2"><div class="flex items-center gap-1 text-label-sm text-on-surface-variant"><i class="w-2 h-2 rounded-full" style="background:' + f[2] + '"></i>' + f[0] + '</div><div class="text-headline-sm font-headline-md text-on-surface mt-0.5">' + pad2(total) + '</div></div>';
    });
    html += '</div></div>';
    var vrec = VOICE.recordings[0];
    html += '<div class="soft-card p-space-lg">';
    html += '<div class="flex items-center justify-between mb-2"><span class="text-label-sm font-label-sm uppercase tracking-wide text-on-surface-variant">语音速记</span>' +
      (vrec
        ? '<span class="chip chip-line"><span class="material-symbols-outlined text-[13px]">graphic_eq</span>' + esc(fmtDuration(vrec.durationSec)) + '</span>'
        : '<span class="chip chip-line"><span class="material-symbols-outlined text-[13px]">mic</span>待录制</span>') + '</div>';
    html += '<h3 class="text-headline-sm font-headline-sm text-on-surface mb-1">' + esc(vrec ? vrec.title : '选题语音速记') + '</h3>';
    html += '<p class="text-label-sm text-on-surface-variant mb-3">' + esc(vrec
      ? (vrec.transcript ? String(vrec.transcript).replace(/\s+/g, ' ').slice(0, 70) : '尚无转写文本，可打开速记手动补充。')
      : '录下选题会的关键决策，录音只保存在本机。') + '</p>';
    html += waveHtml();
    html += vrec
      ? '<button class="mt-3 w-full inline-flex items-center justify-center gap-1 px-3 py-2 rounded-full bg-surface-container-low text-label-sm font-semibold text-on-surface hover:bg-surface-container-high" data-act="voicePlay" data-id="' + esc(vrec.id) + '" type="button"><span class="material-symbols-outlined text-base">play_arrow</span>播放最新录音</button>'
      : '<button class="mt-3 w-full inline-flex items-center justify-center gap-1 px-3 py-2 rounded-full bg-surface-container-low text-label-sm font-semibold text-on-surface hover:bg-surface-container-high" data-act="voiceMemo" type="button"><span class="material-symbols-outlined text-base">mic</span>开始录制</button>';
    html += '<button class="mt-2 w-full inline-flex items-center justify-center gap-1 px-3 py-2 rounded-full bg-primary text-on-primary text-label-sm font-semibold hover:opacity-90" data-act="voiceMemo" type="button"><span class="material-symbols-outlined text-base">queue_music</span>打开语音速记</button>';
    html += '</div>';
    html += '</div>';

    /* monthly table */
    html += '<div class="col-span-12 soft-card overflow-hidden">';
    html += '<div class="flex flex-wrap items-center justify-between gap-2 px-space-lg pt-space-lg pb-space-sm">';
    html += '<div><h3 class="text-headline-sm font-headline-sm text-on-surface">本月排期进度详表</h3><p class="text-label-sm text-on-surface-variant">' + monthRows.length + ' 条排期 · 阶段可直接下拉更新</p></div>';
    html += '<div class="flex items-center gap-2"><button class="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-surface-container-low text-label-sm font-semibold text-on-surface hover:bg-surface-container-high" data-act="exportCal" type="button"><span class="material-symbols-outlined text-base">download</span>导出 CSV</button>';
    html += '<button class="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary text-on-primary text-label-sm font-semibold hover:opacity-90" data-act="new" data-db="calendar" type="button"><span class="material-symbols-outlined text-base">add</span>新建</button></div>';
    html += '</div>';
    if(!monthRows.length){
      html += emptyState('这个月还没有排期', '点日历格子里的 + 直接排一条，或使用「新建排期计划」', 'calendar_month');
    } else {
      html += '<div class="overflow-x-auto"><table class="w-full text-[12px]"><thead><tr class="text-label-sm text-on-surface-variant bg-surface-container-low/60">';
      html += '<th class="text-left font-semibold py-2.5 pl-4 pr-2 whitespace-nowrap">计划发布时间</th>';
      html += '<th class="text-left font-semibold py-2.5 px-2 whitespace-nowrap">排期编号</th>';
      html += '<th class="text-left font-semibold py-2.5 px-2">内容标题</th>';
      html += '<th class="text-left font-semibold py-2.5 px-2 whitespace-nowrap">发布平台</th>';
      html += '<th class="text-left font-semibold py-2.5 px-2 whitespace-nowrap">内容形式</th>';
      html += '<th class="text-left font-semibold py-2.5 px-2 whitespace-nowrap">负责人</th>';
      html += '<th class="text-left font-semibold py-2.5 px-2 whitespace-nowrap">当前阶段</th>';
      html += '<th class="text-left font-semibold py-2.5 px-2 whitespace-nowrap">关联选题</th>';
      html += '<th class="text-right font-semibold py-2.5 pr-4 pl-2 whitespace-nowrap">关键操作</th>';
      html += '</tr></thead><tbody class="divide-y divide-surface-container-low">';
      monthRows.forEach(function(r){
        var isToday = dayKey(r['计划发布时间']) === todayKey;
        html += '<tr class="row-hover">';
        html += '<td class="py-3 pl-4 pr-2 whitespace-nowrap"><div class="flex items-center gap-1.5"><span class="text-[12px] font-medium text-on-surface">' + esc(fmtDateTime(r['计划发布时间'])) + '</span>' + (isToday ? '<span class="chip chip-honey">今天</span>' : '') + '</div></td>';
        html += '<td class="py-3 px-2 whitespace-nowrap"><span class="mono text-[11px] font-semibold text-on-surface-variant">' + esc(r['排期ID'] || '—') + '</span></td>';
        html += '<td class="py-3 px-2 min-w-[180px]"><div class="font-semibold text-on-surface truncate max-w-[240px]" title="' + esc(r['标题']) + '">' + esc(r['标题'] || '（未命名）') + '</div></td>';
        html += '<td class="py-3 px-2 whitespace-nowrap">' + platformChip(r['平台']) + '</td>';
        html += '<td class="py-3 px-2 whitespace-nowrap text-label-sm text-on-surface-variant">' + esc(r['内容形式'] || '—') + '</td>';
        html += '<td class="py-3 px-2 whitespace-nowrap"><div class="flex items-center gap-1.5"><span class="w-6 h-6 rounded-full bg-tertiary-fixed text-on-tertiary-fixed-variant flex items-center justify-center text-[10px] font-bold">' + esc(avatarInitial(r['负责人'])) + '</span><span class="text-label-sm text-on-surface-variant">' + esc(r['负责人'] || '未指派') + '</span></div></td>';
        html += '<td class="py-3 px-2 whitespace-nowrap">' + quickSelect('calendar', r, '当前阶段', STAGES, stageClass(r['当前阶段'])) + '</td>';
        html += '<td class="py-3 px-2 whitespace-nowrap">' + (r['选题ID'] ? '<button class="text-label-sm text-[#785d00] hover:underline inline-flex items-center gap-0.5" data-act="openTopic" data-code="' + esc(r['选题ID']) + '" type="button"><span class="material-symbols-outlined text-[13px]">link</span>' + esc(r['选题ID']) + '</button>' : '<span class="text-outline">—</span>') + '</td>';
        html += '<td class="py-3 pr-4 pl-2 whitespace-nowrap"><div class="flex items-center justify-end gap-1">';
        if(['已发布','二次分发','已复盘'].indexOf(r['当前阶段']) < 0){
          if(pubScheduleReady(r)){
            html += '<button class="px-2.5 py-1 rounded-full bg-primary text-on-primary text-[10px] font-semibold hover:opacity-90" data-act="pubNew" data-id="' + esc(r['_id']) + '" type="button">准备发布</button>';
          }
          html += '<button class="px-2.5 py-1 rounded-full bg-secondary-fixed text-[10px] font-semibold text-on-secondary-fixed-variant hover:brightness-95" data-act="publish" data-id="' + esc(r['_id']) + '" type="button">标记已发布</button>';
        }
        html += '<button class="w-7 h-7 rounded-full hover:bg-surface-container flex items-center justify-center text-on-surface-variant" data-act="edit" data-db="calendar" data-id="' + esc(r['_id']) + '" type="button" title="编辑"><span class="material-symbols-outlined text-base">edit</span></button>';
        html += '</div></td></tr>';
      });
      html += '</tbody></table></div>';
    }
    html += '</div>';
    html += '</div></div>';
    return html;
  }
  function monthWeekBuckets(rows){
    var out = { 图文:[0,0,0,0,0,0], 短视频:[0,0,0,0,0,0], 长图:[0,0,0,0,0,0] };
    rows.forEach(function(r){
      var d = parseDate(r['计划发布时间']);
      if(!d) return;
      var idx = Math.min(5, Math.floor((d.getDate() - 1) / 5));
      var f = r['内容形式'] === '短视频' ? '短视频' : r['内容形式'] === '长图' ? '长图' : '图文';
      out[f][idx]++;
    });
    return out;
  }

  /* 通用分页栏：看板、流水账共用 */
  function pagerFooter(sizeId, act, size, page, pageCount, start, end, total, unit){
    var html = '';
    html += '<div class="flex flex-wrap items-center justify-between gap-space-sm px-space-lg py-space-sm border-t border-surface-container-low">';
    html += '<div class="text-label-sm text-on-surface-variant">第 ' + (start + 1) + '–' + end + ' 个 · 共 ' + total + ' 个' + unit + '</div>';
    html += '<div class="flex items-center gap-space-sm">';
    html += '<select id="' + sizeId + '" class="bg-surface-container-low text-label-sm font-label-sm text-on-surface pl-2.5 pr-1 py-1.5 rounded-full focus:outline-none cursor-pointer">';
    [30, 50, 100].forEach(function(n){
      html += '<option value="' + n + '"' + (size === n ? ' selected' : '') + '>每页 ' + n + ' 个</option>';
    });
    html += '</select>';
    html += '<div class="flex items-center gap-1">';
    html += '<button class="w-7 h-7 rounded-full bg-surface-container-low text-on-surface flex items-center justify-center hover:bg-surface-container-high disabled:opacity-40 disabled:cursor-not-allowed" data-act="' + act + '" data-page="' + (page - 1) + '" type="button"' + (page <= 1 ? ' disabled' : '') + ' title="上一页"><span class="material-symbols-outlined text-base">chevron_left</span></button>';
    html += '<span class="text-label-sm text-on-surface-variant px-1 text-center min-w-[52px]">' + page + ' / ' + pageCount + '</span>';
    html += '<button class="w-7 h-7 rounded-full bg-surface-container-low text-on-surface flex items-center justify-center hover:bg-surface-container-high disabled:opacity-40 disabled:cursor-not-allowed" data-act="' + act + '" data-page="' + (page + 1) + '" type="button"' + (page >= pageCount ? ' disabled' : '') + ' title="下一页"><span class="material-symbols-outlined text-base">chevron_right</span></button>';
    html += '</div></div></div>';
    return html;
  }

  /* ---------- view: review ---------- */
  function viewReview(){
    var allGroups = reviewGroups();
    var groups = filteredGroups();
    var rows = reviewRows();
    var start = reviewRangeStart();

    var last7 = last7Stats();
    var rangeRead = rows.reduce(function(a,b){ return a + num(b['阅读播放']); }, 0);
    var rangeLike = rows.reduce(function(a,b){ return a + num(b['点赞']); }, 0);
    var rangeFans = rows.reduce(function(a,b){ return a + num(b['涨粉']); }, 0);
    var rangeConv = rows.reduce(function(a,b){ return a + num(b['转化']); }, 0);
    var week = startOfWeek(new Date());
    var newThisWeek = allGroups.filter(function(g){
      var d = parseDate(g.latest['统计日期']);
      return d && startOfDay(d) >= week;
    }).length;
    var missing = missingSnapshots();
    var snapshotTotal = DATA.review.length;

    var html = '';
    html += '<div class="fade-in">';

    /* control banner */
    html += '<div class="soft-card px-space-lg py-space-md mb-space-lg flex flex-wrap items-center justify-between gap-space-md">';
    html += '<div class="seg">';
    html += '<button class="' + (state.reviewMode === 'agg' ? 'on' : '') + '" data-act="rvMode" data-mode="agg" type="button">按排期聚合视图 (生命周期)</button>';
    html += '<button class="' + (state.reviewMode !== 'agg' ? 'on' : '') + '" data-act="rvMode" data-mode="list" type="button">日常流水账快照 (时间序)</button>';
    html += '</div>';
    html += '<div class="flex items-center gap-space-sm">';
    html += '<div class="relative"><select id="reviewRange" class="appearance-none bg-surface-container-low text-label-md font-label-md text-on-surface pl-3 pr-8 py-2 rounded-full focus:outline-none cursor-pointer">';
    [['all','全部时间'],['7','近 7 天'],['14','近 14 天'],['30','近 30 天']].forEach(function(o){
      html += '<option value="' + o[0] + '"' + (state.reviewRange === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
    });
    html += '</select><span class="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none text-base">expand_more</span></div>';
    html += '<button class="inline-flex items-center gap-1.5 px-space-md py-2 bg-tertiary-fixed text-on-tertiary-fixed-variant rounded-full text-label-md font-label-md shadow-sm hover:brightness-95" data-act="xhsSync" type="button"><span class="material-symbols-outlined text-base">cloud_sync</span>从小红书同步</button>';
    html += '<button class="inline-flex items-center gap-1.5 px-space-md py-2 bg-tertiary-fixed text-on-tertiary-fixed-variant rounded-full text-label-md font-label-md shadow-sm hover:brightness-95" data-act="douyinSync" type="button"><span class="material-symbols-outlined text-base">cloud_sync</span>从抖音同步</button>';
    html += '<button class="inline-flex items-center gap-1.5 px-space-md py-2 bg-tertiary-fixed text-on-tertiary-fixed-variant rounded-full text-label-md font-label-md shadow-sm hover:brightness-95" data-act="channelsSync" type="button"><span class="material-symbols-outlined text-base">cloud_sync</span>从视频号同步</button>';
    html += '<button class="inline-flex items-center gap-1.5 px-space-md py-2 bg-secondary-container text-on-secondary-container rounded-full text-label-md font-label-md shadow-sm hover:brightness-95" data-act="new" data-db="review" type="button"><span class="material-symbols-outlined text-base">add_chart</span>记一条数据快照</button>';
    html += '</div></div>';

    /* KPI banners */
    html += '<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md mb-space-lg">';
    html += kpiPastel('lilac', '监控中作品数', pad2(allGroups.length), '+' + newThisWeek + ' 本周 · 累计 ' + snapshotTotal + ' 批快照', '检查异常', 'checkMissing');
    html += kpiPastel('sky', '7 日综合互动率', last7.rate.toFixed(2) + '%', '点赞 / 阅读播放 · ' + (last7.rate >= 5 ? '高于基准线' : '继续优化'), '算法拆解', 'explainRate');
    html += kpiPastel('butter', '累计全渠道增粉', (rangeFans >= 0 ? '+' : '') + fmtNum(rangeFans), '涨粉率 ' + pct(rangeFans, rangeRead) + ' · 转化 ' + fmtNum(rangeConv), '转化明细', 'explainFans');
    html += kpiPastel('mint', '待补录快照排期', pad2(missing.length), '已发布但今天还没打点', '一键催更', 'recMissing');
    html += '</div>';

    html += '<div class="grid grid-cols-12 gap-space-md items-start">';
    html += '<div class="col-span-12 xl:col-span-8 flex flex-col gap-space-md min-w-0">';

    /* lifecycle curve */
    var focusGroup = null;
    if(state.inspectCode){
      groups.forEach(function(g){ if(g.code === state.inspectCode) focusGroup = g; });
    }
    if(!focusGroup && groups.length) focusGroup = groups[0];
    if(focusGroup && state.inspectCode !== focusGroup.code) state.inspectCode = focusGroup.code;
    var curveVals = focusGroup ? focusGroup.reads : rows.slice().reverse().map(function(r){ return num(r['阅读播放']); });
    if(!curveVals.length) curveVals = [0,0,0,0,0,0,0];
    var curveLabels = focusGroup ? focusGroup.snapshots.map(function(r){ return dayKey(r['统计日期']).substring(5); }) : rows.slice().reverse().map(function(r){ return dayKey(r['统计日期']).substring(5); });
    var curveMax = Math.max.apply(null, curveVals.concat([1]));
    var curveLast = curveVals[curveVals.length-1] || 0;

    html += '<div class="soft-card p-space-lg">';
    html += '<div class="flex flex-wrap items-start justify-between gap-space-sm mb-space-md">';
    html += '<div><div class="flex items-center gap-2 mb-1"><span class="kicker-dot"></span><span class="text-label-sm font-label-sm uppercase tracking-wider text-on-surface-variant">Lifecycle Pulse</span></div>';
    html += '<h3 class="text-headline-md font-headline-md text-on-surface">爆款成长爆发曲线 · 72 小时流速对照</h3>';
    html += '<p class="text-label-sm text-on-surface-variant">' + (focusGroup ? '聚焦 ' + esc(focusGroup.code) + ' · ' + esc(focusGroup.title) : '全部快照按时间序聚合') + '</p></div>';
    html += '<div class="flex items-center gap-4 text-right"><div><div class="text-label-sm text-on-surface-variant">最新阅读</div><div class="text-headline-md font-headline-md text-on-surface">' + fmtNum(curveLast) + '</div></div>';
    html += '<div><div class="text-label-sm text-on-surface-variant">峰值</div><div class="text-headline-md font-headline-md text-[#785d00]">' + fmtNum(curveMax) + '</div></div>';
    html += '<div><div class="text-label-sm text-on-surface-variant">快照批次</div><div class="text-headline-md font-headline-md text-on-surface">' + curveVals.length + '</div></div></div>';
    html += '</div>';
    html += chartSvg([{ vals: curveVals, color:'#6f66a8', width:2.4 }], { id:'rv', height:168, w:680, h:180, pad:10, areaOpacity:.2 });
    html += '<div class="flex items-center justify-between mt-1 text-label-sm text-on-surface-variant"><span>' + (curveLabels[0] || '—') + '</span><span>发布后 72h 为黄金观察窗</span><span>' + (curveLabels[curveLabels.length-1] || '—') + '</span></div>';
    html += '</div>';

    if(state.reviewMode === 'agg'){
      var size = state.lifecycleSize || 30;
      var pageCount = Math.max(1, Math.ceil(groups.length / size));
      var page = Math.min(Math.max(1, state.lifecyclePage || 1), pageCount);
      state.lifecyclePage = page;
      var pageStart = (page - 1) * size;
      var pageGroups = groups.slice(pageStart, pageStart + size);
      var pageEnd = pageStart + pageGroups.length;

      html += '<div class="soft-card overflow-hidden">';
      html += '<div class="flex items-center justify-between px-space-lg pt-space-lg pb-space-sm"><div><h3 class="text-headline-sm font-headline-sm text-on-surface">作品全生命周期看板</h3><p class="text-label-sm text-on-surface-variant">一篇一行，展示最新快照与发布以来走势</p></div><span class="chip chip-line">' + groups.length + ' 个排期</span></div>';
      if(!groups.length){
        html += emptyState('还没有数据快照', '发布后每天记一条，首页趋势才有得看', 'monitoring');
      } else {
        html += '<div class="overflow-x-auto"><table class="w-full text-[12px]"><thead><tr class="text-label-sm text-on-surface-variant bg-surface-container-low/60">';
        html += '<th class="text-left font-semibold py-2.5 pl-4 pr-2">排期 ID / 作品主题</th>';
        html += '<th class="text-left font-semibold py-2.5 px-2 whitespace-nowrap">平台 / 阶段</th>';
        html += '<th class="text-left font-semibold py-2.5 px-2 whitespace-nowrap">快照周期</th>';
        html += '<th class="text-right font-semibold py-2.5 px-2 whitespace-nowrap">最新阅读/播放</th>';
        html += '<th class="text-right font-semibold py-2.5 px-2 whitespace-nowrap">互动率</th>';
        html += '<th class="text-left font-semibold py-2.5 px-2 whitespace-nowrap">7 日走势</th>';
        html += '<th class="text-right font-semibold py-2.5 pr-4 pl-2 whitespace-nowrap">操作</th>';
        html += '</tr></thead><tbody class="divide-y divide-surface-container-low">';
        pageGroups.forEach(function(g){
          var latest = g.latest;
          var read = num(latest['阅读播放']), like = num(latest['点赞']);
          var sel = state.inspectCode === g.code;
          html += '<tr class="row-hover' + (sel ? ' bg-secondary-fixed/15' : '') + '">';
          html += '<td class="py-3 pl-4 pr-2 max-w-[260px]"><div class="flex items-center gap-2"><span class="mono text-[11px] font-semibold text-on-surface-variant">' + esc(g.code) + '</span>';
          if(!g.calExists) html += '<span class="chip chip-coral">排期已删</span>';
          html += '</div><div class="font-semibold text-on-surface truncate" title="' + esc(g.title) + '">' + esc(g.title) + '</div></td>';
          html += '<td class="py-3 px-2 whitespace-nowrap"><div class="mb-1">' + platformChip(g.platform) + '</div>' + (g.calExists ? '<span class="chip chip-line">' + esc(g.stage) + '</span>' : '<span class="text-outline">—</span>') + '</td>';
          html += '<td class="py-3 px-2 whitespace-nowrap"><div class="text-on-surface">' + g.count + ' 批</div><div class="text-label-sm text-on-surface-variant">' + esc(dayKey(latest['统计日期'])) + '</div></td>';
          html += '<td class="py-3 px-2 text-right whitespace-nowrap"><div class="font-semibold text-on-surface">' + fmtNum(read) + '</div><div class="text-label-sm text-on-surface-variant">涨粉 ' + fmtNum(latest['涨粉']) + '</div></td>';
          html += '<td class="py-3 px-2 text-right whitespace-nowrap"><span class="font-semibold text-[#785d00]">' + pct(like, read) + '</span></td>';
          html += '<td class="py-3 px-2">' + miniSpark(g.reads.slice(-7), '#6f66a8') + '</td>';
          html += '<td class="py-3 pr-4 pl-2"><div class="flex items-center justify-end gap-1">';
          html += '<button class="px-2.5 py-1 rounded-full bg-surface-container-low text-[10px] font-semibold text-on-surface hover:bg-surface-container-high" data-act="rec" data-calcode="' + esc(g.code) + '" data-platform="' + esc(g.platform) + '" type="button">补录</button>';
          html += '<button class="px-2.5 py-1 rounded-full bg-tertiary-fixed text-[10px] font-semibold text-on-tertiary-fixed-variant hover:brightness-95" data-act="inspect" data-code="' + esc(g.code) + '" type="button">复盘</button></div></td></tr>';
        });
        html += '</tbody></table></div>';
        html += pagerFooter('lifecycleSize', 'lifecyclePage', size, page, pageCount, pageStart, pageEnd, groups.length, '排期');
      }
      html += '</div>';
    }

    /* raw table */
    var listSize = state.reviewListSize || 30;
    var listPageCount = Math.max(1, Math.ceil(rows.length / listSize));
    var listPage = Math.min(Math.max(1, state.reviewListPage || 1), listPageCount);
    state.reviewListPage = listPage;
    var listStart = (listPage - 1) * listSize;
    var pageRows = rows.slice(listStart, listStart + listSize);
    var listEnd = listStart + pageRows.length;

    html += '<div class="soft-card overflow-hidden">';
    html += '<div class="flex items-center justify-between px-space-lg pt-space-lg pb-space-sm"><div><h3 class="text-headline-sm font-headline-sm text-on-surface">日常流水账快照记录</h3><p class="text-label-sm text-on-surface-variant">' + rows.length + ' 条快照 · 同一排期可每天记一条</p></div>';
    html += '<span class="chip chip-line">' + (state.reviewRange === 'all' ? '全部时间' : '近 ' + state.reviewRange + ' 天') + '</span></div>';
    if(!rows.length){
      html += emptyState('这个区间还没有快照', '调整时间范围，或点上方「记一条数据快照」', 'table_view');
    } else {
      html += '<div class="overflow-x-auto"><table class="w-full text-[12px]"><thead><tr class="text-label-sm text-on-surface-variant bg-surface-container-low/60">';
      html += '<th class="text-left font-semibold py-2.5 pl-4 pr-2 whitespace-nowrap">统计日期</th>';
      html += '<th class="text-left font-semibold py-2.5 px-2 whitespace-nowrap">关联排期编号</th>';
      html += '<th class="text-right font-semibold py-2.5 px-2 whitespace-nowrap">当日累计阅读/播放</th>';
      html += '<th class="text-right font-semibold py-2.5 px-2 whitespace-nowrap">互动数</th>';
      html += '<th class="text-right font-semibold py-2.5 px-2 whitespace-nowrap">当日涨粉</th>';
      html += '<th class="text-right font-semibold py-2.5 px-2 whitespace-nowrap">转化</th>';
      html += '<th class="text-left font-semibold py-2.5 px-2">复盘备注</th>';
      html += '<th class="text-right font-semibold py-2.5 pr-4 pl-2 whitespace-nowrap">操作</th>';
      html += '</tr></thead><tbody class="divide-y divide-surface-container-low">';
      pageRows.forEach(function(r){
        var read = num(r['阅读播放']), like = num(r['点赞']), fans = num(r['涨粉']);
        html += '<tr class="row-hover">';
        html += '<td class="py-2.5 pl-4 pr-2 whitespace-nowrap"><span class="font-medium">' + esc(dayKey(r['统计日期']) || '—') + '</span></td>';
        html += '<td class="py-2.5 px-2 whitespace-nowrap"><button class="mono text-[11px] text-[#785d00] hover:underline" data-act="inspect" data-code="' + esc(r['排期ID'] || '') + '" type="button">' + esc(r['排期ID'] || '—') + '</button></td>';
        html += '<td class="py-2.5 px-2 text-right whitespace-nowrap">' + fmtNum(read) + '</td>';
        html += '<td class="py-2.5 px-2 text-right whitespace-nowrap">' + fmtNum(like) + ' <span class="text-label-sm text-on-surface-variant">(' + pct(like, read) + ')</span></td>';
        html += '<td class="py-2.5 px-2 text-right whitespace-nowrap">' + fmtNum(fans) + '</td>';
        html += '<td class="py-2.5 px-2 text-right whitespace-nowrap">' + fmtNum(r['转化']) + '</td>';
        html += '<td class="py-2.5 px-2 max-w-[180px]"><div class="text-on-surface-variant line-clamp-2">' + esc(truncate(r['复盘备注'], 46) || '—') + '</div></td>';
        html += '<td class="py-2.5 pr-4 pl-2 whitespace-nowrap"><div class="flex items-center justify-end gap-1">';
        html += '<button class="px-2.5 py-1 rounded-full bg-surface-container-low text-[10px] font-semibold text-on-surface hover:bg-surface-container-high" data-act="edit" data-db="review" data-id="' + esc(r['_id']) + '" type="button">编辑</button>';
        html += '<button class="w-6 h-6 rounded-full hover:bg-error-container/60 flex items-center justify-center text-on-surface-variant hover:text-error" data-act="del" data-db="review" data-id="' + esc(r['_id']) + '" data-name="' + esc(r['复盘ID']) + '" type="button" title="删除"><span class="material-symbols-outlined text-[15px]">delete</span></button>';
        html += '</div></td></tr>';
      });
      html += '</tbody></table></div>';
      html += pagerFooter('reviewListSize', 'reviewPage', listSize, listPage, listPageCount, listStart, listEnd, rows.length, '快照');
      html += '<div class="px-space-lg py-2 text-label-sm text-on-surface-variant border-t border-surface-container-low">互动率 = 点赞 ÷ 阅读播放，涨粉率 = 涨粉 ÷ 阅读播放，均由页面实时计算，不写入表格。</div>';
    }
    html += '</div>';

    html += '</div>'; /* left */

    /* inspect panel */
    html += '<div class="col-span-12 xl:col-span-4 flex flex-col gap-space-md">';
    html += '<div class="soft-card overflow-hidden">';
    html += '<div class="flex items-center justify-between px-space-lg pt-space-lg pb-space-sm border-b border-surface-container-low"><div class="flex items-center gap-2"><span class="kicker-dot"></span><div><h3 class="text-headline-sm font-headline-sm text-on-surface">复盘单篇深度解构</h3><p class="text-label-sm text-on-surface-variant">选中作品的数据切片</p></div></div>';
    html += '<span class="material-symbols-outlined text-on-surface-variant text-lg">page_info</span></div>';
    if(!focusGroup){
      html += emptyState('还没有可复盘的作品', '先记一条数据快照', 'query_stats');
    } else {
      var lr = num(focusGroup.latest['阅读播放']), ll = num(focusGroup.latest['点赞']), lf = num(focusGroup.latest['涨粉']);
      html += '<div class="px-space-lg py-space-md">';
      html += '<div class="rounded-xl overflow-hidden relative mb-space-md"><img alt="作品封面" class="w-full h-32 object-cover" src="/assets/img-2.jpg">';
      html += '<span class="absolute top-2 left-2 chip chip-dark mono">' + esc(focusGroup.code) + '</span>';
      html += '<span class="absolute bottom-2 left-2 chip chip-honey">' + esc(focusGroup.stage) + '</span></div>';
      html += '<h4 class="text-headline-sm font-headline-sm text-on-surface leading-snug">' + esc(focusGroup.title) + '</h4>';
      html += '<p class="text-label-sm text-on-surface-variant mt-0.5">' + esc(platformText(focusGroup.platform)) + ' · ' + focusGroup.count + ' 批快照 · 最新 ' + esc(dayKey(focusGroup.latest['统计日期'])) + '</p>';
      html += '<div class="grid grid-cols-2 gap-2 mt-space-md">';
      html += '<div class="rounded-lg bg-surface-container-low p-2.5"><div class="text-label-sm text-on-surface-variant">赞粉比</div><div class="text-headline-sm font-headline-md text-on-surface mt-0.5">' + (lf ? (ll / lf).toFixed(1) : '—') + '</div><div class="text-[10px] text-on-surface-variant">点赞 ' + fmtNum(ll) + ' / 涨粉 ' + fmtNum(lf) + '</div></div>';
      html += '<div class="rounded-lg bg-surface-container-low p-2.5"><div class="text-label-sm text-on-surface-variant">互动率</div><div class="text-headline-sm font-headline-md text-[#785d00] mt-0.5">' + pct(ll, lr) + '</div><div class="text-[10px] text-on-surface-variant">阅读 ' + fmtNum(lr) + '</div></div>';
      html += '</div>';
      html += '<div class="mt-space-md"><div class="text-label-sm font-label-sm uppercase tracking-wide text-on-surface-variant mb-2">核心流量抓手总结</div><ol class="flex flex-col gap-1.5 text-label-sm text-on-surface-variant">';
      html += '<li class="flex gap-1.5"><span class="w-4 h-4 rounded-full bg-tertiary-fixed text-on-tertiary-fixed-variant flex items-center justify-center text-[9px] font-bold shrink-0">1</span><span>标题与平台「' + esc(platformText(focusGroup.platform)) + '」的受众匹配度决定了首波点击。</span></li>';
      html += '<li class="flex gap-1.5"><span class="w-4 h-4 rounded-full bg-secondary-fixed text-on-secondary-fixed-variant flex items-center justify-center text-[9px] font-bold shrink-0">2</span><span>互动率 ' + pct(ll, lr) + '，' + (ll / Math.max(1, lr) >= 0.05 ? '内容共鸣度高于基准，可复用叙事结构。' : '建议强化观点冲突与评论区引导。') + '</span></li>';
      html += '<li class="flex gap-1.5"><span class="w-4 h-4 rounded-full bg-[#DCF3E5] text-[#23583A] flex items-center justify-center text-[9px] font-bold shrink-0">3</span><span>发布以来累计涨粉 ' + fmtNum(focusGroup.snapshots.reduce(function(a,b){ return a + num(b['涨粉']); }, 0)) + '，可持续追踪 72 小时曲线。</span></li>';
      html += '</ol></div>';
      html += '<button class="mt-space-md w-full inline-flex items-center justify-center gap-1 px-4 py-2.5 rounded-full bg-primary text-on-primary text-label-md font-label-md shadow-sm hover:opacity-90" data-act="deriveTopic" data-code="' + esc(focusGroup.code) + '" type="button"><span class="material-symbols-outlined text-base">auto_awesome</span>一键派生下篇选题</button>';
      html += '</div>';
    }
    html += '</div>';
    html += audioCard();
    html += '</div></div>';
    html += '</div>';
    return html;
  }

  /* ---------- view: assets ---------- */
  function viewAssets(){
    var base = byPlatform(DATA.asset);
    var kw = state.assetKeyword;
    var rows = base.slice();
    if(kw !== 'all') rows = rows.filter(function(r){ return r['关键词'] && r['关键词'].indexOf(kw) >= 0; });
    if(state.q){
      var q = state.q.toLowerCase();
      rows = rows.filter(function(r){
        var hay = [r['标题'], r['成稿Markdown'], r['配图说明'], r['素材ID'], r['关联选题ID'], r['关联排期ID']].join(' ');
        if(r['关键词'] && r['关键词'].length) hay += ' ' + r['关键词'].join(' ');
        return hay.toLowerCase().indexOf(q) >= 0;
      });
    }
    rows.sort(function(a,b){
      var da = parseDate(a['归档日期']), db_ = parseDate(b['归档日期']);
      return (db_ ? db_.getTime() : 0) - (da ? da.getTime() : 0);
    });
    if(rows.length && !rows.some(function(r){ return r['_id'] === state.assetId; })) state.assetId = rows[0]['_id'];
    var selected = null;
    rows.forEach(function(r){ if(r['_id'] === state.assetId) selected = r; });

    var visualCount = base.filter(function(r){ return !!String(r['配图说明'] || '').trim(); }).length;
    var allKw = {};
    base.forEach(function(r){ (r['关键词'] || []).forEach(function(k){ allKw[k] = true; }); });
    var kwList = ASSET_TAGS.filter(function(k){ return allKw[k]; });
    Object.keys(allKw).forEach(function(k){ if(kwList.indexOf(k) < 0) kwList.push(k); });
    var totalWords = base.reduce(function(a,b){ return a + num(b['字数']); }, 0);
    var wordLabel = totalWords >= 1000 ? (totalWords / 1000).toFixed(1) + 'k' : fmtNum(totalWords);

    var html = '';
    html += '<div class="fade-in">';

    /* KPIs */
    html += '<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md mb-space-lg">';
    html += kpiPastel('lilac', '归档成稿总计', pad2(base.length), '素材库全量沉淀', '全览', 'assetKw', 'all');
    html += kpiPastel('sky', '视觉与配图规范', pad2(visualCount), '含配图说明的成稿', '图库', 'assetKw', '封面');
    html += kpiPastel('butter', '核心知识标签库', pad2(kwList.length), '可检索的关键词条目', '标签', 'assetKw', '标题');
    html += '<div class="relative overflow-hidden rounded-xl bg-primary-container p-space-lg flex flex-col justify-between shadow-sm">' +
      '<div class="flex items-center justify-between"><span class="text-label-md font-label-md text-on-primary-container tracking-wide uppercase">总字数知识沉淀</span>' +
      '<button class="px-3 py-1 rounded-full bg-secondary-container text-on-secondary-container text-label-sm font-label-sm shadow-sm hover:brightness-95" data-act="new" data-db="asset" type="button">归档成稿</button></div>' +
      '<div class="mt-space-md"><div class="text-display-lg font-display-lg text-white leading-none tracking-tight">' + wordLabel + '</div>' +
      '<p class="mt-2 text-label-sm text-on-primary-container">按已归档 Markdown 正文字数统计</p></div>' +
      '<div class="absolute -right-4 -bottom-4 w-20 h-20 bg-secondary-container/20 rounded-full blur-xl"></div></div>';
    html += '</div>';

    /* toolbar */
    html += '<div class="soft-card px-space-lg py-space-md mb-space-md">';
    html += '<div class="flex flex-wrap items-center gap-space-sm">';
    html += '<div class="flex items-center gap-1.5 shrink-0"><span class="kicker-dot"></span><span class="text-headline-sm font-headline-sm text-on-surface mr-1">成稿沉淀卡片</span></div>';
    html += '<div class="flex flex-wrap items-center gap-1.5 flex-1">';
    html += '<button class="px-3 py-1 rounded-full text-label-sm font-semibold ' + (kw === 'all' ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container') + '" data-act="assetKw" data-val="all" type="button">全部</button>';
    kwList.forEach(function(k){
      html += '<button class="px-3 py-1 rounded-full text-label-sm font-semibold ' + (kw === k ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container') + '" data-act="assetKw" data-val="' + esc(k) + '" type="button">#' + esc(k) + '</button>';
    });
    html += '</div>';
    html += '<div class="input-wrap w-[260px]"><span class="material-symbols-outlined">search</span><input id="qAsset" class="inp" placeholder="全文检索标题 / 正文 / 配图 / 关键词" value="' + esc(state.q) + '"></div>';
    html += '<button class="w-9 h-9 rounded-full bg-surface-container-low flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high" data-act="assetSort" type="button" title="按归档日期排序"><span class="material-symbols-outlined text-base">sort</span></button>';
    html += '<button class="inline-flex items-center gap-1.5 px-space-md py-2 bg-primary text-on-primary rounded-full text-label-sm font-semibold shadow-sm hover:opacity-90" data-act="new" data-db="asset" type="button"><span class="material-symbols-outlined text-base">add</span>归档一篇成稿</button>';
    html += '</div></div>';

    html += '<div class="grid grid-cols-12 gap-space-md items-start">';

    /* left list */
    html += '<div class="col-span-12 xl:col-span-5 flex flex-col gap-space-md min-w-0">';
    if(!rows.length){
      html += '<div class="soft-card">' + emptyState('还没有匹配的素材', '换个关键词，或归档一篇成稿', 'auto_stories') + '</div>';
    } else {
      html += '<div class="flex flex-col gap-space-sm">';
      rows.forEach(function(r){
        var md = String(r['成稿Markdown'] || '').replace(/^#+\s*/gm, '').replace(/\n+/g, ' ');
        var selCls = r['_id'] === state.assetId ? ' sel' : '';
        html += '<div class="asset-card soft-card p-space-md' + selCls + '" data-act="openAsset" data-id="' + esc(r['_id']) + '">';
        html += '<div class="flex items-center justify-between gap-2 mb-1.5"><div class="flex items-center gap-1.5"><span class="chip chip-line mono">' + esc(r['素材ID'] || '') + '</span>' + platformChip(r['平台']) + '</div><span class="text-label-sm text-on-surface-variant">' + esc(dayKey(r['归档日期']) || '') + '</span></div>';
        html += '<h3 class="text-body-md font-semibold text-on-surface leading-snug line-clamp-2 pr-4">' + esc(r['标题'] || '（未命名）') + '</h3>';
        html += '<p class="text-label-sm text-on-surface-variant mt-1 line-clamp-2 leading-relaxed">' + esc(truncate(md, 96)) + '</p>';
        html += '<div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2.5 pt-2.5 border-t border-surface-container-low text-label-sm text-on-surface-variant">';
        html += '<span class="inline-flex items-center gap-0.5"><span class="material-symbols-outlined text-[13px]">notes</span>' + fmtNum(r['字数']) + ' 字</span>';
        html += '<span class="inline-flex items-center gap-0.5"><span class="material-symbols-outlined text-[13px]">image</span>' + (r['配图说明'] ? '含配图规范' : '无配图') + '</span>';
        html += '<span class="inline-flex items-center gap-0.5"><span class="material-symbols-outlined text-[13px]">link</span>' + esc(r['关联选题ID'] || '—') + '</span>';
        html += '<div class="ml-auto flex items-center gap-1">';
        html += '<button class="w-7 h-7 rounded-full bg-surface-container-low hover:bg-surface-container-high flex items-center justify-center text-on-surface-variant" data-act="copyMd" data-id="' + esc(r['_id']) + '" type="button" title="复制 Markdown"><span class="material-symbols-outlined text-[15px]">content_copy</span></button>';
        html += '<button class="w-7 h-7 rounded-full bg-surface-container-low hover:bg-surface-container-high flex items-center justify-center text-on-surface-variant" data-act="openAsset" data-id="' + esc(r['_id']) + '" type="button" title="查看详情"><span class="material-symbols-outlined text-[15px]">arrow_forward</span></button>';
        html += '</div></div></div>';
      });
      html += '</div>';
    }

    /* history card */
    html += '<div class="soft-card p-space-lg">';
    html += '<div class="flex items-center justify-between mb-2"><h3 class="text-headline-sm font-headline-sm text-on-surface">最近归档</h3><span class="chip chip-line">' + base.length + ' 篇</span></div>';
    html += '<div class="flex flex-col divide-y divide-surface-container-low">';
    rows.slice(0, 4).forEach(function(r){
      html += '<button class="flex items-center justify-between gap-2 py-2 text-left group" data-act="openAsset" data-id="' + esc(r['_id']) + '" type="button"><span class="text-label-md text-on-surface truncate group-hover:text-[#785d00]">' + esc(r['标题'] || '（未命名）') + '</span><span class="text-label-sm text-on-surface-variant shrink-0">' + esc(dayKey(r['归档日期']).substring(5)) + '</span></button>';
    });
    if(!rows.length) html += '<span class="text-label-sm text-on-surface-variant py-2">暂无归档记录</span>';
    html += '</div></div>';
    html += '</div>';

    /* right detail */
    html += '<div class="col-span-12 xl:col-span-7 min-w-0">';
    html += '<div class="soft-card overflow-hidden">';
    if(!selected){
      html += emptyState('选择左侧一张成稿卡片', '这里会显示 Markdown 正文、配图说明与规范视口', 'article');
    } else {
      var docA = urlOf(selected['成稿文档链接']), docB = urlOf(selected['配图文档链接']), pub = urlOf(selected['发布链接']);
      var relatedCal = calendarByCode(selected['关联排期ID']);
      html += '<div class="px-space-lg pt-space-lg pb-space-sm border-b border-surface-container-low">';
      html += '<div class="flex flex-wrap items-start justify-between gap-2">';
      html += '<div class="min-w-0"><div class="flex items-center gap-2 mb-1"><span class="kicker-dot"></span><span class="text-label-sm font-label-sm uppercase tracking-wider text-on-surface-variant">成稿详情与规范视口</span><span class="chip chip-mint">已发布至生产环境</span></div>';
      html += '<h3 class="text-headline-md font-headline-md text-on-surface truncate">' + esc(selected['标题'] || '（未命名）') + '</h3>';
      html += '<p class="text-label-sm text-on-surface-variant mt-0.5">' + esc(selected['素材ID'] || '') + ' · 关联选题 ' + esc(selected['关联选题ID'] || '—') + ' · 关联排期 ' + esc(selected['关联排期ID'] || '—') + '</p></div>';
      html += '<div class="flex items-center gap-2 shrink-0">';
      html += '<button class="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-surface-container-low text-label-sm font-semibold text-on-surface hover:bg-surface-container-high" data-act="linkSchedule" data-id="' + esc(selected['_id']) + '" type="button"><span class="material-symbols-outlined text-base">calendar_month</span>关联排期</button>';
      html += '<button class="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary text-on-primary text-label-sm font-semibold hover:opacity-90" data-act="edit" data-db="asset" data-id="' + esc(selected['_id']) + '" type="button"><span class="material-symbols-outlined text-base">edit</span>编辑此素材</button>';
      html += '</div></div>';
      if(docA || docB || pub){
        html += '<div class="flex flex-wrap items-center gap-3 mt-2 text-label-sm">';
        if(docA) html += '<a class="link-arrow inline-flex items-center gap-0.5" href="' + esc(docA) + '" target="_blank" rel="noopener"><span class="material-symbols-outlined text-[13px]">description</span>成稿文档</a>';
        if(docB) html += '<a class="link-arrow inline-flex items-center gap-0.5" href="' + esc(docB) + '" target="_blank" rel="noopener"><span class="material-symbols-outlined text-[13px]">image</span>配图说明</a>';
        if(pub) html += '<a class="link-arrow inline-flex items-center gap-0.5" href="' + esc(pub) + '" target="_blank" rel="noopener"><span class="material-symbols-outlined text-[13px]">open_in_new</span>发布链接</a>';
        html += '</div>';
      }
      html += '</div>';

      html += '<div class="grid grid-cols-12 gap-space-md p-space-lg">';
      html += '<div class="col-span-12 lg:col-span-7">';
      html += '<div class="rounded-xl border border-surface-container-low bg-surface-container-lowest p-space-md max-h-[540px] overflow-y-auto">';
      html += '<div class="md-body">' + mdToHtml(selected['成稿Markdown']) + '</div>';
      html += '</div></div>';
      html += '<div class="col-span-12 lg:col-span-5 flex flex-col gap-space-md">';
      html += '<div class="rounded-xl border border-surface-container-low p-space-md">';
      html += '<div class="flex items-center justify-between mb-2"><h4 class="text-label-md font-label-md uppercase tracking-wide text-on-surface-variant">配图说明</h4><span class="chip chip-line">' + esc(selected['平台'] || '通用') + '</span></div>';
      html += '<img alt="配图预览" class="w-full h-28 object-cover rounded-lg mb-2" src="/assets/img-3.jpg">';
      html += '<div class="md-body text-[12px] line-clamp-3">' + mdToHtml(selected['配图说明']) + '</div>';
      html += '<div class="mt-2 pt-2 border-t border-surface-container-low text-label-sm text-on-surface-variant flex items-center justify-between"><span>构图：主体居中偏右</span><span>色板：#FFD975 / #E2DFFF</span></div>';
      html += '</div>';
      html += '<div class="rounded-xl border border-surface-container-low p-space-md">';
      html += '<div class="flex items-center justify-between mb-2"><h4 class="text-label-md font-label-md uppercase tracking-wide text-on-surface-variant">关联排期状态</h4><span class="material-symbols-outlined text-base text-on-surface-variant">timeline</span></div>';
      if(relatedCal){
        html += '<div class="flex items-center justify-between mb-1"><span class="mono text-[11px] text-on-surface-variant">' + esc(relatedCal['排期ID']) + '</span>' + quickSelect('calendar', relatedCal, '当前阶段', STAGES, stageClass(relatedCal['当前阶段'])) + '</div>';
        html += '<div class="text-label-sm text-on-surface-variant">' + esc(relatedCal['标题'] || '') + '</div>';
        html += '<div class="text-label-sm text-on-surface-variant">计划 ' + esc(fmtDateTime(relatedCal['计划发布时间'])) + '</div>';
      } else {
        html += '<p class="text-label-sm text-on-surface-variant">未关联排期，或排期已被删除。</p>';
      }
      html += '</div>';
      html += '<div class="rounded-xl bg-surface-container-low p-space-md">';
      html += '<div class="flex items-center justify-between mb-2"><span class="text-label-sm font-label-sm uppercase tracking-wide text-on-surface-variant">语音复盘</span><span class="text-label-sm text-on-surface-variant">00:46</span></div>';
      html += waveHtml();
      html += '</div>';
      html += '</div></div>';
    }
    html += '</div></div>';

    html += '</div></div>';
    return html;
  }

  /* ---------- markdown ---------- */
  function mdToHtml(md){
    if(!md) return '<p style="color:var(--muted)">暂无内容</p>';
    var text = esc(md);
    var codeBlocks = [];
    text = text.replace(/```([\s\S]*?)```/g, function(_, body){
      codeBlocks.push('<pre><code>' + body.replace(/^\n/, '') + '</code></pre>');
      return '\n@@CODE' + (codeBlocks.length - 1) + '@@\n';
    });
    var blocks = text.split(/\n{2,}/);
    var out = '';
    blocks.forEach(function(block){
      var b = block.trim();
      if(!b) return;
      if(/^@@CODE\d+@@$/.test(b)){
        out += codeBlocks[parseInt(b.match(/\d+/)[0], 10)];
        return;
      }
      if(/^###\s/.test(b)){ out += '<h3>' + inline(b.replace(/^###\s/, '')) + '</h3>'; return; }
      if(/^##\s/.test(b)){ out += '<h2>' + inline(b.replace(/^##\s/, '')) + '</h2>'; return; }
      if(/^#\s/.test(b)){ out += '<h1>' + inline(b.replace(/^#\s/, '')) + '</h1>'; return; }
      if(/^&gt;\s?/.test(b)){
        out += '<blockquote><p>' + inline(b.replace(/^&gt;\s?/gm, '')) + '</p></blockquote>';
        return;
      }
      if(/^[-*]\s/.test(b)){
        var items = b.split('\n').filter(function(l){ return /^[-*]\s/.test(l.trim()); });
        out += '<ul>' + items.map(function(l){ return '<li>' + inline(l.trim().replace(/^[-*]\s/, '')) + '</li>'; }).join('') + '</ul>';
        return;
      }
      if(/^\d+\.\s/.test(b)){
        var oitems = b.split('\n').filter(function(l){ return /^\d+\.\s/.test(l.trim()); });
        out += '<ol>' + oitems.map(function(l){ return '<li>' + inline(l.trim().replace(/^\d+\.\s/, '')) + '</li>'; }).join('') + '</ol>';
        return;
      }
      out += '<p>' + inline(b.replace(/\n/g, '<br>')) + '</p>';
    });
    return out || '<p style="color:var(--muted)">暂无内容</p>';
  }
  function inline(s){
    return s
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }

  /* ---------- 连接设置 ---------- */
  var connData = null; // 连接设置一览（来自 /api/connections），null 表示尚未加载

  function loadConnections(){
    request('/connections').then(function(d){
      connData = d;
      if(state.view === 'connections') render();
    }).catch(function(err){
      toast('连接配置加载失败：' + err.message, 'err');
    });
  }

  var CONN_ICON = {
    '公众号':'chat', '小红书':'auto_stories', '视频号':'play_circle', '抖音':'music_note',
    'B站':'smart_display', '知乎':'forum', '微博':'public', '快手':'videocam'
  };
  var CONN_TINT = {
    '公众号':'bg-[#DCF3E5] text-[#23583A]', '小红书':'bg-[#FCE3DD] text-[#8E3B26]',
    '视频号':'bg-[#D5EAF7] text-[#2C495E]', '抖音':'bg-[#E2DFFF] text-[#444465]',
    'B站':'bg-[#D5EAF7] text-[#2C495E]', '知乎':'bg-[#E2DFFF] text-[#444465]',
    '微博':'bg-[#FFDF91] text-[#594400]', '快手':'bg-[#FFE3D3] text-[#8A3B0F]'
  };
  var CONN_MODE = {
    official: { label:'官方接口', cls:'chip-mint' },
    cookie:   { label:'Cookie 兜底', cls:'chip-honey' },
    custom:   { label:'自定义', cls:'chip-line' }
  };

  function viewConnections(){
    if(!connData){
      loadConnections();
      return '<div class="flex items-center gap-space-sm text-on-surface-variant"><span class="material-symbols-outlined animate-spin">progress_activity</span> 正在加载各渠道连接配置…</div>';
    }
    var d = connData;
    var platforms = d.platforms.filter(function(p){
      return state.platform === 'all' || state.platform === p;
    });
    var enabledCount = d.platforms.filter(function(p){
      return d.connections[p] && d.connections[p].enabled;
    }).length;
    var officialCount = d.platforms.filter(function(p){ return d.defs[p].apiMode === 'official'; }).length;
    var cookieCount = d.platforms.filter(function(p){ return d.defs[p].apiMode === 'cookie'; }).length;
    var html = '';
    html += '<div class="flex items-end justify-between mb-space-lg gap-space-md flex-wrap">'
      + '<div><h2 class="text-headline-md font-headline-md text-on-surface">连接设置</h2>'
      + '<p class="text-label-sm text-on-surface-variant mt-1">为各渠道配置连接凭证，打通官方接口或 Cookie 兜底，让数据自动回流到工作台。</p></div>'
      + '<button class="flex items-center gap-1 px-space-md py-2 rounded-full bg-surface-container-lowest text-label-md font-label-md text-on-surface hover:bg-surface-container-high transition-colors" data-act="connReload" type="button"><span class="material-symbols-outlined text-base">refresh</span>刷新</button>'
      + '</div>';

    // 概览 + 安全提示
    html += '<div class="rounded-2xl bg-surface-container-lowest border border-surface-container shadow-sm p-space-md mb-space-lg flex items-center justify-between gap-space-md flex-wrap">'
      + '<div class="flex items-center gap-3 min-w-0">'
      + '<span class="w-10 h-10 rounded-2xl bg-[#E2DFFF] text-[#444465] flex items-center justify-center shrink-0"><span class="material-symbols-outlined text-xl">shield_lock</span></span>'
      + '<div class="min-w-0"><p class="text-label-md font-label-md text-on-surface">凭证只保存在本机，读取时自动掩码</p>'
      + '<p class="text-label-sm text-on-surface-variant">配置文件 data/channel-connections.json；密钥不会回传明文，留空保存即保持原值。</p></div></div>'
      + '<div class="flex items-center gap-2 flex-wrap">'
      + '<span class="chip chip-mint">已启用 ' + enabledCount + ' / ' + d.platforms.length + '</span>'
      + '<span class="chip chip-line">官方接口 ' + officialCount + '</span>'
      + '<span class="chip chip-honey">Cookie 兜底 ' + cookieCount + '</span>'
      + '</div></div>';

    if(!platforms.length){
      html += '<div class="rounded-2xl bg-surface-container-lowest border border-dashed border-outline-variant p-space-xl text-center text-on-surface-variant">当前筛选下没有渠道，切换右上角「全部平台」查看。</div>';
      return html;
    }

    html += '<div class="grid grid-cols-1 xl:grid-cols-2 gap-space-md">';
    platforms.forEach(function(p){ html += connCard(p, d); });
    html += '</div>';
    return html;
  }

  function connCard(p, d){
    var def = d.defs[p];
    var conn = d.connections[p] || { enabled:false, fields:{}, updatedAt:null };
    var enabled = conn.enabled === true;
    var mode = CONN_MODE[def.apiMode] || CONN_MODE.custom;
    var required = def.fields.filter(function(f){ return !f.optional; });
    var filled = required.filter(function(f){
      var fv = conn.fields[f.key];
      return fv && fv.hasValue;
    }).length;
    var complete = filled === required.length;
    var savedAt = conn.updatedAt ? '更新于 ' + esc(fmtDateTime(conn.updatedAt)) : '尚未配置';
    var modeChip = def.docs
      ? '<a class="chip ' + mode.cls + ' hover:opacity-90 transition-opacity" href="' + esc(def.docs) + '" target="_blank" rel="noopener" title="打开官方文档 / 数据入口">' + mode.label + '<span class="material-symbols-outlined text-[12px]">open_in_new</span></a>'
      : '<span class="chip ' + mode.cls + '">' + mode.label + '</span>';
    var html = '';
    html += '<div class="rounded-2xl bg-surface-container-lowest border border-surface-container shadow-sm p-space-lg flex flex-col gap-space-md">';
    // 头部：图标 + 平台 + 模式 + 启用开关
    html += '<div class="flex items-start justify-between gap-3">';
    html += '<div class="flex items-center gap-3 min-w-0">'
      + '<span class="w-11 h-11 rounded-2xl ' + (CONN_TINT[p] || 'bg-[#F2F3F6] text-[#44474A]') + ' flex items-center justify-center shrink-0"><span class="material-symbols-outlined text-xl">' + (CONN_ICON[p] || 'hub') + '</span></span>'
      + '<div class="min-w-0"><div class="flex items-center gap-2 flex-wrap">'
      + platformChip(p)
      + modeChip
      + (enabled ? '<span class="chip chip-mint">已启用</span>' : '<span class="chip chip-line">未启用</span>')
      + '</div>'
      + (def.docs ? '' : '<p class="text-label-sm text-on-surface-variant mt-1">本地自定义配置</p>') + '</div></div>';
    html += '<button class="shrink-0 px-3 py-1.5 rounded-full text-label-sm font-label-sm ' + (enabled ? 'bg-surface-container-low text-on-surface hover:bg-surface-container-high' : 'bg-primary text-on-primary hover:opacity-90') + '" data-act="connToggle" data-platform="' + esc(p) + '" type="button">' + (enabled ? '停用' : '启用') + '</button>';
    html += '</div>';
    // 接口说明
    html += '<p class="text-label-sm text-on-surface-variant leading-relaxed">' + esc(def.note) + '</p>';
    // 一键登录（Cookie 渠道）
    if(def.login && def.login.available){
      html += '<div class="flex items-center gap-2 flex-wrap">'
        + '<button class="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-surface-container-low text-label-md font-label-md text-on-surface hover:bg-surface-container-high transition-colors" data-act="connLogin" data-platform="' + esc(p) + '" type="button"><span class="material-symbols-outlined text-base">login</span>一键登录获取 Cookie</button>'
        + '<span class="text-label-sm text-on-surface-variant">打开独立浏览器窗口，登录成功后自动回填并保存</span>'
        + '</div>';
    }
    // 字段
    html += '<div class="flex flex-col gap-space-sm">';
    def.fields.forEach(function(f){
      var fv = conn.fields[f.key] || { value:'', hasValue:false };
      var ph = f.secret
        ? (fv.hasValue ? '已配置 · 留空则保持不变' : '请输入密钥')
        : (f.optional ? '选填' : '请输入');
      var shown = f.secret ? '' : fv.value;
      html += '<div class="fld" style="margin-bottom:0">'
        + '<label class="lab">' + esc(f.key)
        + (f.optional ? ' <span class="text-on-surface-variant text-[11px] normal-case tracking-normal">（选填）</span>' : '')
        + (f.secret ? ' <span class="text-on-surface-variant text-[11px] normal-case tracking-normal">（密钥）</span>' : '')
        + (f.secret && fv.hasValue ? '<span class="ml-auto inline-flex items-center gap-1"><span class="chip chip-mint">已保存</span><button class="chip chip-line hover:bg-[#FCE3DD] hover:text-[#8E3B26]" data-act="connClear" data-platform="' + esc(p) + '" data-key="' + esc(f.key) + '" type="button">清除</button></span>' : '')
        + '</label>'
        + '<input class="inp" type="' + (f.secret ? 'password' : 'text') + '" data-conn-field="1" data-platform="' + esc(p) + '" data-key="' + esc(f.key) + '" data-secret="' + (f.secret ? '1' : '0') + '" data-has="' + (fv.hasValue ? '1' : '0') + '" value="' + esc(shown) + '" placeholder="' + esc(ph) + '" autocomplete="off" spellcheck="false">'
        + '</div>';
    });
    html += '</div>';
    // 测试结果行
    html += '<p class="text-label-sm text-on-surface-variant hidden" data-conn-msg="' + esc(p) + '"></p>';
    // 底部操作
    html += '<div class="flex items-center justify-between gap-2 pt-space-sm border-t border-surface-container mt-auto">';
    html += '<div class="min-w-0"><p class="text-label-sm text-on-surface-variant truncate">' + savedAt + '</p>'
      + '<p class="text-label-sm ' + (complete ? 'text-[#1B6F43]' : 'text-[#9A3B3B]') + '">' + (complete ? '必填项已填写' : '待填写 ' + (required.length - filled) + ' 项必填') + '</p></div>';
    html += '<div class="flex items-center gap-2 shrink-0">';
    html += '<button class="px-4 py-2 rounded-full bg-surface-container-low text-label-md font-label-md text-on-surface hover:bg-surface-container-high transition-colors" data-act="connTest" data-platform="' + esc(p) + '" type="button">测试连接</button>';
    html += '<button class="inline-flex items-center gap-1 px-5 py-2 rounded-full bg-primary text-on-primary text-label-md font-label-md shadow-sm hover:opacity-90 transition-all" data-act="connSave" data-platform="' + esc(p) + '" type="button"><span class="material-symbols-outlined text-base">save</span>保存</button>';
    html += '</div></div>';
    html += '</div>';
    return html;
  }

  function connCollect(platform){
    var inputs = document.querySelectorAll('#view input[data-conn-field="1"][data-platform="' + (platform) + '"]');
    var fields = {};
    for(var i = 0; i < inputs.length; i++){
      var el = inputs[i];
      var key = el.getAttribute('data-key');
      var secret = el.getAttribute('data-secret') === '1';
      var has = el.getAttribute('data-has') === '1';
      var val = el.value;
      if(secret){
        // 密钥输入框不回显：空值表示保留原值，输入新值则覆盖
        fields[key] = val !== '' ? val : (has ? '__KEEP_EXISTING__' : '');
      } else {
        fields[key] = val;
      }
    }
    return fields;
  }

  function connEnabled(platform){
    if(connData && connData.connections[platform]) return connData.connections[platform].enabled === true;
    var btn = document.querySelector('button[data-act="connToggle"][data-platform="' + platform + '"]');
    return btn ? btn.textContent.trim() === '停用' : false;
  }

  function connSave(platform){
    var fields = connCollect(platform);
    var enabled = connEnabled(platform);
    request('/connections/' + encodeURIComponent(platform), {
      method: 'PUT',
      body: JSON.stringify({ enabled: enabled, fields: fields })
    }).then(function(resp){
      connData = null;
      loadConnections();
      toast(platform + ' 连接信息已保存', 'ok');
    }).catch(function(err){
      toast('保存失败：' + err.message, 'err');
    });
  }

  function connTest(platform){
    var fields = connCollect(platform);
    var btn = document.querySelector('#view button[data-act="connTest"][data-platform="' + platform + '"]');
    var msg = document.querySelector('#view [data-conn-msg="' + platform + '"]');
    if(btn){ btn.disabled = true; btn.textContent = '测试中…'; }
    if(msg){ msg.className = 'text-label-sm text-on-surface-variant'; msg.textContent = '正在校验凭证…'; }
    request('/connections/' + encodeURIComponent(platform) + '/test', {
      method: 'POST',
      body: JSON.stringify({ fields: fields })
    }).then(function(resp){
      var text = resp.message || (resp.ok ? '连接正常' : '连接失败');
      if(msg){
        msg.className = 'text-label-sm ' + (resp.ok ? 'text-[#1B6F43]' : 'text-[#9A3B3B]');
        msg.textContent = (resp.ok ? '✓ ' : '✕ ') + text;
      }
      toast(platform + '：' + text, resp.ok ? 'ok' : 'err');
    }).catch(function(err){
      if(msg){ msg.className = 'text-label-sm text-[#9A3B3B]'; msg.textContent = '✕ ' + err.message; }
      toast('测试失败：' + err.message, 'err');
    }).finally(function(){
      if(btn){ btn.disabled = false; btn.textContent = '测试连接'; }
    });
  }

  var loginPollTimer = null;

  function connLogin(platform){
    var btn = document.querySelector('#view button[data-act="connLogin"][data-platform="' + platform + '"]');
    var msg = document.querySelector('#view [data-conn-msg="' + platform + '"]');
    if(btn){ btn.disabled = true; btn.innerHTML = '<span class="material-symbols-outlined text-base animate-spin">progress_activity</span>等待登录…'; }
    if(msg){ msg.className = 'text-label-sm text-on-surface-variant'; msg.textContent = '正在启动本地浏览器窗口…'; }
    request('/connections/' + encodeURIComponent(platform) + '/login', { method: 'POST', body: '{}' })
      .then(function(resp){
        if(msg && resp.login && resp.login.message){ msg.textContent = resp.login.message; }
        pollConnLogin(platform, btn, msg);
      })
      .catch(function(err){
        if(btn){ btn.disabled = false; btn.innerHTML = '<span class="material-symbols-outlined text-base">login</span>一键登录获取 Cookie'; }
        if(msg){ msg.className = 'text-label-sm text-[#9A3B3B]'; msg.textContent = '✕ ' + err.message; }
        toast('启动登录窗口失败：' + err.message, 'err');
      });
  }

  function pollConnLogin(platform, btn, msg){
    if(loginPollTimer){ clearInterval(loginPollTimer); loginPollTimer = null; }
    var started = Date.now();
    function stop(){ if(loginPollTimer){ clearInterval(loginPollTimer); loginPollTimer = null; } }
    function restore(){
      if(btn && document.body.contains(btn)){
        btn.disabled = false;
        btn.innerHTML = '<span class="material-symbols-outlined text-base">login</span>一键登录获取 Cookie';
      }
    }
    loginPollTimer = setInterval(function(){
      request('/connections/' + encodeURIComponent(platform) + '/login/status').then(function(st){
        if(!st) return;
        if(st.status === 'success'){
          stop(); restore();
          if(msg){ msg.className = 'text-label-sm text-[#1B6F43]'; msg.textContent = '✓ ' + (st.message || '登录成功，Cookie 已自动保存'); }
          toast(platform + ' 登录成功，Cookie 已自动保存', 'ok');
          connData = null;
          loadConnections();
          return;
        }
        if(st.status === 'error' || st.status === 'cancelled' || st.status === 'idle'){
          stop(); restore();
          var failText = st.message || (st.status === 'cancelled' ? '已取消登录' : '登录窗口已关闭');
          if(msg){ msg.className = 'text-label-sm text-[#9A3B3B]'; msg.textContent = '✕ ' + failText; }
          if(st.status !== 'idle' || st.message) toast(platform + '：' + failText, 'err');
          return;
        }
        if(msg){
          msg.className = 'text-label-sm text-on-surface-variant';
          msg.textContent = st.message || '请在弹出的浏览器窗口完成登录…';
        }
        if(Date.now() - started > 6 * 60 * 1000){
          stop(); restore();
          if(msg){ msg.className = 'text-label-sm text-[#9A3B3B]'; msg.textContent = '✕ 等待登录超时，请重新点击'; }
        }
      }).catch(function(){
        // 瞬时失败继续轮询
      });
    }, 1000);
  }

  function connClear(platform, key){
    var fields = connCollect(platform);
    fields[key] = '';
    var enabled = connEnabled(platform);
    request('/connections/' + encodeURIComponent(platform), {
      method: 'PUT',
      body: JSON.stringify({ enabled: enabled, fields: fields })
    }).then(function(){
      connData = null;
      loadConnections();
      toast(platform + ' 的 ' + key + ' 已清除', 'ok');
    }).catch(function(err){
      toast('清除失败：' + err.message, 'err');
    });
  }

  function connToggle(platform){
    var enabled = connEnabled(platform);
    // 切换开关即保存当前字段 + 新启用状态
    var fields = connCollect(platform);
    request('/connections/' + encodeURIComponent(platform), {
      method: 'PUT',
      body: JSON.stringify({ enabled: !enabled, fields: fields })
    }).then(function(){
      connData = null;
      loadConnections();
      toast(platform + (enabled ? ' 已停用' : ' 已启用'), 'ok');
    }).catch(function(err){
      toast('操作失败：' + err.message, 'err');
    });
  }

  /* ---------- 发布中心 ---------- */
  function pubTaskById(id){
    var found = null;
    PUB.tasks.forEach(function(t){ if(t._id === id) found = t; });
    return found;
  }
  function pubPlatformSupported(p){
    var list = (PUB.status && PUB.status.platforms) || [];
    if(!list.length) return p === '抖音';
    return list.some(function(x){ return x.platform === p; });
  }
  function pubKindOf(rec){
    var f = rec && rec['内容形式'];
    if(f === '短视频') return 'video';
    if(f === '图文' || f === '长图') return 'image';
    return null;
  }
  function pubActivePlatforms(){
    var map = {};
    PUB.tasks.forEach(function(t){
      if(['failed','canceled'].indexOf(t.status) < 0) map[t.scheduleCode + '|' + t.platform] = true;
    });
    return map;
  }
  function pubPlatformOptions(rec){
    if(!rec) return [];
    var active = pubActivePlatforms();
    return platformList(rec['平台']).filter(function(p){
      return pubPlatformSupported(p) && !active[rec['排期ID'] + '|' + p];
    });
  }
  function pubScheduleReady(r){
    return !!r && r['当前阶段'] === '待发布' && !!pubKindOf(r) && platformList(r['平台']).some(pubPlatformSupported);
  }
  function pubStatusChip(t){
    var cls = {
      scheduled:'chip-sky', running:'chip-honey', needs_confirm:'chip-coral',
      submitted:'chip-lilac', published:'chip-mint', failed:'chip-coral', canceled:'chip-line'
    }[t.status] || 'chip-line';
    var icon = t.status === 'running' ? '<span class="material-symbols-outlined text-[13px] animate-spin">progress_activity</span>' : '';
    return '<span class="chip ' + cls + '">' + icon + esc(t.statusLabel || t.status) + '</span>';
  }
  function pubWhenOf(rec){
    var d = parseDate(rec && rec['计划发布时间']);
    if(!d || d.getTime() < Date.now()) d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function pubTimeRange(t){
    if(!t.startedAt) return '尚未执行';
    var s = fmtDateTime(t.startedAt);
    return t.finishedAt ? s + ' → ' + fmtDateTime(t.finishedAt) : s + ' → 进行中';
  }
  function pubSchedulesForCreate(){
    var rows = DATA.calendar.filter(function(r){
      if(!pubScheduleReady(r)) return false;
      if(!pubPlatformOptions(r).length) return false;
      return true;
    });
    rows.sort(function(a, b){
      var da = parseDate(a['计划发布时间']), db = parseDate(b['计划发布时间']);
      if(da && db && da - db !== 0) return da - db;
      return String(a['排期ID'] || '').localeCompare(String(b['排期ID'] || ''));
    });
    return rows;
  }
  function autoQueuePublish(rec){
    if(!rec || !rec['排期ID']) return Promise.resolve(null);
    return request('/publish/auto-queue', {
      method: 'POST',
      body: JSON.stringify({ scheduleCode: rec['排期ID'] })
    }).then(function(res){
      var r = res && res.result;
      if(!r) return null;
      if(r.created.length){
        toast('已自动排入 ' + r.created.length + ' 条发布任务', 'ok');
        loadPublishData().catch(function(){ /* 下次进入发布中心再刷新 */ });
      } else if(rec['当前阶段'] === '待发布' && r.skipped.length){
        var hasTask = r.skipped.some(function(s){ return /^已有发布任务/.test(s.reason); });
        if(!hasTask) toast('未自动排入发布任务：' + r.skipped[0].reason);
      }
      return r;
    }).catch(function(){ return null; });
  }

  function scanPendingSchedules(){
    request('/publish/auto-queue', {
      method: 'POST',
      body: JSON.stringify({ all: true })
    }).then(function(res){
      var r = (res && res.result) || { scanned: 0, created: [], skipped: [] };
      return loadPublishData().then(function(){
        render();
        if(r.created.length){
          toast('已自动排入 ' + r.created.length + ' 条发布任务', 'ok');
        } else if(!r.scanned){
          toast('没有「待发布」阶段的排期');
        } else {
          toast('没有可自动排入的排期：' + (r.skipped[0] ? r.skipped[0].reason : '条件不满足'));
        }
      });
    }).catch(function(err){
      toast('扫描失败：' + errMsg(err), 'err');
    });
  }

  function armPublishPoll(){
    clearTimeout(PUB.timer);
    PUB.timer = null;
    if(PUB.watch){
      var watched = pubTaskById(PUB.watch.id);
      if(!watched || ['published','failed','needs_confirm','submitted','canceled'].indexOf(watched.status) >= 0 || Date.now() > PUB.watch.until){
        PUB.watch = null;
      }
    }
    var running = PUB.tasks.some(function(t){ return t.status === 'running'; });
    if(!running && !PUB.watch) return;
    var detailOpen = $('publishModal').classList.contains('on') && PUB.mode === 'detail';
    if(state.view !== 'publish' && !detailOpen) return;
    PUB.timer = setTimeout(function(){
      loadPublishData().then(function(){
        return loadTable('calendar').catch(function(){ /* 日历刷新失败不影响队列 */ });
      }).then(function(){
        render();
        if(detailOpen && PUB.detailId){
          var t = pubTaskById(PUB.detailId);
          if(t) openPublishDetail(t);
        }
      }).catch(function(){ /* 轮询失败下次再试 */ });
    }, 4000);
  }

  function viewPublish(){
    var tasks = PUB.tasks;
    var counts = { scheduled:0, running:0, needs_confirm:0, submitted:0, published:0, failed:0, canceled:0 };
    tasks.forEach(function(t){ if(counts[t.status] != null) counts[t.status]++; });
    var st = PUB.status || {};
    var running = st.running;

    var html = '';
    html += '<div class="fade-in">';

    html += '<div class="soft-card px-space-lg py-space-md mb-space-lg flex flex-wrap items-center justify-between gap-space-md">';
    html += '<div class="min-w-0"><div class="flex items-center gap-2 mb-1"><span class="kicker-dot"></span><span class="text-label-sm font-label-sm uppercase tracking-wider text-on-surface-variant">Publish Center</span></div>';
    html += '<h2 class="text-headline-md font-headline-md text-on-surface">发布中心</h2>';
    html += '<p class="text-label-sm text-on-surface-variant mt-1">' + (running ? ('正在执行「' + esc(running.title) + '」（' + esc(running.code) + '）') : '队列空闲 · 每 30 秒巡检一次到点任务') + '</p></div>';
    html += '<div class="flex items-center gap-space-sm flex-wrap">';
    html += '<span class="chip ' + (st.scheduler ? 'chip-mint' : 'chip-line') + '">' + (st.scheduler ? '调度器运行中' : '调度器未启动') + '</span>';
    ((st.platforms) || []).forEach(function(p){
      html += '<span class="chip chip-line">' + esc(p.platform) + ' 已接入</span>';
    });
    html += '<button class="w-9 h-9 rounded-full bg-surface-container-low text-on-surface flex items-center justify-center hover:bg-surface-container-high transition-colors" data-act="pubReload" type="button" title="刷新"><span class="material-symbols-outlined text-base">refresh</span></button>';
    html += '<button class="inline-flex items-center gap-1.5 px-space-md py-2 bg-surface-container-low text-on-surface rounded-full text-label-md font-label-md hover:bg-surface-container-high transition-all" data-act="pubAutoQueueAll" type="button"><span class="material-symbols-outlined text-base">playlist_add_check</span>扫描待发布排期</button>';
    html += '<button class="inline-flex items-center gap-1.5 px-space-md py-2 bg-primary text-on-primary rounded-full text-label-md font-label-md shadow-sm hover:opacity-90 transition-all" data-act="pubNew" type="button"><span class="material-symbols-outlined text-base">add</span>新建发布任务</button>';
    html += '</div></div>';

    html += '<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md mb-space-lg">';
    html += kpiPastel('sky', '已排程', pad2(counts.scheduled), '到点后由调度器自动执行');
    html += kpiPastel('butter', '进行中', pad2(counts.running), '同一时间只执行一条任务');
    html += kpiPastel('lilac', '待人工确认', pad2(counts.needs_confirm), '浏览器已填好表单，等你点发布');
    html += kpiPastel('mint', '已发布', pad2(counts.published + counts.submitted), '含待核验 ' + counts.submitted + ' 条 · 失败 ' + counts.failed + ' 条');
    html += '</div>';

    html += '<div class="grid grid-cols-12 gap-space-md items-start">';
    html += '<div class="col-span-12 xl:col-span-8">';
    html += '<div class="soft-card overflow-hidden">';
    html += '<div class="flex items-center justify-between px-space-lg pt-space-lg pb-space-sm"><div><h3 class="text-headline-sm font-headline-sm text-on-surface">发布任务队列</h3><p class="text-label-sm text-on-surface-variant">' + tasks.length + ' 条任务 · 按创建时间倒序</p></div>';
    html += '<span class="chip chip-line">' + (running ? '执行中' : '空闲') + '</span></div>';
    if(!tasks.length){
      html += emptyState('还没有发布任务', '在内容日历里把排期推进到「待发布」，点「准备发布」即可排入队列', 'send');
    } else {
      html += '<div class="overflow-x-auto"><table class="w-full text-[12px]"><thead><tr class="text-label-sm text-on-surface-variant bg-surface-container-low/60">';
      html += '<th class="text-left font-semibold py-2.5 pl-4 pr-2 whitespace-nowrap">任务 / 内容</th>';
      html += '<th class="text-left font-semibold py-2.5 px-2 whitespace-nowrap">平台 / 方式</th>';
      html += '<th class="text-left font-semibold py-2.5 px-2 whitespace-nowrap">计划执行</th>';
      html += '<th class="text-left font-semibold py-2.5 px-2 whitespace-nowrap">状态</th>';
      html += '<th class="text-left font-semibold py-2.5 px-2 whitespace-nowrap">发布素材</th>';
      html += '<th class="text-right font-semibold py-2.5 pr-4 pl-2 whitespace-nowrap">操作</th>';
      html += '</tr></thead><tbody class="divide-y divide-surface-container-low">';
      tasks.forEach(function(t){
        var id = esc(t._id);
        html += '<tr class="row-hover">';
        html += '<td class="py-3 pl-4 pr-2 min-w-[200px]"><div class="mono text-[10.5px] font-semibold text-on-surface-variant">' + esc(t.code) + '</div>';
        html += '<button class="font-semibold text-on-surface truncate max-w-[280px] text-left hover:text-[#785d00]" data-act="pubDetail" data-id="' + id + '" type="button" title="查看详情">' + esc(t.title || '（未命名）') + '</button>';
        html += '<div class="text-label-sm text-on-surface-variant">' + esc(t.scheduleCode) + (t.error ? ' · <span class="text-[#8E3B26]">' + esc(truncate(t.error, 30)) + '</span>' : '') + '</div></td>';
        html += '<td class="py-3 px-2 whitespace-nowrap">' + platformChip(t.platform) + '<div class="text-label-sm text-on-surface-variant mt-1">' + (t.mode === 'auto' ? '全自动' : '人工确认') + '</div></td>';
        html += '<td class="py-3 px-2 whitespace-nowrap"><div>' + esc(fmtDateTime(t.scheduledAt)) + '</div><div class="text-label-sm text-on-surface-variant">' + esc(t.attempts ? '已尝试 ' + t.attempts + ' 次' : '未执行') + '</div></td>';
        html += '<td class="py-3 px-2 whitespace-nowrap">' + pubStatusChip(t) + '</td>';
        var mediaItems = t.media || [];
        var mediaName = '—';
        var mediaMeta = '';
        if(mediaItems.length){
          if(mediaItems[0].kind === 'image'){
            mediaName = mediaItems.length + ' 张图片';
            mediaMeta = fmtBytes(mediaItems.reduce(function(sum, m){ return sum + (m.sizeBytes || 0); }, 0));
          } else {
            mediaName = mediaItems[0].name;
            mediaMeta = (mediaItems[0].durationSec ? fmtDuration(mediaItems[0].durationSec) + ' · ' : '') + fmtBytes(mediaItems[0].sizeBytes || 0);
          }
        }
        html += '<td class="py-3 px-2 whitespace-nowrap"><div class="max-w-[160px] truncate" title="' + esc(mediaName) + '">' + esc(mediaName) + '</div><div class="text-label-sm text-on-surface-variant">' + esc(mediaMeta) + '</div></td>';
        html += '<td class="py-3 pr-4 pl-2 whitespace-nowrap"><div class="flex items-center justify-end gap-1">';
        if(t.status === 'scheduled') html += '<button class="px-2.5 py-1 rounded-full bg-primary text-on-primary text-[10px] font-semibold hover:opacity-90" data-act="pubRun" data-id="' + id + '" type="button">立即执行</button>';
        if(t.status === 'failed' || t.status === 'canceled') html += '<button class="px-2.5 py-1 rounded-full bg-secondary-fixed text-[10px] font-semibold text-on-secondary-fixed-variant hover:brightness-95" data-act="pubRetry" data-id="' + id + '" type="button">重试</button>';
        if(t.status === 'needs_confirm' || t.status === 'submitted') html += '<button class="px-2.5 py-1 rounded-full bg-secondary-fixed text-[10px] font-semibold text-on-secondary-fixed-variant hover:brightness-95" data-act="pubDetail" data-id="' + id + '" type="button">去确认</button>';
        html += '<button class="px-2.5 py-1 rounded-full bg-surface-container-low text-[10px] font-semibold text-on-surface hover:bg-surface-container-high" data-act="pubDetail" data-id="' + id + '" type="button">详情</button>';
        html += '</div></td></tr>';
      });
      html += '</tbody></table></div>';
    }
    html += '</div></div>';

    html += '<div class="col-span-12 xl:col-span-4 flex flex-col gap-space-md">';
    if(counts.needs_confirm){
      html += '<div class="soft-card border-l-4 border-[#8e3b26] p-space-lg">';
      html += '<div class="flex items-center justify-between mb-2"><h3 class="text-headline-sm font-headline-sm text-on-surface flex items-center gap-2"><span class="material-symbols-outlined text-lg" style="color:#8e3b26">fact_check</span>等待人工确认</h3><span class="chip chip-coral">' + counts.needs_confirm + ' 条</span></div>';
      html += '<p class="text-label-sm text-on-surface-variant mb-2">表单已填好，请在浏览器窗口点击「发布」，完成后回到这里标记已发布。</p>';
      html += '<div class="flex flex-col gap-1.5">';
      tasks.filter(function(t){ return t.status === 'needs_confirm'; }).slice(0, 4).forEach(function(t){
        html += '<div class="flex items-center justify-between gap-2"><div class="min-w-0"><div class="text-body-sm font-medium truncate">' + esc(t.title) + '</div><div class="text-label-sm text-on-surface-variant">' + esc(t.code) + ' · ' + esc(t.platform) + '</div></div>';
        html += '<button class="px-3 py-1 rounded-full bg-secondary-fixed text-label-sm font-semibold text-on-secondary-fixed-variant shrink-0" data-act="pubDetail" data-id="' + esc(t._id) + '" type="button">去确认</button></div>';
      });
      html += '</div></div>';
    }
    html += '<div class="soft-card p-space-lg">';
    html += '<h3 class="text-headline-sm font-headline-sm text-on-surface mb-2">执行说明</h3>';
    html += '<ul class="text-label-sm text-on-surface-variant flex flex-col gap-1.5">';
    html += '<li>· 队列同一时间只执行一条任务，到点后自动打开本地浏览器。</li>';
    html += '<li>· 人工确认模式：上传素材、填好标题与话题后停在发布按钮前，由你手动点「发布」。</li>';
    html += '<li>· 全自动模式：点击发布后会到作品列表核验新作品链接，未核验到的显示为「待核验」。</li>';
    html += '<li>· 超过计划时间 6 小时仍未执行的任务会标记失败，可调整时间后重试。</li>';
    html += '<li>· 素材优先复用内容日历里的上传（视频在 data/videos、图片在 data/images），执行日志与截图在 data/publish-logs。</li>';
    html += '</ul>';
    html += '<div class="mt-space-md rounded-xl bg-surface-container-low p-3"><div class="text-label-sm text-on-surface-variant">首次使用</div><div class="text-label-sm text-on-surface mt-1">先到「连接设置」完成抖音一键登录，发布时复用已保存的登录态。</div></div>';
    html += '</div>';
    html += '</div></div>';
    html += '</div>';
    return html;
  }

  function pubKv(k, valueHtml){
    return '<div class="pub-kv"><div class="k">' + esc(k) + '</div><div class="v">' + valueHtml + '</div></div>';
  }

  function publishCreateHtml(pick, schedules){
    var when = pick ? pubWhenOf(pick) : '';
    var title = pick ? (pick['标题'] || '') : '';
    var platformOpts = pubPlatformOptions(pick);
    var html = '';
    html += '<div class="pub-grid">';
    html += '<div class="fld"><label class="lab">关联排期 <b>*</b></label><select id="pubSchedule" class="sel">';
    schedules.forEach(function(r){
      html += '<option value="' + esc(r['排期ID']) + '" data-title="' + esc(r['标题']) + '" data-when="' + esc(pubWhenOf(r)) + '"' + (pick && pick['排期ID'] === r['排期ID'] ? ' selected' : '') + '>' + esc(r['标题'] || '（未命名）') + ' · ' + esc(platformText(r['平台'])) + ' · ' + esc(r['当前阶段'] || '') + '</option>';
    });
    html += '</select></div>';
    html += '<div class="fld"><label class="lab">发布平台 <b>*</b></label><select id="pubPlatform" class="sel">';
    platformOpts.forEach(function(p){
      html += '<option value="' + esc(p) + '">' + esc(p) + '</option>';
    });
    html += '</select></div>';
    html += '</div>';
    html += '<div class="fld"><label class="lab">计划执行时间 <b>*</b></label><input id="pubWhen" class="inp" type="datetime-local" value="' + esc(when) + '"></div>';
    html += '<div class="fld"><label class="lab">作品标题 <b>*</b> <span class="text-outline normal-case">· 抖音最多 30 字，超出自动截断</span></label><input id="pubTitle" class="inp" type="text" maxlength="80" value="' + esc(title) + '" placeholder="填写作品标题"></div>';
    html += '<div class="fld"><label class="lab">作品简介</label><textarea id="pubDescription" class="ta" rows="3" placeholder="留空也可以；话题标签会自动追加到简介末尾"></textarea></div>';
    html += '<div class="fld"><label class="lab">话题标签 <span class="text-outline normal-case">· 用逗号或空格分隔，最多 10 个</span></label><input id="pubTags" class="inp" type="text" placeholder="干货, 运营, 复盘"></div>';
    html += '<div class="fld"><label class="lab">发布素材 <b>*</b></label><div id="pubMediaSlot"><div class="text-label-sm text-on-surface-variant">正在读取内容日历素材…</div></div></div>';
    html += '<div class="fld" style="margin-bottom:0"><label class="lab">发布方式</label><div class="pub-mode">';
    html += '<label><input type="radio" name="pubMode" value="confirm" checked><span><span class="t">人工确认（推荐）</span><span class="d">自动打开浏览器、上传素材并填好标题与话题，停在发布按钮前，由你确认后手动点「发布」。</span></span></label>';
    html += '<label><input type="radio" name="pubMode" value="auto"><span><span class="t">全自动发布</span><span class="d">填好表单后自动点击发布，并到作品列表核验新作品链接；执行期间请勿关闭浏览器窗口。</span></span></label>';
    html += '</div></div>';
    return html;
  }

  function resetPublishUpload(){
    if(PUB_UPLOAD.previewUrls){
      PUB_UPLOAD.previewUrls.forEach(function(url){ try{ URL.revokeObjectURL(url); }catch(err){} });
    }
    PUB_UPLOAD = { kind:'video', items:[], pendingIds:[], uploading:false, progress:0, previewUrls:[], kept:false, xhrs:[] };
  }

  function openPublishCreate(rec){
    if(!PUB.loaded){
      loadPublishData().then(function(){ openPublishCreate(rec); }).catch(function(err){
        toast('发布服务暂不可用：' + errMsg(err), 'err');
      });
      return;
    }
    var schedules = pubSchedulesForCreate();
    PUB.mode = 'create';
    PUB.detailId = null;
    resetPublishUpload();
    var pick = null;
    if(rec) schedules.forEach(function(r){ if(r['排期ID'] === rec['排期ID']) pick = r; });
    if(rec && !pick){
      toast('这条排期已有进行中的发布任务，或不在「待发布」阶段', 'err');
      return;
    }
    if(!pick && schedules.length) pick = schedules[0];
    PUB_UPLOAD.kind = pubKindOf(pick) || 'video';
    $('publishKicker').textContent = 'New Publish Task';
    $('publishModalTitle').textContent = '新建发布任务';
    $('publishSub').textContent = '优先复用内容日历里已上传的素材，缺失时可在这里补传。';
    $('publishBody').innerHTML = schedules.length
      ? publishCreateHtml(pick, schedules)
      : emptyState('没有可自动发布的排期', '先把内容日历里的排期阶段改为「待发布」，内容形式选短视频 / 图文 / 长图，且平台已接入自动发布', 'event_busy');
    $('publishFoot').innerHTML = schedules.length
      ? '<button class="px-5 py-2.5 rounded-full bg-surface-container-low text-label-md font-label-md text-on-surface hover:bg-surface-container-high transition-colors" data-act="pubClose" type="button">取消</button>'
        + '<button id="pubSaveBtn" class="inline-flex items-center gap-1.5 px-6 py-2.5 rounded-full bg-primary text-on-primary text-label-md font-label-md shadow-sm hover:opacity-90 transition-all" data-act="pubSave" type="button"><span class="material-symbols-outlined text-base">send</span>保存并排程</button>'
      : '<button class="px-5 py-2.5 rounded-full bg-surface-container-low text-label-md font-label-md text-on-surface hover:bg-surface-container-high transition-colors" data-act="pubClose" type="button">关闭</button>';
    $('publishModal').classList.add('on');
    var schedEl = $('pubSchedule');
    if(schedEl) schedEl.addEventListener('change', onPublishScheduleChange);
    updatePublishSaveState();
    if(pick) loadPublishScheduleMedia(pick);
    setTimeout(function(){ var t = $('pubTitle'); if(t) t.focus(); }, 60);
  }

  function onPublishScheduleChange(e){
    var opt = e.target.options[e.target.selectedIndex];
    if(!opt) return;
    var titleEl = $('pubTitle');
    var whenEl = $('pubWhen');
    if(titleEl) titleEl.value = opt.getAttribute('data-title') || '';
    if(whenEl) whenEl.value = opt.getAttribute('data-when') || '';
    var rec = null;
    DATA.calendar.forEach(function(r){ if(r['排期ID'] === e.target.value) rec = r; });
    if(!rec) return;
    var platformEl = $('pubPlatform');
    if(platformEl){
      platformEl.innerHTML = pubPlatformOptions(rec).map(function(p){
        return '<option value="' + esc(p) + '">' + esc(p) + '</option>';
      }).join('');
    }
    if(PUB_UPLOAD.uploading){
      (PUB_UPLOAD.xhrs || []).forEach(function(xhr){ try{ xhr.abort(); }catch(err){} });
      PUB_UPLOAD.xhrs = [];
      PUB_UPLOAD.uploading = false;
      PUB_UPLOAD.uploadRun = (PUB_UPLOAD.uploadRun || 0) + 1;
    }
    PUB_UPLOAD.kind = pubKindOf(rec) || 'video';
    pubDiscardPending();
    PUB_UPLOAD.items = [];
    loadPublishScheduleMedia(rec);
    updatePublishSaveState();
  }

  var pubMediaSeq = 0;
  function loadPublishScheduleMedia(rec){
    var seq = ++pubMediaSeq;
    PUB_UPLOAD.pendingIds = [];
    renderPublishMedia('loading');
    request('/media?scheduleId=' + encodeURIComponent(rec['_id'])).then(function(res){
      if(seq !== pubMediaSeq || PUB.mode !== 'create') return;
      var list = (res && res.media) || [];
      PUB_UPLOAD.items = list;
      PUB_UPLOAD.kind = list.length ? list[0].kind : (pubKindOf(rec) || 'video');
      renderPublishMedia();
      updatePublishSaveState();
    }).catch(function(err){
      if(seq !== pubMediaSeq) return;
      renderPublishMedia('error', errMsg(err));
      updatePublishSaveState();
    });
  }

  function mediaUploadHtml(kind){
    var isImage = kind === 'image';
    var html = '<div class="pub-upload"><button type="button" class="inline-flex items-center gap-1 px-4 py-2 rounded-full bg-primary text-on-primary text-label-sm font-semibold hover:opacity-90" data-act="pubPickMedia"><span class="material-symbols-outlined text-base">upload_file</span>' + (isImage ? '选择图片' : '选择视频') + '</button>';
    html += '<span class="hint">' + (isImage ? 'JPG / PNG / WebP，最多 30 张，单张 20MB；选择后自动上传' : 'MP4 / MOV / WebM，最大 4GB；选择后自动上传') + '</span></div>';
    html += '<input id="pubMediaFile" type="file" ' + (isImage ? 'accept="image/jpeg,image/png,image/webp" multiple' : 'accept="video/*"') + ' hidden>';
    return html;
  }

  function renderMediaList(items, options){
    var opts = options || {};
    if(!items.length) return '';
    var html = '<div class="media-list">';
    items.forEach(function(item, i){
      var isImage = item.kind === 'image';
      var thumb = isImage
        ? '<img class="media-thumb" src="' + esc(item.fileUrl || item.previewUrl) + '" alt="' + esc(item.name) + '" loading="lazy">'
        : '<span class="media-thumb media-thumb-video material-symbols-outlined">movie</span>';
      var meta = fmtBytes(item.sizeBytes || 0) + (item.durationSec ? ' · ' + fmtDuration(item.durationSec) : '');
      html += '<div class="media-item" data-media-id="' + esc(item.id) + '">';
      html += thumb;
      html += '<div class="media-meta"><div class="media-name">' + esc(item.name) + '</div><div class="media-sub">' + (isImage ? '第 ' + (i + 1) + ' 张 · ' : '') + esc(meta) + '</div></div>';
      if(opts.actions){
        html += '<div class="media-actions">';
        html += '<button type="button" class="media-btn" data-act="mediaUp" data-media-id="' + esc(item.id) + '" title="上移"' + (i === 0 ? ' disabled' : '') + '><span class="material-symbols-outlined">arrow_upward</span></button>';
        html += '<button type="button" class="media-btn" data-act="mediaDown" data-media-id="' + esc(item.id) + '" title="下移"' + (i === items.length - 1 ? ' disabled' : '') + '><span class="material-symbols-outlined">arrow_downward</span></button>';
        html += '<button type="button" class="media-btn media-btn-del" data-act="mediaRemove" data-media-id="' + esc(item.id) + '" title="移除"><span class="material-symbols-outlined">close</span></button>';
        html += '</div>';
      }
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  function renderPublishMedia(state, message){
    var slot = $('pubMediaSlot');
    if(!slot) return;
    if(state === 'loading'){
      slot.innerHTML = '<div class="text-label-sm text-on-surface-variant">正在读取内容日历素材…</div>';
      return;
    }
    if(state === 'error'){
      slot.innerHTML = '<div class="text-label-sm" style="color:#8e3b26">素材读取失败：' + esc(message || '') + '</div>';
      return;
    }
    var items = PUB_UPLOAD.items || [];
    var html = '';
    if(items.length){
      var fromSchedule = !(PUB_UPLOAD.pendingIds || []).length;
      html += '<div class="media-note">' + (fromSchedule ? '已从内容日历带入 ' : '已上传 ') + items.length + (PUB_UPLOAD.kind === 'image' ? ' 张图片' : ' 个视频') + '，将按此顺序发布。</div>';
      html += renderMediaList(items);
    } else {
      html += '<div class="media-note">这条排期还没有素材，可在这里补传；上传后会自动保存到内容日历。</div>';
      html += mediaUploadHtml(PUB_UPLOAD.kind);
      html += '<div id="pubProgress" class="pub-progress hidden"><div class="bar"><i id="pubMediaBar"></i></div><span id="pubMediaPct">0%</span></div>';
    }
    slot.innerHTML = html;
    var fileEl = $('pubMediaFile');
    if(fileEl) fileEl.addEventListener('change', onPublishMediaChange);
  }

  function updatePublishSaveState(){
    var btn = $('pubSaveBtn');
    if(!btn) return;
    btn.disabled = !(PUB_UPLOAD.items || []).length || PUB_UPLOAD.uploading;
    btn.classList.toggle('opacity-50', btn.disabled);
    btn.classList.toggle('cursor-not-allowed', btn.disabled);
  }

  function readVideoDuration(file){
    return new Promise(function(resolve){
      var url = URL.createObjectURL(file);
      var video = document.createElement('video');
      var done = false;
      function finish(sec){
        if(done) return;
        done = true;
        try{ URL.revokeObjectURL(url); }catch(err){}
        resolve(Number.isFinite(sec) && sec > 0 ? sec : 0);
      }
      video.preload = 'metadata';
      video.onloadedmetadata = function(){ finish(video.duration); };
      video.onerror = function(){ finish(0); };
      setTimeout(function(){ finish(video.duration); }, 4000);
      video.src = url;
    });
  }

  function pubDiscardPending(){
    var ids = (PUB_UPLOAD.pendingIds || []).slice();
    PUB_UPLOAD.pendingIds = [];
    ids.forEach(function(id){
      if(!id) return;
      request('/media/' + encodeURIComponent(id), { method: 'DELETE' }).catch(function(){ /* 清理失败不打扰用户 */ });
    });
  }

  function onPublishMediaChange(e){
    var picked = Array.prototype.slice.call((e.target && e.target.files) || []);
    if(e.target) e.target.value = '';
    if(!picked.length) return;
    var kind = PUB_UPLOAD.kind === 'image' ? 'image' : 'video';
    var limit = kind === 'image' ? 20 * 1024 * 1024 : 4 * 1024 * 1024 * 1024;
    var accepted = picked.filter(function(file){
      var nameOk = kind === 'image'
        ? /\.(jpe?g|png|webp)$/i.test(file.name)
        : /\.(mp4|m4v|mov|webm|mkv|avi|wmv|flv|mpe?g)$/i.test(file.name);
      var typeOk = (file.type || '').indexOf(kind + '/') === 0;
      if(!nameOk && !typeOk){ toast('已跳过不支持的文件：' + file.name, 'err'); return false; }
      if(file.size > limit){
        toast(file.name + ' 超出大小上限（' + (kind === 'image' ? '单张 20MB' : '4GB') + '）', 'err');
        return false;
      }
      return true;
    });
    if(kind === 'video') accepted = accepted.slice(0, 1);
    if(kind === 'image'){
      accepted.sort(function(a, b){ return (a.lastModified || 0) - (b.lastModified || 0); });
      var room = 30 - (PUB_UPLOAD.items || []).length;
      if(accepted.length > room){
        if(room > 0) toast('单个图文最多 30 张图片，已保留前 ' + room + ' 张', 'err');
        accepted = accepted.slice(0, Math.max(0, room));
      }
    }
    if(!accepted.length) return;
    uploadPublishMediaList(accepted, kind);
  }

  function uploadPublishMediaList(files, kind){
    var total = files.length;
    var idx = 0;
    var run = PUB_UPLOAD.uploadRun = (PUB_UPLOAD.uploadRun || 0) + 1;
    PUB_UPLOAD.uploading = true;
    updatePublishSaveState();
    var prog = $('pubProgress');
    if(prog) prog.classList.remove('hidden');
    function sameRun(){ return PUB_UPLOAD.uploadRun === run; }
    function finish(){
      if(!sameRun()) return;
      PUB_UPLOAD.uploading = false;
      renderPublishMedia();
      updatePublishSaveState();
    }
    function next(){
      if(!sameRun()) return;
      if(idx >= total) return finish();
      var file = files[idx++];
      var prep = kind === 'video' ? readVideoDuration(file) : Promise.resolve(0);
      prep.then(function(sec){
        return uploadPublishMedia(file, kind, sec, total > 1 ? idx + '/' + total : '');
      }).then(function(media){
        if(!sameRun()){
          if(media && !media.scheduleId) request('/media/' + encodeURIComponent(media.id), { method: 'DELETE' }).catch(function(){});
          return;
        }
        if(!media) return next();
        PUB_UPLOAD.items.push(media);
        if(!media.scheduleId) PUB_UPLOAD.pendingIds.push(media.id);
        next();
      }).catch(function(err){
        if(sameRun()) toast('上传失败：' + errMsg(err), 'err');
        next();
      });
    }
    next();
  }

  function uploadMediaFile(file, kind, duration, xhrs, onProgress, role){
    return new Promise(function(resolve, reject){
      var xhr = new XMLHttpRequest();
      if(xhrs) xhrs.push(xhr);
      xhr.open('POST', API + '/media?name=' + encodeURIComponent(file.name) + '&kind=' + kind + '&duration=' + encodeURIComponent(duration || 0) + (role ? '&role=' + encodeURIComponent(role) : ''));
      xhr.setRequestHeader('Content-Type', file.type || (kind === 'image' ? 'image/png' : 'video/mp4'));
      xhr.upload.onprogress = function(ev){
        if(!ev.lengthComputable || !onProgress) return;
        onProgress(Math.round(ev.loaded / ev.total * 100));
      };
      xhr.onload = function(){
        var body = null;
        try{ body = JSON.parse(xhr.responseText); }catch(err){}
        if(xhr.status >= 200 && xhr.status < 300 && body && body.media) return resolve(body.media);
        reject(new Error((body && body.error) || ('上传失败（HTTP ' + xhr.status + '）')));
      };
      xhr.onerror = function(){ reject(new Error('上传中断，请确认本地服务仍在运行')); };
      xhr.onabort = function(){ reject(new Error('上传已取消')); };
      xhr.send(file);
    });
  }

  function uploadPublishMedia(file, kind, duration, counter){
    return uploadMediaFile(file, kind, duration, PUB_UPLOAD.xhrs, function(pct){
      var bar = $('pubMediaBar');
      var label = $('pubMediaPct');
      if(bar) bar.style.width = pct + '%';
      if(label) label.textContent = (counter ? counter + ' · ' : '') + pct + '%';
    });
  }

  /* ---------- calendar media ---------- */
  var calMediaSeq = 0;

  function calKindOf(format){
    if(format === '短视频') return 'video';
    if(format === '图文' || format === '长图') return 'image';
    return null;
  }

  function resetMediaEdit(){
    (MEDIA_EDIT.xhrs || []).forEach(function(xhr){ try{ xhr.abort(); }catch(err){} });
    MEDIA_EDIT = { scheduleId:null, format:'', kind:null, items:[], pendingIds:[], uploading:false, xhrs:[], otherCount:0, loading:false, loadError:false };
  }

  function calDiscardPending(){
    var ids = (MEDIA_EDIT.pendingIds || []).slice();
    MEDIA_EDIT.pendingIds = [];
    ids.forEach(function(id){
      if(!id) return;
      request('/media/' + encodeURIComponent(id), { method: 'DELETE' }).catch(function(){ /* 清理失败不打扰用户 */ });
    });
  }

  function initCalendarMedia(rec){
    calDiscardPending();
    resetMediaEdit();
    MEDIA_EDIT.scheduleId = rec ? rec['_id'] : null;
    var fmtEl = document.querySelector('[data-field="内容形式"]');
    MEDIA_EDIT.format = fmtEl ? fmtEl.value : ((rec && rec['内容形式']) || '');
    MEDIA_EDIT.kind = calKindOf(MEDIA_EDIT.format);
    if(MEDIA_EDIT.scheduleId) loadCalendarMedia(MEDIA_EDIT.scheduleId);
    else renderCalendarMedia();
  }

  function loadCalendarMedia(scheduleId){
    var seq = ++calMediaSeq;
    MEDIA_EDIT.pendingIds = [];
    MEDIA_EDIT.loading = true;
    MEDIA_EDIT.loadError = false;
    renderCalendarMedia('loading');
    request('/tables/calendar/records/' + encodeURIComponent(scheduleId) + '/media').then(function(res){
      if(seq !== calMediaSeq) return;
      MEDIA_EDIT.loading = false;
      var list = (res && res.media) || [];
      if(MEDIA_EDIT.kind){
        MEDIA_EDIT.items = list.filter(function(item){ return item.kind === MEDIA_EDIT.kind; });
        MEDIA_EDIT.otherCount = list.length - MEDIA_EDIT.items.length;
      } else {
        MEDIA_EDIT.items = [];
        MEDIA_EDIT.otherCount = list.length;
      }
      renderCalendarMedia();
      if(!CAL_COVER.dirty && !CAL_COVER.uploading) setCoverFromServer((res && res.cover) || null);
      else renderCalendarCover();
    }).catch(function(err){
      if(seq !== calMediaSeq) return;
      MEDIA_EDIT.loading = false;
      MEDIA_EDIT.loadError = true;
      CAL_COVER.loading = false;
      renderCalendarCover();
      var slot = $('calMediaBlock');
      if(slot) slot.innerHTML = '<div class="text-label-sm" style="color:#8e3b26">素材读取失败：' + esc(errMsg(err)) + '，请关闭抽屉后重试</div>';
    });
  }

  function renderCalendarMedia(state){
    var slot = $('calMediaBlock');
    if(!slot) return;
    if(state === 'loading'){
      slot.innerHTML = '<div class="text-label-sm text-on-surface-variant">正在读取排期素材…</div>';
      return;
    }
    var format = MEDIA_EDIT.format || '';
    var kind = MEDIA_EDIT.kind;
    if(!kind){
      slot.innerHTML = '<div class="media-note">' + (format ? '「' + esc(format) + '」暂不支持自动发布，无需上传发布素材。' : '先选择「内容形式」，再上传发布素材。') + '</div>';
      return;
    }
    var isImage = kind === 'image';
    var html = '';
    html += '<div class="media-note">' + (isImage ? '最多 30 张图片，顺序即发布顺序。' : '1 个视频，重新选择会替换。') + '保存排期时一并保存素材。</div>';
    if(MEDIA_EDIT.otherCount > 0){
      html += '<div class="media-note" style="color:#8e3b26">该排期已有 ' + MEDIA_EDIT.otherCount + ' 个其他类型的素材，不会用于本次发布。</div>';
    }
    if(MEDIA_EDIT.items.length) html += renderMediaList(MEDIA_EDIT.items, { actions:true });
    var canAdd = !MEDIA_EDIT.uploading && (isImage ? MEDIA_EDIT.items.length < 30 : true);
    if(canAdd){
      html += '<div class="pub-upload" style="margin-top:8px"><button type="button" class="inline-flex items-center gap-1 px-4 py-2 rounded-full bg-primary text-on-primary text-label-sm font-semibold hover:opacity-90" data-act="calPickMedia"><span class="material-symbols-outlined text-base">upload_file</span>' + (MEDIA_EDIT.items.length ? (isImage ? '继续添加图片' : '更换视频') : (isImage ? '选择图片' : '选择视频')) + '</button>';
      html += '<span class="hint">' + (isImage ? 'JPG / PNG / WebP，单张 20MB' : 'MP4 / MOV / WebM，最大 4GB') + '</span></div>';
    }
    html += '<input id="calMediaFile" type="file" ' + (isImage ? 'accept="image/jpeg,image/png,image/webp" multiple' : 'accept="video/*"') + ' hidden>';
    html += '<div id="calProgress" class="pub-progress' + (MEDIA_EDIT.uploading ? '' : ' hidden') + '"><div class="bar"><i id="calMediaBar"></i></div><span id="calMediaPct">0%</span></div>';
    slot.innerHTML = html;
  }

  function onCalendarFormatChange(){
    var fmtEl = document.querySelector('[data-field="内容形式"]');
    var format = fmtEl ? fmtEl.value : '';
    if(format === MEDIA_EDIT.format) return;
    if(MEDIA_EDIT.uploading){
      (MEDIA_EDIT.xhrs || []).forEach(function(xhr){ try{ xhr.abort(); }catch(err){} });
      MEDIA_EDIT.uploading = false;
      MEDIA_EDIT.xhrs = [];
      MEDIA_EDIT.uploadRun = (MEDIA_EDIT.uploadRun || 0) + 1;
    }
    calDiscardPending();
    MEDIA_EDIT.format = format;
    MEDIA_EDIT.kind = calKindOf(format);
    updateCoverFormat();
    renderCalendarCover();
    if(MEDIA_EDIT.scheduleId) loadCalendarMedia(MEDIA_EDIT.scheduleId);
    else {
      MEDIA_EDIT.items = [];
      MEDIA_EDIT.otherCount = 0;
      renderCalendarMedia();
    }
  }

  function onCalendarMediaChange(e){
    var picked = Array.prototype.slice.call((e.target && e.target.files) || []);
    if(e.target) e.target.value = '';
    if(!picked.length) return;
    var kind = MEDIA_EDIT.kind;
    if(!kind){ toast('先选择「内容形式」，再上传素材', 'err'); return; }
    var limit = kind === 'image' ? 20 * 1024 * 1024 : 4 * 1024 * 1024 * 1024;
    var accepted = picked.filter(function(file){
      var nameOk = kind === 'image'
        ? /\.(jpe?g|png|webp)$/i.test(file.name)
        : /\.(mp4|m4v|mov|webm|mkv|avi|wmv|flv|mpe?g)$/i.test(file.name);
      var typeOk = (file.type || '').indexOf(kind + '/') === 0;
      if(!nameOk && !typeOk){ toast('已跳过不支持的文件：' + file.name, 'err'); return false; }
      if(file.size > limit){
        toast(file.name + ' 超出大小上限（' + (kind === 'image' ? '单张 20MB' : '4GB') + '）', 'err');
        return false;
      }
      return true;
    });
    if(kind === 'video'){
      accepted = accepted.slice(0, 1);
      if(MEDIA_EDIT.items.length){
        MEDIA_EDIT.items.slice().forEach(function(item){
          var idx = MEDIA_EDIT.pendingIds.indexOf(item.id);
          if(idx >= 0){
            MEDIA_EDIT.pendingIds.splice(idx, 1);
            request('/media/' + encodeURIComponent(item.id), { method: 'DELETE' }).catch(function(){});
          }
        });
        MEDIA_EDIT.items = [];
      }
    }
    if(kind === 'image'){
      accepted.sort(function(a, b){ return (a.lastModified || 0) - (b.lastModified || 0); });
      var room = 30 - MEDIA_EDIT.items.length;
      if(accepted.length > room){
        if(room > 0) toast('单个图文最多 30 张图片，已保留前 ' + room + ' 张', 'err');
        accepted = accepted.slice(0, Math.max(0, room));
      }
    }
    if(!accepted.length) return;
    uploadCalendarMediaList(accepted, kind);
  }

  function uploadCalendarMediaList(files, kind){
    var total = files.length;
    var idx = 0;
    var run = MEDIA_EDIT.uploadRun = (MEDIA_EDIT.uploadRun || 0) + 1;
    MEDIA_EDIT.uploading = true;
    MEDIA_EDIT.xhrs = [];
    renderCalendarMedia();
    var prog = $('calProgress');
    if(prog) prog.classList.remove('hidden');
    function sameRun(){ return MEDIA_EDIT.uploadRun === run; }
    function finish(){
      if(!sameRun()) return;
      MEDIA_EDIT.uploading = false;
      renderCalendarMedia();
      renderCalendarCover();
      if(MEDIA_EDIT.items.length) toast('素材已上传 · 保存排期后生效', 'ok');
    }
    function next(){
      if(!sameRun()) return;
      if(idx >= total) return finish();
      var file = files[idx++];
      var prep = kind === 'video' ? readVideoDuration(file) : Promise.resolve(0);
      prep.then(function(sec){
        return uploadMediaFile(file, kind, sec, MEDIA_EDIT.xhrs, function(pct){
          if(!sameRun()) return;
          var bar = $('calMediaBar');
          var label = $('calMediaPct');
          if(bar) bar.style.width = pct + '%';
          if(label) label.textContent = (total > 1 ? idx + '/' + total + ' · ' : '') + pct + '%';
        });
      }).then(function(media){
        if(!sameRun()){
          if(media && !media.scheduleId) request('/media/' + encodeURIComponent(media.id), { method: 'DELETE' }).catch(function(){});
          return;
        }
        if(!media) return next();
        MEDIA_EDIT.items.push(media);
        if(!media.scheduleId) MEDIA_EDIT.pendingIds.push(media.id);
        next();
      }).catch(function(err){
        if(sameRun()) toast('上传失败：' + errMsg(err), 'err');
        next();
      });
    }
    next();
  }

  function moveCalendarMedia(id, delta){
    var idx = -1;
    MEDIA_EDIT.items.forEach(function(item, i){ if(item.id === id) idx = i; });
    if(idx < 0) return;
    var to = idx + delta;
    if(to < 0 || to >= MEDIA_EDIT.items.length) return;
    var tmp = MEDIA_EDIT.items[idx];
    MEDIA_EDIT.items[idx] = MEDIA_EDIT.items[to];
    MEDIA_EDIT.items[to] = tmp;
    renderCalendarMedia();
  }

  function removeCalendarMedia(id){
    var idx = -1;
    MEDIA_EDIT.items.forEach(function(item, i){ if(item.id === id) idx = i; });
    if(idx < 0) return;
    var item = MEDIA_EDIT.items[idx];
    MEDIA_EDIT.items.splice(idx, 1);
    var p = MEDIA_EDIT.pendingIds.indexOf(id);
    if(p >= 0){
      MEDIA_EDIT.pendingIds.splice(p, 1);
      request('/media/' + encodeURIComponent(id), { method: 'DELETE' }).catch(function(){});
    }
    renderCalendarMedia();
    renderCalendarCover();
  }

  function attachEditorMedia(saved){
    var ids = (MEDIA_EDIT.items || []).map(function(item){ return item.id; });
    return request('/tables/calendar/records/' + encodeURIComponent(saved._id) + '/media', {
      method: 'PUT',
      body: JSON.stringify({ ids: ids })
    }).then(function(res){
      MEDIA_EDIT.pendingIds = [];
      MEDIA_EDIT.scheduleId = saved._id;
      var list = (res && res.media) || [];
      if(MEDIA_EDIT.kind){
        MEDIA_EDIT.items = list.filter(function(item){ return item.kind === MEDIA_EDIT.kind; });
        MEDIA_EDIT.otherCount = list.length - MEDIA_EDIT.items.length;
      }
    });
  }

  /* ---------- calendar cover ---------- */
  var calCoverSeq = 0;
  var CROP_RATIOS = { '16:9': 16 / 9, '9:16': 9 / 16, '4:3': 4 / 3, '3:4': 3 / 4, '3:2': 3 / 2, '1:1': 1 };

  function coverSupported(format){
    return format === '图文' || format === '长图' || format === '短视频';
  }

  function calCoverDiscardPending(){
    var ids = (CAL_COVER.pendingIds || []).slice();
    CAL_COVER.pendingIds = [];
    ids.forEach(function(id){
      if(!id) return;
      request('/media/' + encodeURIComponent(id), { method: 'DELETE' }).catch(function(){ /* 清理失败不打扰用户 */ });
    });
  }

  function resetCalendarCover(){
    calCoverSeq++;
    (CAL_COVER.xhrs || []).forEach(function(xhr){ try{ xhr.abort(); }catch(err){} });
    if(CAL_COVER.source && CAL_COVER.source.revoke && CAL_COVER.source.url){
      try{ URL.revokeObjectURL(CAL_COVER.source.url); }catch(err){}
    }
    closeCoverCrop();
    CAL_COVER = newCalendarCoverState();
  }

  function updateCoverFormat(){
    var fmtEl = document.querySelector('[data-field="内容形式"]');
    var next = fmtEl ? fmtEl.value : '';
    var wasSupported = CAL_COVER.supported;
    CAL_COVER.format = next;
    CAL_COVER.supported = coverSupported(next);
    if(wasSupported && !CAL_COVER.supported) restoreCoverOriginal();
  }

  function restoreCoverOriginal(){
    calCoverSeq++;
    (CAL_COVER.xhrs || []).forEach(function(xhr){ try{ xhr.abort(); }catch(err){} });
    CAL_COVER.xhrs = [];
    calCoverDiscardPending();
    CAL_COVER.current = CAL_COVER.original;
    CAL_COVER.dirty = false;
    CAL_COVER.uploading = false;
    if(CAL_COVER.current){
      CAL_COVER.source = { url: CAL_COVER.current.fileUrl, name: CAL_COVER.current.name };
    } else {
      CAL_COVER.source = null;
    }
  }

  function initCalendarCover(rec){
    calCoverDiscardPending();
    resetCalendarCover();
    CAL_COVER.scheduleId = rec ? rec._id : null;
    updateCoverFormat();
    CAL_COVER.loading = !!(rec && CAL_COVER.supported);
    renderCalendarCover();
  }

  function setCoverFromServer(cover){
    CAL_COVER.loading = false;
    if(CAL_COVER.dirty || CAL_COVER.uploading) return;
    CAL_COVER.current = cover || null;
    CAL_COVER.original = cover || null;
    CAL_COVER.source = cover ? { url: cover.fileUrl, name: cover.name } : null;
    renderCalendarCover();
  }

  function renderCalendarCover(){
    var fld = $('calCoverFld');
    var slot = $('calCoverBlock');
    if(!fld || !slot) return;
    if(!CAL_COVER.supported){
      fld.style.display = 'none';
      slot.innerHTML = '';
      return;
    }
    fld.style.display = '';
    if(CAL_COVER.loading){
      slot.innerHTML = '<div class="text-label-sm text-on-surface-variant">正在读取封面…</div>';
      return;
    }
    var html = '';
    if(CAL_COVER.current){
      html += '<div class="cover-current"><img class="cover-preview" src="' + esc(CAL_COVER.current.fileUrl) + '" alt="封面">';
      html += '<div class="cover-info"><div class="cover-title">' + (CAL_COVER.pendingIds.length ? '新封面 · 保存排期后生效' : '已设置封面') + '</div>';
      html += '<div class="media-sub">' + esc(CAL_COVER.current.name) + ' · ' + fmtBytes(CAL_COVER.current.sizeBytes || 0) + '</div>';
      html += '<div class="cover-actions">';
      if(CAL_COVER.source) html += '<button type="button" class="cover-btn" data-act="calCoverRecrop">重新裁剪</button>';
      html += '<button type="button" class="cover-btn" data-act="calCoverPick">更换封面</button>';
      html += '<button type="button" class="cover-btn cover-btn-del" data-act="calCoverRemove">移除</button>';
      html += '</div></div></div>';
    } else {
      html += '<div class="pub-upload"><button type="button" class="inline-flex items-center gap-1 px-4 py-2 rounded-full bg-primary text-on-primary text-label-sm font-semibold hover:opacity-90" data-act="calCoverPick"><span class="material-symbols-outlined text-base">image</span>选择封面</button>';
      html += '<span class="hint">JPG / PNG / WebP，≤20MB；选择后可裁剪比例</span></div>';
      var imageItems = (MEDIA_EDIT.items || []).filter(function(item){ return item.kind === 'image'; });
      if(MEDIA_EDIT.kind === 'image' && imageItems.length){
        html += '<div class="cover-picks"><span class="hint">或从已上传图片中选择：</span>';
        imageItems.forEach(function(item){
          html += '<button type="button" class="cover-pick" data-act="calCoverFromItem" data-media-id="' + esc(item.id) + '" title="' + esc(item.name) + '"><img src="' + esc(item.fileUrl) + '" alt=""></button>';
        });
        html += '</div>';
      }
    }
    if(CAL_COVER.uploading){
      html += '<div id="coverProgress" class="pub-progress"><div class="bar"><i id="coverBar"></i></div><span id="coverPct">0%</span></div>';
    }
    html += '<input id="calCoverFile" type="file" accept="image/jpeg,image/png,image/webp" hidden>';
    slot.innerHTML = html;
  }

  function onCalendarCoverChange(e){
    var file = e.target && e.target.files && e.target.files[0];
    if(e.target) e.target.value = '';
    if(!file) return;
    if(CAL_COVER.uploading){ toast('封面正在上传，请稍候', 'err'); return; }
    var nameOk = /\.(jpe?g|png|webp)$/i.test(file.name);
    var typeOk = (file.type || '').indexOf('image/') === 0;
    if(!nameOk && !typeOk){ toast('封面仅支持 JPG / PNG / WebP', 'err'); return; }
    if(file.size > 20 * 1024 * 1024){ toast('封面图片不能超过 20MB', 'err'); return; }
    openCoverCrop({ url: URL.createObjectURL(file), name: file.name, revoke: true });
  }

  function openCoverCropFromItem(id){
    var item = null;
    (MEDIA_EDIT.items || []).forEach(function(it){ if(it.id === id) item = it; });
    if(!item || item.kind !== 'image'){ toast('请选择一张正文图片', 'err'); return; }
    openCoverCrop({ url: item.fileUrl, name: item.name, revoke: false });
  }

  function removeCalendarCover(){
    if(CAL_COVER.uploading) return;
    if(!CAL_COVER.current) return;
    var current = CAL_COVER.current;
    var p = CAL_COVER.pendingIds.indexOf(current.id);
    if(p >= 0){
      CAL_COVER.pendingIds.splice(p, 1);
      request('/media/' + encodeURIComponent(current.id), { method: 'DELETE' }).catch(function(){});
    }
    CAL_COVER.current = null;
    CAL_COVER.source = null;
    CAL_COVER.dirty = true;
    renderCalendarCover();
    toast('已移除封面 · 保存排期后生效', 'ok');
  }

  function attachEditorCover(saved){
    return request('/tables/calendar/records/' + encodeURIComponent(saved._id) + '/cover', {
      method: 'PUT',
      body: JSON.stringify({ mediaId: CAL_COVER.current ? CAL_COVER.current.id : null })
    }).then(function(res){
      CAL_COVER.pendingIds = [];
      CAL_COVER.dirty = false;
      CAL_COVER.scheduleId = saved._id;
      CAL_COVER.original = (res && res.cover) || null;
      CAL_COVER.current = CAL_COVER.original;
      if(CAL_COVER.current && !CAL_COVER.source){
        CAL_COVER.source = { url: CAL_COVER.current.fileUrl, name: CAL_COVER.current.name };
      }
      renderCalendarCover();
      return CAL_COVER.current;
    });
  }

  /* ---------- cover cropper ---------- */
  function openCoverCrop(source){
    if(!source || !source.url) return;
    var seq = calCoverSeq;
    var img = new Image();
    img.onload = function(){
      if(seq !== calCoverSeq){
        if(source.revoke) { try{ URL.revokeObjectURL(source.url); }catch(err){} }
        return;
      }
      if(CAL_COVER.source && CAL_COVER.source.revoke && CAL_COVER.source.url && CAL_COVER.source.url !== source.url){
        try{ URL.revokeObjectURL(CAL_COVER.source.url); }catch(err){}
      }
      CAL_COVER.source = source;
      CROP.active = true;
      CROP.img = img;
      CROP.natW = img.naturalWidth || img.width || 1;
      CROP.natH = img.naturalHeight || img.height || 1;
      CROP.ratio = 'original';
      var srcEl = $('cropSource');
      if(srcEl) srcEl.textContent = source.name || '';
      layoutCoverCrop();
      setCropRatioUI('original');
      cropInitRect();
      $('cropModal').classList.add('on');
    };
    img.onerror = function(){
      if(source.revoke) { try{ URL.revokeObjectURL(source.url); }catch(err){} }
      toast('图片载入失败，请换一张试试', 'err');
    };
    img.src = source.url;
  }

  function layoutCoverCrop(){
    var maxW = Math.max(260, Math.min(720, window.innerWidth - 120));
    var maxH = Math.max(220, Math.min(Math.round(window.innerHeight * 0.56), 520));
    var scale = Math.min(maxW / CROP.natW, maxH / CROP.natH);
    CROP.scale = scale;
    CROP.stageW = Math.max(1, Math.round(CROP.natW * scale));
    CROP.stageH = Math.max(1, Math.round(CROP.natH * scale));
    var stage = $('cropStage');
    stage.style.width = CROP.stageW + 'px';
    stage.style.height = CROP.stageH + 'px';
    $('cropImg').src = CAL_COVER.source.url;
  }

  function cropRatioValue(key){
    if(key === 'original') return CROP.natW / CROP.natH;
    if(key === 'free') return 0;
    return CROP_RATIOS[key] || 0;
  }

  function cropInitRect(){
    var ratio = cropRatioValue(CROP.ratio);
    var w, h;
    if(!ratio){
      w = CROP.stageW;
      h = CROP.stageH;
    } else if(CROP.stageW / CROP.stageH > ratio){
      h = CROP.stageH;
      w = h * ratio;
    } else {
      w = CROP.stageW;
      h = w / ratio;
    }
    CROP.rect = { x: (CROP.stageW - w) / 2, y: (CROP.stageH - h) / 2, w: w, h: h };
    drawCropBox();
  }

  function setCropRatioUI(key){
    var btns = document.querySelectorAll('#cropRatios [data-ratio]');
    for(var i = 0; i < btns.length; i++) btns[i].classList.toggle('on', btns[i].getAttribute('data-ratio') === key);
  }

  function drawCropBox(){
    var box = $('cropBox');
    if(!box) return;
    box.style.left = CROP.rect.x + 'px';
    box.style.top = CROP.rect.y + 'px';
    box.style.width = CROP.rect.w + 'px';
    box.style.height = CROP.rect.h + 'px';
  }

  function cropPointerPos(e){
    var stage = $('cropStage');
    var r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function cropStartDrag(e, mode, handle){
    if(!CROP.active) return;
    e.preventDefault();
    var p = cropPointerPos(e);
    var r = CROP.rect;
    var anchor = null;
    if(mode === 'resize'){
      anchor = {
        x: handle === 'nw' || handle === 'sw' ? r.x + r.w : r.x,
        y: handle === 'nw' || handle === 'ne' ? r.y + r.h : r.y
      };
    }
    CROP.drag = {
      mode: mode,
      anchor: anchor,
      startRect: { x: r.x, y: r.y, w: r.w, h: r.h },
      start: p
    };
    document.addEventListener('pointermove', cropMoveDrag);
    document.addEventListener('pointerup', cropEndDrag);
    document.addEventListener('pointercancel', cropEndDrag);
  }

  function cropMoveDrag(e){
    if(!CROP.drag) return;
    var p = cropPointerPos(e);
    if(CROP.drag.mode === 'move'){
      var sr = CROP.drag.startRect;
      CROP.rect.x = Math.max(0, Math.min(sr.x + (p.x - CROP.drag.start.x), CROP.stageW - CROP.rect.w));
      CROP.rect.y = Math.max(0, Math.min(sr.y + (p.y - CROP.drag.start.y), CROP.stageH - CROP.rect.h));
    } else {
      cropResizeTo(p);
    }
    drawCropBox();
  }

  function cropResizeTo(p){
    var anchor = CROP.drag.anchor;
    if(!anchor) return;
    var px = Math.max(0, Math.min(p.x, CROP.stageW));
    var py = Math.max(0, Math.min(p.y, CROP.stageH));
    var ratio = cropRatioValue(CROP.ratio);
    var minSize = 24;
    var dx = px - anchor.x;
    var dy = py - anchor.y;
    if(!ratio){
      var left = Math.min(anchor.x, px);
      var right = Math.max(anchor.x, px);
      var top = Math.min(anchor.y, py);
      var bottom = Math.max(anchor.y, py);
      if(right - left < minSize){
        if(px < anchor.x) left = Math.max(0, anchor.x - minSize);
        else right = Math.min(CROP.stageW, anchor.x + minSize);
      }
      if(bottom - top < minSize){
        if(py < anchor.y) top = Math.max(0, anchor.y - minSize);
        else bottom = Math.min(CROP.stageH, anchor.y + minSize);
      }
      CROP.rect = { x: left, y: top, w: right - left, h: bottom - top };
      return;
    }
    var signX = dx < 0 ? -1 : 1;
    var signY = dy < 0 ? -1 : 1;
    var w = Math.max(Math.abs(dx), Math.abs(dy) * ratio, minSize);
    var maxW = Math.min(
      signX < 0 ? anchor.x : CROP.stageW - anchor.x,
      (signY < 0 ? anchor.y : CROP.stageH - anchor.y) * ratio
    );
    if(w > maxW) w = maxW;
    w = Math.max(1, w);
    var h = w / ratio;
    CROP.rect = {
      x: signX < 0 ? anchor.x - w : anchor.x,
      y: signY < 0 ? anchor.y - h : anchor.y,
      w: w,
      h: h
    };
  }

  function cropEndDrag(){
    CROP.drag = null;
    document.removeEventListener('pointermove', cropMoveDrag);
    document.removeEventListener('pointerup', cropEndDrag);
    document.removeEventListener('pointercancel', cropEndDrag);
  }

  function closeCoverCrop(){
    CROP.active = false;
    CROP.drag = null;
    CROP.img = null;
    document.removeEventListener('pointermove', cropMoveDrag);
    document.removeEventListener('pointerup', cropEndDrag);
    document.removeEventListener('pointercancel', cropEndDrag);
    var modal = $('cropModal');
    if(modal) modal.classList.remove('on');
    var imgEl = $('cropImg');
    if(imgEl) imgEl.removeAttribute('src');
  }

  function confirmCoverCrop(){
    if(!CROP.active || !CROP.img) return;
    var r = CROP.rect;
    var s = CROP.scale || 1;
    var sx = Math.max(0, Math.round(r.x / s));
    var sy = Math.max(0, Math.round(r.y / s));
    var sw = Math.max(1, Math.round(r.w / s));
    var sh = Math.max(1, Math.round(r.h / s));
    if(sx + sw > CROP.natW) sw = CROP.natW - sx;
    if(sy + sh > CROP.natH) sh = CROP.natH - sy;
    sw = Math.max(1, sw);
    sh = Math.max(1, sh);
    var cap = Math.min(1, 4096 / Math.max(sw, sh));
    var cw = Math.max(1, Math.round(sw * cap));
    var ch = Math.max(1, Math.round(sh * cap));
    var canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(CROP.img, sx, sy, sw, sh, 0, 0, cw, ch);
    var name = 'cover-' + Date.now() + '.jpg';
    canvas.toBlob(function(blob){
      if(!blob){ toast('封面生成失败，请重试', 'err'); return; }
      closeCoverCrop();
      uploadCoverBlob(blob, name);
    }, 'image/jpeg', 0.9);
  }

  function uploadCoverBlob(blob, name){
    if(!CAL_COVER.supported){ toast('当前内容形式不需要封面', 'err'); return; }
    var file = new File([blob], name, { type: 'image/jpeg' });
    var seq = calCoverSeq;
    CAL_COVER.uploading = true;
    CAL_COVER.xhrs = [];
    renderCalendarCover();
    function sameRun(){ return calCoverSeq === seq; }
    uploadMediaFile(file, 'image', 0, CAL_COVER.xhrs, function(pct){
      if(!sameRun()) return;
      var bar = $('coverBar');
      var label = $('coverPct');
      if(bar) bar.style.width = pct + '%';
      if(label) label.textContent = pct + '%';
    }, 'cover').then(function(media){
      if(!sameRun() || !$('calCoverBlock')){
        if(media && !media.scheduleId) request('/media/' + encodeURIComponent(media.id), { method: 'DELETE' }).catch(function(){});
        return;
      }
      calCoverDiscardPending();
      CAL_COVER.current = media;
      CAL_COVER.pendingIds = media.scheduleId ? [] : [media.id];
      CAL_COVER.uploading = false;
      CAL_COVER.dirty = true;
      CAL_COVER.xhrs = [];
      renderCalendarCover();
      toast('封面已上传 · 保存排期后生效', 'ok');
    }).catch(function(err){
      if(!sameRun()) return;
      CAL_COVER.uploading = false;
      CAL_COVER.xhrs = [];
      renderCalendarCover();
      toast('封面上传失败：' + errMsg(err), 'err');
    });
  }

  function savePublishTask(){
    var scheduleEl = $('pubSchedule');
    var platformEl = $('pubPlatform');
    var titleEl = $('pubTitle');
    var descEl = $('pubDescription');
    var tagsEl = $('pubTags');
    var whenEl = $('pubWhen');
    if(!scheduleEl || !scheduleEl.value){ toast('请选择关联排期', 'err'); return; }
    if(!platformEl || !platformEl.value){ toast('请选择发布平台', 'err'); return; }
    if(PUB_UPLOAD.uploading){ toast('素材还在上传，请稍候', 'err'); return; }
    var mediaIds = (PUB_UPLOAD.items || []).map(function(item){ return item.id; });
    if(!mediaIds.length){ toast('请先上传发布素材', 'err'); return; }
    var title = String(titleEl && titleEl.value || '').trim();
    if(!title){ toast('作品标题不能为空', 'err'); if(titleEl) titleEl.focus(); return; }
    var modeEl = document.querySelector('input[name="pubMode"]:checked');
    var body = {
      scheduleCode: scheduleEl.value,
      platform: platformEl.value,
      mediaIds: mediaIds,
      title: title,
      description: String(descEl && descEl.value || '').trim(),
      tags: String(tagsEl && tagsEl.value || '').trim(),
      scheduledAt: whenEl ? whenEl.value : '',
      mode: modeEl ? modeEl.value : 'confirm'
    };
    var btn = $('pubSaveBtn');
    if(btn){ btn.disabled = true; btn.innerHTML = '<span class="material-symbols-outlined text-base animate-spin">progress_activity</span><span>保存中…</span>'; }
    request('/publish/tasks', { method: 'POST', body: JSON.stringify(body) }).then(function(res){
      var task = res && res.task;
      PUB_UPLOAD.kept = true;
      closePublishModal();
      return loadPublishData().then(function(){
        switchView('publish');
        toast('任务 ' + (task ? task.code : '') + ' 已排程 · ' + (task && task.mode === 'auto' ? '到点自动发布' : '到点打开浏览器等你确认'), 'ok');
      });
    }).catch(function(err){
      toast('创建失败：' + errMsg(err), 'err');
      if(btn){
        btn.innerHTML = '<span class="material-symbols-outlined text-base">send</span>保存并排程';
        updatePublishSaveState();
      }
    });
  }

  function closePublishModal(){
    var wasCreate = PUB.mode === 'create';
    (PUB_UPLOAD.xhrs || []).forEach(function(xhr){ try{ xhr.abort(); }catch(err){} });
    $('publishModal').classList.remove('on');
    PUB.mode = 'detail';
    PUB.detailId = null;
    pubMediaSeq++;
    if(wasCreate && !PUB_UPLOAD.kept) pubDiscardPending();
    resetPublishUpload();
  }

  function openPublishDetail(task){
    if(!task) return;
    PUB.mode = 'detail';
    PUB.detailId = task._id;
    $('publishKicker').textContent = 'Publish Task · ' + task.code;
    $('publishModalTitle').textContent = task.title || '发布任务';
    $('publishSub').textContent = (task.scheduleTitle || task.scheduleCode) + ' · ' + task.platform;
    $('publishModal').classList.add('on');
    fillPublishDetail(task);
    loadPublishDetailExtras(task);
  }

  function fillPublishDetail(t){
    var html = '';
    html += '<div class="flex items-center gap-2 flex-wrap">' + pubStatusChip(t)
      + '<span class="chip chip-line">' + (t.mode === 'auto' ? '全自动' : '人工确认') + '</span>'
      + (t.attempts ? '<span class="chip chip-line">已尝试 ' + t.attempts + ' 次</span>' : '') + '</div>';
    html += '<div class="pub-detail">';
    html += pubKv('排期', esc(t.scheduleCode) + (t.scheduleTitle ? ' · ' + esc(t.scheduleTitle) : ''));
    html += pubKv('平台', platformChip(t.platform));
    html += pubKv('计划执行', esc(fmtDateTime(t.scheduledAt)));
    var mt = t.media || [];
    var mtHtml = '—';
    if(mt.length){
      mtHtml = '<div class="flex flex-col gap-1">' + mt.map(function(item){
        var meta = fmtBytes(item.sizeBytes || 0) + (item.durationSec ? ' · ' + fmtDuration(item.durationSec) : '');
        return '<div class="flex flex-col"><a class="link-arrow break-all" href="' + esc(item.fileUrl) + '" target="_blank" rel="noopener">' + esc(item.name) + '</a><span class="text-label-sm text-on-surface-variant">' + esc(meta) + '</span></div>';
      }).join('') + '</div>';
    }
    html += pubKv('发布素材', mtHtml);
    html += pubKv('执行记录', esc(pubTimeRange(t)));
    html += pubKv('发布链接', t.publishUrl ? '<a class="link-arrow" href="' + esc(t.publishUrl) + '" target="_blank" rel="noopener">' + esc(t.publishUrl) + '</a>' : '—');
    html += pubKv('作品 ID', esc(t.workId || '—'));
    html += '</div>';
    if(t.error){
      html += '<div class="rounded-xl px-3 py-2 text-label-sm" style="background:#fce3dd;color:#8e3b26">失败原因：' + esc(t.error) + '</div>';
    }
    if(t.description || (t.tags && t.tags.length)){
      html += '<div class="rounded-xl bg-surface-container-low px-3 py-2"><div class="text-label-sm text-on-surface-variant mb-1">简介与话题</div><div class="text-body-sm whitespace-pre-line">' + esc(t.description || '（无简介）') + '</div>';
      if(t.tags && t.tags.length) html += '<div class="text-label-sm text-[#785d00] mt-1">' + t.tags.map(function(x){ return '#' + esc(x); }).join(' ') + '</div>';
      html += '</div>';
    }
    if(t.status === 'needs_confirm' || t.status === 'submitted'){
      html += '<div class="fld" style="margin-bottom:0"><label class="lab">发布链接 <span class="text-outline normal-case">· 确认发布后粘贴，可留空</span></label><input id="pubResultUrl" class="inp" type="url" placeholder="https://www.douyin.com/video/…"></div>';
    }
    html += '<div><div class="flex items-center justify-between mb-1"><span class="text-label-sm font-semibold text-on-surface">执行日志</span><span class="text-label-sm text-on-surface-variant mono">' + esc(t.code) + '</span></div><pre id="pubLog" class="pub-log">（加载中…）</pre></div>';
    html += '<div><div class="text-label-sm font-semibold text-on-surface mb-1">页面截图</div><div id="pubShots" class="pub-shots"><span class="pub-empty">加载中…</span></div></div>';
    $('publishBody').innerHTML = html;
    $('publishFoot').innerHTML = publishDetailActions(t);
  }

  function publishDetailActions(t){
    var id = esc(t._id);
    var html = '';
    if(t.status === 'scheduled'){
      html += '<button class="inline-flex items-center gap-1 px-4 py-2 rounded-full bg-primary text-on-primary text-label-md font-label-md hover:opacity-90" data-act="pubRun" data-id="' + id + '" type="button"><span class="material-symbols-outlined text-base">play_arrow</span>立即执行</button>';
      html += '<button class="px-4 py-2 rounded-full bg-surface-container-low text-label-md font-label-md text-on-surface hover:bg-surface-container-high" data-act="pubCancel" data-id="' + id + '" type="button">取消任务</button>';
    }
    if(t.status === 'failed' || t.status === 'canceled'){
      html += '<button class="inline-flex items-center gap-1 px-4 py-2 rounded-full bg-primary text-on-primary text-label-md font-label-md hover:opacity-90" data-act="pubRetry" data-id="' + id + '" type="button"><span class="material-symbols-outlined text-base">replay</span>重试</button>';
    }
    if(t.status === 'needs_confirm' || t.status === 'submitted'){
      html += '<button class="inline-flex items-center gap-1 px-4 py-2 rounded-full bg-secondary-fixed text-on-secondary-fixed-variant text-label-md font-label-md hover:brightness-95" data-act="pubComplete" data-id="' + id + '" type="button"><span class="material-symbols-outlined text-base">task_alt</span>标记已发布</button>';
    }
    if(t.status === 'failed' || t.status === 'canceled'){
      html += '<button class="px-4 py-2 rounded-full bg-surface-container-low text-label-md font-label-md text-[#8e3b26] hover:bg-[#fce3dd]" data-act="pubDelete" data-id="' + id + '" type="button">删除任务</button>';
    }
    html += '<button class="px-5 py-2 rounded-full bg-surface-container-low text-label-md font-label-md text-on-surface hover:bg-surface-container-high" data-act="pubClose" type="button">关闭</button>';
    return html;
  }

  function loadPublishDetailExtras(t){
    request('/publish/tasks/' + encodeURIComponent(t._id) + '/log').then(function(res){
      var el = $('pubLog');
      if(el) el.textContent = (res && res.log) || '（暂无日志）';
    }).catch(function(){
      var el = $('pubLog');
      if(el) el.textContent = '（日志读取失败）';
    });
    request('/publish/tasks/' + encodeURIComponent(t._id) + '/screenshots').then(function(res){
      var el = $('pubShots');
      if(!el) return;
      var shots = (res && res.screenshots) || [];
      if(!shots.length){
        el.innerHTML = '<span class="pub-empty">暂无截图。任务失败或停在发布前时，会自动保存当时页面截图。</span>';
        return;
      }
      el.innerHTML = shots.map(function(s){
        return '<a href="' + esc(s.url) + '" target="_blank" rel="noopener" title="' + esc(s.name) + '"><img loading="lazy" src="' + esc(s.url) + '" alt="页面截图"><span>' + esc(s.name) + '</span></a>';
      }).join('');
    }).catch(function(){
      var el = $('pubShots');
      if(el) el.innerHTML = '<span class="pub-empty">截图读取失败</span>';
    });
    setTimeout(function(){
      var log = $('pubLog');
      if(log) log.scrollTop = log.scrollHeight;
    }, 320);
  }

  function pubTaskAction(id, action, body){
    var labels = { run:'已触发执行', cancel:'任务已取消', retry:'已重新排入队列', complete:'已标记为发布成功' };
    return request('/publish/tasks/' + encodeURIComponent(id) + '/' + action, {
      method: 'POST',
      body: JSON.stringify(body || {})
    }).then(function(){
      if(action === 'run' || action === 'retry') PUB.watch = { id:id, until: Date.now() + 10 * 60 * 1000 };
      return loadPublishData();
    }).then(function(){
      return loadTable('calendar').catch(function(){ /* 日历刷新失败不影响操作结果 */ });
    }).then(function(){
      render();
      var t = pubTaskById(id);
      if($('publishModal').classList.contains('on') && PUB.mode === 'detail'){
        if(t) openPublishDetail(t); else closePublishModal();
      }
      toast((labels[action] || '操作成功') + ' · ' + hhmm(), 'ok');
    }).catch(function(err){
      toast('操作失败：' + errMsg(err), 'err');
    });
  }

  function completePublishTask(id){
    var input = $('pubResultUrl');
    var publishUrl = input ? String(input.value || '').trim() : '';
    pubTaskAction(id, 'complete', { publishUrl: publishUrl });
  }

  function askDeletePublish(t){
    if(!t) return;
    pendingDelete = { kind:'publish', id:t._id };
    $('modalTitle').textContent = '删除这个发布任务？';
    $('modalText').textContent = '「' + t.code + ' · ' + (t.title || '未命名') + '」将删除本地任务、日志与截图；已发布的作品不受影响。';
    $('modalOk').textContent = '确认删除';
    $('modal').classList.add('on');
  }

  /* ---------- render ---------- */
  function render(){
    var v = $('view');
    if(state.view === 'home') v.innerHTML = viewHome();
    else if(state.view === 'topics') v.innerHTML = viewTopics();
    else if(state.view === 'calendar') v.innerHTML = viewCalendar();
    else if(state.view === 'publish') v.innerHTML = viewPublish();
    else if(state.view === 'review') v.innerHTML = viewReview();
    else if(state.view === 'assets') v.innerHTML = viewAssets();
    else if(state.view === 'connections') v.innerHTML = viewConnections();
    syncTopicCheckAll();

    var pending = DATA.topic.filter(function(r){ return r['状态'] === '待写'; }).length;
    var badge = $('badgeTopic');
    if(badge){
      badge.textContent = pending > 99 ? '99+' : String(pending);
      badge.style.display = pending ? 'flex' : 'none';
    }
    var links = document.querySelectorAll('#sideNav .nav-link');
    for(var i = 0; i < links.length; i++){
      var on = links[i].getAttribute('data-tab') === state.view;
      links[i].className = 'nav-link relative group flex items-center justify-center w-12 h-12 rounded-xl transition-all' + (on ? ' active' : '');
    }
    var notifyDot = $('notifyDot');
    if(notifyDot) notifyDot.style.display = (DATA.calendar.some(function(r){
      var d = parseDate(r['计划发布时间']);
      return d && d < startOfDay(new Date()) && ['已发布','二次分发','已复盘'].indexOf(r['当前阶段']) < 0;
    }) ? 'block' : 'none');
    var needConfirm = PUB.tasks.filter(function(t){ return t.status === 'needs_confirm'; }).length;
    var pubBadge = $('badgePublish');
    if(pubBadge){
      pubBadge.textContent = needConfirm > 99 ? '99+' : String(needConfirm);
      pubBadge.style.display = needConfirm ? 'flex' : 'none';
    }
    var exportBtn = $('exportBtn');
    if(exportBtn) exportBtn.style.display = (state.view === 'connections' || state.view === 'publish') ? 'none' : '';
    syncVoiceIcons();
    armPublishPoll();
  }

  function switchView(view){
    state.view = view;
    state.q = '';
    state.assetId = null;
    if(location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
    render();
    scrollTop();
    if(view === 'publish'){
      loadPublishData().then(render).catch(function(err){
        toast('发布队列加载失败：' + errMsg(err), 'err');
      });
    }
  }

  /* ---------- interaction ---------- */
  var side = $('sideNav');
  if(side){
    side.addEventListener('click', function(e){
      var a = e.target.closest ? e.target.closest('.nav-link') : null;
      if(!a) return;
      e.preventDefault();
      switchView(a.getAttribute('data-tab'));
    });
  }

  var pf = $('pfFilter');
  if(pf){
    pf.addEventListener('change', function(){
      state.platform = this.value;
      render();
    });
  }
  $('refreshBtn').addEventListener('click', function(){ loadAllData(); });
  $('exportBtn').addEventListener('click', function(){
    var map = { home:'calendar', topics:'topic', calendar:'calendar', review:'review', assets:'asset' };
    window.location.href = '/api/tables/' + (map[state.view] || 'calendar') + '/export.csv';
  });
  var profileBtn = $('profileBtn');
  if(profileBtn) profileBtn.addEventListener('click', openProfileEditor);

  var helpBtn = $('helpBtn');
  if(helpBtn) helpBtn.addEventListener('click', function(){
    openInfo('使用提示', '· 所有写入即时保存到本地 SQLite 数据库\n· 阶段 / 状态下拉选完即存\n· 发布后可直接补录当日数据快照\n· 支持多标签页实时同步与 CSV 导出');
  });
  var notifyBtn = $('notifyBtn');
  if(notifyBtn) notifyBtn.addEventListener('click', function(){
    var n = DATA.calendar.filter(function(r){
      var d = parseDate(r['计划发布时间']);
      return d && d < startOfDay(new Date()) && ['已发布','二次分发','已复盘'].indexOf(r['当前阶段']) < 0;
    }).length;
    toast(n ? ('有 ' + n + ' 条排期已逾期，去内容日历处理') : '没有新的提醒');
  });
  var logoutBtn = $('logoutBtn');
  if(logoutBtn) logoutBtn.addEventListener('click', function(){
    openInfo('本地数据服务', '工作台数据保存在 data/workbench.db（SQLite）。\nCSV 备份可通过右上角「导出 CSV」或 /api/tables/{topic|calendar|review|asset}/export.csv 获取。');
  });

  var globalSearch = $('globalSearch');
  if(globalSearch){
    globalSearch.addEventListener('keydown', function(e){
      if(e.key === 'Enter'){
        var q = this.value.trim();
        if(state.view !== 'topics' && state.view !== 'assets') state.view = 'topics';
        state.q = q;
        render();
      }
    });
  }
  document.addEventListener('keydown', function(e){
    if((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')){
      e.preventDefault();
      var gs = $('globalSearch');
      if(gs) gs.focus();
    }
  });

  /* filtered change events */
  var viewEl = $('view');
  viewEl.addEventListener('change', function(e){
    var t = e.target;
    var tid = t && t.getAttribute ? t.getAttribute('data-topic-check') : null;
    if(tid){
      if(t.checked) state.topicChecked[tid] = true;
      else delete state.topicChecked[tid];
      render();
      return;
    }
    if(t.id === 'topicCheckAll'){
      var on = !!t.checked;
      topicRows().forEach(function(r){
        if(on) state.topicChecked[r['_id']] = true;
        else delete state.topicChecked[r['_id']];
      });
      render();
      return;
    }
    var qk = t && t.getAttribute ? t.getAttribute('data-quick') : null;
    if(qk){
      quickUpdate(qk, t.getAttribute('data-id'), t.getAttribute('data-qfield'), t.value);
      return;
    }
    if(t.id === 'stageFilter'){ state.stage = t.value; render(); return; }
    if(t.id === 'reviewRange'){ state.reviewRange = t.value; state.lifecyclePage = 1; state.reviewListPage = 1; render(); return; }
    if(t.id === 'lifecycleSize'){
      state.lifecycleSize = parseInt(t.value, 10) || 30;
      state.lifecyclePage = 1;
      render();
      return;
    }
    if(t.id === 'reviewListSize'){
      state.reviewListSize = parseInt(t.value, 10) || 30;
      state.reviewListPage = 1;
      render();
      return;
    }
    if(t.id === 'statusFilter'){ state.status = t.value; render(); return; }
  });
  viewEl.addEventListener('input', function(e){
    var t = e.target;
    if(t.id === 'qTopic' || t.id === 'qAsset'){
      state.q = t.value;
      var pos = t.selectionStart;
      render();
      var again = $(t.id);
      if(again){ again.focus(); again.setSelectionRange(pos, pos); }
      return;
    }
    if(t.id === 'inlineScore'){
      state.topicDraft = state.topicDraft || {};
      state.topicDraft.score = t.value;
      var badge = $('inlineScoreBadge');
      if(badge) badge.textContent = Number(t.value).toFixed(1) + ' 分';
      return;
    }
    var dk = t.getAttribute ? t.getAttribute('data-draft') : null;
    if(dk){
      state.topicDraft = state.topicDraft || {};
      state.topicDraft[dk] = t.value;
    }
  });
  viewEl.addEventListener('change', function(e){
    var t = e.target;
    if(t.getAttribute && t.getAttribute('data-inline-tag')){
      state.topicDraft = state.topicDraft || {};
      var tags = [];
      var boxes = document.querySelectorAll('[data-inline-tag]:checked');
      for(var i = 0; i < boxes.length; i++) tags.push(boxes[i].getAttribute('data-inline-tag'));
      state.topicDraft.tags = tags;
    }
  });

  viewEl.addEventListener('dblclick', function(e){
    if(e.target.closest && e.target.closest('input,label,select,button,a')) return;
    var tr = e.target.closest ? e.target.closest('[data-row-topic]') : null;
    if(!tr) return;
    state.inlineTopic = tr.getAttribute('data-row-topic');
    state.topicDraft = null;
    render();
    var box = $('inlineInspector');
    if(box) box.scrollIntoView({ behavior:'smooth', block:'start' });
  });

  viewEl.addEventListener('click', function(e){
    var t = e.target;
    if(t && t.tagName === 'A') return;
    var actEl = t.closest ? t.closest('[data-act]') : null;
    if(!actEl) return;
    var act = actEl.getAttribute('data-act');
    var dbKey = actEl.getAttribute('data-db');
    var id = actEl.getAttribute('data-id');

    if(act === 'new'){ e.preventDefault(); openEditor(dbKey, null, null); return; }
    if(act === 'edit'){ e.preventDefault(); e.stopPropagation(); openEditor(dbKey, id); return; }
    if(act === 'del'){ e.preventDefault(); e.stopPropagation(); askDelete(dbKey, id, actEl.getAttribute('data-name')); return; }
    if(act === 'day'){ e.preventDefault(); e.stopPropagation(); openEditor('calendar', null, { date: actEl.getAttribute('data-date') }); return; }
    if(act === 'dayMore'){
      e.preventDefault(); e.stopPropagation();
      var date = actEl.getAttribute('data-date');
      var list = DATA.calendar.filter(function(r){ return !state.platform || state.platform === 'all' || platformList(r['平台']).indexOf(state.platform) >= 0; }).filter(function(r){ return dayKey(r['计划发布时间']) === date; });
      openInfo(date + ' 的排期', list.length ? list.map(function(r){ return '· ' + fmtTimeOnly(r['计划发布时间']) + '  ' + (r['标题'] || '（未命名）') + '  [' + (r['当前阶段'] || '') + ']'; }).join('\n') : '当天没有排期');
      return;
    }
    if(act === 'prevMonth'){ shiftMonth(-1); return; }
    if(act === 'nextMonth'){ shiftMonth(1); return; }
    if(act === 'todayMonth'){ var n = new Date(); state.month = { y:n.getFullYear(), m:n.getMonth() }; render(); return; }
    if(act === 'openAsset'){ e.preventDefault(); state.assetId = id; render(); return; }
    if(act === 'publish'){ e.preventDefault(); markPublished(id); return; }
    if(act === 'postpone'){ e.preventDefault(); postpone(id); return; }
    if(act === 'toSchedule'){
      e.preventDefault();
      var topic = null;
      DATA.topic.forEach(function(r){ if(r['_id'] === id) topic = r; });
      if(!topic) return;
      openEditor('calendar', null, {
        fill: {
          '选题ID': topic['选题ID'] || '',
          '标题': topic['选题'] || '',
          '平台': topic['平台'] || ''
        },
        subText: '选题 ' + (topic['选题ID'] || '') + ' 已带入，选好发布时间即可保存'
      });
      return;
    }
    if(act === 'rvMode'){ state.reviewMode = actEl.getAttribute('data-mode') || 'agg'; state.lifecyclePage = 1; state.reviewListPage = 1; render(); return; }
    if(act === 'lifecyclePage'){
      e.preventDefault();
      state.lifecyclePage = parseInt(actEl.getAttribute('data-page'), 10) || 1;
      render();
      return;
    }
    if(act === 'reviewPage'){
      e.preventDefault();
      state.reviewListPage = parseInt(actEl.getAttribute('data-page'), 10) || 1;
      render();
      return;
    }
    if(act === 'xhsSync'){ e.preventDefault(); syncXhs(actEl); return; }
    if(act === 'douyinSync'){ e.preventDefault(); syncDouyin(actEl); return; }
    if(act === 'channelsSync'){ e.preventDefault(); syncChannels(actEl); return; }
    if(act === 'rec'){
      e.preventDefault();
      var code = actEl.getAttribute('data-calcode') || '';
      var platform = actEl.getAttribute('data-platform') || '';
      if(!code) return;
      openEditor('review', null, {
        fill: { '排期ID': code, '平台': platform },
        subText: '已带出排期与平台，数字可以先估一份，累计到今天'
      });
      return;
    }
    if(act === 'goto'){
      e.preventDefault();
      var target = actEl.getAttribute('data-view');
      if(!target) return;
      var status = actEl.getAttribute('data-status');
      var stage = actEl.getAttribute('data-stage');
      if(status) state.status = status;
      if(stage) state.stage = stage;
      switchView(target);
      return;
    }
    if(act === 'statusTab'){
      state.status = actEl.getAttribute('data-val') || 'all';
      render();
      return;
    }
    if(act === 'clearTopicChecked'){
      state.topicChecked = {};
      render();
      return;
    }
    if(act === 'sortTopic'){
      state.topicSort = state.topicSort === 'desc' ? 'asc' : 'desc';
      render();
      return;
    }
    if(act === 'calStage'){
      state.stage = actEl.getAttribute('data-val') || 'all';
      render();
      return;
    }
    if(act === 'exportCal'){
      window.location.href = '/api/tables/calendar/export.csv';
      return;
    }
    if(act === 'topicNew'){
      state.inlineTopic = null;
      state.topicDraft = null;
      render();
      var nameInput = $('inlineName');
      if(nameInput){ nameInput.focus(); nameInput.scrollIntoView({ behavior:'smooth', block:'center' }); }
      return;
    }
    if(act === 'editInlineTopic'){
      state.inlineTopic = id;
      state.topicDraft = null;
      render();
      var box2 = $('inlineInspector');
      if(box2) box2.scrollIntoView({ behavior:'smooth', block:'start' });
      return;
    }
    if(act === 'inlineReset'){
      state.inlineTopic = null;
      state.topicDraft = null;
      render();
      return;
    }
    if(act === 'inlineSave'){
      saveInlineTopic();
      return;
    }
    if(act === 'editProfile'){
      e.preventDefault();
      openProfileEditor();
      return;
    }
    if(act === 'connReload'){
      connData = null;
      loadConnections();
      return;
    }
    if(act === 'connSave'){
      e.preventDefault();
      connSave(actEl.getAttribute('data-platform'));
      return;
    }
    if(act === 'connTest'){
      e.preventDefault();
      connTest(actEl.getAttribute('data-platform'));
      return;
    }
    if(act === 'connLogin'){
      e.preventDefault();
      connLogin(actEl.getAttribute('data-platform'));
      return;
    }
    if(act === 'connToggle'){
      e.preventDefault();
      connToggle(actEl.getAttribute('data-platform'));
      return;
    }
    if(act === 'connClear'){
      e.preventDefault();
      connClear(actEl.getAttribute('data-platform'), actEl.getAttribute('data-key'));
      return;
    }
    if(act === 'assetKw'){
      state.assetKeyword = actEl.getAttribute('data-val') || 'all';
      render();
      return;
    }
    if(act === 'assetSort'){
      state.q = state.q;
      toast('当前按归档日期倒序展示');
      return;
    }
    if(act === 'copyMd'){
      var rec = null;
      DATA.asset.forEach(function(r){ if(r['_id'] === id) rec = r; });
      if(rec){
        var md = String(rec['成稿Markdown'] || '');
        if(navigator.clipboard && navigator.clipboard.writeText){
          navigator.clipboard.writeText(md).then(function(){ toast('Markdown 已复制到剪贴板'); }, function(){ toast('复制失败，请手动选择正文', 'err'); });
        } else {
          toast('当前浏览器不支持剪贴板写入', 'err');
        }
      }
      return;
    }
    if(act === 'inspect'){
      state.inspectCode = actEl.getAttribute('data-code') || null;
      render();
      return;
    }
    if(act === 'openTopic'){
      var code3 = actEl.getAttribute('data-code') || '';
      state.view = 'topics';
      state.q = code3;
      state.status = 'all';
      state.assetId = null;
      render();
      scrollTop();
      return;
    }
    if(act === 'deriveTopic'){
      var code4 = actEl.getAttribute('data-code');
      var g = null;
      reviewGroups().forEach(function(x){ if(x.code === code4) g = x; });
      if(!g) return;
      state.view = 'topics';
      state.q = '';
      state.status = 'all';
      state.inlineTopic = null;
      state.topicDraft = {
        name: g.title + ' · 续篇',
        platform: g.platform || '公众号',
        status: '待写',
        angle: '承接《' + g.title + '》的复盘结论，补足评论区高频问题与可执行清单。',
        score: 8.0,
        tags: ['干货','观点'],
        url: ''
      };
      render();
      scrollTop();
      toast('已在选题面板生成「续篇」草稿，确认后保存');
      return;
    }
    if(act === 'linkSchedule'){
      var asset = null;
      DATA.asset.forEach(function(r){ if(r['_id'] === id) asset = r; });
      if(!asset) return;
      var cal = calendarByCode(asset['关联排期ID']);
      if(cal){ openEditor('calendar', cal['_id']); }
      else toast('这条素材还没有关联有效排期', 'err');
      return;
    }
    if(act === 'checkMissing'){
      var missing2 = missingSnapshots();
      if(!missing2.length){ toast('所有已发布作品今天都已打点'); return; }
      openInfo('快照异常检查', '共 ' + missing2.length + ' 条已发布排期今天还没有数据快照：\n' +
        missing2.slice(0, 6).map(function(r){ return '· ' + (r['标题'] || r['排期ID']) + '（' + r['排期ID'] + '）'; }).join('\n') +
        (missing2.length > 6 ? '\n… 等 ' + missing2.length + ' 条' : '') +
        '\n\n点击「一键催更」可优先带出第一条待补录排期。');
      return;
    }
    if(act === 'explainRate'){
      var l7 = last7Stats();
      openInfo('互动率算法拆解', '互动率 = 近 7 天点赞 ÷ 近 7 天阅读播放。\n当前样本：点赞 ' + fmtNum(l7.like) + ' / 阅读 ' + fmtNum(l7.read) + ' = ' + l7.rate.toFixed(2) + '%。');
      return;
    }
    if(act === 'explainFans'){
      var rRows = reviewRows();
      var rRead = rRows.reduce(function(a,b){ return a + num(b['阅读播放']); }, 0);
      var rFans = rRows.reduce(function(a,b){ return a + num(b['涨粉']); }, 0);
      var rConv = rRows.reduce(function(a,b){ return a + num(b['转化']); }, 0);
      openInfo('转化与涨粉明细', '当前区间累计增粉 ' + fmtNum(rFans) + '，涨粉率 ' + pct(rFans, rRead) + '。\n转化合计 ' + fmtNum(rConv) + '，共 ' + rRows.length + ' 条快照。');
      return;
    }
    if(act === 'recMissing'){ recMissingSnapshot(); return; }
    if(act === 'voiceMemo'){ e.preventDefault(); openVoiceMemo(); return; }
    if(act === 'voicePlay'){ e.preventDefault(); playVoice(id); return; }
    if(act === 'pubNew'){
      e.preventDefault();
      var calRec = null;
      if(id) DATA.calendar.forEach(function(r){ if(r['_id'] === id) calRec = r; });
      openPublishCreate(calRec);
      return;
    }
    if(act === 'pubDetail'){ e.preventDefault(); openPublishDetail(pubTaskById(id)); return; }
    if(act === 'pubRun'){ e.preventDefault(); pubTaskAction(id, 'run'); return; }
    if(act === 'pubRetry'){ e.preventDefault(); pubTaskAction(id, 'retry'); return; }
    if(act === 'pubCancel'){ e.preventDefault(); pubTaskAction(id, 'cancel'); return; }
    if(act === 'pubDelete'){ e.preventDefault(); askDeletePublish(pubTaskById(id)); return; }
    if(act === 'pubReload'){
      e.preventDefault();
      loadPublishData().then(render).catch(function(err){ toast('刷新失败：' + errMsg(err), 'err'); });
      return;
    }
    if(act === 'pubAutoQueueAll'){
      e.preventDefault();
      scanPendingSchedules();
      return;
    }
  });

  function recMissingSnapshot(){
    var missing = byPlatform(DATA.calendar).filter(function(r){
      return ['已发布','二次分发','已复盘'].indexOf(r['当前阶段']) >= 0 && !hasSnapshotToday(r['排期ID']);
    });
    if(!missing.length){ toast('没有待补录的排期'); return; }
    var first = missing[0];
    openEditor('review', null, {
      fill: { '排期ID': first['排期ID'], '平台': platformList(first['平台'])[0] || '' },
      subText: '共 ' + missing.length + ' 条待补录，已优先带出「' + (first['标题'] || first['排期ID']) + '」'
    });
  }

  function postpone(id){
    var rec = null;
    DATA.calendar.forEach(function(r){ if(r['_id'] === id) rec = r; });
    if(!rec) return;
    var d = parseDate(rec['计划发布时间']);
    if(!d) return;
    d = addDays(d, 1);
    suppressUntil = Date.now() + 1500;
    OPS.calendar.upd(id, { '计划发布时间': { date: d.toISOString() } }).then(function(){
      return loadTable('calendar');
    }).then(function(){
      render();
      toast('已顺延至 ' + fmtDateTime(d) + ' · ' + hhmm(), 'ok');
    }).catch(function(err){ toast('顺延失败：' + errMsg(err), 'err'); });
  }

  function shiftMonth(delta){
    if(!state.month){ var n = new Date(); state.month = { y:n.getFullYear(), m:n.getMonth() }; }
    var y = state.month.y, m = state.month.m + delta;
    if(m < 0){ m = 11; y -= 1; }
    if(m > 11){ m = 0; y += 1; }
    state.month = { y:y, m:m };
    render();
  }

  /* ---------- drawer form ---------- */
  function todayISO(){
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function applyDefaults(dbKey, recordId){
    if(recordId) return;
    var defaults = {
      topic: { '状态': '待写', '创建日期': todayISO(), '平台': state.platform !== 'all' ? state.platform : '公众号' },
      calendar: { '当前阶段': '选题确认', '内容形式': '图文', '平台': state.platform !== 'all' ? state.platform : '公众号' },
      review: { '统计日期': todayISO(), '平台': state.platform !== 'all' ? state.platform : '公众号' },
      asset: { '归档日期': todayISO(), '平台': state.platform !== 'all' ? state.platform : '公众号' }
    }[dbKey] || {};
    Object.keys(defaults).forEach(function(name){
      var value = defaults[name];
      if(value === 'all' || value == null) return;
      if(dbKey === 'calendar' && name === '平台'){
        var boxes = document.querySelectorAll('[data-field="平台"]');
        for(var b = 0; b < boxes.length; b++){
          if(boxes[b].value === value) boxes[b].checked = true;
        }
        return;
      }
      var el = document.querySelector('[data-field="' + name + '"]');
      if(!el || el.value) return;
      if(el.tagName === 'SELECT'){
        var hit = false;
        for(var i = 0; i < el.options.length; i++){
          if(el.options[i].value === value) hit = true;
        }
        if(!hit) return;
      }
      el.value = value;
    });
  }

  function openEditor(dbKey, recordId, preset){
    editing.dbKey = dbKey;
    editing.recordId = recordId || null;
    var rec = null;
    if(recordId){
      DATA[dbKey].forEach(function(r){ if(r['_id'] === recordId) rec = r; });
    }
    editing.record = rec;

    $('drawerTitle').textContent = (recordId ? '编辑' : '新增') + ' · ' + DB_LABEL[dbKey];
    $('drawerSub').textContent = recordId ? (rec && rec[ID_FIELD[dbKey]] ? rec[ID_FIELD[dbKey]] : '未命名记录') : '填写后点保存，立即生效';
    $('drawerKicker').textContent = dbKey === 'topic' ? '选题字段录入' : dbKey === 'calendar' ? '排期字段录入' : dbKey === 'review' ? '快照字段录入' : '素材字段录入';

    var props = SCHEMAS[dbKey] || [];
    if(!props.length){
      $('drawerBody').innerHTML = emptyState('表结构还没加载完', '请点右上角刷新后重试', 'sync_problem');
    } else {
      var html = '';
      var calForm = dbKey === 'calendar';
      if(calForm){
        html += '<div class="form-grid cal-form">';
      }
      var CAL_TAIL = ['标签', '是否开启原创声明', '是否包含AI生成内容', '谁可以看'];
      // 发布链接字段暂不在内容日历表单中展示，数据库与接口仍保留
      var CAL_FORM_HIDDEN = ['发布链接'];
      props.forEach(function(p){
        if(calForm && CAL_FORM_HIDDEN.indexOf(p.name) >= 0) return;
        if(calForm && CAL_TAIL.indexOf(p.name) >= 0) return;
        var full = calForm && (p.name === '标题' || p.name === '备注' || p.name === '平台');
        html += fieldHtml(p, rec ? rec[p.name] : null, dbKey, preset, full);
      });
      if(dbKey === 'review'){
        html += '<div class="rounded-xl bg-surface-container-low p-3 mb-4"><div class="flex items-center justify-between text-label-sm text-on-surface-variant mb-1"><span>实时派生指标</span><span id="rateHint">按当前输入计算</span></div><div id="ratePreview" class="flex items-center gap-4 text-headline-sm font-headline-md text-on-surface"><span>互动率 <b id="rateLike" class="text-[#785d00]">—</b></span><span>涨粉率 <b id="rateFans" class="text-[#23583a]">—</b></span></div></div>';
      }
      if(calForm){
        html += '<div class="fld full"><label class="lab">发布素材 <span class="text-outline normal-case">· 短视频 1 个视频；图文 / 长图最多 30 张图片</span></label><div id="calMediaBlock"></div></div>';
        html += '<div class="fld full" id="calCoverFld" style="display:none"><label class="lab">封面 <span class="text-outline normal-case">· 图文 / 长图 / 短视频可设置，支持裁剪</span></label><div id="calCoverBlock"></div></div>';
        props.forEach(function(p){
          if(CAL_FORM_HIDDEN.indexOf(p.name) >= 0) return;
          if(CAL_TAIL.indexOf(p.name) < 0) return;
          var tailFull = p.name === '标签' || p.name === '谁可以看';
          html += fieldHtml(p, rec ? rec[p.name] : null, dbKey, preset, tailFull);
        });
        html += '</div>';
      }
      $('drawerBody').innerHTML = html;
    }
    applyDefaults(dbKey, recordId);
    if(preset && preset.fill){
      Object.keys(preset.fill).forEach(function(name){
        var val = preset.fill[name];
        if(dbKey === 'calendar' && name === '平台'){
          var want = platformList(val);
          var boxes = document.querySelectorAll('[data-field="平台"]');
          for(var b = 0; b < boxes.length; b++) boxes[b].checked = want.indexOf(boxes[b].value) >= 0;
          return;
        }
        var el = document.querySelector('[data-field="' + name + '"]');
        if(el && !el.readOnly && val != null && val !== '') el.value = val;
      });
      $('drawerSub').textContent = preset.subText || '已自动带入关联信息，补齐后保存即可';
    }
    $('drawerHint').textContent = '';
    $('drawerSave').disabled = false;
    $('drawerSave').innerHTML = '<span class="material-symbols-outlined text-base">check</span><span>保存到数据库</span>';
    $('drawer').classList.toggle('cal-popup', dbKey === 'calendar');
    $('drawer').classList.add('on');
    $('mask').classList.add('on');
    updateRatePreview();

    if(!(preset && preset.fill)) restoreDraft(dbKey, recordId);
    if(dbKey === 'calendar'){
      initCalendarCover(rec);
      initCalendarMedia(rec);
    } else {
      resetMediaEdit();
    }
  }
  function closeEditor(){
    calMediaSeq++;
    if((MEDIA_EDIT.pendingIds || []).length) calDiscardPending();
    if((CAL_COVER.pendingIds || []).length) calCoverDiscardPending();
    resetCalendarCover();
    resetMediaEdit();
    $('drawer').classList.remove('on');
    $('mask').classList.remove('on');
    editing.dbKey = null; editing.recordId = null; editing.record = null;
    if(staleWhileEditing){
      staleWhileEditing = false;
      setTimeout(scheduleReload, 60);
    }
  }
  /* ---------- 标签输入 ---------- */
  function tagChipsHtml(list){
    return list.map(function(t){
      return '<span class="tag-chip">' + esc(t) + '<button type="button" class="tag-chip-x" data-act="tagRemove" data-val="' + esc(t) + '" title="移除">×</button></span>';
    }).join('');
  }
  function readTagList(){
    var el = $('drawerBody').querySelector('[data-field="标签"]');
    if(!el) return [];
    try{
      var v = JSON.parse(el.value || '[]');
      return Array.isArray(v) ? v : [];
    } catch(err){ return []; }
  }
  function writeTagList(list){
    var el = $('drawerBody').querySelector('[data-field="标签"]');
    var chips = $('drawerBody').querySelector('[data-tags-chips]');
    if(chips) chips.innerHTML = tagChipsHtml(list);
    if(el){
      el.value = JSON.stringify(list);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  function addCalendarTags(raw){
    var list = readTagList();
    var changed = false;
    String(raw).split(/[\s,，]+/).forEach(function(t){
      t = t.trim();
      if(!t) return;
      if(t.length > 50) t = t.substring(0, 50);
      if(list.indexOf(t) < 0){ list.push(t); changed = true; }
    });
    if(changed) writeTagList(list);
    return changed;
  }

  function fieldHtml(p, value, dbKey, preset, full){
    var name = p.name;
    var type = p.type;
    var idAttr = ' data-field="' + esc(name) + '"';
    var html = '<div class="fld' + (full ? ' full' : '') + '"><label class="lab">' + esc(name) + (p.note ? ' <span class="text-outline normal-case">· ' + esc(p.note) + '</span>' : '') + '</label>';
    if(p.readonly){
      html += '<input type="text" class="inp" readonly value="' + esc(value == null ? '' : value) + '" placeholder="保存后自动生成" style="background:#f2f3f6;color:#75777a">';
      html += '</div>';
      return html;
    }
    if(type === 'select'){
      var opts = (p.config && p.config.options) ? p.config.options : [];
      html += '<select class="sel"' + idAttr + '><option value="">请选择</option>';
      opts.forEach(function(o){
        html += '<option value="' + esc(o.text) + '"' + (value === o.text ? ' selected' : '') + '>' + esc(o.text) + '</option>';
      });
      html += '</select>';
    } else if(type === 'multi_select'){
      var mopts = (p.config && p.config.options) ? p.config.options : [];
      var cur = value && value.length ? value : [];
      html += '<div class="tag-cloud">';
      mopts.forEach(function(o){
        var on = cur.indexOf(o.text) >= 0;
        html += '<label class="tag-opt"><input type="checkbox"' + idAttr + ' value="' + esc(o.text) + '"' + (on ? ' checked' : '') + '><span>' + esc(o.text) + '</span></label>';
      });
      html += '</div>';
    } else if(type === 'radio'){
      var ropts = (p.config && p.config.options) ? p.config.options : [];
      var picked = value || (ropts[0] ? ropts[0].text : '');
      html += '<div class="radio-row">';
      ropts.forEach(function(o){
        html += '<label class="radio-opt"><input type="radio"' + idAttr + ' name="r-' + esc(name) + '" value="' + esc(o.text) + '"' + (picked === o.text ? ' checked' : '') + '><span>' + esc(o.text) + '</span></label>';
      });
      html += '</div>';
    } else if(type === 'tags'){
      var tagList = Array.isArray(value) ? value : [];
      html += '<div class="tag-input" data-tags-wrap>';
      html += '<div class="tag-chips" data-tags-chips>' + tagChipsHtml(tagList) + '</div>';
      html += '<input type="text" class="tag-entry" data-tags-entry placeholder="输入后按回车或空格添加" autocomplete="off">';
      html += '</div>';
      html += '<input type="hidden"' + idAttr + ' value="' + esc(JSON.stringify(tagList)) + '">';
    } else if(type === 'number'){
      html += '<input type="number" step="any" class="inp"' + idAttr + ' value="' + (value == null ? '' : esc(value)) + '">';
    } else if(type === 'date'){
      var fmt = (p.config && p.config.format) ? p.config.format : 'yyyy-mm-dd';
      var withTime = fmt.indexOf('hh') >= 0;
      var inputVal = '';
      if(value){
        var d = parseDate(value);
        if(d){
          if(withTime) inputVal = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
          else inputVal = isoDay(d);
        }
      }
      if(!inputVal && preset && preset.date && (name === '计划发布时间' || name === '统计日期' || name === '创建日期' || name === '归档日期')){
        inputVal = withTime ? preset.date + 'T20:00' : preset.date;
      }
      html += '<input type="' + (withTime ? 'datetime-local' : 'date') + '" class="inp"' + idAttr + ' value="' + esc(inputVal) + '">';
    } else if(type === 'url'){
      var u = urlOf(value);
      html += '<input type="url" class="inp" placeholder="https://…" ' + idAttr + ' value="' + esc(u) + '">';
    } else if(type === 'checkbox'){
      html += '<label style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox"' + idAttr + (value ? ' checked' : '') + '><span class="text-label-sm">是</span></label>';
    } else {
      var longFields = ['成稿Markdown','配图说明','切入角度','复盘备注','备注'];
      var isLong = longFields.indexOf(name) >= 0;
      if(name === '成稿Markdown'){
        html += '<div class="md-tools mb-1.5"><button type="button" data-md="h2">H2 小标题</button><button type="button" data-md="quote">引用</button><button type="button" data-md="code">代码块</button><button type="button" data-md="list">列表</button></div>';
        html += '<textarea class="ta" rows="12" style="min-height:240px;font-family:ui-monospace,Consolas,monospace;font-size:12px"' + idAttr + '>' + esc(value == null ? '' : value) + '</textarea>';
      } else if(type === 'text'){
        html += '<input type="text" class="inp"' + idAttr + ' value="' + esc(value == null ? '' : value) + '">';
      } else {
        html += '<textarea class="ta"' + (isLong ? ' rows="3"' : ' rows="2"') + idAttr + '>' + esc(value == null ? '' : value) + '</textarea>';
      }
    }
    html += '</div>';
    return html;
  }
  function collectProps(){
    var dbKey = editing.dbKey;
    var props = SCHEMAS[dbKey] || [];
    var out = {};
    var keys = {};
    for(var i = 0; i < props.length; i++){
      var p = props[i];
      var name = p.name;
      var type = p.type;
      if(type === 'multi_select'){
        var boxes = document.querySelectorAll('[data-field="' + name + '"]:checked');
        var arr = [];
        for(var b = 0; b < boxes.length; b++) arr.push(boxes[b].value);
        if(arr.length) out[name] = { multi_select: arr };
        keys[name] = true;
        continue;
      }
      if(type === 'tags'){
        out[name] = { tags: readTagList() };
        keys[name] = true;
        continue;
      }
      if(type === 'radio'){
        var picked = document.querySelector('[data-field="' + name + '"]:checked');
        if(picked) out[name] = { select: picked.value };
        keys[name] = true;
        continue;
      }
      var el = document.querySelector('[data-field="' + name + '"]');
      if(!el) continue;
      if(type === 'checkbox'){
        out[name] = { checkbox: !!el.checked };
        keys[name] = true;
        continue;
      }
      var v = el.value;
      if(v == null) v = '';
      v = String(v).trim();
      if(v === '') continue;
      if(type === 'number'){
        var n = parseFloat(v);
        if(isNaN(n)) continue;
        out[name] = { number: n };
      } else if(type === 'select'){
        out[name] = { select: v };
      } else if(type === 'date'){
        var fmt = (p.config && p.config.format) ? p.config.format : 'yyyy-mm-dd';
        if(fmt.indexOf('hh') >= 0){
          var d = new Date(v);
          if(isNaN(d.getTime())) continue;
          out[name] = { date: d.toISOString() };
        } else {
          out[name] = { date: v.substring(0,10) };
        }
      } else if(type === 'url'){
        var low = v.toLowerCase();
        if(low.indexOf('http:') !== 0 && low.indexOf('https:') !== 0){
          throw new Error(name + ' 需要以 http 或 https 开头的完整链接');
        }
        out[name] = { url: { text: v, link: v } };
      } else {
        out[name] = { text: v };
      }
      keys[name] = true;
    }
    var known = {};
    (SCHEMAS[dbKey] || []).forEach(function(p){ known[p.name] = true; });
    Object.keys(out).forEach(function(k){
      if(!known[k]) throw new Error('字段「' + k + '」不在表结构里');
    });
    return out;
  }

  /* ---------- inline topic save ---------- */
  function saveInlineTopic(){
    var nameEl = $('inlineName');
    var platformEl = $('inlinePlatform');
    var statusEl = $('inlineStatus');
    var angleEl = $('inlineAngle');
    var scoreEl = $('inlineScore');
    var urlEl = $('inlineUrl');
    if(!nameEl || !platformEl){ return; }
    var name = String(nameEl.value || '').trim();
    var platform = String(platformEl.value || '').trim();
    if(!name){ toast('「选题名称」不能为空', 'err'); nameEl.classList.add('err'); nameEl.focus(); return; }
    nameEl.classList.remove('err');
    if(!platform){ toast('请选择目标平台', 'err'); return; }
    var ref = String(urlEl && urlEl.value || '').trim();
    if(ref){
      var low = ref.toLowerCase();
      if(low.indexOf('http:') !== 0 && low.indexOf('https:') !== 0){
        toast('参考来源需要以 http 或 https 开头', 'err');
        if(urlEl) urlEl.classList.add('err');
        return;
      }
      if(urlEl) urlEl.classList.remove('err');
    }
    var tags = [];
    var boxes = document.querySelectorAll('[data-inline-tag]:checked');
    for(var i = 0; i < boxes.length; i++) tags.push(boxes[i].getAttribute('data-inline-tag'));
    var props = {
      '选题': { text: name },
      '平台': { select: platform },
      '状态': { select: String(statusEl && statusEl.value || '待写') },
      '爆款潜力评分': { number: Number(scoreEl && scoreEl.value || 0) }
    };
    var angle = String(angleEl && angleEl.value || '').trim();
    if(angle) props['切入角度'] = { text: angle };
    if(tags.length) props['标签'] = { multi_select: tags };
    if(ref) props['参考链接'] = { url: { text: ref, link: ref } };
    if(!state.inlineTopic) props['创建日期'] = { date: todayISO() };
    suppressUntil = Date.now() + 1500;
    var op = state.inlineTopic ? OPS.topic.upd(state.inlineTopic, props) : OPS.topic.add(props);
    op.then(function(){ return loadTable('topic'); }).then(function(){
      var wasEdit = !!state.inlineTopic;
      state.inlineTopic = null;
      state.topicDraft = null;
      render();
      toast((wasEdit ? '选题已更新' : '选题已保存，ID 已自动生成') + ' · ' + hhmm(), 'ok');
    }).catch(function(err){
      toast('保存失败：' + errMsg(err), 'err');
    });
  }

  /* ---------- review live rates ---------- */
  function updateRatePreview(){
    if(!editing.dbKey || editing.dbKey !== 'review') return;
    var readEl = document.querySelector('[data-field="阅读播放"]');
    var likeEl = document.querySelector('[data-field="点赞"]');
    var fansEl = document.querySelector('[data-field="涨粉"]');
    var rl = $('rateLike'), rf = $('rateFans');
    if(!rl || !rf) return;
    var read = readEl ? num(readEl.value) : 0;
    var like = likeEl ? num(likeEl.value) : 0;
    var fans = fansEl ? num(fansEl.value) : 0;
    rl.textContent = read ? (like / read * 100).toFixed(2) + '%' : '—';
    rf.textContent = read ? (fans / read * 100).toFixed(2) + '%' : '—';
  }

  /* ---------- draft cache (localStorage) ---------- */
  function draftKey(dbKey, recordId){ return 'wb_workbench_draft_' + dbKey + '_' + (recordId || 'new'); }
  function saveDraft(){
    if(!editing.dbKey) return;
    try{
      var body = $('drawerBody');
      var data = {};
      var inputs = body.querySelectorAll('[data-field]');
      for(var i = 0; i < inputs.length; i++){
        var el = inputs[i];
        var f = el.getAttribute('data-field');
        if(el.type === 'checkbox'){
          if(!data[f]) data[f] = [];
          if(el.checked) data[f].push(el.value || 'true');
        } else if(el.type !== 'radio'){
          data[f] = el.value;
        }
      }
      localStorage.setItem(draftKey(editing.dbKey, editing.recordId), JSON.stringify(data));
    } catch(err){ /* 存储不可用时静默降级 */ }
  }
  function restoreDraft(dbKey, recordId){
    if(recordId) return;
    try{
      var raw = localStorage.getItem(draftKey(dbKey, recordId));
      if(!raw) return;
      var data = JSON.parse(raw);
      Object.keys(data).forEach(function(f){
        var els = document.querySelectorAll('[data-field="' + f + '"]');
        for(var i = 0; i < els.length; i++){
          var el = els[i];
          if(el.type === 'checkbox'){
            if(f === '平台' && dbKey === 'calendar' && !recordId && state.platform && state.platform !== 'all') continue;
            el.checked = data[f] && data[f].indexOf(el.value) >= 0;
          } else if(data[f] != null && data[f] !== ''){
            // 新建记录时，平台优先跟随头部渠道筛选，不被残留草稿覆盖
            if(!(f === '平台' && !recordId && state.platform && state.platform !== 'all')) el.value = data[f];
          }
        }
      });
      var chips = $('drawerBody').querySelector('[data-tags-chips]');
      if(chips) chips.innerHTML = tagChipsHtml(readTagList());
      $('drawerHint').textContent = '已恢复上次未保存的草稿';
      updateRatePreview();
    } catch(err){ /* 忽略损坏的草稿 */ }
  }
  function clearDraft(dbKey, recordId){
    try{ localStorage.removeItem(draftKey(dbKey, recordId)); } catch(err){}
  }

  $('drawerBody').addEventListener('input', function(){
    updateRatePreview();
    clearTimeout(saveDraft._t);
    saveDraft._t = setTimeout(saveDraft, 300);
  });
  $('drawerBody').addEventListener('keydown', function(e){
    var entry = e.target && e.target.getAttribute && e.target.getAttribute('data-tags-entry') !== null ? e.target : null;
    if(!entry) return;
    if(e.isComposing || e.keyCode === 229) return;
    var key = e.key;
    if(key === 'Enter' || key === ' ' || key === 'Spacebar'){
      e.preventDefault();
      addCalendarTags(entry.value);
      entry.value = '';
      return;
    }
    if(key === 'Backspace' && entry.value === ''){
      var list = readTagList();
      if(list.length){
        e.preventDefault();
        list.pop();
        writeTagList(list);
      }
    }
  });
  $('drawerBody').addEventListener('change', function(e){
    if(e.target && e.target.getAttribute && e.target.getAttribute('data-field') === '内容形式'){
      onCalendarFormatChange();
    } else if(e.target && e.target.id === 'calMediaFile'){
      onCalendarMediaChange(e);
    } else if(e.target && e.target.id === 'calCoverFile'){
      onCalendarCoverChange(e);
    }
    updateRatePreview();
    clearTimeout(saveDraft._t);
    saveDraft._t = setTimeout(saveDraft, 300);
  });
  $('drawerBody').addEventListener('click', function(e){
    var btn = e.target.closest ? e.target.closest('[data-md]') : null;
    if(!btn){
      var actEl = e.target.closest ? e.target.closest('[data-act]') : null;
      if(!actEl) return;
      var act = actEl.getAttribute('data-act');
      if(act === 'calPickMedia'){
        e.preventDefault();
        var fileEl = $('calMediaFile');
        if(fileEl) fileEl.click();
        return;
      }
      if(act === 'calCoverPick'){
        e.preventDefault();
        if(CAL_COVER.uploading){ toast('封面正在上传，请稍候', 'err'); return; }
        var coverEl = $('calCoverFile');
        if(coverEl) coverEl.click();
        return;
      }
      if(act === 'calCoverRecrop'){
        e.preventDefault();
        if(CAL_COVER.source) openCoverCrop(CAL_COVER.source);
        return;
      }
      if(act === 'calCoverFromItem'){
        e.preventDefault();
        openCoverCropFromItem(actEl.getAttribute('data-media-id'));
        return;
      }
      if(act === 'calCoverRemove'){
        e.preventDefault();
        removeCalendarCover();
        return;
      }
      if(act === 'tagRemove'){
        e.preventDefault();
        var tagVal = actEl.getAttribute('data-val');
        writeTagList(readTagList().filter(function(t){ return t !== tagVal; }));
        return;
      }
      if(act === 'mediaUp' || act === 'mediaDown' || act === 'mediaRemove'){
        e.preventDefault();
        var mid = actEl.getAttribute('data-media-id');
        if(act === 'mediaUp') moveCalendarMedia(mid, -1);
        else if(act === 'mediaDown') moveCalendarMedia(mid, 1);
        else removeCalendarMedia(mid);
      }
      return;
    }
    e.preventDefault();
    var ta = document.querySelector('[data-field="成稿Markdown"]');
    if(!ta) return;
    var kind = btn.getAttribute('data-md');
    var snippets = {
      h2: '\n## 小标题\n',
      quote: '\n> 写一句可以单独传播的金句\n',
      code: '\n```\n在这里粘贴代码或固定文案\n```\n',
      list: '\n- 要点一\n- 要点二\n- 要点三\n'
    };
    var text = snippets[kind] || '';
    var start = ta.selectionStart || ta.value.length;
    ta.value = ta.value.substring(0, start) + text + ta.value.substring(ta.selectionEnd || start);
    ta.focus();
    ta.setSelectionRange(start + text.length, start + text.length);
    saveDraft();
  });

  /* ---------- save ---------- */
  function setSaving(on){
    var btn = $('drawerSave');
    btn.disabled = !!on;
    btn.innerHTML = on ? '<span class="material-symbols-outlined text-base animate-spin">progress_activity</span><span>保存中…</span>' : '<span class="material-symbols-outlined text-base">check</span><span>保存到数据库</span>';
  }
  function hhmm(){ var d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  function saveRecord(){
    if(!editing.dbKey) return;
    var dbKey = editing.dbKey;
    var recordId = editing.recordId;
    var props;
    try{
      props = collectProps();
    } catch(err){
      toast(errMsg(err), 'err');
      return;
    }
    if(!Object.keys(props).length){
      toast('请至少填写一个字段', 'err');
      return;
    }
    var must = { topic:['选题'], calendar:['标题','计划发布时间','平台'], review:['排期ID','统计日期'], asset:['标题'] };
    var need = must[dbKey] || [];
    for(var i = 0; i < need.length; i++){
      if(!props[need[i]]){
        toast('「' + need[i] + '」不能为空', 'err');
        return;
      }
    }
    if(dbKey === 'calendar' && MEDIA_EDIT.loading){ toast('正在读取排期素材，请稍候再保存', 'err'); return; }
    if(dbKey === 'calendar' && MEDIA_EDIT.uploading){ toast('素材还在上传，请稍候再保存', 'err'); return; }
    if(dbKey === 'calendar' && MEDIA_EDIT.loadError){ toast('排期素材读取失败，请关闭抽屉后重试', 'err'); return; }
    if(dbKey === 'calendar' && CAL_COVER.loading){ toast('正在读取封面，请稍候再保存', 'err'); return; }
    if(dbKey === 'calendar' && CAL_COVER.uploading){ toast('封面还在上传，请稍候再保存', 'err'); return; }
    setSaving(true);
    suppressUntil = Date.now() + 1500;
    var savedHint = null;
    var op = recordId
      ? OPS[dbKey].upd(recordId, props)
      : OPS[dbKey].add(props);

    op.then(function(res){
      if(res && res.record) savedHint = res.record;
      return loadTable(dbKey);
    }).then(function(){
      return verifyWrite(dbKey, recordId, props, savedHint);
    }).then(function(saved){
      clearDraft(dbKey, recordId);
      editing.recordId = saved._id;
      editing.record = saved;
      if(dbKey === 'calendar' && MEDIA_EDIT.kind){
        return attachEditorMedia(saved).then(function(){ return saved; }).catch(function(err){
          setSaving(false);
          $('drawerHint').textContent = '字段已保存，但发布素材未关联';
          toast('字段已保存，素材关联失败：' + errMsg(err), 'err');
          var handled = new Error('media attach failed');
          handled.handled = true;
          return Promise.reject(handled);
        });
      }
      return saved;
    }).then(function(saved){
      if(dbKey === 'calendar' && CAL_COVER.supported && CAL_COVER.dirty){
        return attachEditorCover(saved).then(function(){ return saved; }).catch(function(err){
          setSaving(false);
          $('drawerHint').textContent = '字段已保存，但封面未关联';
          toast('字段已保存，封面关联失败：' + errMsg(err), 'err');
          var handled = new Error('cover attach failed');
          handled.handled = true;
          return Promise.reject(handled);
        });
      }
      return saved;
    }).then(function(saved){
      setSaving(false);
      toast('已保存 · ' + hhmm(), 'ok');
      closeEditor();
      render();
      if(dbKey === 'calendar'){
        syncTopicStatus(saved);
        autoQueuePublish(saved);
      }
    }).catch(function(err){
      if(err && err.handled) return;
      setSaving(false);
      $('drawerHint').textContent = '未写入，草稿已保留';
      toast('保存失败：' + errMsg(err), 'err');
    });
  }

  function verifyWrite(dbKey, recordId, props, hint){
    var rows = DATA[dbKey] || [];
    var target = null;
    var idField = ID_FIELD[dbKey];
    var wantedId = props[idField] && props[idField].text ? props[idField].text : null;
    var targetId = recordId || (hint && hint._id) || null;

    if(targetId){
      rows.forEach(function(r){ if(r['_id'] === targetId) target = r; });
    }
    if(!target && wantedId){
      rows.forEach(function(r){ if(r[idField] === wantedId) target = r; });
    }
    if(!target){
      var probe = null;
      Object.keys(props).some(function(k){
        var v = props[k];
        var plain = v && (v.text != null ? v.text : v.number != null ? v.number : v.select != null ? v.select : null);
        if(plain == null) return false;
        probe = { key: k, value: String(plain) };
        return true;
      });
      if(probe){
        rows.forEach(function(r){
          if(String(r[probe.key] == null ? '' : r[probe.key]) === probe.value) target = r;
        });
      }
    }
    if(!target) throw new Error('回读未找到这条记录，请刷新确认');
    if(wantedId && target[idField] && target[idField] !== wantedId){
      throw new Error('回读的业务 ID 与提交不一致');
    }
    return target;
  }

  function syncTopicStatus(calRec){
    if(!calRec || !calRec['选题ID'] || !calRec['当前阶段']) return;
    var want = '写作中';
    if(calRec['当前阶段'] === '选题确认') want = '待写';
    if(['已发布','二次分发','已复盘'].indexOf(calRec['当前阶段']) >= 0) want = '已发布';
    var target = null;
    DATA.topic.forEach(function(t){ if(t['选题ID'] === calRec['选题ID']) target = t; });
    if(!target || target['状态'] === '废弃' || target['状态'] === want) return;
    OPS.topic.upd(target['_id'], { '状态': { select: want } }).then(function(){
      return loadTable('topic');
    }).then(function(){
      render();
      toast('选题 ' + calRec['选题ID'] + ' 状态已同步为「' + want + '」', 'ok');
    }).catch(function(){ /* 联动失败不阻塞主流程 */ });
  }

  function markPublished(id){
    var rec = null;
    DATA.calendar.forEach(function(r){ if(r['_id'] === id) rec = r; });
    if(!rec) return;
    OPS.calendar.upd(id, { '当前阶段': { select: '已发布' } })
      .then(function(){ return loadTable('calendar'); })
      .then(function(){
        render();
        toast('已标记为已发布 · ' + hhmm(), 'ok');
        var saved = null;
        DATA.calendar.forEach(function(r){ if(r['_id'] === id) saved = r; });
        syncTopicStatus(saved);
        askTodaySnapshot(saved);
      })
      .catch(function(err){ toast('更新失败：' + errMsg(err), 'err'); });
  }

  /* ---------- 语音速记 ---------- */
  var VOICE = {
    recordings: [],
    stream: null,
    recorder: null,
    chunks: [],
    blob: null,
    url: null,
    startedAt: 0,
    duration: 0,
    timer: null,
    recording: false,
    saving: false,
    discardOnStop: false,
    stopHandled: false,
    recognition: null,
    asrStopped: false,
    asrFailed: false,
    finalText: '',
    interim: '',
    manualEdited: false,
    lastAsrWrite: ''
  };
  var voiceAudio = null;
  var voicePlayingId = null;

  function voiceSupported(){
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }
  function speechCtor(){
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }
  function fmtDuration(sec){
    var t = Math.max(0, Math.round(Number(sec) || 0));
    var h = Math.floor(t / 3600);
    var m = Math.floor((t % 3600) / 60);
    var s = t % 60;
    return (h ? h + ':' + pad(m) : pad(m)) + ':' + pad(s);
  }
  function fmtVoiceDate(v){
    var d = parseDate(v);
    if(!d) return '—';
    if(isoDay(d) === isoDay(new Date())) return '今天 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function fmtBytes(n){
    n = Number(n) || 0;
    if(n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + 'MB';
    if(n >= 1024) return Math.round(n / 1024) + 'KB';
    return n + 'B';
  }
  function findVoice(id){
    var hit = null;
    VOICE.recordings.forEach(function(r){ if(r.id === id) hit = r; });
    return hit;
  }
  function loadVoiceRecordings(){
    return request('/recordings').then(function(res){
      VOICE.recordings = (res && res.recordings) || [];
      renderVoiceList();
      return VOICE.recordings;
    }).catch(function(err){
      console.warn('[voice] 读取录音失败：', errMsg(err));
      return VOICE.recordings;
    });
  }

  function voicePlayer(){
    if(voiceAudio) return voiceAudio;
    voiceAudio = new Audio();
    voiceAudio.addEventListener('play', syncVoiceIcons);
    voiceAudio.addEventListener('pause', syncVoiceIcons);
    voiceAudio.addEventListener('ended', function(){ voicePlayingId = null; syncVoiceIcons(); });
    voiceAudio.addEventListener('error', function(){
      if(!voicePlayingId) return;
      voicePlayingId = null;
      syncVoiceIcons();
      toast('录音播放失败，音频文件可能已丢失', 'err');
    });
    return voiceAudio;
  }
  function syncVoiceIcons(){
    var nodes = document.querySelectorAll('[data-act="voicePlay"]');
    for(var i = 0; i < nodes.length; i++){
      var playing = !!(voicePlayingId && voiceAudio && nodes[i].getAttribute('data-id') === voicePlayingId && !voiceAudio.paused);
      var icon = nodes[i].querySelector('.material-symbols-outlined');
      if(icon) icon.textContent = playing ? 'pause' : 'play_arrow';
      nodes[i].setAttribute('title', playing ? '暂停' : '播放');
    }
  }
  function playVoice(id){
    var rec = findVoice(id);
    if(!rec) return;
    var audio = voicePlayer();
    if(voicePlayingId === id && !audio.paused){ audio.pause(); return; }
    if(voicePlayingId !== id){
      audio.pause();
      audio.src = rec.audioUrl;
      voicePlayingId = id;
    }
    var p = audio.play();
    if(p && p.catch) p.catch(function(){
      voicePlayingId = null;
      syncVoiceIcons();
      toast('录音播放失败，音频文件可能已丢失', 'err');
    });
    syncVoiceIcons();
  }

  function renderVoiceList(){
    var box = $('voiceList');
    if(!box) return;
    var count = $('voiceCount');
    if(count) count.textContent = VOICE.recordings.length + ' 条';
    if(!VOICE.recordings.length){
      box.innerHTML = emptyState('还没有录音', '点上方麦克风开始第一条语音速记', 'mic');
      return;
    }
    box.innerHTML = VOICE.recordings.map(function(r){
      var excerpt = r.transcript ? String(r.transcript).replace(/\s+/g, ' ') : '尚无转写文本，可打开速记手动补充。';
      if(excerpt.length > 120) excerpt = excerpt.slice(0, 120) + '…';
      var playing = voicePlayingId === r.id && voiceAudio && !voiceAudio.paused;
      return '<div class="voice-item">' +
        '<button class="voice-play" data-act="voicePlay" data-id="' + esc(r.id) + '" type="button" title="' + (playing ? '暂停' : '播放') + '"><span class="material-symbols-outlined">' + (playing ? 'pause' : 'play_arrow') + '</span></button>' +
        '<div class="min-w-0 flex-1">' +
          '<div class="flex items-center gap-2 min-w-0"><span class="voice-item-title">' + esc(r.title) + '</span><span class="chip chip-line mono">' + esc(r.code) + '</span></div>' +
          '<div class="voice-item-meta">' + esc(fmtVoiceDate(r.createdAt)) + ' · ' + esc(fmtDuration(r.durationSec)) + ' · ' + esc(fmtBytes(r.sizeBytes)) + '</div>' +
          '<div class="voice-item-text">' + esc(excerpt) + '</div>' +
        '</div>' +
        '<div class="voice-item-actions">' +
          '<button data-act="voiceRename" data-id="' + esc(r.id) + '" type="button" title="重命名"><span class="material-symbols-outlined">edit</span></button>' +
          '<button data-act="voiceDelete" data-id="' + esc(r.id) + '" type="button" title="删除"><span class="material-symbols-outlined">delete</span></button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function ensureVoiceWave(){
    var box = $('voiceWave');
    if(!box || box.children.length) return;
    var html = '';
    for(var i = 0; i < 32; i++){
      html += '<i style="height:' + (6 + (i * 7) % 26) + 'px"></i>';
    }
    box.innerHTML = html;
  }
  function setWaveActive(on){
    var box = $('voiceWave');
    if(box) box.classList.toggle('on', !!on);
  }
  function setVoiceStatus(text, kind){
    var el = $('voiceStatus');
    if(!el) return;
    el.textContent = text;
    el.className = 'text-label-md font-label-md ' + (kind === 'err' ? 'text-[#ba1a1a]' : 'text-on-surface');
  }
  function setAsrTag(text, kind){
    var el = $('voiceAsrTag');
    if(!el) return;
    el.textContent = text;
    el.className = 'chip ' + (kind === 'err' ? 'chip-coral' : kind === 'on' ? 'chip-mint' : 'chip-line');
  }
  function setVoiceTimer(sec){
    var el = $('voiceTimer');
    if(el) el.textContent = fmtDuration(sec);
  }
  function setRecordButton(on){
    var btn = $('voiceRecordBtn');
    var icon = $('voiceRecordIcon');
    if(btn){
      btn.classList.toggle('on', !!on);
      btn.title = on ? '停止录音' : '开始录音';
    }
    if(icon) icon.textContent = on ? 'stop' : 'mic';
  }

  function openVoiceMemo(){
    ensureVoiceWave();
    renderVoiceList();
    $('voiceModal').classList.add('on');
    if(!VOICE.recording && !VOICE.blob){
      setVoiceStatus('准备录音');
      setAsrTag(speechCtor() ? '浏览器听写' : '听写不可用，可手动补写', speechCtor() ? '' : 'err');
    }
  }
  function closeVoiceMemo(){
    if(VOICE.recording){
      toast('正在录音，请先停止录音并保存或放弃', 'err');
      return;
    }
    $('voiceModal').classList.remove('on');
  }

  function resetVoiceDraft(){
    VOICE.blob = null;
    VOICE.duration = 0;
    VOICE.finalText = '';
    VOICE.interim = '';
    VOICE.manualEdited = false;
    VOICE.lastAsrWrite = '';
    if(VOICE.url){ URL.revokeObjectURL(VOICE.url); VOICE.url = null; }
    var prev = $('voicePreview');
    if(prev){
      try{ prev.pause(); }catch(err){}
      prev.removeAttribute('src');
      try{ prev.load(); }catch(err){}
      prev.classList.add('hidden');
    }
    var ta = $('voiceTranscript');
    if(ta) ta.value = '';
    var title = $('voiceTitleInput');
    if(title) title.value = '';
    var save = $('voiceSave');
    if(save) save.disabled = true;
    var discard = $('voiceDiscard');
    if(discard) discard.disabled = true;
    setRecordButton(false);
    setWaveActive(false);
    setVoiceTimer(0);
    setAsrTag(speechCtor() ? '浏览器听写' : '听写不可用，可手动补写', speechCtor() ? '' : 'err');
  }

  function pickAudioMime(){
    if(!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
    var cands = ['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg;codecs=opus','audio/ogg'];
    for(var i = 0; i < cands.length; i++){
      if(MediaRecorder.isTypeSupported(cands[i])) return cands[i];
    }
    return '';
  }
  function startVoiceTimer(){
    clearInterval(VOICE.timer);
    VOICE.timer = setInterval(function(){
      if(!VOICE.recording) return;
      VOICE.duration = (Date.now() - VOICE.startedAt) / 1000;
      setVoiceTimer(VOICE.duration);
    }, 250);
  }
  function stopVoiceTimer(){
    if(VOICE.timer){ clearInterval(VOICE.timer); VOICE.timer = null; }
  }
  function stopVoiceStream(){
    if(VOICE.stream){
      VOICE.stream.getTracks().forEach(function(t){ try{ t.stop(); }catch(err){} });
      VOICE.stream = null;
    }
  }

  function startVoiceRecording(){
    if(VOICE.recording || VOICE.saving) return;
    if(!voiceSupported()){
      toast('当前浏览器不支持录音，请使用桌面版 Chrome / Edge', 'err');
      return;
    }
    if(VOICE.blob) resetVoiceDraft();
    VOICE.finalText = '';
    VOICE.interim = '';
    VOICE.manualEdited = false;
    VOICE.lastAsrWrite = '';
    var ta = $('voiceTranscript');
    if(ta) ta.value = '';
    setVoiceStatus('正在请求麦克风权限…');
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream){
      VOICE.stream = stream;
      var mime = pickAudioMime();
      var rec;
      try{
        rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      }catch(err){
        stopVoiceStream();
        setVoiceStatus('录音启动失败', 'err');
        toast('无法启动录音：' + err.message, 'err');
        return;
      }
      VOICE.recorder = rec;
      VOICE.chunks = [];
      rec.ondataavailable = function(ev){ if(ev.data && ev.data.size) VOICE.chunks.push(ev.data); };
      rec.onstop = onVoiceRecorderStop;
      rec.onerror = function(ev){
        toast('录音出错：' + ((ev.error && ev.error.message) || '未知错误'), 'err');
      };
      try{
        rec.start(1000);
      }catch(err){
        stopVoiceStream();
        setVoiceStatus('录音启动失败', 'err');
        toast('无法启动录音：' + err.message, 'err');
        return;
      }
      VOICE.startedAt = Date.now();
      VOICE.duration = 0;
      VOICE.recording = true;
      VOICE.discardOnStop = false;
      VOICE.stopHandled = false;
      setRecordButton(true);
      var save = $('voiceSave');
      if(save) save.disabled = true;
      var discard = $('voiceDiscard');
      if(discard) discard.disabled = false;
      setWaveActive(true);
      setVoiceStatus('正在录音…');
      setVoiceTimer(0);
      startVoiceTimer();
      startSpeechRecognition();
    }).catch(function(err){
      var msg = err && err.name === 'NotAllowedError'
        ? '麦克风权限被拒绝，请在浏览器地址栏允许后重试'
        : '无法访问麦克风：' + ((err && err.message) || '未知错误');
      setVoiceStatus('录音启动失败', 'err');
      toast(msg, 'err');
    });
  }

  function stopVoiceRecording(discard){
    if(!VOICE.recording) return;
    VOICE.recording = false;
    VOICE.discardOnStop = !!discard;
    stopVoiceTimer();
    stopSpeechRecognition();
    setWaveActive(false);
    setRecordButton(false);
    setVoiceStatus(discard ? '已放弃本次录音' : '正在整理录音…');
    try{
      if(VOICE.recorder && VOICE.recorder.state !== 'inactive') VOICE.recorder.stop();
      else onVoiceRecorderStop();
    }catch(err){
      onVoiceRecorderStop();
    }
    stopVoiceStream();
  }

  function onVoiceRecorderStop(){
    if(VOICE.stopHandled) return;
    VOICE.stopHandled = true;
    var discard = VOICE.discardOnStop;
    VOICE.discardOnStop = false;
    var mime = (VOICE.recorder && VOICE.recorder.mimeType) || 'audio/webm';
    var chunks = VOICE.chunks;
    VOICE.chunks = [];
    stopVoiceTimer();
    if(discard || !chunks.length){
      resetVoiceDraft();
      setVoiceStatus(discard ? '已放弃本次录音' : '没有录到音频，请重试', discard ? '' : 'err');
      return;
    }
    VOICE.duration = Math.max(0.1, (Date.now() - VOICE.startedAt) / 1000);
    var blob = new Blob(chunks, { type: mime.split(';')[0] });
    VOICE.blob = blob;
    if(VOICE.url) URL.revokeObjectURL(VOICE.url);
    VOICE.url = URL.createObjectURL(blob);
    var prev = $('voicePreview');
    if(prev){
      prev.src = VOICE.url;
      prev.classList.remove('hidden');
    }
    var title = $('voiceTitleInput');
    if(title && !title.value.trim()){
      var d = new Date();
      title.value = '语音速记 ' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }
    setVoiceTimer(VOICE.duration);
    setVoiceStatus('录音完成，确认标题后保存');
    if(VOICE.finalText || (($('voiceTranscript') || {}).value || '').trim()){
      setAsrTag('听写已完成，可手动修改', '');
    }else{
      setAsrTag(speechCtor() ? '未识别到文字，可手动补写' : '听写不可用，可手动补写', 'err');
    }
    var save = $('voiceSave');
    if(save) save.disabled = false;
    var discardBtn = $('voiceDiscard');
    if(discardBtn) discardBtn.disabled = false;
  }

  function writeVoiceTranscript(){
    var el = $('voiceTranscript');
    if(!el || VOICE.manualEdited) return;
    var composed = VOICE.finalText + (VOICE.interim ? (VOICE.finalText ? ' ' : '') + VOICE.interim : '');
    VOICE.lastAsrWrite = composed;
    el.value = composed;
    el.scrollTop = el.scrollHeight;
  }
  function startSpeechRecognition(){
    var Ctor = speechCtor();
    if(!Ctor){
      setAsrTag('听写不可用，可手动补写', 'err');
      return;
    }
    if(!VOICE.recording) return;
    stopSpeechRecognition();
    VOICE.asrStopped = false;
    VOICE.asrFailed = false;
    var rec = new Ctor();
    VOICE.recognition = rec;
    rec.lang = 'zh-CN';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onstart = function(){ setAsrTag('听写中…', 'on'); };
    rec.onresult = function(ev){
      var interim = '';
      for(var i = ev.resultIndex; i < ev.results.length; i++){
        var res = ev.results[i];
        var text = res[0] ? res[0].transcript : '';
        if(res.isFinal){
          if(text.trim()) VOICE.finalText += (VOICE.finalText ? '\n' : '') + text.trim();
        }else{
          interim += text;
        }
      }
      VOICE.interim = interim;
      writeVoiceTranscript();
    };
    rec.onerror = function(ev){
      var code = ev && ev.error;
      if(code === 'aborted' || code === 'no-speech') return;
      VOICE.asrFailed = true;
      setAsrTag(code === 'not-allowed' ? '听写权限被拒绝，可手动补写' : '听写中断，可手动补写', 'err');
    };
    rec.onend = function(){
      if(VOICE.recognition !== rec) return;
      VOICE.recognition = null;
      if(VOICE.recording && !VOICE.asrStopped && !VOICE.asrFailed){
        setTimeout(function(){
          if(VOICE.recording && !VOICE.asrStopped && !VOICE.asrFailed) startSpeechRecognition();
        }, 250);
      }
    };
    try{
      rec.start();
    }catch(err){
      VOICE.asrFailed = true;
      setAsrTag('听写不可用，可手动补写', 'err');
    }
  }
  function stopSpeechRecognition(){
    VOICE.asrStopped = true;
    VOICE.interim = '';
    var rec = VOICE.recognition;
    VOICE.recognition = null;
    if(rec){ try{ rec.stop(); }catch(err){} }
  }

  function discardVoiceDraft(){
    if(VOICE.recording){ stopVoiceRecording(true); return; }
    resetVoiceDraft();
    setVoiceStatus('已放弃本次录音');
  }

  function saveVoiceRecording(){
    if(VOICE.saving || !VOICE.blob) return;
    var titleEl = $('voiceTitleInput');
    var title = String(titleEl ? titleEl.value : '').trim();
    if(!title){
      toast('请填写录音标题', 'err');
      if(titleEl) titleEl.focus();
      return;
    }
    var transcript = String(($('voiceTranscript') || {}).value || '').trim();
    var blob = VOICE.blob;
    var mime = blob.type || 'audio/webm';
    VOICE.saving = true;
    var saveBtn = $('voiceSave');
    if(saveBtn) saveBtn.disabled = true;
    setVoiceStatus('正在保存录音…');
    var qs = '?title=' + encodeURIComponent(title) +
      '&duration=' + encodeURIComponent(String(Math.round(VOICE.duration * 10) / 10)) +
      '&mime=' + encodeURIComponent(mime);
    fetch(API + '/recordings' + qs, {
      method: 'POST',
      headers: { 'Content-Type': mime },
      body: blob
    }).then(function(res){
      return res.text().then(function(text){
        var body = null;
        if(text){ try{ body = JSON.parse(text); }catch(err){} }
        if(!res.ok) throw new Error((body && body.error) || ('保存失败（HTTP ' + res.status + '）'));
        return body;
      });
    }).then(function(body){
      var rec = body && body.recording;
      if(!rec || !rec.id) throw new Error('保存失败：服务未返回录音记录');
      if(!transcript) return rec;
      return request('/recordings/' + encodeURIComponent(rec.id), {
        method: 'PATCH',
        body: JSON.stringify({ transcript: transcript })
      }).then(function(patch){ return (patch && patch.recording) || rec; });
    }).then(function(){
      resetVoiceDraft();
      setVoiceStatus('录音已保存');
      renderVoiceList();
      return loadVoiceRecordings().then(function(){ render(); });
    }).then(function(){
      toast('语音速记已保存 · ' + hhmm(), 'ok');
    }).catch(function(err){
      setVoiceStatus('保存失败，请重试', 'err');
      toast('保存失败：' + errMsg(err), 'err');
    }).finally(function(){
      VOICE.saving = false;
      if(VOICE.blob && saveBtn) saveBtn.disabled = false;
    });
  }

  function renameVoice(id){
    var rec = findVoice(id);
    if(!rec) return;
    var next = window.prompt('修改录音标题', rec.title);
    if(next == null) return;
    next = String(next).trim();
    if(!next){ toast('标题不能为空', 'err'); return; }
    request('/recordings/' + encodeURIComponent(id), {
      method: 'PATCH',
      body: JSON.stringify({ title: next })
    }).then(function(){
      return loadVoiceRecordings();
    }).then(function(){
      render();
      toast('标题已更新 · ' + hhmm(), 'ok');
    }).catch(function(err){ toast('重命名失败：' + errMsg(err), 'err'); });
  }

  function askDeleteVoice(id){
    var rec = findVoice(id);
    if(!rec) return;
    pendingDelete = { kind:'recording', id:id };
    $('modalTitle').textContent = '删除这条录音？';
    $('modalText').textContent = '「' + rec.title + '」的音频文件与转写文本将被永久删除，无法恢复。';
    $('modalOk').textContent = '确认删除';
    $('modal').classList.add('on');
  }
  function deleteVoice(id){
    if(voicePlayingId === id && voiceAudio){
      try{ voiceAudio.pause(); }catch(err){}
      voicePlayingId = null;
      syncVoiceIcons();
    }
    fetch(API + '/recordings/' + encodeURIComponent(id), { method: 'DELETE' }).then(function(res){
      return res.text().then(function(text){
        var body = null;
        if(text){ try{ body = JSON.parse(text); }catch(err){} }
        if(!res.ok) throw new Error((body && body.error) || ('删除失败（HTTP ' + res.status + '）'));
        return body;
      });
    }).then(function(){
      return loadVoiceRecordings();
    }).then(function(){
      render();
      toast('录音已删除 · ' + hhmm(), 'ok');
    }).catch(function(err){ toast('删除失败：' + errMsg(err), 'err'); });
  }

  $('voiceRecordBtn').addEventListener('click', function(){
    if(VOICE.recording) stopVoiceRecording(false);
    else startVoiceRecording();
  });
  $('voiceDiscard').addEventListener('click', discardVoiceDraft);
  $('voiceSave').addEventListener('click', saveVoiceRecording);
  $('voiceClose').addEventListener('click', closeVoiceMemo);
  $('voiceTranscript').addEventListener('input', function(){
    if(this.value !== VOICE.lastAsrWrite){
      VOICE.manualEdited = true;
      if(VOICE.recording) setAsrTag('手动补充中，听写仍在继续', '');
    }
  });
  $('voiceModal').addEventListener('click', function(e){
    if(e.target === this){ closeVoiceMemo(); return; }
    var el = e.target.closest ? e.target.closest('[data-act]') : null;
    if(!el) return;
    var act = el.getAttribute('data-act');
    var id = el.getAttribute('data-id');
    if(act === 'voicePlay'){ playVoice(id); return; }
    if(act === 'voiceRename'){ renameVoice(id); return; }
    if(act === 'voiceDelete'){ askDeleteVoice(id); return; }
  });

  /* ---------- publish modal ---------- */
  $('publishModal').addEventListener('click', function(e){
    if(e.target === this){ closePublishModal(); return; }
    var el = e.target.closest ? e.target.closest('[data-act]') : null;
    if(!el) return;
    var act = el.getAttribute('data-act');
    var id = el.getAttribute('data-id');
    if(act === 'pubClose'){ closePublishModal(); return; }
    if(act === 'pubPickMedia'){ var f = $('pubMediaFile'); if(f) f.click(); return; }
    if(act === 'pubSave'){ savePublishTask(); return; }
    if(act === 'pubRun'){ pubTaskAction(id, 'run'); return; }
    if(act === 'pubRetry'){ pubTaskAction(id, 'retry'); return; }
    if(act === 'pubCancel'){ pubTaskAction(id, 'cancel'); return; }
    if(act === 'pubComplete'){ completePublishTask(id); return; }
    if(act === 'pubDelete'){ askDeletePublish(pubTaskById(id)); return; }
  });
  $('publishClose').addEventListener('click', closePublishModal);

  /* ---------- cover crop modal ---------- */
  $('cropModal').addEventListener('click', function(e){
    if(e.target === this) closeCoverCrop();
  });
  $('cropClose').addEventListener('click', closeCoverCrop);
  $('cropCancel').addEventListener('click', closeCoverCrop);
  $('cropConfirm').addEventListener('click', confirmCoverCrop);
  $('cropRatios').addEventListener('click', function(e){
    var el = e.target.closest ? e.target.closest('[data-ratio]') : null;
    if(!el) return;
    CROP.ratio = el.getAttribute('data-ratio');
    setCropRatioUI(CROP.ratio);
    cropInitRect();
  });
  $('cropBox').addEventListener('pointerdown', function(e){
    var handle = e.target && e.target.getAttribute ? e.target.getAttribute('data-handle') : null;
    cropStartDrag(e, handle ? 'resize' : 'move', handle);
  });

  /* ---------- modal / info ---------- */
  var pendingDelete = null;
  function askDelete(dbKey, id, name){
    pendingDelete = { dbKey:dbKey, id:id };
    $('modalTitle').textContent = '删除这条' + DB_LABEL[dbKey] + '记录？';
    $('modalText').textContent = '「' + (name || '未命名') + '」将被永久删除，无法恢复。关联的其它表记录不会自动清除。';
    $('modalOk').textContent = '确认删除';
    $('modal').classList.add('on');
  }
  function openInfo(title, text){
    pendingDelete = null;
    $('modalTitle').textContent = title;
    $('modalText').textContent = text;
    $('modalOk').textContent = '知道了';
    $('modal').classList.add('on');
  }
  $('modalCancel').addEventListener('click', function(){ $('modal').classList.remove('on'); pendingDelete = null; });
  $('modalOk').addEventListener('click', function(){
    var job = pendingDelete;
    pendingDelete = null;
    $('modal').classList.remove('on');
    if(!job) return;
    if(job.kind === 'recording'){ deleteVoice(job.id); return; }
    if(job.kind === 'publish'){
      request('/publish/tasks/' + encodeURIComponent(job.id), { method: 'DELETE' }).then(function(){
        return loadPublishData();
      }).then(function(){
        if(PUB.detailId === job.id) closePublishModal();
        render();
        toast('发布任务已删除 · ' + hhmm(), 'ok');
      }).catch(function(err){
        toast('删除失败：' + errMsg(err), 'err');
      });
      return;
    }
    OPS[job.dbKey].del(job.id).then(function(){
      return loadTable(job.dbKey);
    }).then(function(){
      render();
      toast('已删除 · ' + hhmm(), 'ok');
    }).catch(function(err){
      toast('删除失败：' + errMsg(err), 'err');
    });
  });
  $('modal').addEventListener('click', function(e){ if(e.target === this){ this.classList.remove('on'); pendingDelete = null; } });

  /* ---------- 主理人资料 ---------- */
  var profileDraftFile = null;
  var profilePreviewUrl = null;

  function openProfileEditor(){
    profileDraftFile = null;
    if(profilePreviewUrl){ URL.revokeObjectURL(profilePreviewUrl); profilePreviewUrl = null; }
    $('profilePreview').src = profileAvatarUrl();
    $('profileNameInput').value = (PROFILE && PROFILE.name) || '';
    $('profileFile').value = '';
    $('profileModal').classList.add('on');
    setTimeout(function(){ var el = $('profileNameInput'); if(el){ el.focus(); el.select(); } }, 60);
  }
  function closeProfileEditor(){
    $('profileModal').classList.remove('on');
    if(profilePreviewUrl){ URL.revokeObjectURL(profilePreviewUrl); profilePreviewUrl = null; }
    profileDraftFile = null;
  }
  function pickProfileAvatar(){
    var input = $('profileFile');
    if(input) input.click();
  }
  function onProfileFileChange(e){
    var file = e.target.files && e.target.files[0];
    if(!file) return;
    if(['image/png','image/jpeg','image/webp','image/gif'].indexOf(file.type) < 0){
      toast('仅支持 PNG / JPG / WebP / GIF 图片', 'err');
      e.target.value = '';
      return;
    }
    if(file.size > 5 * 1024 * 1024){
      toast('头像图片不能超过 5MB', 'err');
      e.target.value = '';
      return;
    }
    profileDraftFile = file;
    if(profilePreviewUrl) URL.revokeObjectURL(profilePreviewUrl);
    profilePreviewUrl = URL.createObjectURL(file);
    $('profilePreview').src = profilePreviewUrl;
  }
  function uploadProfileAvatar(file){
    return fetch(API + '/profile/avatar', {
      method: 'POST',
      headers: { 'Content-Type': file.type },
      body: file
    }).then(function(res){
      return res.text().then(function(text){
        var body = null;
        if(text){ try{ body = JSON.parse(text); }catch(err){} }
        if(!res.ok) throw new Error((body && body.error) || ('上传失败（HTTP ' + res.status + '）'));
        return body;
      });
    }, function(){
      throw new Error('连不上本地服务，请确认 npm start 仍在运行');
    });
  }
  function saveProfile(){
    var input = $('profileNameInput');
    var name = String(input ? input.value : '').trim();
    if(!name){ toast('主理人名称不能为空', 'err'); if(input) input.focus(); return; }
    if(name.length > 24){ toast('主理人名称最多 24 个字符', 'err'); return; }
    var file = profileDraftFile;
    var btn = $('profileSave');
    if(btn) btn.disabled = true;
    var job = Promise.resolve();
    if(name !== PROFILE.name){
      job = job.then(function(){
        return request('/profile', { method: 'PUT', body: JSON.stringify({ name: name }) });
      });
    }
    if(file){
      job = job.then(function(){ return uploadProfileAvatar(file); });
    }
    job.then(function(){
      return loadProfile();
    }).then(function(){
      closeProfileEditor();
      if(state.view === 'home') render();
      toast('主理人信息已更新 · ' + hhmm(), 'ok');
    }).catch(function(err){
      toast('保存失败：' + errMsg(err), 'err');
    }).finally(function(){
      if(btn) btn.disabled = false;
    });
  }
  $('profileAvatarBtn').addEventListener('click', pickProfileAvatar);
  $('profileFile').addEventListener('change', onProfileFileChange);
  $('profileSave').addEventListener('click', saveProfile);
  $('profileClose').addEventListener('click', closeProfileEditor);
  $('profileCancel').addEventListener('click', closeProfileEditor);
  $('profileModal').addEventListener('click', function(e){ if(e.target === this) closeProfileEditor(); });

  /* ---------- drawer wiring ---------- */
  $('drawerClose').addEventListener('click', closeEditor);
  $('drawerCancel').addEventListener('click', closeEditor);
  $('drawerSave').addEventListener('click', saveRecord);
  $('mask').addEventListener('click', closeEditor);
  document.addEventListener('keydown', function(e){
    if(e.keyCode === 27){
      if(CROP.active){ closeCoverCrop(); return; }
      closeEditor();
      $('modal').classList.remove('on');
      $('profileModal').classList.remove('on');
      closeVoiceMemo();
      closePublishModal();
      pendingDelete = null;
    }
  });

  /* ---------- boot ---------- */
  (function fillPlatforms(){
    var sel = $('pfFilter');
    PLATFORMS.forEach(function(p){
      var o = document.createElement('option');
      o.value = p; o.textContent = p;
      sel.appendChild(o);
    });
  })();

  function scheduleReload(){
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(function(){
      var jobs = [loadVoiceRecordings()];
      if(PUB.loaded) jobs.push(loadPublishData());
      Promise.all(jobs).then(loadAllData);
    }, 200);
  }

  function subscribe(){
    if(typeof EventSource === 'undefined') return;
    try{
      var es = new EventSource(API + '/events');
      es.addEventListener('ready', function(){ setSync('实时同步已连接', 'ok'); });
      es.addEventListener('change', function(){
        if(Date.now() < suppressUntil) return;
        if(editing.dbKey){ staleWhileEditing = true; return; }
        scheduleReload();
      });
      es.addEventListener('error', function(){ setSync('实时同步断开，正在重连…', 'err'); });
    }catch(err){ /* 浏览器不支持时退化为手动刷新 */ }
  }

  function boot(){
    var initial = (location.hash || '').replace(/^#/, '');
    if(['home','topics','calendar','publish','review','assets','connections'].indexOf(initial) >= 0) state.view = initial;
    setSync('正在连接…', '');
    subscribe();
    Promise.all([
      loadProfile().catch(function(){ /* 旧服务没有 profile 接口时保持默认资料 */ }),
      loadVoiceRecordings(),
      loadPublishData().catch(function(){ /* 发布服务不可用时不影响其它页面 */ })
    ]).then(loadAllData);
  }
  boot();
})();
