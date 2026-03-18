/* ========================================
   app.js — UI, Router, All Pages
   ======================================== */

var _ps = {} // page state (preserved within same page)
var _currentPage = '' // track current page for state reset
var _viewer = false
var _viewerTournament = null
var _matchDrafts = {} // persists score drafts across page navigations: { matchKey: {score1,score2,winnerId} }

function _canEdit(t) {
  if (_viewer) return false
  if (!t) return false
  if (typeof isCreator === 'function') return isCreator(t)
  return true
}

function _canScore(t) {
  if (_viewer) return false
  return !!t
}

/* ===== UI Helpers ===== */
function showToast(msg, duration) {
  var el = document.getElementById('toast-container')
  el.innerHTML = '<div class="toast">' + esc(msg) + '</div>'
  clearTimeout(el._t)
  el._t = setTimeout(function () { el.innerHTML = '' }, duration || 2000)
}

function showModal(opts) {
  var root = document.getElementById('modal-root')
  var html = '<div class="modal-mask" id="modal-mask"><div class="modal-content">'
  html += '<div class="modal-title">' + esc(opts.title || '提示') + '</div>'
  if (opts.content) html += '<div class="modal-body">' + esc(opts.content) + '</div>'
  html += '<div class="modal-actions">'
  if (opts.showCancel !== false) html += '<button class="btn-secondary" id="modal-cancel">' + esc(opts.cancelText || '取消') + '</button>'
  html += '<button class="btn-primary" id="modal-confirm">' + esc(opts.confirmText || '确定') + '</button>'
  html += '</div></div></div>'
  root.innerHTML = html
  document.getElementById('modal-confirm').onclick = function () { root.innerHTML = ''; if (opts.onConfirm) opts.onConfirm() }
  var c = document.getElementById('modal-cancel')
  if (c) c.onclick = function () { root.innerHTML = ''; if (opts.onCancel) opts.onCancel() }
  document.getElementById('modal-mask').onclick = function (e) { if (e.target.id === 'modal-mask') { root.innerHTML = ''; if (opts.onCancel) opts.onCancel() } }
}

function showPrompt(opts) {
  var root = document.getElementById('modal-root')
  var html = '<div class="modal-mask" id="modal-mask"><div class="modal-content">'
  html += '<div class="modal-title">' + esc(opts.title || '输入') + '</div>'
  html += '<div style="padding:0 4px 16px"><input class="input-field" id="prompt-input" value="' + esc(opts.value || '') + '" placeholder="' + esc(opts.placeholder || '') + '" maxlength="' + (opts.maxlength || 30) + '"></div>'
  html += '<div class="modal-actions"><button class="btn-secondary" id="modal-cancel">取消</button><button class="btn-primary" id="modal-confirm">' + esc(opts.confirmText || '确定') + '</button></div>'
  html += '</div></div>'
  root.innerHTML = html
  var inp = document.getElementById('prompt-input')
  setTimeout(function () { inp.focus(); inp.select() }, 50)
  document.getElementById('modal-confirm').onclick = function () { var v = inp.value.trim(); root.innerHTML = ''; if (opts.onConfirm) opts.onConfirm(v) }
  document.getElementById('modal-cancel').onclick = function () { root.innerHTML = '' }
  document.getElementById('modal-mask').onclick = function (e) { if (e.target.id === 'modal-mask') root.innerHTML = '' }
}

function showActionSheet(items, onCancel) {
  var root = document.getElementById('modal-root')
  var html = '<div class="action-sheet-mask" id="as-mask"><div class="action-sheet">'
  items.forEach(function (it, i) { html += '<div class="action-sheet-item" data-idx="' + i + '">' + esc(it.text) + '</div>' })
  html += '<div class="action-sheet-cancel" id="as-cancel">取消</div></div></div>'
  root.innerHTML = html
  root.querySelectorAll('.action-sheet-item').forEach(function (el) {
    el.onclick = function () { root.innerHTML = ''; var idx = +el.dataset.idx; if (items[idx] && items[idx].action) items[idx].action() }
  })
  document.getElementById('as-cancel').onclick = function () { root.innerHTML = ''; if (onCancel) onCancel() }
  document.getElementById('as-mask').onclick = function (e) { if (e.target.id === 'as-mask') { root.innerHTML = ''; if (onCancel) onCancel() } }
}

function showCustomMatchModal(opts) {
  var root = document.getElementById('modal-root')
  var teams = opts.teams, mc = opts.matchCount
  var html = '<div class="modal-mask" id="modal-mask"><div class="modal-content" style="max-height:85vh;overflow-y:auto">'
  html += '<div class="modal-title">' + esc(opts.title || '自定义对阵') + '</div>'
  html += '<div style="padding:0 4px 16px">'
  for (var i = 0; i < mc; i++) {
    var lb = opts.labels ? opts.labels[i] : ('第' + (i + 1) + '场')
    html += '<div class="card" style="padding:12px;margin-bottom:8px">'
    html += '<div style="font-weight:600;margin-bottom:8px;font-size:13px;color:var(--primary-light)">' + esc(lb) + '</div>'
    html += '<div style="display:flex;align-items:center;gap:8px">'
    html += '<select class="input-field" id="cm-a-' + i + '" style="flex:1"><option value="">选择</option>'
    teams.forEach(function (t) { html += '<option value="' + t.id + '">' + esc(t.name) + '</option>' })
    html += '</select><span style="color:var(--text3);font-weight:700">VS</span>'
    html += '<select class="input-field" id="cm-b-' + i + '" style="flex:1"><option value="">选择</option>'
    teams.forEach(function (t) { html += '<option value="' + t.id + '">' + esc(t.name) + '</option>' })
    html += '</select></div></div>'
  }
  html += '</div><div class="modal-actions"><button class="btn-secondary" id="modal-cancel">取消</button><button class="btn-primary" id="modal-confirm">确定</button></div>'
  html += '</div></div>'
  root.innerHTML = html
  document.getElementById('modal-confirm').onclick = function () {
    var pairs = [], used = {}
    for (var i = 0; i < mc; i++) {
      var a = document.getElementById('cm-a-' + i).value, b = document.getElementById('cm-b-' + i).value
      if (!a || !b) { showToast('请选择所有对阵'); return }
      if (a === b) { showToast('不能选择相同队伍'); return }
      if (used[a] || used[b]) { showToast('每个队伍只能出现一次'); return }
      used[a] = true; used[b] = true
      pairs.push([teams.find(function (t) { return t.id === a }), teams.find(function (t) { return t.id === b })])
    }
    root.innerHTML = ''
    if (opts.onConfirm) opts.onConfirm(pairs)
  }
  document.getElementById('modal-cancel').onclick = function () { root.innerHTML = '' }
  document.getElementById('modal-mask').onclick = function (e) { if (e.target.id === 'modal-mask') root.innerHTML = '' }
}

/* ===== Router ===== */
var _routes = []
function navigate(path) { _routes.push(location.hash); location.hash = path }
function goBack() { if (_routes.length > 0) location.hash = _routes.pop(); else location.hash = '/' }

function parseRoute() {
  var h = location.hash.replace(/^#/, '') || '/'
  var qi = h.indexOf('?'), path = qi >= 0 ? h.substring(0, qi) : h, params = {}
  if (qi >= 0) h.substring(qi + 1).split('&').forEach(function (p) { var kv = p.split('='); if (kv.length === 2) params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]) })
  return { path: path, params: params }
}

function render() {
  var r = parseRoute(), app = document.getElementById('app')
  if (!app) return
  var curId = r.params && r.params.id ? r.params.id : null
  if (typeof _activeListeners !== 'undefined') {
    Object.keys(_activeListeners).forEach(function (lid) {
      if (lid !== curId) stopListenTournament(lid)
    })
  }
  var html = '', page = 'home'
  if (r.path === '/' || r.path === '') { html = renderHome(r.params); page = 'home' }
  else if (r.path === '/create') { html = renderCreate(r.params); page = 'create' }
  else if (r.path === '/players') { html = renderPlayers(r.params); page = 'players' }
  else if (r.path === '/pairing') { html = renderPairing(r.params); page = 'pairing' }
  else if (r.path === '/settings') { html = renderSettings(r.params); page = 'settings' }
  else if (r.path === '/result') { html = renderResult(r.params); page = 'result' }
  else if (r.path === '/schedule') { html = renderSchedule(r.params); page = 'schedule' }
  else if (r.path === '/match') { html = renderMatch(r.params); page = 'match' }
  else if (r.path === '/rankings') { html = renderRankings(r.params); page = 'rankings' }
  else { html = renderHome(r.params); page = 'home' }
  if (page !== _currentPage) _ps = {}
  _currentPage = page
  app.innerHTML = html
  requestAnimationFrame(function () {
    if (page === 'home') mountHome(r.params)
    else if (page === 'create') mountCreate(r.params)
    else if (page === 'players') mountPlayers(r.params)
    else if (page === 'pairing') mountPairing(r.params)
    else if (page === 'settings') mountSettings(r.params)
    else if (page === 'result') mountResult(r.params)
    else if (page === 'schedule') mountSchedule(r.params)
    else if (page === 'match') mountMatch(r.params)
    else if (page === 'rankings') mountRankings(r.params)
  })
}

function _t(id) { return _viewer ? _viewerTournament : getTournament(id) }

/* ===== Format Labels ===== */
var FMT = { 'round-robin': '单循环', 'group-knockout': '小组循环+淘汰赛', 'single-knockout': '单循环+淘汰赛', 'nine-team': '9组大战赛' }
var TYPE = { singles: '单打', doubles: '双打' }

/* ====================================================================
   PAGE: HOME
   ==================================================================== */
function renderHome() {
  var ts = _viewer ? [] : getTournaments()
  var html = '<div class="container">'
  html += '<div class="home-header"><div class="home-title">🎾 TENNIS GO!</div><div class="home-subtitle">积分分组 · 赛程管理 · 比分录入</div></div>'
  if (!_viewer) {
    html += '<div class="search-box"><input class="input-field" id="home-search" placeholder="搜索比赛名称..." value="' + esc(_ps.q || '') + '"><button class="btn-primary" id="btn-search" style="padding:0 18px;flex-shrink:0;border-radius:var(--pill);font-size:16px">🔍</button>'
    if (_firebaseReady) html += '<button class="btn-icon" id="btn-refresh" title="刷新" style="font-size:18px;opacity:.5;flex-shrink:0">🔄</button>'
    html += '</div>'
    if (_isFirebaseConfigured() && !_firebaseReady) {
      html += '<div id="cloud-status" class="text-center text-hint" style="padding:8px;font-size:12px;opacity:.5">☁️ 云端同步中...</div>'
    }
    html += '<div id="empty-init" class="empty-state"' + (ts.length > 0 ? ' style="display:none"' : '') + '><div class="empty-icon">🏆</div><div class="empty-text">还没有比赛记录</div><div class="empty-hint">点击下方按钮创建第一场比赛</div></div>'
    html += '<div id="search-empty" class="empty-state" style="display:none;padding:30px"><div class="empty-icon">🔍</div><div class="empty-text">未找到相关比赛</div><div class="empty-hint">试试其他关键词，或清空搜索</div></div>'
    ts.forEach(function (t) {
      var mine = isCreator(t)
      if (mine) html += '<div class="swipe-wrap" data-id="' + t.id + '">'
      html += '<div class="card tournament-card" data-id="' + t.id + '">'
      html += '<div class="flex-between"><div class="tournament-name">' + esc(t.name) + '</div><div class="score-badge">' + esc(TYPE[t.type] || '') + '</div></div>'
      html += '<div class="tournament-meta">'
      html += '<span class="tag tag-green">' + esc(FMT[t.format] || '') + '</span>'
      if (_firebaseReady && !mine) html += '<span class="tag" style="background:rgba(255,255,255,.08);color:rgba(255,255,255,.4);font-size:10px">他人创建</span>'
      if (t.groups) html += '<span class="tag tag-orange">' + t.groups.length + '组</span>'
      if (t.players) html += '<span class="tag tag-blue">' + t.players.length + '人</span>'
      var _mc = (t.matches || []).length, _fc = (t.matches || []).filter(function (m) { return m.status === 'finished' }).length
      if (_mc > 0) html += '<span class="tag tag-purple">' + _fc + '/' + _mc + '场</span>'
      html += '</div>'
      html += '<div class="tournament-time">' + formatTime(t.createTime) + '</div>'
      html += '<div class="share-icon" data-share="' + t.id + '" title="分享">📤</div>'
      html += '</div>'
      if (mine) html += '<div class="swipe-delete">删除</div></div>'
    })
    html += '<div class="bottom-bar"><button class="btn-primary btn-block" id="btn-new">➕ 新建比赛</button></div>'
  }
  html += '</div>'
  return html
}

function _filterCards(q) {
  _ps.q = q
  var kw = (q || '').trim().toLowerCase()
  var cards = document.querySelectorAll('.tournament-card')
  var visible = 0
  cards.forEach(function (c) {
    var n = c.querySelector('.tournament-name')
    var show = !kw || (n && n.textContent.toLowerCase().indexOf(kw) >= 0)
    var target = c.closest('.swipe-wrap') || c
    target.style.display = show ? '' : 'none'
    if (show) visible++
  })
  var emI = document.getElementById('empty-init')
  var emS = document.getElementById('search-empty')
  if (emI) emI.style.display = (!kw && cards.length === 0) ? '' : 'none'
  if (emS) emS.style.display = (kw && visible === 0) ? '' : 'none'
}

function mountHome() {
  var s = document.getElementById('home-search')
  if (s) {
    var _composing = false
    s.addEventListener('compositionstart', function () { _composing = true })
    s.addEventListener('compositionend', function () {
      _composing = false
      _filterCards(s.value)
    })
    var _debounce = null
    s.oninput = function () {
      if (_composing) return
      clearTimeout(_debounce)
      _debounce = setTimeout(function () { _filterCards(s.value) }, 150)
    }
    s.onkeydown = function (e) {
      if (e.key === 'Enter') { clearTimeout(_debounce); _filterCards(s.value) }
    }
    if (_ps.q) _filterCards(_ps.q)
  }
  var sb = document.getElementById('btn-search')
  if (sb) sb.onclick = function () {
    var s = document.getElementById('home-search')
    if (s) _filterCards(s.value)
  }
  var rb = document.getElementById('btn-refresh')
  if (rb) rb.onclick = function () {
    rb.style.animation = 'spin .6s ease'
    refreshFromCloud().then(function () { render(); showToast('已刷新') })
  }
  var btn = document.getElementById('btn-new')
  if (btn) btn.onclick = function () { navigate('/create') }

  var _openSwipe = null
  function _closeAllSwipes() {
    if (_openSwipe) {
      _openSwipe.style.transition = 'transform .3s ease'
      _openSwipe.style.transform = ''
      _openSwipe = null
    }
  }

  document.querySelectorAll('.tournament-card').forEach(function (el) {
    el.onclick = function (e) {
      if (e.target.dataset.share) return
      if (_openSwipe) { _closeAllSwipes(); return }
      var tid = el.dataset.id, tt = getTournament(tid)
      if (!tt) { navigate('/result?id=' + tid); return }
      if (tt.groups) { navigate('/result?id=' + tid) }
      else if (tt.type === 'doubles' && tt.teams && tt.teams.length > 0) { navigate('/settings?id=' + tid) }
      else if (tt.type === 'doubles' && tt.players && tt.players.length > 0) { navigate('/pairing?id=' + tid) }
      else if (tt.players && tt.players.length > 0) { navigate('/settings?id=' + tid) }
      else { navigate('/players?id=' + tid) }
    }
  })

  document.querySelectorAll('.swipe-wrap').forEach(function (wrap) {
    var card = wrap.querySelector('.tournament-card')
    var tid = wrap.dataset.id
    var startX = 0, startY = 0, dx = 0, isSwiping = false, isOpen = false

    card.addEventListener('touchstart', function (e) {
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
      dx = 0
      isSwiping = false
      card.style.transition = 'none'
    })

    card.addEventListener('touchmove', function (e) {
      var cx = e.touches[0].clientX - startX
      var cy = e.touches[0].clientY - startY
      if (!isSwiping && Math.abs(cy) > Math.abs(cx)) return
      if (Math.abs(cx) > 8) isSwiping = true
      if (!isSwiping) return
      e.preventDefault()
      if (isOpen) dx = Math.max(Math.min(cx, 80), -80) + (-80)
      else dx = Math.min(Math.max(cx, -80), 0)
      card.style.transform = 'translateX(' + dx + 'px)'
    }, { passive: false })

    card.addEventListener('touchend', function () {
      card.style.transition = 'transform .3s ease'
      if (dx < -40) {
        if (_openSwipe && _openSwipe !== card) _closeAllSwipes()
        card.style.transform = 'translateX(-80px)'
        _openSwipe = card
        isOpen = true
      } else {
        card.style.transform = ''
        if (_openSwipe === card) _openSwipe = null
        isOpen = false
      }
      dx = 0
      isSwiping = false
    })

    wrap.querySelector('.swipe-delete').onclick = function (e) {
      e.stopPropagation()
      showModal({
        title: '删除比赛', content: '确定删除这场比赛吗？此操作不可恢复。', confirmText: '删除',
        onConfirm: function () { deleteTournament(tid); render() }
      })
    }
  })
  document.querySelectorAll('.share-icon').forEach(function (el) {
    el.onclick = function (e) {
      e.stopPropagation()
      var tid = el.dataset.share
      doShare(tid)
    }
  })
}

function doShare(tid) {
  var data = generateShareData(tid)
  if (!data) { showToast('分享失败'); return }
  var base = location.origin + location.pathname
  var url = base + '?share=' + data
  if (url.length > 8000) {
    showModal({ title: '数据过大', content: '比赛数据较大，建议使用"导出数据"功能分享。', showCancel: false })
    return
  }
  showModal({
    title: '分享比赛', content: '链接已准备好，点击确定复制到剪贴板。访客可通过此链接查看比赛数据（只读）。',
    confirmText: '复制链接',
    onConfirm: function () {
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { showToast('链接已复制') }).catch(function () { fallbackCopy(url) })
      else fallbackCopy(url)
    }
  })
}

function fallbackCopy(text) {
  var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px'
  document.body.appendChild(ta); ta.select()
  try { document.execCommand('copy'); showToast('链接已复制') } catch (e) { showToast('复制失败，请手动复制') }
  document.body.removeChild(ta)
}

/* ====================================================================
   PAGE: CREATE
   ==================================================================== */
function renderCreate() {
  _ps.type = _ps.type || 'singles'
  _ps.format = _ps.format || 'round-robin'
  _ps.name = _ps.name || ''
  var html = '<div class="container">'
  html += '<div class="flex-between mb-md"><button class="btn-home-link" id="btn-home">首页</button><div class="section-title">🏆 新建比赛</div><div style="width:40px"></div></div>'
  html += '<div class="card"><div class="section-title mb-sm">比赛名称</div>'
  html += '<input class="input-field" id="inp-name" placeholder="如：2025春季网球赛" value="' + esc(_ps.name) + '" maxlength="30"></div>'
  html += '<div class="card"><div class="section-title mb-sm">比赛类型</div><div class="flex-row gap-md">'
  html += '<div class="type-option' + (_ps.type === 'singles' ? ' type-option-active' : '') + '" data-type="singles"><div class="type-icon">🏸</div><div class="type-label">单打</div></div>'
  html += '<div class="type-option' + (_ps.type === 'doubles' ? ' type-option-active' : '') + '" data-type="doubles"><div class="type-icon">👥</div><div class="type-label">双打</div></div>'
  html += '</div></div>'
  html += '<div class="card"><div class="section-title mb-sm">赛制</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'
  ;[['round-robin','🔄','单循环','所有对手循环赛'],['group-knockout','🏅','小组循环+淘汰','分组循环后淘汰赛'],['single-knockout','⚡','单循环+淘汰','循环赛后淘汰赛'],['nine-team','🏆','9组大战赛','9队3组多阶段赛']].forEach(function(f){
    html+='<div class="type-option'+(_ps.format===f[0]?' type-option-active':'')+'" data-format="'+f[0]+'" style="min-width:0"><div class="type-icon">'+f[1]+'</div><div class="type-label">'+esc(f[2])+'</div><div class="type-desc">'+esc(f[3])+'</div></div>'
  })
  html += '</div></div>'
  html += '<div class="bottom-bar"><button class="btn-primary btn-block" id="btn-next">下一步 →</button></div>'
  html += '</div>'
  return html
}

function mountCreate() {
  document.getElementById('btn-home').onclick = function () { location.hash = '/' }
  document.getElementById('inp-name').oninput = function () { _ps.name = this.value }
  document.querySelectorAll('[data-type]').forEach(function (el) {
    el.onclick = function () { _ps.type = el.dataset.type; render() }
  })
  document.querySelectorAll('[data-format]').forEach(function (el) {
    el.onclick = function () { _ps.format = el.dataset.format; render() }
  })
  document.getElementById('btn-next').onclick = function () {
    var name = (_ps.name || '').trim()
    if (!name) { showToast('请输入比赛名称'); return }
    var t = {
      id: generateId(), name: name, type: _ps.type, format: _ps.format,
      players: [], teams: [], groups: null, matches: [], knockout: null,
      settings: {}, nineTeam: null, createTime: Date.now()
    }
    if (_ps.format === 'nine-team') t.nineTeam = init9TeamData()
    saveTournament(t)
    navigate('/players?id=' + t.id)
  }
}

/* ====================================================================
   PAGE: PLAYERS
   ==================================================================== */
function renderPlayers(p) {
  var t = getTournament(p.id)
  if (!t) return '<div class="container"><div class="empty-state"><div class="empty-icon">❌</div><div class="empty-text">比赛不存在</div></div></div>'
  if (!_canEdit(t)) return '<div class="container"><div class="empty-state"><div class="empty-icon">🔒</div><div class="empty-text">无编辑权限</div><div class="empty-hint">只有比赛创建者可以管理球员</div></div><div class="text-center mt-md"><button class="btn-primary" onclick="location.hash=\'/\'">返回首页</button></div></div>'
  var players = (t.players || []).slice().sort(function (a, b) { return b.score - a.score })
  var total = players.length, avg = total ? Math.round(players.reduce(function (s, p) { return s + p.score }, 0) / total) : 0
  var html = '<div class="container">'
  html += '<div class="flex-between mb-md"><button class="btn-home-link" id="btn-home">首页</button><div class="section-title">👤 选手管理</div><div style="width:40px"></div></div>'
  html += '<div class="card summary-bar"><div class="flex-between"><div><div class="text-bold">' + esc(t.name) + '</div><div class="player-count">共 ' + total + ' 人 · 平均积分 ' + avg + '</div></div><div class="score-badge">' + esc(TYPE[t.type]) + '</div></div></div>'
  if (t.format === 'nine-team') {
    if (t.type === 'doubles') {
      if (total < 18) html += '<div class="guide-tip">💡 双打9组大战赛建议18名选手（组成9支队伍）</div>'
    } else if (total !== 9) html += '<div class="guide-tip">⚠️ 单打9组大战赛需要恰好 9 名选手</div>'
  } else if (total === 0) html += '<div class="guide-tip">💡 点击下方"添加选手"开始，或导入Excel/CSV文件</div>'
  html += '<div class="card"><div class="section-title mb-sm">添加选手</div>'
  html += '<div class="add-row"><input class="input-field" id="inp-pname" placeholder="姓名"><input class="input-field score-input" id="inp-pscore" placeholder="积分" type="number" min="0"><button class="btn-primary btn-mini" id="btn-add">添加</button></div>'
  if (_ps.editId) html += '<div class="edit-hint" id="cancel-edit">当前正在编辑，点此取消</div>'
  html += '</div>'
  html += '<div class="card"><div class="flex-between mb-sm"><div class="section-title">选手列表</div><div class="flex-row gap-sm">'
  html += '<button class="btn-secondary btn-mini" id="btn-import">📥 导入</button>'
  html += '<button class="btn-danger btn-mini" id="btn-clear-all" style="font-size:12px">清空</button>'
  html += '</div></div>'
  if (players.length === 0) {
    html += '<div class="empty-state" style="padding:20px"><div class="empty-icon">📋</div><div class="empty-text">暂无选手</div></div>'
  } else {
    players.forEach(function (pl, idx) {
      html += '<div class="player-item" data-pid="' + pl.id + '">'
      html += '<div class="rank' + (idx < 3 ? ' top3' : '') + '">' + (idx + 1) + '</div>'
      html += '<div class="player-name-text">' + esc(pl.name) + '</div>'
      html += '<div class="player-actions">'
      html += '<div class="score-badge">' + pl.score + '</div>'
      html += '<button class="btn-icon" data-edit="' + pl.id + '" title="编辑">✏️</button>'
      html += '<button class="btn-icon" data-del="' + pl.id + '" title="删除">🗑️</button>'
      html += '</div></div>'
    })
  }
  html += '</div>'
  var nextLabel = t.type === 'doubles' ? '下一步：组队 →' : '下一步：抽签设置 →'
  var disabled = total < 2
  if (t.format === 'nine-team' && t.type === 'singles' && total !== 9) disabled = true
  html += '<div class="bottom-bar"><button class="btn-primary btn-block' + (disabled ? ' btn-disabled' : '') + '" id="btn-next">' + nextLabel + '</button></div>'
  html += '</div>'
  return html
}

function mountPlayers(p) {
  document.getElementById('btn-home').onclick = function () { location.hash = '/' }
  var t = getTournament(p.id)
  if (!t) return

  document.getElementById('btn-add').onclick = function () {
    var nm = document.getElementById('inp-pname').value.trim()
    var sc = parseInt(document.getElementById('inp-pscore').value) || 0
    if (!nm) { showToast('请输入姓名'); return }
    if (sc < 0) sc = 0
    if (!_ps.editId) {
      if (t.players.some(function (x) { return x.name === nm })) { showToast('选手已存在'); return }
      t.players.push({ id: generateId(), name: nm, score: sc })
    } else {
      var pl = t.players.find(function (x) { return x.id === _ps.editId })
      if (pl) { pl.name = nm; pl.score = sc }
      _ps.editId = null
    }
    saveTournament(t); render()
  }

  var ce = document.getElementById('cancel-edit')
  if (ce) ce.onclick = function () { _ps.editId = null; render() }

  document.querySelectorAll('[data-edit]').forEach(function (el) {
    el.onclick = function (e) {
      e.stopPropagation()
      var pl = t.players.find(function (x) { return x.id === el.dataset.edit })
      if (pl) {
        _ps.editId = pl.id
        document.getElementById('inp-pname').value = pl.name
        document.getElementById('inp-pscore').value = pl.score
        document.getElementById('btn-add').textContent = '保存'
      }
    }
  })
  document.querySelectorAll('[data-del]').forEach(function (el) {
    el.onclick = function (e) {
      e.stopPropagation()
      showModal({
        title: '删除选手', content: '确定删除该选手？',
        onConfirm: function () { t.players = t.players.filter(function (x) { return x.id !== el.dataset.del }); saveTournament(t); render() }
      })
    }
  })

  document.getElementById('btn-import').onclick = function () {
    var fi = document.getElementById('file-input')
    fi.onchange = function () {
      var file = fi.files[0]; if (!file) return
      if (file.name.match(/\.(xlsx|xls)$/i)) {
        var reader = new FileReader()
        reader.onload = function (e) {
          var ps = parseExcel(e.target.result)
          if (ps.length === 0) { showToast('未识别到有效数据'); return }
          ps.forEach(function (np) { if (!t.players.some(function (x) { return x.name === np.name })) t.players.push(np) })
          saveTournament(t); showToast('导入 ' + ps.length + ' 名选手'); render()
        }
        reader.readAsArrayBuffer(file)
      } else {
        var reader = new FileReader()
        reader.onload = function (e) {
          var ps = parseCSV(e.target.result)
          if (ps.length === 0) { showToast('未识别到有效数据'); return }
          ps.forEach(function (np) { if (!t.players.some(function (x) { return x.name === np.name })) t.players.push(np) })
          saveTournament(t); showToast('导入 ' + ps.length + ' 名选手'); render()
        }
        reader.readAsText(file)
      }
      fi.value = ''
    }
    fi.click()
  }

  var ca = document.getElementById('btn-clear-all')
  if (ca) ca.onclick = function () {
    showModal({ title: '清空选手', content: '确定清空所有选手吗？', onConfirm: function () { t.players = []; saveTournament(t); render() } })
  }

  document.getElementById('btn-next').onclick = function () {
    if (t.format === 'nine-team' && t.type === 'singles' && t.players.length !== 9) { showToast('单打9组大战赛需要恰好9名选手'); return }
    if (t.players.length < 2) { showToast('至少需要2名选手'); return }
    if (t.type === 'doubles') navigate('/pairing?id=' + t.id)
    else navigate('/settings?id=' + t.id)
  }
}

/* ====================================================================
   PAGE: PAIRING (Doubles)
   ==================================================================== */
function renderPairing(p) {
  var t = getTournament(p.id)
  if (!t) return '<div class="container"><div class="empty-state"><div class="empty-icon">❌</div><div class="empty-text">比赛不存在</div></div></div>'
  if (!_canEdit(t)) return '<div class="container"><div class="empty-state"><div class="empty-icon">🔒</div><div class="empty-text">无编辑权限</div></div><div class="text-center mt-md"><button class="btn-primary" onclick="location.hash=\'/\'">返回首页</button></div></div>'
  var teams = t.teams || [], pairedIds = new Set()
  teams.forEach(function (tm) { pairedIds.add(tm.player1.id); pairedIds.add(tm.player2.id) })
  var unpaired = t.players.filter(function (x) { return !pairedIds.has(x.id) }).sort(function (a, b) { return b.score - a.score })
  var selected = _ps.selectedId || null
  var html = '<div class="container">'
  html += '<div class="flex-between mb-md"><button class="btn-home-link" id="btn-home">首页</button><div class="section-title">👥 双打组队</div><div style="width:40px"></div></div>'
  html += '<div class="action-bar">'
  html += '<button class="btn-secondary btn-mini" id="btn-rand-pair">🎲 随机组队</button>'
  html += '<button class="btn-secondary btn-mini" id="btn-smart-pair">🧠 智能组队</button>'
  html += '<button class="btn-danger btn-mini" id="btn-clear-pairs">🔄 全部解散</button>'
  html += '</div>'

  html += '<div class="section-header"><div class="section-title text-sm">未配对选手 <span class="section-count">(' + unpaired.length + ')</span></div></div>'
  if (unpaired.length === 0) html += '<div class="text-center text-hint" style="padding:10px">所有选手已配对</div>'
  unpaired.forEach(function (pl) {
    var isSel = selected === pl.id
    html += '<div class="player-card' + (isSel ? ' player-selected' : '') + '" data-pair="' + pl.id + '">'
    html += '<div class="player-info"><span class="player-name-text">' + esc(pl.name) + '</span><span class="score-badge">' + pl.score + '</span></div>'
    html += '<div class="pair-btn">+</div></div>'
  })
  if (unpaired.length % 2 === 1 && unpaired.length > 0) html += '<div class="bye-card">⚠️ 奇数选手，将有一人轮空</div>'

  html += '<div class="section-header"><div class="section-title text-sm">已配对队伍 <span class="section-count">(' + teams.length + ')</span></div></div>'
  if (teams.length === 0) html += '<div class="text-center text-hint" style="padding:10px">点击选手"+"按钮进行手动配对</div>'
  teams.forEach(function (tm) {
    html += '<div class="team-card"><div class="flex-between"><div class="team-name-text">' + esc(tm.name) + '</div><div class="flex-row gap-sm"><div class="score-badge">' + tm.score + '</div><span class="disband-btn" data-disband="' + tm.id + '">解散</span></div></div>'
    html += '<div class="team-detail">' + esc(tm.player1.name) + '(' + tm.player1.score + ') + ' + esc(tm.player2.name) + '(' + tm.player2.score + ')</div></div>'
  })

  var disabled = teams.length < 1
  if (t.format === 'nine-team' && teams.length !== 9) html += '<div class="guide-tip">⚠️ 9组大战赛需要恰好9支队伍（当前 ' + teams.length + ' 支）</div>'
  html += '<div class="bottom-bar"><button class="btn-primary btn-block' + (disabled ? ' btn-disabled' : '') + '" id="btn-next">下一步：抽签设置 →</button></div>'
  html += '</div>'
  return html
}

function mountPairing(p) {
  var t = getTournament(p.id); if (!t) return
  document.getElementById('btn-home').onclick = function () { location.hash = '/' }

  document.querySelectorAll('[data-pair]').forEach(function (el) {
    el.onclick = function () {
      var pid = el.dataset.pair
      if (!_ps.selectedId) { _ps.selectedId = pid; render() }
      else if (_ps.selectedId === pid) { _ps.selectedId = null; render() }
      else {
        var p1 = t.players.find(function (x) { return x.id === _ps.selectedId })
        var p2 = t.players.find(function (x) { return x.id === pid })
        if (p1 && p2) {
          t.teams = t.teams || []
          t.teams.push({ id: 'team_' + Date.now(), player1: { id: p1.id, name: p1.name, score: p1.score }, player2: { id: p2.id, name: p2.name, score: p2.score }, score: p1.score + p2.score, name: p1.name + '/' + p2.name })
          saveTournament(t)
        }
        _ps.selectedId = null; render()
      }
    }
  })

  document.querySelectorAll('[data-disband]').forEach(function (el) {
    el.onclick = function () {
      t.teams = t.teams.filter(function (x) { return x.id !== el.dataset.disband })
      saveTournament(t); render()
    }
  })

  document.getElementById('btn-rand-pair').onclick = function () {
    var pairedIds = new Set(); (t.teams || []).forEach(function (tm) { pairedIds.add(tm.player1.id); pairedIds.add(tm.player2.id) })
    var avail = t.players.filter(function (x) { return !pairedIds.has(x.id) })
    var res = randomPairFn(avail)
    t.teams = (t.teams || []).concat(res.teams)
    saveTournament(t); _ps.selectedId = null; render()
    showToast('随机组队完成')
  }
  document.getElementById('btn-smart-pair').onclick = function () {
    var pairedIds = new Set(); (t.teams || []).forEach(function (tm) { pairedIds.add(tm.player1.id); pairedIds.add(tm.player2.id) })
    var avail = t.players.filter(function (x) { return !pairedIds.has(x.id) })
    var res = smartPairFn(avail)
    t.teams = (t.teams || []).concat(res.teams)
    saveTournament(t); _ps.selectedId = null; render()
    showToast('智能组队完成')
  }
  document.getElementById('btn-clear-pairs').onclick = function () {
    showModal({ title: '全部解散', content: '确定解散所有队伍？', onConfirm: function () { t.teams = []; saveTournament(t); render() } })
  }
  document.getElementById('btn-next').onclick = function () {
    if (t.teams.length < 1) { showToast('至少组成一队'); return }
    if (t.format === 'nine-team' && t.teams.length !== 9) {
      showModal({
        title: '队伍数量提醒', content: '9组大战赛需要9支队伍（当前' + t.teams.length + '支），是否仍要继续？',
        confirmText: '继续', onConfirm: function () { navigate('/settings?id=' + t.id) }
      })
      return
    }
    navigate('/settings?id=' + t.id)
  }
}

/* ====================================================================
   PAGE: SETTINGS
   ==================================================================== */
function renderSettings(p) {
  var t = getTournament(p.id)
  if (!t) return '<div class="container"><div class="empty-state"><div class="empty-icon">❌</div><div class="empty-text">比赛不存在</div></div></div>'
  if (!_canEdit(t)) return '<div class="container"><div class="empty-state"><div class="empty-icon">🔒</div><div class="empty-text">无编辑权限</div><div class="empty-hint">只有比赛创建者可以修改设置</div></div><div class="text-center mt-md"><button class="btn-primary" onclick="location.hash=\'/\'">返回首页</button></div></div>'
  var items = t.type === 'doubles' ? (t.teams || []) : (t.players || [])
  var itemCount = items.length, isD = t.type === 'doubles', fmt = t.format
  var s = t.settings || {}
  if (!s.drawMethod) s.drawMethod = 'snake'
  if (!s.seedCount) s.seedCount = 0
  if (!s.groupCount && fmt === 'group-knockout') s.groupCount = Math.min(4, Math.floor(itemCount / 2))
  if (!s.qualifyCount && fmt === 'group-knockout') s.qualifyCount = 2
  if (!s.koTeamCount && fmt === 'single-knockout') s.koTeamCount = 4
  if (!s.koRule && fmt === 'single-knockout') s.koRule = 'cross'
  if (typeof s.hasThirdPlace === 'undefined') s.hasThirdPlace = true
  _ps.settings = s

  var html = '<div class="container">'
  html += '<div class="flex-between mb-md"><button class="btn-home-link" id="btn-home">首页</button><div class="section-title">⚙️ 抽签设置</div><div style="width:40px"></div></div>'
  html += '<div class="card info-card"><div><div class="info-name">' + esc(t.name) + '</div><div class="info-count">' + itemCount + (isD ? ' 队' : ' 人') + ' · ' + esc(TYPE[t.type]) + ' · ' + esc(FMT[fmt]) + '</div></div></div>'

  if (fmt === 'round-robin') {
    html += '<div class="card"><div class="section-title mb-sm">📋 赛制说明</div><div class="text-sm text-secondary">所有' + (isD ? '队伍' : '选手') + '进行循环赛，每两者之间都有一场比赛。</div></div>'
  } else if (fmt === 'nine-team') {
    if (!s.round6Rule) s.round6Rule = 'ranked'
    html += '<div class="card"><div class="section-title mb-sm">📋 赛制说明</div><div class="text-sm text-secondary">分为3组（A/B/C），每组' + Math.ceil(itemCount / 3) + (isD ? '队' : '人') + '。经过小组赛→6强赛→复活赛→4强赛→决赛决出排名。</div></div>'
    if (itemCount !== 9) html += '<div class="guide-tip">⚠️ 9组大战赛建议9' + (isD ? '队' : '人') + '参赛（当前' + itemCount + '）</div>'
    html += '<div class="card"><div class="section-title mb-sm">⚔️ 6强赛对阵规则</div>'
    html += '<div class="draw-options">'
    html += '<div class="draw-option' + (s.round6Rule === 'ranked' ? ' active' : '') + '" data-r6rule="ranked"><div class="draw-option-title">📊 按排名对阵</div><div class="draw-option-desc">A1vsB2, B1vsC2, C1vsA2</div></div>'
    html += '<div class="draw-option' + (s.round6Rule === 'random' ? ' active' : '') + '" data-r6rule="random"><div class="draw-option-title">🎲 随机抽签</div><div class="draw-option-desc">6队随机两两配对</div></div>'
    html += '</div></div>'
  } else if (fmt === 'group-knockout') {
    html += '<div class="card"><div class="section-title mb-sm">📊 分组设置</div>'
    html += '<div class="method-input-row"><span class="seed-label">组数</span><input class="input-field method-input" id="inp-gc" type="number" min="2" value="' + (s.groupCount || 2) + '"><span class="text-sm text-hint ml-sm">每组约 ' + Math.ceil(itemCount / (s.groupCount || 2)) + (isD ? '队' : '人') + '</span></div>'
    html += '<div class="method-input-row mt-sm"><span class="seed-label">每组出线</span><input class="input-field method-input" id="inp-qc" type="number" min="1" max="4" value="' + (s.qualifyCount || 2) + '"><span class="text-sm text-hint ml-sm">' + (isD ? '队' : '人') + '</span></div>'
    html += '<div class="flex-between mt-sm"><span class="text-sm">三四名决赛</span><label class="toggle"><input type="checkbox" id="chk-tp"' + (s.hasThirdPlace ? ' checked' : '') + '><span class="toggle-slider"></span></label></div>'
    html += '</div>'
  } else if (fmt === 'single-knockout') {
    html += '<div class="card"><div class="section-title mb-sm">📊 淘汰赛设置</div>'
    html += '<div class="method-input-row"><span class="seed-label">参与淘汰赛</span><select class="input-field method-input" id="sel-kc"><option value="2"' + (s.koTeamCount == 2 ? ' selected' : '') + '>2</option><option value="4"' + (s.koTeamCount == 4 ? ' selected' : '') + '>4</option></select><span class="text-sm text-hint ml-sm">' + (isD ? '队' : '人') + '</span></div>'
    if ((s.koTeamCount || 4) == 4) {
      html += '<div class="section-title text-sm mt-md mb-sm">对阵规则</div>'
      html += '<div class="draw-options">'
      html += '<div class="draw-option' + (s.koRule === 'cross' ? ' active' : '') + '" data-rule="cross"><div class="draw-option-title">交叉淘汰</div><div class="draw-option-desc">1v4, 2v3</div></div>'
      html += '<div class="draw-option' + (s.koRule === 'direct' ? ' active' : '') + '" data-rule="direct"><div class="draw-option-title">直接决赛</div><div class="draw-option-desc">1v2, 3v4</div></div>'
      html += '</div>'
    }
    html += '<div class="flex-between mt-sm"><span class="text-sm">三四名决赛</span><label class="toggle"><input type="checkbox" id="chk-tp"' + (s.hasThirdPlace ? ' checked' : '') + '><span class="toggle-slider"></span></label></div>'
    html += '</div>'
  }

  var _isMultiGroup = (fmt === 'group-knockout' || fmt === 'nine-team')
  var _drawTitle = _isMultiGroup ? '🎯 分组方式' : '🎯 排序方式'
  html += '<div class="card"><div class="section-title mb-sm">' + _drawTitle + '</div>'
  html += '<div class="draw-options" style="flex-wrap:wrap">'
  if (_isMultiGroup) {
    html += '<div class="draw-option' + (s.drawMethod === 'snake' ? ' active' : '') + '" data-dm="snake"><div class="draw-option-title">🐍 蛇形分组</div><div class="draw-option-desc">按积分蛇形分配</div></div>'
    html += '<div class="draw-option' + (s.drawMethod === 'random' ? ' active' : '') + '" data-dm="random"><div class="draw-option-title">🎲 随机分组</div><div class="draw-option-desc">种子固定后随机</div></div>'
  } else {
    html += '<div class="draw-option' + (s.drawMethod === 'snake' ? ' active' : '') + '" data-dm="snake"><div class="draw-option-title">📊 按积分排序</div><div class="draw-option-desc">按积分从高到低</div></div>'
    html += '<div class="draw-option' + (s.drawMethod === 'random' ? ' active' : '') + '" data-dm="random"><div class="draw-option-title">🎲 随机排序</div><div class="draw-option-desc">随机打乱顺序</div></div>'
  }
  html += '<div class="draw-option' + (s.drawMethod === 'custom' ? ' active' : '') + '" data-dm="custom"><div class="draw-option-title">✏️ 自定义</div><div class="draw-option-desc">手动' + (_isMultiGroup ? '分配到各组' : '设定顺序') + '</div></div>'
  html += '</div></div>'

  if (s.drawMethod === 'custom') {
    if (fmt === 'nine-team') {
      if (!s.customGroups) s.customGroups = {}
      var _hasAllNt = items.every(function(it) { return s.customGroups[it.id] })
      if (!_hasAllNt) { s.customGroups = {}; items.forEach(function(it, idx) { s.customGroups[it.id] = String.fromCharCode(65 + (idx % 3)) }) }
      var _gcA = 0, _gcB = 0, _gcC = 0
      items.forEach(function(it) { var g = s.customGroups[it.id]; if (g === 'A') _gcA++; else if (g === 'B') _gcB++; else if (g === 'C') _gcC++ })
      html += '<div class="card"><div class="section-title mb-sm">📝 自定义分组</div>'
      html += '<div class="text-sm text-secondary mb-sm">点击 A/B/C 按钮分配各' + (isD ? '队伍' : '选手') + '所在组</div>'
      html += '<div class="flex-row gap-md mb-sm" style="justify-content:center"><span class="tag tag-blue">A组: ' + _gcA + '</span><span class="tag tag-green">B组: ' + _gcB + '</span><span class="tag tag-orange">C组: ' + _gcC + '</span></div>'
      items.forEach(function(it) {
        var assigned = s.customGroups[it.id] || 'A'
        html += '<div class="custom-group-row"><div class="custom-group-name">' + esc(it.name) + '</div><div class="custom-group-name-score">' + it.score + '</div><div class="custom-group-btns">'
        ;['A', 'B', 'C'].forEach(function(g) {
          html += '<div class="group-btn' + (assigned === g ? ' active' : '') + '" data-cg-id="' + it.id + '" data-cg-group="' + g + '" style="padding:5px 14px;font-size:12px">' + g + '</div>'
        })
        html += '</div></div>'
      })
      html += '</div>'
    } else if (fmt === 'group-knockout') {
      var _gkCount = s.groupCount || 2
      var _gkNames = []; for (var _gi = 0; _gi < _gkCount; _gi++) _gkNames.push(String.fromCharCode(65 + _gi))
      if (!s.customGroups) s.customGroups = {}
      var _hasAllGk = items.every(function(it) { return s.customGroups[it.id] && _gkNames.indexOf(s.customGroups[it.id]) >= 0 })
      if (!_hasAllGk) { s.customGroups = {}; items.forEach(function(it, idx) { s.customGroups[it.id] = _gkNames[idx % _gkCount] }) }
      var _gkCounts = {}; _gkNames.forEach(function(gn) { _gkCounts[gn] = 0 })
      items.forEach(function(it) { var g = s.customGroups[it.id]; if (_gkCounts[g] !== undefined) _gkCounts[g]++ })
      html += '<div class="card"><div class="section-title mb-sm">📝 自定义分组</div>'
      html += '<div class="text-sm text-secondary mb-sm">点击按钮分配各' + (isD ? '队伍' : '选手') + '所在组</div>'
      html += '<div class="flex-row gap-sm mb-sm" style="justify-content:center;flex-wrap:wrap">'
      var _tagCls = ['tag-blue', 'tag-green', 'tag-orange', 'tag-purple', 'tag-red']
      _gkNames.forEach(function(gn, gi) { html += '<span class="tag ' + _tagCls[gi % _tagCls.length] + '">' + gn + '组: ' + _gkCounts[gn] + '</span>' })
      html += '</div>'
      items.forEach(function(it) {
        var assigned = s.customGroups[it.id] || _gkNames[0]
        html += '<div class="custom-group-row"><div class="custom-group-name">' + esc(it.name) + '</div><div class="custom-group-name-score">' + it.score + '</div><div class="custom-group-btns">'
        _gkNames.forEach(function(gn) {
          html += '<div class="group-btn' + (assigned === gn ? ' active' : '') + '" data-cg-id="' + it.id + '" data-cg-group="' + gn + '" style="padding:5px 14px;font-size:12px">' + gn + '</div>'
        })
        html += '</div></div>'
      })
      html += '</div>'
    } else {
      if (!s.customOrder || s.customOrder.length !== items.length) {
        s.customOrder = items.slice().sort(function(a, b) { return b.score - a.score }).map(function(it) { return it.id })
      }
      var _coMap = {}; items.forEach(function(it) { _coMap[it.id] = it })
      html += '<div class="card"><div class="section-title mb-sm">📝 自定义排序</div>'
      html += '<div class="text-sm text-secondary mb-sm">使用箭头调整' + (isD ? '队伍' : '选手') + '顺序</div>'
      s.customOrder.forEach(function(id, idx) {
        var it = _coMap[id]; if (!it) return
        html += '<div class="custom-group-row"><div style="min-width:26px;text-align:center;font-weight:700;color:var(--text3)">' + (idx + 1) + '</div><div class="custom-group-name">' + esc(it.name) + '</div><div class="custom-group-name-score">' + it.score + '</div><div class="custom-group-btns">'
        html += '<div class="group-btn" data-co-id="' + id + '" data-co-dir="up" style="padding:4px 10px;font-size:11px;opacity:' + (idx === 0 ? '.25' : '1') + '">▲</div>'
        html += '<div class="group-btn" data-co-id="' + id + '" data-co-dir="down" style="padding:4px 10px;font-size:11px;opacity:' + (idx === s.customOrder.length - 1 ? '.25' : '1') + '">▼</div>'
        html += '</div></div>'
      })
      html += '</div>'
    }
  }

  if (s.drawMethod !== 'custom' && _isMultiGroup) {
    html += '<div class="card"><div class="section-title mb-sm">⭐ 种子设置</div>'
    html += '<div class="seed-row"><span class="seed-label">种子数量</span><input class="input-field seed-input" id="inp-seed" type="number" min="0" max="' + itemCount + '" value="' + (s.seedCount || 0) + '"><span class="text-sm text-hint ml-sm">前N名为种子</span></div></div>'
  }

  if (isD && _canEdit(t)) html += '<div class="text-center mt-sm mb-sm"><button class="btn-undo" id="btn-undo-pairing">↩️ 撤回配对（重新组队）</button></div>'
  html += '<div class="bottom-bar"><button class="btn-accent btn-block" id="btn-draw">🎾 开始抽签</button></div>'
  html += '</div>'
  return html
}

function mountSettings(p) {
  var t = getTournament(p.id); if (!t) return
  var s = _ps.settings || t.settings || {}
  document.getElementById('btn-home').onclick = function () { location.hash = '/' }

  var gc = document.getElementById('inp-gc')
  if (gc) gc.oninput = function () { s.groupCount = Math.max(2, parseInt(gc.value) || 2); t.settings = s; saveTournament(t); render() }
  var qc = document.getElementById('inp-qc')
  if (qc) qc.oninput = function () { s.qualifyCount = Math.max(1, Math.min(4, parseInt(qc.value) || 2)); t.settings = s; saveTournament(t) }
  var kc = document.getElementById('sel-kc')
  if (kc) kc.onchange = function () { s.koTeamCount = parseInt(kc.value); t.settings = s; saveTournament(t); render() }
  var tp = document.getElementById('chk-tp')
  if (tp) tp.onchange = function () { s.hasThirdPlace = tp.checked; t.settings = s; saveTournament(t) }

  document.querySelectorAll('[data-rule]').forEach(function (el) {
    el.onclick = function () { s.koRule = el.dataset.rule; t.settings = s; saveTournament(t); render() }
  })
  document.querySelectorAll('[data-r6rule]').forEach(function (el) {
    el.onclick = function () { s.round6Rule = el.dataset.r6rule; t.settings = s; saveTournament(t); render() }
  })
  document.querySelectorAll('[data-dm]').forEach(function (el) {
    el.onclick = function () { s.drawMethod = el.dataset.dm; t.settings = s; saveTournament(t); render() }
  })
  document.querySelectorAll('[data-cg-id]').forEach(function (el) {
    el.onclick = function () {
      if (!s.customGroups) s.customGroups = {}
      s.customGroups[el.dataset.cgId] = el.dataset.cgGroup
      t.settings = s; saveTournament(t); render()
    }
  })
  document.querySelectorAll('[data-co-id]').forEach(function (el) {
    el.onclick = function () {
      if (!s.customOrder) return
      var id = el.dataset.coId, dir = el.dataset.coDir
      var idx = s.customOrder.indexOf(id)
      if (idx < 0) return
      if (dir === 'up' && idx > 0) { var tmp = s.customOrder[idx - 1]; s.customOrder[idx - 1] = id; s.customOrder[idx] = tmp }
      else if (dir === 'down' && idx < s.customOrder.length - 1) { var tmp = s.customOrder[idx + 1]; s.customOrder[idx + 1] = id; s.customOrder[idx] = tmp }
      else return
      t.settings = s; saveTournament(t); render()
    }
  })
  var sd = document.getElementById('inp-seed')
  if (sd) sd.oninput = function () { s.seedCount = Math.max(0, parseInt(sd.value) || 0); t.settings = s; saveTournament(t) }

  var _up = document.getElementById('btn-undo-pairing')
  if (_up) _up.onclick = function () {
    showModal({ title: '撤回配对', content: '将清空所有队伍配对，回到组队页面重新配对，确定撤回？', confirmText: '确认撤回',
      onConfirm: function () {
        t = getTournament(p.id); t.teams = []; t.groups = null; t.matches = []; t.knockout = null; t.nineTeam = null
        saveTournament(t); showToast('已撤回配对')
        navigate('/pairing?id=' + t.id)
      }
    })
  }

  document.getElementById('btn-draw').onclick = function () {
    t = getTournament(p.id)
    if (!t) { showToast('比赛数据异常'); return }
    s = _ps.settings || t.settings || {}
    var items = t.type === 'doubles' ? (t.teams || []) : (t.players || [])
    if (items.length < 2) { showToast('至少需要2' + (t.type === 'doubles' ? '支队伍' : '名选手')); return }
    var fmt = t.format
    t.settings = s; t.matches = []; t.knockout = null
    if (fmt === 'nine-team') t.nineTeam = init9TeamData()
    function _buildCustomOrder(order, its) {
      var m = {}; its.forEach(function(x) { m[x.id] = x })
      return (order || []).map(function(id) { return m[id] ? Object.assign({}, m[id]) : null }).filter(Boolean)
    }
    function _buildCustomGroups(cg, its, names) {
      var gm = {}; names.forEach(function(n) { gm[n] = [] })
      its.forEach(function(it) { var g = cg[it.id] || names[0]; if (gm[g]) gm[g].push(Object.assign({}, it)); else gm[names[0]].push(Object.assign({}, it)) })
      return names.map(function(n) { return {name: n, members: gm[n]} })
    }
    if (fmt === 'round-robin') {
      if (s.drawMethod === 'custom' && s.customOrder) {
        t.groups = [{ name: 'A', members: _buildCustomOrder(s.customOrder, items) }]
      } else if (s.drawMethod === 'random') {
        t.groups = [{ name: 'A', members: shuffleArray(items.map(function (x) { return Object.assign({}, x) })) }]
      } else {
        t.groups = [{ name: 'A', members: items.slice().sort(function (a, b) { return b.score - a.score }).map(function (x) { return Object.assign({}, x) }) }]
      }
    } else if (fmt === 'nine-team') {
      if (s.drawMethod === 'custom' && s.customGroups) {
        t.groups = _buildCustomGroups(s.customGroups, items, ['A', 'B', 'C'])
      } else {
        var gc = 3, sc = Math.min(s.seedCount || 0, items.length)
        t.groups = s.drawMethod === 'random' ? randomGroup(items, gc, sc) : snakeGroup(items, gc, sc)
      }
    } else if (fmt === 'group-knockout') {
      if (s.drawMethod === 'custom' && s.customGroups) {
        var _gkN = []; for (var _gi = 0; _gi < (s.groupCount || 2); _gi++) _gkN.push(String.fromCharCode(65 + _gi))
        t.groups = _buildCustomGroups(s.customGroups, items, _gkN)
      } else {
        var gc = s.groupCount || 2, sc = Math.min(s.seedCount || 0, items.length)
        t.groups = s.drawMethod === 'random' ? randomGroup(items, gc, sc) : snakeGroup(items, gc, sc)
      }
    } else if (fmt === 'single-knockout') {
      if (s.drawMethod === 'custom' && s.customOrder) {
        t.groups = [{ name: 'A', members: _buildCustomOrder(s.customOrder, items) }]
      } else {
        t.groups = [{ name: 'A', members: (s.drawMethod === 'random' ? shuffleArray(items) : items.slice().sort(function (a, b) { return b.score - a.score })).map(function (x) { return Object.assign({}, x) }) }]
      }
    }
    saveTournament(t)
    showToast('抽签完成！')
    navigate('/result?id=' + t.id)
  }
}

/* ====================================================================
   PAGE: RESULT
   ==================================================================== */
function renderResult(p) {
  var t = _t(p.id)
  if (!t) return '<div class="container"><div class="empty-state"><div class="empty-icon">❌</div><div class="empty-text">比赛不存在</div></div></div>'
  if (!t.groups) return '<div class="container"><div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">尚未完成抽签</div></div><div class="text-center mt-md"><button class="btn-primary" onclick="location.hash=\'/\'">返回首页</button></div></div>'
  var isD = t.type === 'doubles', fmt = t.format
  var expanded = _ps.expanded || {}
  var html = '<div class="container">'
  if (_viewer) html += '<div class="viewer-banner">🔒 只读模式 — 仅供查看</div>'
  html += '<div class="flex-between mb-md"><button class="btn-home-link" id="btn-home">首页</button><div class="section-title">📋 分组结果</div><div style="width:40px"></div></div>'
  html += '<div class="card header-card"><div class="flex-between"><div class="header-name">' + esc(t.name) + '</div>'
  if (_canScore(t)) html += '<button class="btn-icon" id="btn-edit-name" title="修改名称" style="font-size:16px;opacity:.6">✏️</button>'
  html += '</div>'
  html += '<div class="header-summary">' + esc(TYPE[t.type]) + ' · ' + esc(FMT[fmt])
  var totalMembers = 0; t.groups.forEach(function (g) { totalMembers += g.members.length })
  html += ' · ' + t.groups.length + '组 · ' + totalMembers + (isD ? '队' : '人') + '</div></div>'

  t.groups.forEach(function (g) {
    var exp = expanded[g.name] !== false
    html += '<div class="group-card"><div class="group-header" data-gname="' + g.name + '"><div><span class="group-name-label">' + esc(g.name) + ' 组</span><span class="group-count-label">(' + g.members.length + (isD ? '队' : '人') + ')</span></div><div class="group-arrow' + (exp ? ' expanded' : '') + '">▼</div></div>'
    if (exp) {
      html += '<div class="group-body">'
      g.members.forEach(function (m, idx) {
        html += '<div class="member-item"><div class="member-rank">' + (idx + 1) + '</div><div class="member-info"><div class="member-name-text">' + esc(m.name) + '</div>'
        if (isD && m.player1 && m.player2) html += '<div class="member-detail">' + esc(m.player1.name) + '(' + m.player1.score + ') + ' + esc(m.player2.name) + '(' + m.player2.score + ')</div>'
        html += '</div><div class="member-badges"><span class="score-badge">' + m.score + '</span>'
        if (m.isSeed) html += '<span class="seed-badge">种子</span>'
        html += '</div></div>'
      })
      html += '</div>'
    }
    html += '</div>'
  })

  if (!_viewer) {
    var _hasSchedule = (t.matches && t.matches.length > 0)
    html += '<div class="bottom-actions">'
    if (_hasSchedule) {
      html += '<div class="action-row"><button class="btn-primary" id="btn-gen-schedule">📅 查看赛程</button>'
    } else {
      html += '<div class="action-row"><button class="btn-primary" id="btn-gen-schedule">📅 生成赛程</button>'
    }
    html += '<button class="btn-accent" id="btn-share">📤 分享</button></div>'
    html += '<div class="action-row"><button class="btn-secondary" id="btn-export">💾 导出</button>'
    if (_canEdit(t)) html += '<button class="btn-undo" id="btn-undo-draw">↩️ 撤回分组</button>'
    html += '</div></div>'
  }
  html += '</div>'
  return html
}

function mountResult(p) {
  var t = _t(p.id); if (!t || !t.groups) return
  if (typeof listenToTournament === 'function') listenToTournament(p.id)
  _ps.expanded = _ps.expanded || {}
  document.getElementById('btn-home').onclick = function () { location.hash = '/' }

  document.querySelectorAll('.group-header').forEach(function (el) {
    el.onclick = function () {
      var gn = el.dataset.gname
      _ps.expanded[gn] = _ps.expanded[gn] === false ? true : false
      render()
    }
  })

  if (_viewer) return

  var en = document.getElementById('btn-edit-name')
  if (en) en.onclick = function () {
    showPrompt({
      title: '修改比赛名称', value: t.name, placeholder: '输入新名称',
      onConfirm: function (val) {
        if (!val) { showToast('名称不能为空'); return }
        t = getTournament(p.id); t.name = val; saveTournament(t)
        showToast('名称已修改'); render()
      }
    })
  }

  var gs = document.getElementById('btn-gen-schedule')
  if (gs) gs.onclick = function () {
    t = getTournament(p.id)
    if (t.matches && t.matches.length > 0) {
      navigate('/schedule?id=' + t.id)
      return
    }
    t.matches = generateAllGroupMatches(t.groups)
    if (t.format === 'nine-team') {
      t.nineTeam = t.nineTeam || init9TeamData()
      t.nineTeam.stageStatus.group = 'in_progress'
    }
    saveTournament(t)
    showToast('赛程已生成'); navigate('/schedule?id=' + t.id)
  }
  var sh = document.getElementById('btn-share')
  if (sh) sh.onclick = function () { doShare(p.id) }
  var ex = document.getElementById('btn-export')
  if (ex) ex.onclick = function () { doExport(t) }
  var ud = document.getElementById('btn-undo-draw')
  if (ud) ud.onclick = function () {
    showModal({
      title: '撤回分组', content: '将清空分组、赛程和比分数据，回到抽签设置页面，确定撤回？', confirmText: '确认撤回',
      onConfirm: function () {
        t = getTournament(p.id)
        t.groups = null; t.matches = []; t.knockout = null; t.nineTeam = null
        saveTournament(t); showToast('已撤回分组')
        navigate('/settings?id=' + t.id)
      }
    })
  }
}

function doExport(t) {
  var items = [
    { text: '📋 导出分组名单 (Excel)', action: function () { exportGroupList(t) } },
    { text: '📅 导出赛程表 (Excel)', action: function () { exportSchedule(t) } },
    { text: '📊 导出比分表 (Excel)', action: function () { exportScores(t) } },
    { text: '🏆 导出排名 (Excel)', action: function () { exportRankings(t) } },
    { text: '🖼️ 导出分组图片', action: function () { chooseImageTheme(t, 'groups') } },
    { text: '🖼️ 导出排名图片', action: function () { chooseImageTheme(t, 'rankings') } }
  ]
  if (t.format === 'nine-team') {
    items.push({ text: '🖼️ 导出小组赛比分图片', action: function () { chooseImageTheme(t, 'scores_group') } })
    items.push({ text: '🖼️ 导出6强赛比分图片', action: function () { chooseImageTheme(t, 'scores_round6') } })
    items.push({ text: '🖼️ 导出复活赛比分图片', action: function () { chooseImageTheme(t, 'scores_revival') } })
    items.push({ text: '🖼️ 导出4强赛比分图片', action: function () { chooseImageTheme(t, 'scores_semi') } })
    items.push({ text: '🖼️ 导出决赛比分图片', action: function () { chooseImageTheme(t, 'scores_final') } })
    items.push({ text: '🖼️ 导出排位赛比分图片', action: function () { chooseImageTheme(t, 'scores_ranking') } })
  } else {
    items.push({ text: '🖼️ 导出比分图片（全部）', action: function () { chooseImageTheme(t, 'scores_all') } })
  }
  items.push({ text: '📝 复制文字结果', action: function () { copyTextResult(t) } })
  showActionSheet(items)
}

function chooseImageTheme(t, type) {
  showActionSheet([
    { text: '⬜ 简约白', action: function () { exportAsImage(t, type, 'light') } },
    { text: '🟢 网球绿', action: function () { exportAsImage(t, type, 'green') } },
    { text: '⬛ 暗夜模式', action: function () { exportAsImage(t, type, 'dark') } },
    { text: '💜 紫罗兰', action: function () { exportAsImage(t, type, 'purple') } }
  ])
}

function exportAsImage(t, type, theme) {
  var th = IMG_THEMES[theme] || IMG_THEMES.light
  var body = ''
  if (type === 'groups') {
    ;(t.groups || []).forEach(function (g, gi) {
      body += '<div style="margin-bottom:16px;background:'+th.cardBg+';border-radius:12px;border:1px solid '+th.border+';overflow:hidden">'
      body += '<div style="padding:10px 16px;background:'+th.headerBg+';display:flex;align-items:center;gap:8px"><span style="font-size:18px;font-weight:800;color:'+th.headerText+'">'+esc(g.name)+'</span><span style="font-size:12px;color:rgba(255,255,255,.7)">组 · '+g.members.length+'人</span></div>'
      g.members.forEach(function (m, i) {
        var rowBg = i % 2 === 0 ? 'transparent' : th.cardBg
        body += '<div style="display:flex;align-items:center;padding:10px 16px;background:'+rowBg+'">'
        var rankStyle = i < 3 ? 'width:26px;height:26px;border-radius:50%;background:'+th.badge+';color:'+th.badgeText+';display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;flex-shrink:0' : 'width:26px;height:26px;border-radius:50%;background:'+th.cardBg+';border:1px solid '+th.border+';color:'+th.sub+';display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0'
        body += '<div style="'+rankStyle+'">'+(i+1)+'</div>'
        body += '<div style="flex:1;margin-left:12px"><div style="font-size:14px;font-weight:600;line-height:1.3">'+esc(m.name)+'</div>'
        if (t.type === 'doubles' && m.player1 && m.player2) body += '<div style="font-size:11px;color:'+th.sub+';margin-top:2px">'+esc(m.player1.name)+' + '+esc(m.player2.name)+'</div>'
        body += '</div>'
        body += '<div style="display:flex;align-items:center;gap:6px">'
        body += '<span style="background:'+th.badge+';color:'+th.badgeText+';padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700">'+m.score+'</span>'
        if (m.isSeed) body += '<span style="background:'+th.tagBg+';color:'+th.tagText+';padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700">种子</span>'
        body += '</div></div>'
      })
      body += '</div>'
    })
  } else if (type === 'rankings') {
    if (t.format === 'nine-team') {
      var rk = compute9TeamFinalRankings(t)
      if (rk.length > 0) {
        rk.forEach(function (r) {
          var icon = r.rank <= 3 ? ['🥇','🥈','🥉'][r.rank-1] : ''
          var isMedal = r.rank <= 3
          var cardStyle = isMedal ? 'background:'+th.cardBg+';border:1px solid '+th.border+';border-radius:12px;padding:14px 16px;margin-bottom:8px' : 'padding:10px 16px;margin-bottom:4px;border-bottom:1px solid '+th.border
          body += '<div style="display:flex;align-items:center;'+cardStyle+'">'
          if (isMedal) { body += '<span style="font-size:28px;margin-right:12px">'+icon+'</span>' }
          else { body += '<span style="width:32px;height:32px;border-radius:50%;background:'+th.cardBg+';border:1px solid '+th.border+';display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:'+th.sub+';margin-right:12px;flex-shrink:0">'+r.rank+'</span>' }
          body += '<div style="flex:1"><div style="font-size:'+(isMedal?'16':'14')+'px;font-weight:'+(isMedal?'800':'600')+'">'+esc(r.team.name)+'</div></div>'
          body += '<span style="background:'+th.tagBg+';color:'+th.tagText+';padding:3px 12px;border-radius:20px;font-size:12px;font-weight:600">'+esc(r.label)+'</span>'
          body += '</div>'
        })
      } else { body += '<div style="text-align:center;padding:30px;color:'+th.sub+';font-size:14px">⏳ 比赛尚未完成</div>' }
    } else {
      ;(t.groups || []).forEach(function (g) {
        var gm = (t.matches || []).filter(function (m) { return m.stage === 'group' && m.groupName === g.name })
        var st = calculateStandings(gm, g.members)
        body += '<div style="margin-bottom:16px;background:'+th.cardBg+';border-radius:12px;border:1px solid '+th.border+';overflow:hidden">'
        body += '<div style="padding:10px 16px;background:'+th.headerBg+';display:flex;align-items:center;gap:8px"><span style="font-size:16px;font-weight:800;color:'+th.headerText+'">'+esc(g.name)+' 组排名</span></div>'
        body += '<div style="display:flex;padding:8px 16px;border-bottom:1px solid '+th.border+';font-size:11px;color:'+th.sub+';font-weight:600"><span style="width:30px">#</span><span style="flex:1">名称</span><span style="width:50px;text-align:center">战绩</span><span style="width:44px;text-align:center">净局</span><span style="width:44px;text-align:center">积分</span></div>'
        st.forEach(function (s, i) {
          var net = (s.scoreFor || 0) - (s.scoreAgainst || 0)
          var netStr = net > 0 ? '+'+net : String(net)
          var rowBg = i % 2 === 0 ? 'transparent' : th.cardBg
          body += '<div style="display:flex;align-items:center;padding:9px 16px;background:'+rowBg+'">'
          var rankStyle = i < 3 ? 'width:24px;height:24px;border-radius:50%;background:'+th.badge+';color:'+th.badgeText+';display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800' : 'width:24px;text-align:center;font-size:12px;color:'+th.sub+';font-weight:600'
          body += '<span style="'+rankStyle+';margin-right:6px">'+(i+1)+'</span>'
          body += '<span style="flex:1;font-size:13px;font-weight:600">'+esc(s.name)+'</span>'
          body += '<span style="width:50px;text-align:center;font-size:12px;color:'+th.sub+'">'+s.wins+'胜'+s.losses+'负</span>'
          var netColor = net > 0 ? th.accent : (net < 0 ? '#FF5252' : th.sub)
          body += '<span style="width:44px;text-align:center;font-size:12px;font-weight:700;color:'+netColor+'">'+netStr+'</span>'
          body += '<span style="width:44px;text-align:center"><span style="background:'+th.badge+';color:'+th.badgeText+';padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700">'+s.points+'</span></span>'
          body += '</div>'
        })
        body += '</div>'
      })
    }
  }
  if (type.indexOf('scores_') === 0) {
    var stageKey = type.replace('scores_', '')
    var stageNames = {group:'小组赛',round6:'6强赛',revival:'复活赛',semi:'4强赛',final:'决赛',ranking:'排位赛',all:'全部比分'}
    var stageLabel = stageNames[stageKey] || '比分'
    var matches
    if (stageKey === 'all') {
      matches = (t.matches || []).concat([])
      if (t.knockout) t.knockout.forEach(function (r) { r.matches.forEach(function (m) { matches.push(m) }) })
    } else if (stageKey === 'final') {
      matches = (t.matches || []).filter(function (m) { return m.stage === 'final' || m.stage === 'third' })
    } else {
      matches = (t.matches || []).filter(function (m) { return m.stage === stageKey })
    }
    body += _buildScoreImageHtml(matches, th, stageKey === 'group' ? t.groups : null)
    var info = renderExportImage(t.name + ' — ' + stageLabel + '比分', body, theme)
    captureAndDownload(info.el, t.name + '_' + stageKey + '_scores.png')
    return
  }
  var info = renderExportImage(t.name + (type === 'groups' ? ' — 分组名单' : ' — 排名'), body, theme)
  captureAndDownload(info.el, t.name + '_' + type + '.png')
}

function _buildScoreImageHtml(matches, th, groups) {
  var html = ''
  if (groups && groups.length > 1) {
    groups.forEach(function (g) {
      var gm = matches.filter(function (m) { return m.groupName === g.name })
      if (gm.length === 0) return
      html += '<div style="margin-bottom:16px;background:'+th.cardBg+';border-radius:12px;border:1px solid '+th.border+';overflow:hidden">'
      html += '<div style="padding:10px 16px;background:'+th.headerBg+';font-size:15px;font-weight:700;color:'+th.headerText+'">'+esc(g.name)+' 组</div>'
      gm.forEach(function (m, i) { html += _buildMatchRow(m, th, i) })
      html += '</div>'
    })
  } else {
    if (matches.length === 0) {
      html += '<div style="text-align:center;padding:30px;color:'+th.sub+';font-size:14px">暂无比赛数据</div>'
    } else {
      html += '<div style="background:'+th.cardBg+';border-radius:12px;border:1px solid '+th.border+';overflow:hidden">'
      matches.forEach(function (m, i) { html += _buildMatchRow(m, th, i) })
      html += '</div>'
    }
  }
  return html
}

function _buildMatchRow(m, th, idx) {
  var t1 = m.team1 ? esc(m.team1.name) : 'TBD'
  var t2 = m.team2 ? esc(m.team2.name) : 'TBD'
  var s1 = m.status === 'finished' ? esc(m.score1 || '0') : '-'
  var s2 = m.status === 'finished' ? esc(m.score2 || '0') : '-'
  var w1 = m.winnerId && m.team1 && m.winnerId === m.team1.id
  var w2 = m.winnerId && m.team2 && m.winnerId === m.team2.id
  var rowBg = idx % 2 === 0 ? 'transparent' : th.cardBg
  var label = m.matchLabel || ''
  var h = '<div style="padding:10px 16px;background:'+rowBg+';border-bottom:1px solid '+th.border+'">'
  if (label) h += '<div style="font-size:10px;color:'+th.sub+';font-weight:600;margin-bottom:4px">'+esc(label)+'</div>'
  h += '<div style="display:flex;align-items:center">'
  h += '<div style="flex:1;text-align:right;font-size:13px;font-weight:'+(w1?'800':'500')+';color:'+(w1?th.accent:th.text)+'">'+t1+'</div>'
  h += '<div style="width:80px;text-align:center;font-size:14px;font-weight:800;color:'+(m.status==='finished'?th.accent:th.sub)+'">' + s1 + ' : ' + s2 + '</div>'
  h += '<div style="flex:1;text-align:left;font-size:13px;font-weight:'+(w2?'800':'500')+';color:'+(w2?th.accent:th.text)+'">'+t2+'</div>'
  h += '</div></div>'
  return h
}

function exportGroupList(t) {
  var rows = []
  ;(t.groups || []).forEach(function (g) {
    g.members.forEach(function (m, i) { rows.push([g.name + '组', i + 1, m.name, m.score, m.isSeed ? '种子' : '']) })
  })
  exportToExcel(['组别', '序号', '名称', '积分', '种子'], rows, t.name + '_分组名单.xlsx')
  showToast('导出成功')
}

function exportSchedule(t) {
  var rows = []
  ;(t.matches || []).forEach(function (m, i) {
    rows.push([i + 1, m.stage || '循环赛', m.groupName || m.matchLabel || '', m.team1 ? m.team1.name : 'TBD', m.team2 ? m.team2.name : 'TBD', m.status === 'finished' ? '已完成' : '未完成'])
  })
  exportToExcel(['序号', '阶段', '组/轮次', '队伍1', '队伍2', '状态'], rows, t.name + '_赛程表.xlsx')
  showToast('导出成功')
}

function exportScores(t) {
  var rows = []
  ;(t.matches || []).filter(function (m) { return m.status === 'finished' }).forEach(function (m, i) {
    var wn = m.winnerId ? (m.team1.id === m.winnerId ? m.team1.name : m.team2.name) : ''
    rows.push([i + 1, m.stage || '', m.team1.name, m.score1 || '', m.team2.name, m.score2 || '', wn])
  })
  exportToExcel(['序号', '阶段', '队伍1', '比分1', '队伍2', '比分2', '胜者'], rows, t.name + '_比分表.xlsx')
  showToast('导出成功')
}

function exportRankings(t) {
  var rows = []
  if (t.format === 'nine-team') {
    var rk = compute9TeamFinalRankings(t)
    rk.forEach(function (r) { rows.push([r.rank, r.team.name, r.label]) })
    exportToExcel(['名次', '队伍', '称号'], rows, t.name + '_最终排名.xlsx')
  } else {
    (t.groups || []).forEach(function (g) {
      var gm = (t.matches || []).filter(function (m) { return m.stage === 'group' && m.groupName === g.name })
      var st = calculateStandings(gm, g.members)
      st.forEach(function (s, i) { rows.push([g.name + '组', i + 1, s.name, s.wins, s.losses, s.points]) })
    })
    exportToExcel(['组别', '排名', '名称', '胜场', '负场', '积分'], rows, t.name + '_排名.xlsx')
  }
  showToast('导出成功')
}

function copyTextResult(t) {
  var text = groupsToText(t)
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { showToast('已复制到剪贴板') })
  else { fallbackCopy(text); showToast('已复制') }
}

/* ====================================================================
   PAGE: SCHEDULE
   ==================================================================== */
function renderSchedule(p) {
  var t = _t(p.id)
  if (!t) return '<div class="container"><div class="empty-state"><div class="empty-icon">❌</div><div class="empty-text">比赛不存在</div></div></div>'
  var fmt = t.format, matches = t.matches || []
  var html = '<div class="container">'
  if (_viewer) html += '<div class="viewer-banner">🔒 只读模式 — 仅供查看</div>'
  html += '<div class="flex-between mb-md"><button class="btn-home-link" id="btn-home">首页</button><div class="section-title">📅 赛程</div><button class="btn-icon" id="btn-rankings">🏆</button></div>'
  html += '<div class="card" style="padding:12px 16px"><div class="flex-between"><div><div class="text-bold">' + esc(t.name) + '</div><div class="text-xs text-secondary mt-xs">' + esc(TYPE[t.type]) + ' · ' + esc(FMT[fmt]) + '</div></div>'
  if (_canScore(t)) html += '<button class="btn-icon" id="btn-edit-name-sch" title="修改名称" style="font-size:14px;opacity:.5">✏️</button>'
  html += '</div></div>'
  html += '<div class="flex-between mb-sm"><button class="btn-export-img" id="btn-export-stage">📷 导出比分图片</button>'
  if (_canScore(t)) html += '<button class="btn-undo" id="btn-undo-schedule">↩️ 撤回赛程</button>'
  html += '</div>'

  if (fmt === 'nine-team') {
    html += render9TeamSchedule(t)
  } else if (fmt === 'group-knockout') {
    html += renderGroupKnockoutSchedule(t)
  } else if (fmt === 'single-knockout') {
    html += renderSingleKnockoutSchedule(t)
  } else {
    html += renderRoundRobinSchedule(t)
  }

  html += '</div>'
  return html
}

function renderRoundRobinSchedule(t) {
  var matches = (t.matches || []).filter(function (m) { return m.stage === 'group' })
  var groups = t.groups || []
  var curGroup = _ps.curGroup || (groups[0] ? groups[0].name : 'A')
  var html = ''
  if (groups.length > 1) {
    html += '<div class="group-selector">'
    groups.forEach(function (g) {
      html += '<div class="group-btn' + (curGroup === g.name ? ' active' : '') + '" data-grp="' + g.name + '">' + g.name + '组</div>'
    })
    html += '</div>'
  }
  var gm = matches.filter(function (m) { return m.groupName === curGroup })
  html += renderMatchList(gm, t)
  return html
}

function renderGroupKnockoutSchedule(t) {
  var curTab = _ps.curTab || 'group'
  var html = '<div class="tab-bar">'
  html += '<div class="tab-item' + (curTab === 'group' ? ' active' : '') + '" data-tab="group">小组赛</div>'
  html += '<div class="tab-item' + (curTab === 'knockout' ? ' active' : '') + '" data-tab="knockout">淘汰赛</div>'
  html += '</div>'

  if (curTab === 'group') {
    var groups = t.groups || []
    var curGroup = _ps.curGroup || (groups[0] ? groups[0].name : 'A')
    if (groups.length > 1) {
      html += '<div class="group-selector">'
      groups.forEach(function (g) {
        html += '<div class="group-btn' + (curGroup === g.name ? ' active' : '') + '" data-grp="' + g.name + '">' + g.name + '组</div>'
      })
      html += '</div>'
    }
    var gm = (t.matches || []).filter(function (m) { return m.stage === 'group' && m.groupName === curGroup })
    html += renderMatchList(gm, t)

    var allGroupDone = (t.matches || []).filter(function (m) { return m.stage === 'group' }).every(function (m) { return m.status === 'finished' })
    if (allGroupDone && !t.knockout && _canScore(t)) {
      html += '<div class="text-center mt-md"><button class="btn-accent" id="btn-gen-ko">🏅 生成淘汰赛</button></div>'
    }
  } else {
    html += renderKnockoutBracket(t)
  }
  return html
}

function renderSingleKnockoutSchedule(t) {
  var curTab = _ps.curTab || 'group'
  var html = '<div class="tab-bar">'
  html += '<div class="tab-item' + (curTab === 'group' ? ' active' : '') + '" data-tab="group">循环赛</div>'
  html += '<div class="tab-item' + (curTab === 'knockout' ? ' active' : '') + '" data-tab="knockout">淘汰赛</div>'
  html += '</div>'

  if (curTab === 'group') {
    var gm = (t.matches || []).filter(function (m) { return m.stage === 'group' })
    html += renderMatchList(gm, t)
    var allDone = gm.length > 0 && gm.every(function (m) { return m.status === 'finished' })
    if (allDone && !t.knockout && _canScore(t)) {
      html += '<div class="text-center mt-md"><button class="btn-accent" id="btn-gen-ko">🏅 生成淘汰赛</button></div>'
    }
  } else {
    html += renderKnockoutBracket(t)
  }
  return html
}

function render9TeamSchedule(t) {
  var nt = t.nineTeam || init9TeamData()
  var stages = [
    { key: 'group', label: '小组赛' }, { key: 'round6', label: '6强赛' },
    { key: 'revival', label: '复活赛' }, { key: 'semi', label: '4强赛' },
    { key: 'final', label: '决赛' }, { key: 'ranking', label: '排位赛' }
  ]
  var curStage = _ps.curStage || 'group'
  var html = '<div class="stage-tabs">'
  stages.forEach(function (s) {
    var status = nt.stageStatus[s.key] || 'pending'
    var cls = 'stage-tab' + (curStage === s.key ? ' active' : '') + (status === 'completed' ? ' completed' : '')
    html += '<div class="' + cls + '" data-stage="' + s.key + '">' + esc(s.label) + '</div>'
  })
  html += '</div>'

  if (curStage === 'group') {
    var groups = t.groups || []
    var curGroup = _ps.curGroup || 'A'
    html += '<div class="group-selector">'
    groups.forEach(function (g) {
      html += '<div class="group-btn' + (curGroup === g.name ? ' active' : '') + '" data-grp="' + g.name + '">' + g.name + '组</div>'
    })
    html += '</div>'
    var gm = (t.matches || []).filter(function (m) { return m.stage === 'group' && m.groupName === curGroup })
    html += renderMatchList(gm, t)
    var allGroupDone = is9TeamStageComplete(t, 'group')
    if (allGroupDone && _canScore(t)) {
      var hasR6 = get9TeamStageMatches(t, 'round6').length > 0
      if (!hasR6) html += '<div class="text-center mt-md"><button class="btn-accent" id="btn-gen-r6">⚡ 生成6强赛对阵</button></div>'
      var hasRanking = get9TeamStageMatches(t, 'ranking').length > 0
      if (!hasRanking) html += '<div class="text-center mt-sm"><button class="btn-secondary btn-mini" id="btn-gen-ranking">🏅 生成排位赛(7-9名)</button></div>'
    }
  } else if (curStage === 'round6') {
    var r6m = get9TeamStageMatches(t, 'round6')
    if (r6m.length === 0) html += '<div class="empty-state" style="padding:20px"><div class="empty-icon">⏳</div><div class="empty-text">请先完成小组赛</div></div>'
    else {
      if (_canScore(t)) html += '<div class="text-right mb-sm"><button class="btn-undo" id="btn-undo-r6">↩️ 撤回6强赛</button></div>'
      html += renderMatchList(r6m, t)
      var r6Done = is9TeamStageComplete(t, 'round6')
      if (r6Done && _canScore(t)) {
        var hasRevival = get9TeamStageMatches(t, 'revival').length > 0
        if (!hasRevival) html += '<div class="text-center mt-md"><button class="btn-accent" id="btn-gen-revival">🔄 生成复活赛</button></div>'
      }
    }
  } else if (curStage === 'revival') {
    var rvm = get9TeamStageMatches(t, 'revival')
    if (rvm.length === 0) html += '<div class="empty-state" style="padding:20px"><div class="empty-icon">⏳</div><div class="empty-text">请先完成6强赛</div></div>'
    else {
      if (_canScore(t)) html += '<div class="text-right mb-sm"><button class="btn-undo" id="btn-undo-revival">↩️ 撤回复活赛</button></div>'
      html += '<div class="guide-tip">💡 复活赛采用抢7制</div>'
      html += renderMatchList(rvm, t)
      var rvDone = is9TeamStageComplete(t, 'revival')
      if (rvDone && _canScore(t)) {
        var hasSemi = get9TeamStageMatches(t, 'semi').length > 0
        if (!hasSemi) html += '<div class="text-center mt-md"><button class="btn-accent" id="btn-draw-semi">🎲 4强赛抽签</button></div>'
      }
    }
  } else if (curStage === 'semi') {
    var sm = get9TeamStageMatches(t, 'semi')
    if (sm.length === 0) html += '<div class="empty-state" style="padding:20px"><div class="empty-icon">⏳</div><div class="empty-text">请先完成复活赛并进行4强赛抽签</div></div>'
    else {
      if (_canScore(t)) html += '<div class="text-right mb-sm"><button class="btn-undo" id="btn-undo-semi">↩️ 撤回4强赛</button></div>'
      html += renderMatchList(sm, t)
      var semiDone = is9TeamStageComplete(t, 'semi')
      if (semiDone && _canScore(t)) {
        var hasFinal = get9TeamStageMatches(t, 'final').length > 0
        if (!hasFinal) html += '<div class="text-center mt-md"><button class="btn-accent" id="btn-gen-finals">🏆 生成决赛</button></div>'
      }
    }
  } else if (curStage === 'final') {
    var fm = (t.matches || []).filter(function (m) { return m.stage === 'final' || m.stage === 'third' })
    if (fm.length === 0) html += '<div class="empty-state" style="padding:20px"><div class="empty-icon">⏳</div><div class="empty-text">请先完成4强赛</div></div>'
    else {
      if (_canScore(t)) html += '<div class="text-right mb-sm"><button class="btn-undo" id="btn-undo-final">↩️ 撤回决赛</button></div>'
      html += renderMatchList(fm, t)
    }
  } else if (curStage === 'ranking') {
    var rkm = get9TeamStageMatches(t, 'ranking')
    if (rkm.length === 0) html += '<div class="empty-state" style="padding:20px"><div class="empty-icon">⏳</div><div class="empty-text">小组赛完成后生成排位赛</div></div>'
    else {
      if (_canScore(t)) html += '<div class="text-right mb-sm"><button class="btn-undo" id="btn-undo-ranking">↩️ 撤回排位赛</button></div>'
      html += renderMatchList(rkm, t)
    }
  }
  return html
}

function renderMatchList(matches, t) {
  if (matches.length === 0) return '<div class="text-center text-hint" style="padding:15px">暂无比赛</div>'
  var html = ''
  matches.forEach(function (m) {
    var statusClass = m.status === 'finished' ? 'finished' : 'pending'
    html += '<div class="match-card ' + statusClass + '" data-mid="' + m.id + '">'
    if (m.matchLabel) html += '<div class="match-round">' + esc(m.matchLabel) + '</div>'
    else if (m.round) html += '<div class="match-round">第 ' + m.round + ' 轮' + (m.groupName ? ' · ' + m.groupName + '组' : '') + '</div>'
    html += '<div class="match-teams">'
    html += '<div class="match-team"><div class="match-team-name' + (m.winnerId && m.winnerId === (m.team1 ? m.team1.id : '') ? ' winner' : '') + (m.team1 ? '' : ' tbd') + '">' + (m.team1 ? esc(m.team1.name) : 'TBD') + '</div></div>'
    html += '<div class="match-vs' + (m.status === 'finished' ? ' has-score' : '') + '">' + (m.status === 'finished' ? esc(m.score1 || '-') + ' : ' + esc(m.score2 || '-') : 'VS') + '</div>'
    html += '<div class="match-team"><div class="match-team-name' + (m.winnerId && m.winnerId === (m.team2 ? m.team2.id : '') ? ' winner' : '') + (m.team2 ? '' : ' tbd') + '">' + (m.team2 ? esc(m.team2.name) : 'TBD') + '</div></div>'
    html += '</div>'
    if (m.status === 'finished') html += '<div class="match-status"><span class="tag tag-green">已完成</span></div>'
    else html += '<div class="match-status"><span class="tag tag-orange">' + (m.team1 && m.team2 ? '待比赛' : '等待中') + '</span></div>'
    html += '</div>'
  })
  return html
}

function renderKnockoutBracket(t) {
  if (!t.knockout || t.knockout.length === 0) return '<div class="text-center text-hint" style="padding:20px">淘汰赛尚未生成</div>'
  var html = ''
  if (_canScore(t)) html += '<div class="text-right mb-sm"><button class="btn-undo" id="btn-undo-ko">↩️ 撤回淘汰赛</button></div>'
  t.knockout.forEach(function (round, ri) {
    html += '<div class="round-header">' + esc(round.roundName) + '</div>'
    round.matches.forEach(function (m, mi) {
      html += '<div class="ko-match-card" data-kori="' + ri + '" data-komi="' + mi + '">'
      html += '<div class="ko-teams">'
      html += '<div class="ko-team' + (m.winnerId && m.team1 && m.winnerId === m.team1.id ? ' winner' : '') + (m.team1 ? '' : ' tbd') + '">' + (m.team1 ? esc(m.team1.name) : '待定') + '</div>'
      html += '<div class="ko-vs">' + (m.status === 'finished' ? esc(m.score1 || '-') + ':' + esc(m.score2 || '-') : 'VS') + '</div>'
      html += '<div class="ko-team' + (m.winnerId && m.team2 && m.winnerId === m.team2.id ? ' winner' : '') + (m.team2 ? '' : ' tbd') + '">' + (m.team2 ? esc(m.team2.name) : '待定') + '</div>'
      html += '</div></div>'
    })
  })
  return html
}

function mountSchedule(p) {
  var t = _t(p.id); if (!t) return
  if (typeof listenToTournament === 'function') listenToTournament(p.id)
  document.getElementById('btn-home').onclick = function () { location.hash = '/' }
  document.getElementById('btn-rankings').onclick = function () { navigate('/rankings?id=' + p.id) }

  var usc = document.getElementById('btn-undo-schedule')
  if (usc) usc.onclick = function () {
    showModal({ title: '撤回赛程', content: '将清空所有比赛对阵和比分数据，回到分组结果页面，确定撤回？', confirmText: '确认撤回',
      onConfirm: function () {
        t = getTournament(p.id)
        t.matches = []; t.knockout = null; t.nineTeam = null
        saveTournament(t); showToast('已撤回赛程')
        navigate('/result?id=' + t.id)
      }
    })
  }

  var _exs = document.getElementById('btn-export-stage')
  if (_exs) _exs.onclick = function () {
    t = getTournament(p.id); if (!t) return
    var fmt = t.format
    if (fmt === 'nine-team') {
      var curStage = _ps.curStage || 'group'
      var stageNames = {group:'小组赛',round6:'6强赛',revival:'复活赛',semi:'4强赛',final:'决赛',ranking:'排位赛'}
      chooseImageTheme(t, 'scores_' + (curStage === 'final' ? 'final' : curStage))
    } else if (fmt === 'group-knockout' || fmt === 'single-knockout') {
      var curTab = _ps.curTab || 'group'
      if (curTab === 'knockout' && t.knockout) {
        var koMatches = []; t.knockout.forEach(function (r) { r.matches.forEach(function (m) { koMatches.push(m) }) })
        chooseImageTheme(t, 'scores_all')
      } else { chooseImageTheme(t, 'scores_group') }
    } else { chooseImageTheme(t, 'scores_all') }
  }

  var _enSch = document.getElementById('btn-edit-name-sch')
  if (_enSch) _enSch.onclick = function () {
    showPrompt({
      title: '修改比赛名称', value: t.name, placeholder: '输入新名称',
      onConfirm: function (val) {
        if (!val) { showToast('名称不能为空'); return }
        var _t2 = getTournament(p.id); _t2.name = val; saveTournament(_t2)
        showToast('名称已修改'); render()
      }
    })
  }

  document.querySelectorAll('[data-tab]').forEach(function (el) {
    el.onclick = function () { _ps.curTab = el.dataset.tab; render() }
  })
  document.querySelectorAll('[data-stage]').forEach(function (el) {
    el.onclick = function () { _ps.curStage = el.dataset.stage; render() }
  })
  document.querySelectorAll('[data-grp]').forEach(function (el) {
    el.onclick = function () { _ps.curGroup = el.dataset.grp; render() }
  })

  if (_canScore(t)) {
    document.querySelectorAll('.match-card').forEach(function (el) {
      el.onclick = function () {
        var mid = el.dataset.mid
        var m = (t.matches || []).find(function (x) { return x.id === mid })
        if (m && m.team1 && m.team2) navigate('/match?id=' + p.id + '&matchId=' + mid)
      }
    })
    document.querySelectorAll('.ko-match-card').forEach(function (el) {
      el.onclick = function () {
        var ri = +el.dataset.kori, mi = +el.dataset.komi
        if (t.knockout && t.knockout[ri] && t.knockout[ri].matches[mi]) {
          var m = t.knockout[ri].matches[mi]
          if (m.team1 && m.team2) navigate('/match?id=' + p.id + '&koRi=' + ri + '&koMi=' + mi)
        }
      }
    })
  }

  /* Group+Knockout: generate knockout */
  var gko = document.getElementById('btn-gen-ko')
  if (gko) gko.onclick = function () {
    function _getKoTeams() {
      t = getTournament(p.id)
      var teams = []
      if (t.format === 'group-knockout') {
        ;(t.groups || []).forEach(function (g) {
          var gm = (t.matches || []).filter(function (m) { return m.stage === 'group' && m.groupName === g.name })
          var st = calculateStandings(gm, g.members)
          st.slice(0, t.settings.qualifyCount || 2).forEach(function (s) { teams.push(s) })
        })
      } else if (t.format === 'single-knockout') {
        var gm = (t.matches || []).filter(function (m) { return m.stage === 'group' })
        var members = t.groups[0] ? t.groups[0].members : []
        var st = calculateStandings(gm, members)
        st.slice(0, t.settings.koTeamCount || 4).forEach(function (s) { teams.push(s) })
      }
      return teams
    }
    function _doKo(customPairs) {
      t = getTournament(p.id)
      if (customPairs) {
        function rn(c) { if (c === 1) return '决赛'; if (c === 2) return '半决赛'; if (c === 4) return '四分之一决赛'; return (c * 2) + '进' + c }
        var first = customPairs.map(function (pr) { return makeKoMatch(pr[0], pr[1]) })
        var rounds = [{ roundName: rn(first.length), matches: first }]
        var cur = first
        while (cur.length > 1) { var nxt = []; for (var i = 0; i < cur.length; i += 2) nxt.push(makeKoMatch(null, null)); rounds.push({ roundName: rn(nxt.length), matches: nxt }); cur = nxt }
        if (t.settings.hasThirdPlace && rounds.length >= 2) rounds.push({ roundName: '三四名决赛', isThirdPlace: true, matches: [makeKoMatch(null, null)] })
        t.knockout = rounds
      } else {
        if (t.format === 'group-knockout') {
          var gs = {}
          ;(t.groups || []).forEach(function (g) { var gm = (t.matches || []).filter(function (m) { return m.stage === 'group' && m.groupName === g.name }); gs[g.name] = calculateStandings(gm, g.members) })
          t.knockout = generateKnockoutBracket(gs, t.settings.qualifyCount || 2, t.settings.hasThirdPlace)
        } else if (t.format === 'single-knockout') {
          var gm = (t.matches || []).filter(function (m) { return m.stage === 'group' })
          var members = t.groups[0] ? t.groups[0].members : []
          var st = calculateStandings(gm, members)
          t.knockout = generateSingleKnockoutBracket(st, t.settings.koTeamCount || 4, t.settings.koRule || 'cross', t.settings.hasThirdPlace)
        }
      }
      saveTournament(t); showToast('淘汰赛已生成'); _ps.curTab = 'knockout'; render()
    }
    var teams = _getKoTeams()
    if (teams.length < 2) { showToast('出线队伍不足'); return }
    var mc = Math.floor(teams.length / 2)
    var labels = []; for (var li = 0; li < mc; li++) labels.push('第' + (li + 1) + '场')
    showActionSheet([
      { text: '🎲 自动对阵', action: function () { _doKo(null) } },
      { text: '✏️ 自定义对阵', action: function () {
        showCustomMatchModal({ title: '淘汰赛自定义对阵', teams: teams, matchCount: mc, labels: labels, onConfirm: _doKo })
      }}
    ])
  }

  /* 9-team: generate round of 6 */
  var gr6 = document.getElementById('btn-gen-r6')
  if (gr6) gr6.onclick = function () {
    function _doR6(customPairs) {
      t = getTournament(p.id); var nt = t.nineTeam || init9TeamData()
      var r6m
      if (customPairs) {
        r6m = customPairs.map(function (pr, i) {
          return { id: makeMatchId('r6'), stage: 'round6', matchLabel: '6强赛' + (i + 1),
            team1: { id: pr[0].id, name: pr[0].name, score: pr[0].score },
            team2: { id: pr[1].id, name: pr[1].name, score: pr[1].score },
            score1: '', score2: '', winnerId: null, status: 'pending' }
        })
      } else {
        var gs = get9TeamGroupStandings(t)
        r6m = generate9TeamRound6Matches(gs, (t.settings && t.settings.round6Rule) || 'ranked')
      }
      t.matches = (t.matches || []).concat(r6m)
      nt.stageStatus.group = 'completed'; nt.stageStatus.round6 = 'in_progress'
      t.nineTeam = nt; saveTournament(t)
      showToast('6强赛对阵已生成'); _ps.curStage = 'round6'; render()
    }
    showActionSheet([
      { text: '🎲 随机对阵', action: function () { _doR6(null) } },
      { text: '✏️ 自定义对阵', action: function () {
        t = getTournament(p.id); var gs = get9TeamGroupStandings(t)
        var pool = []; Object.keys(gs).sort().forEach(function (gn) { if (gs[gn].length >= 2) { pool.push(gs[gn][0]); pool.push(gs[gn][1]) } })
        showCustomMatchModal({ title: '6强赛自定义对阵', teams: pool, matchCount: 3, labels: ['6强赛1', '6强赛2', '6强赛3'], onConfirm: _doR6 })
      }}
    ])
  }

  /* 9-team: generate ranking (7-9th) */
  var grk = document.getElementById('btn-gen-ranking')
  if (grk) grk.onclick = function () {
    t = getTournament(p.id); var nt = t.nineTeam || init9TeamData()
    var gs = get9TeamGroupStandings(t)
    var thirdTeams = []
    ;(t.groups || []).forEach(function (g) {
      var gStandings = gs[g.name] || []
      if (gStandings.length >= 3) thirdTeams.push(gStandings[2])
    })
    var rkm = generate9TeamRankingMatches(thirdTeams)
    t.matches = (t.matches || []).concat(rkm)
    nt.stageStatus.ranking = 'in_progress'
    t.nineTeam = nt; saveTournament(t)
    showToast('排位赛已生成'); _ps.curStage = 'ranking'; render()
  }

  /* 9-team: generate revival */
  var grv = document.getElementById('btn-gen-revival')
  if (grv) grv.onclick = function () {
    t = getTournament(p.id); var nt = t.nineTeam || init9TeamData()
    var r6m = get9TeamStageMatches(t, 'round6')
    var losers = [], winners = []
    r6m.forEach(function (m) {
      if (m.status === 'finished' && m.winnerId) {
        var w = m.team1.id === m.winnerId ? m.team1 : m.team2
        var l = m.team1.id === m.winnerId ? m.team2 : m.team1
        winners.push(w); losers.push(l)
      }
    })
    nt.round6Winners = winners; nt.round6Losers = losers
    var rvm = generate9TeamRevivalMatches(losers)
    t.matches = (t.matches || []).concat(rvm)
    nt.stageStatus.round6 = 'completed'; nt.stageStatus.revival = 'in_progress'
    t.nineTeam = nt; saveTournament(t)
    showToast('复活赛已生成'); _ps.curStage = 'revival'; render()
  }

  /* 9-team: semi-final draw */
  var dsf = document.getElementById('btn-draw-semi')
  if (dsf) dsf.onclick = function () {
    function _getPool() {
      t = getTournament(p.id); var nt = t.nineTeam || init9TeamData()
      var rvm = get9TeamStageMatches(t, 'revival')
      var revTeams = [], rIds = new Set()
      rvm.forEach(function (m) {
        if (m.team1 && !rIds.has(m.team1.id)) { rIds.add(m.team1.id); revTeams.push(m.team1) }
        if (m.team2 && !rIds.has(m.team2.id)) { rIds.add(m.team2.id); revTeams.push(m.team2) }
      })
      var revStandings = calculateStandings(rvm, revTeams)
      if (revStandings.length === 0) { showToast('复活赛数据不足'); return null }
      var qualifier = revStandings[0]
      nt.revivalQualifier = qualifier
      t.nineTeam = nt
      return { pool: (nt.round6Winners || []).concat([qualifier]), nt: nt }
    }
    function _doSemi(customPairs) {
      t = getTournament(p.id); var info = _getPool(); if (!info) return
      var nt = info.nt, sfm
      if (customPairs) {
        sfm = customPairs.map(function (pr, i) {
          return { id: makeMatchId('sf'), stage: 'semi', matchLabel: '4强赛' + (i + 1),
            team1: { id: pr[0].id, name: pr[0].name, score: pr[0].score },
            team2: { id: pr[1].id, name: pr[1].name, score: pr[1].score },
            score1: '', score2: '', winnerId: null, status: 'pending' }
        })
      } else {
        sfm = generate9TeamSemiFinalDraw(nt.round6Winners || [], nt.revivalQualifier)
      }
      t.matches = (t.matches || []).concat(sfm)
      nt.stageStatus.revival = 'completed'; nt.stageStatus.semi = 'in_progress'; nt.semiFinalDrawn = true
      t.nineTeam = nt; saveTournament(t)
      showToast('4强赛抽签完成'); _ps.curStage = 'semi'; render()
    }
    var info = _getPool(); if (!info) return
    showActionSheet([
      { text: '🎲 随机抽签', action: function () { _doSemi(null) } },
      { text: '✏️ 自定义对阵', action: function () {
        showCustomMatchModal({ title: '4强赛自定义对阵', teams: info.pool, matchCount: 2, labels: ['4强赛1', '4强赛2'], onConfirm: _doSemi })
      }}
    ])
  }

  /* 9-team: generate finals */
  var gfn = document.getElementById('btn-gen-finals')
  if (gfn) gfn.onclick = function () {
    function _doFinals(customPairs) {
      t = getTournament(p.id); var nt = t.nineTeam || init9TeamData()
      var sm = get9TeamStageMatches(t, 'semi')
      var sfW = [], sfL = []
      sm.forEach(function (m) {
        if (m.status === 'finished' && m.winnerId) {
          var w = m.team1.id === m.winnerId ? m.team1 : m.team2
          var l = m.team1.id === m.winnerId ? m.team2 : m.team1
          sfW.push(w); sfL.push(l)
        }
      })
      nt.semiFinalWinners = sfW; nt.semiFinalLosers = sfL
      var fm
      if (customPairs) {
        fm = []
        if (customPairs[0]) fm.push({ id: makeMatchId('fn'), stage: 'final', matchLabel: '决赛',
          team1: { id: customPairs[0][0].id, name: customPairs[0][0].name, score: customPairs[0][0].score },
          team2: { id: customPairs[0][1].id, name: customPairs[0][1].name, score: customPairs[0][1].score },
          score1: '', score2: '', winnerId: null, status: 'pending' })
        if (customPairs[1]) fm.push({ id: makeMatchId('tp'), stage: 'third', matchLabel: '三四名决赛',
          team1: { id: customPairs[1][0].id, name: customPairs[1][0].name, score: customPairs[1][0].score },
          team2: { id: customPairs[1][1].id, name: customPairs[1][1].name, score: customPairs[1][1].score },
          score1: '', score2: '', winnerId: null, status: 'pending' })
      } else {
        fm = generate9TeamFinals(sfW, sfL)
      }
      t.matches = (t.matches || []).concat(fm)
      nt.stageStatus.semi = 'completed'; nt.stageStatus.final = 'in_progress'
      t.nineTeam = nt; saveTournament(t)
      showToast('决赛已生成'); _ps.curStage = 'final'; render()
    }
    t = getTournament(p.id)
    var sm = get9TeamStageMatches(t, 'semi')
    var allTeams = []
    sm.forEach(function (m) {
      if (m.status === 'finished' && m.winnerId) {
        allTeams.push(m.team1.id === m.winnerId ? m.team1 : m.team2)
        allTeams.push(m.team1.id === m.winnerId ? m.team2 : m.team1)
      }
    })
    showActionSheet([
      { text: '🎲 自动生成', action: function () { _doFinals(null) } },
      { text: '✏️ 自定义对阵', action: function () {
        showCustomMatchModal({ title: '决赛/三四名自定义', teams: allTeams, matchCount: 2, labels: ['决赛', '三四名决赛'], onConfirm: _doFinals })
      }}
    ])
  }

  /* ===== Undo / Revoke stages ===== */
  function _undoConfirm(title, msg, fn) {
    showModal({ title: title, content: msg, confirmText: '确认撤回', onConfirm: fn })
  }
  var _9stages = ['round6', 'revival', 'semi', 'final', 'third', 'ranking']

  var ur6 = document.getElementById('btn-undo-r6')
  if (ur6) ur6.onclick = function () {
    _undoConfirm('撤回6强赛', '将删除6强赛及之后所有阶段比赛数据，确定撤回？', function () {
      t = getTournament(p.id); var nt = t.nineTeam || init9TeamData()
      t.matches = (t.matches || []).filter(function (m) { return _9stages.indexOf(m.stage) < 0 })
      nt.stageStatus.group = is9TeamStageComplete(t, 'group') ? 'completed' : 'in_progress'
      nt.stageStatus.round6 = 'pending'; nt.stageStatus.revival = 'pending'; nt.stageStatus.semi = 'pending'; nt.stageStatus.final = 'pending'; nt.stageStatus.ranking = 'pending'
      nt.round6Winners = []; nt.round6Losers = []; nt.revivalQualifier = null; nt.semiFinalDrawn = false; nt.semiFinalWinners = []; nt.semiFinalLosers = []; nt.finalRankings = []
      t.nineTeam = nt; saveTournament(t); showToast('已撤回6强赛'); _ps.curStage = 'group'; render()
    })
  }

  var urv = document.getElementById('btn-undo-revival')
  if (urv) urv.onclick = function () {
    _undoConfirm('撤回复活赛', '将删除复活赛及之后所有阶段（不含6强赛）比赛数据，确定撤回？', function () {
      t = getTournament(p.id); var nt = t.nineTeam || init9TeamData()
      t.matches = (t.matches || []).filter(function (m) { return m.stage !== 'revival' && m.stage !== 'semi' && m.stage !== 'final' && m.stage !== 'third' })
      nt.stageStatus.revival = 'pending'; nt.stageStatus.semi = 'pending'; nt.stageStatus.final = 'pending'
      nt.revivalQualifier = null; nt.semiFinalDrawn = false; nt.semiFinalWinners = []; nt.semiFinalLosers = []; nt.finalRankings = []
      nt.stageStatus.round6 = is9TeamStageComplete(t, 'round6') ? 'completed' : 'in_progress'
      t.nineTeam = nt; saveTournament(t); showToast('已撤回复活赛'); _ps.curStage = 'round6'; render()
    })
  }

  var usm = document.getElementById('btn-undo-semi')
  if (usm) usm.onclick = function () {
    _undoConfirm('撤回4强赛', '将删除4强赛及决赛数据，确定撤回？', function () {
      t = getTournament(p.id); var nt = t.nineTeam || init9TeamData()
      t.matches = (t.matches || []).filter(function (m) { return m.stage !== 'semi' && m.stage !== 'final' && m.stage !== 'third' })
      nt.stageStatus.semi = 'pending'; nt.stageStatus.final = 'pending'
      nt.semiFinalDrawn = false; nt.semiFinalWinners = []; nt.semiFinalLosers = []; nt.finalRankings = []
      nt.stageStatus.revival = is9TeamStageComplete(t, 'revival') ? 'completed' : 'in_progress'
      t.nineTeam = nt; saveTournament(t); showToast('已撤回4强赛'); _ps.curStage = 'revival'; render()
    })
  }

  var ufn = document.getElementById('btn-undo-final')
  if (ufn) ufn.onclick = function () {
    _undoConfirm('撤回决赛', '将删除决赛和三四名决赛数据，确定撤回？', function () {
      t = getTournament(p.id); var nt = t.nineTeam || init9TeamData()
      t.matches = (t.matches || []).filter(function (m) { return m.stage !== 'final' && m.stage !== 'third' })
      nt.stageStatus.final = 'pending'; nt.semiFinalWinners = []; nt.semiFinalLosers = []; nt.finalRankings = []
      nt.stageStatus.semi = is9TeamStageComplete(t, 'semi') ? 'completed' : 'in_progress'
      t.nineTeam = nt; saveTournament(t); showToast('已撤回决赛'); _ps.curStage = 'semi'; render()
    })
  }

  var urk = document.getElementById('btn-undo-ranking')
  if (urk) urk.onclick = function () {
    _undoConfirm('撤回排位赛', '将删除排位赛（7-9名）数据，确定撤回？', function () {
      t = getTournament(p.id); var nt = t.nineTeam || init9TeamData()
      t.matches = (t.matches || []).filter(function (m) { return m.stage !== 'ranking' })
      nt.stageStatus.ranking = 'pending'
      t.nineTeam = nt; saveTournament(t); showToast('已撤回排位赛'); render()
    })
  }

  var uko = document.getElementById('btn-undo-ko')
  if (uko) uko.onclick = function () {
    _undoConfirm('撤回淘汰赛', '将删除所有淘汰赛对阵和比分数据，确定撤回？', function () {
      t = getTournament(p.id)
      t.knockout = null
      saveTournament(t); showToast('已撤回淘汰赛'); _ps.curTab = 'group'; render()
    })
  }
}

/* ====================================================================
   PAGE: MATCH (Score Entry)
   ==================================================================== */
function renderMatch(p) {
  var t = _t(p.id)
  if (!t) return '<div class="container"><div class="empty-state"><div class="empty-icon">❌</div><div class="empty-text">比赛不存在</div></div></div>'
  if (!_canScore(t)) return '<div class="container"><div class="empty-state"><div class="empty-icon">🔒</div><div class="empty-text">无编辑权限</div></div><div class="text-center mt-md"><button class="btn-primary" onclick="location.hash=\'/\'">返回首页</button></div></div>'
  var m = null, isKo = false, koRi = -1, koMi = -1
  if (p.matchId) { m = (t.matches || []).find(function (x) { return x.id === p.matchId }) }
  else if (p.koRi !== undefined) { koRi = +p.koRi; koMi = +p.koMi; isKo = true; if (t.knockout && t.knockout[koRi]) m = t.knockout[koRi].matches[koMi] }
  if (!m) return '<div class="container"><div class="empty-state"><div class="empty-icon">❌</div><div class="empty-text">比赛场次不存在</div></div></div>'

  var _mk = p.matchId || ('ko_' + p.koRi + '_' + p.koMi)
  var _draft = _matchDrafts[_mk]
  _ps.matchKey = _mk
  _ps.score1 = (_draft && _draft.score1 !== undefined) ? _draft.score1 : (_ps.score1 !== undefined ? _ps.score1 : (m.score1 || ''))
  _ps.score2 = (_draft && _draft.score2 !== undefined) ? _draft.score2 : (_ps.score2 !== undefined ? _ps.score2 : (m.score2 || ''))
  _ps.winnerId = (_draft && _draft.winnerId !== undefined) ? _draft.winnerId : (_ps.winnerId !== undefined ? _ps.winnerId : (m.winnerId || null))

  var html = '<div class="container">'
  html += '<div class="flex-between mb-md"><button class="btn-home-link" id="btn-home">首页</button><div class="section-title">📝 比分录入</div><div style="width:40px"></div></div>'

  var stageLabel = m.matchLabel || m.stage || '比赛'
  if (m.groupName) stageLabel = m.groupName + '组 第' + m.round + '轮'
  html += '<div class="card"><div class="match-info"><div class="match-stage">' + esc(stageLabel) + '</div></div>'
  html += '<div class="teams-display">'
  html += '<div class="team-side"><div class="team-main-name">' + (m.team1 ? esc(m.team1.name) : 'TBD') + '</div></div>'
  html += '<div class="vs-text">VS</div>'
  html += '<div class="team-side"><div class="team-main-name">' + (m.team2 ? esc(m.team2.name) : 'TBD') + '</div></div>'
  html += '</div></div>'

  html += '<div class="card"><div class="section-title mb-sm">比分</div>'
  if (m.isRevival) html += '<div class="guide-tip">💡 复活赛采用抢7制，如 7-5、8-6</div>'
  html += '<div class="score-row"><div class="score-label">' + (m.team1 ? esc(m.team1.name) : '队伍1') + '</div><input class="input-field" id="inp-s1" placeholder="如 6-4,7-5" value="' + esc(_ps.score1) + '"></div>'
  html += '<div class="score-row"><div class="score-label">' + (m.team2 ? esc(m.team2.name) : '队伍2') + '</div><input class="input-field" id="inp-s2" placeholder="如 4-6,5-7" value="' + esc(_ps.score2) + '"></div>'
  html += '</div>'

  html += '<div class="card"><div class="section-title mb-sm">胜方</div>'
  html += '<div class="winner-options">'
  if (m.team1) {
    html += '<div class="winner-option' + (_ps.winnerId === m.team1.id ? ' selected' : '') + '" data-wid="' + m.team1.id + '"><div class="winner-name">' + esc(m.team1.name) + '</div>'
    if (_ps.winnerId === m.team1.id) html += '<div class="winner-check">✓</div>'
    html += '</div>'
  }
  if (m.team2) {
    html += '<div class="winner-option' + (_ps.winnerId === m.team2.id ? ' selected' : '') + '" data-wid="' + m.team2.id + '"><div class="winner-name">' + esc(m.team2.name) + '</div>'
    if (_ps.winnerId === m.team2.id) html += '<div class="winner-check">✓</div>'
    html += '</div>'
  }
  html += '</div></div>'

  html += '<div class="bottom-bar"><button class="btn-primary btn-block" id="btn-save">💾 保存比分</button></div>'
  html += '</div>'
  return html
}

function mountMatch(p) {
  var t = _t(p.id); if (!t) return
  document.getElementById('btn-home').onclick = function () { location.hash = '/' }
  var _mk = _ps.matchKey
  document.getElementById('inp-s1').oninput = function () { _ps.score1 = this.value; if (_mk) { if (!_matchDrafts[_mk]) _matchDrafts[_mk] = {}; _matchDrafts[_mk].score1 = this.value } }
  document.getElementById('inp-s2').oninput = function () { _ps.score2 = this.value; if (_mk) { if (!_matchDrafts[_mk]) _matchDrafts[_mk] = {}; _matchDrafts[_mk].score2 = this.value } }

  document.querySelectorAll('[data-wid]').forEach(function (el) {
    el.onclick = function () { _ps.winnerId = el.dataset.wid; if (_mk) { if (!_matchDrafts[_mk]) _matchDrafts[_mk] = {}; _matchDrafts[_mk].winnerId = el.dataset.wid }; render() }
  })

  document.getElementById('btn-save').onclick = function () {
    if (!_ps.winnerId) { showToast('请选择胜方'); return }
    t = getTournament(p.id)
    var isKo = p.koRi !== undefined
    var m = null

    if (p.matchId) { m = (t.matches || []).find(function (x) { return x.id === p.matchId }) }
    else if (isKo) { var ri = +p.koRi, mi = +p.koMi; if (t.knockout && t.knockout[ri]) m = t.knockout[ri].matches[mi] }
    if (!m) { showToast('比赛未找到'); return }

    m.score1 = _ps.score1; m.score2 = _ps.score2; m.winnerId = _ps.winnerId; m.status = 'finished'

    if (isKo) {
      var ri = +p.koRi, mi = +p.koMi
      var winner = m.team1.id === m.winnerId ? m.team1 : m.team2
      var loser = m.team1.id === m.winnerId ? m.team2 : m.team1
      t.knockout = advanceKnockoutWinner(t.knockout, ri, mi, winner, loser)
    }

    if (t.format === 'nine-team') update9TeamProgress(t)

    saveTournament(t)
    if (_ps.matchKey) delete _matchDrafts[_ps.matchKey]
    showToast('比分已保存 ✓')
    navigate('/schedule?id=' + p.id)
  }
}

function update9TeamProgress(t) {
  var nt = t.nineTeam || init9TeamData()
  if (is9TeamStageComplete(t, 'group') && nt.stageStatus.group !== 'completed') nt.stageStatus.group = 'completed'
  if (is9TeamStageComplete(t, 'round6') && nt.stageStatus.round6 !== 'completed') nt.stageStatus.round6 = 'completed'
  if (is9TeamStageComplete(t, 'revival') && nt.stageStatus.revival !== 'completed') nt.stageStatus.revival = 'completed'
  if (is9TeamStageComplete(t, 'semi') && nt.stageStatus.semi !== 'completed') nt.stageStatus.semi = 'completed'
  var finalM = (t.matches || []).filter(function (m) { return m.stage === 'final' || m.stage === 'third' })
  if (finalM.length > 0 && finalM.every(function (m) { return m.status === 'finished' })) nt.stageStatus.final = 'completed'
  if (is9TeamStageComplete(t, 'ranking')) nt.stageStatus.ranking = 'completed'
  t.nineTeam = nt
}

/* ====================================================================
   PAGE: RANKINGS
   ==================================================================== */
function renderRankings(p) {
  var t = _t(p.id)
  if (!t) return '<div class="container"><div class="empty-state"><div class="empty-icon">❌</div><div class="empty-text">比赛不存在</div></div></div>'
  var fmt = t.format
  var html = '<div class="container">'
  if (_viewer) html += '<div class="viewer-banner">🔒 只读模式 — 仅供查看</div>'
  html += '<div class="flex-between mb-md"><button class="btn-home-link" id="btn-home">首页</button><div class="section-title">🏆 排名</div><div style="width:40px"></div></div>'

  if (fmt === 'nine-team') {
    html += render9TeamRankings(t)
  } else {
    html += renderStandardRankings(t)
  }
  html += '</div>'
  return html
}

function renderStandardRankings(t) {
  var html = ''
  ;(t.groups || []).forEach(function (g) {
    var gm = (t.matches || []).filter(function (m) { return m.stage === 'group' && m.groupName === g.name })
    var st = calculateStandings(gm, g.members)
    html += '<div class="round-header">' + esc(g.name) + ' 组排名</div>'
    html += renderStandingsTable(st, t.format === 'group-knockout' ? (t.settings.qualifyCount || 2) : 0)
  })

  if (t.knockout && t.knockout.length > 0) {
    html += '<div class="round-header mt-lg">淘汰赛</div>'
    html += renderKnockoutBracket(t)
    var finalRound = t.knockout.find(function (r) { return r.roundName === '决赛' })
    if (finalRound && finalRound.matches[0] && finalRound.matches[0].winnerId) {
      var fm = finalRound.matches[0]
      var champion = fm.team1.id === fm.winnerId ? fm.team1 : fm.team2
      html += '<div class="champion-card"><div class="champion-title">🏆</div><div class="champion-name">' + esc(champion.name) + '</div><div class="text-sm text-secondary mt-xs">冠军</div></div>'
    }
  }
  return html
}

function render9TeamRankings(t) {
  var nt = t.nineTeam || init9TeamData()
  var tabs = [
    { key: 'group', label: '小组排名' },
    { key: 'revival', label: '复活赛排名' },
    { key: 'ranking', label: '排位赛排名' },
    { key: 'final', label: '最终排名' }
  ]
  var curTab = _ps.rankTab || 'group'
  var html = '<div class="tab-bar">'
  tabs.forEach(function (tab) {
    html += '<div class="tab-item' + (curTab === tab.key ? ' active' : '') + '" data-rtab="' + tab.key + '">' + tab.label + '</div>'
  })
  html += '</div>'

  if (curTab === 'group') {
    var gs = get9TeamGroupStandings(t)
    ;(t.groups || []).forEach(function (g) {
      html += '<div class="round-header">' + esc(g.name) + ' 组</div>'
      var st = gs[g.name] || []
      html += renderStandingsTable(st, 2)
    })
  } else if (curTab === 'revival') {
    var rvm = get9TeamStageMatches(t, 'revival')
    if (rvm.length === 0) { html += '<div class="empty-state" style="padding:20px"><div class="empty-text">复活赛尚未开始</div></div>' }
    else {
      var rTeams = []; var rIds = new Set()
      rvm.forEach(function (m) {
        if (m.team1 && !rIds.has(m.team1.id)) { rIds.add(m.team1.id); rTeams.push(m.team1) }
        if (m.team2 && !rIds.has(m.team2.id)) { rIds.add(m.team2.id); rTeams.push(m.team2) }
      })
      var st = calculateStandings(rvm, rTeams)
      html += '<div class="round-header">复活赛排名</div>'
      html += renderStandingsTable(st, 1)
    }
  } else if (curTab === 'ranking') {
    var rkm = get9TeamStageMatches(t, 'ranking')
    if (rkm.length === 0) { html += '<div class="empty-state" style="padding:20px"><div class="empty-text">排位赛尚未开始</div></div>' }
    else {
      var rkTeams = []; var rkIds = new Set()
      rkm.forEach(function (m) {
        if (m.team1 && !rkIds.has(m.team1.id)) { rkIds.add(m.team1.id); rkTeams.push(m.team1) }
        if (m.team2 && !rkIds.has(m.team2.id)) { rkIds.add(m.team2.id); rkTeams.push(m.team2) }
      })
      var st = calculateStandings(rkm, rkTeams)
      html += '<div class="round-header">小组第三排位赛 (第7-9名)</div>'
      html += renderStandingsTable(st, 0)
    }
  } else if (curTab === 'final') {
    var rk = compute9TeamFinalRankings(t)
    if (rk.length === 0) { html += '<div class="empty-state" style="padding:20px"><div class="empty-text">比赛尚未全部完成</div></div>' }
    else {
      if (rk[0]) html += '<div class="champion-card"><div class="champion-title">🏆</div><div class="champion-name">' + esc(rk[0].team.name) + '</div><div class="text-sm text-secondary mt-xs">冠军</div></div>'
      html += '<div class="mt-md">'
      rk.forEach(function (r) {
        var posIcon = r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : '#' + r.rank
        html += '<div class="final-rank-item"><div class="final-rank-pos">' + posIcon + '</div><div class="final-rank-name">' + esc(r.team.name) + '</div><div class="final-rank-label">' + esc(r.label) + '</div></div>'
      })
      html += '</div>'
    }
  }
  return html
}

function renderStandingsTable(standings, qualifyCount) {
  if (standings.length === 0) return '<div class="text-center text-hint" style="padding:10px">暂无排名数据</div>'
  var html = '<div class="standings-table">'
  html += '<div class="table-header"><div class="col-rank">#</div><div class="col-name">名称</div><div class="col-stat">胜</div><div class="col-stat">负</div><div class="col-stat">净局</div><div class="col-points">积分</div></div>'
  standings.forEach(function (s, i) {
    var net = (s.scoreFor || 0) - (s.scoreAgainst || 0)
    var netStr = net > 0 ? '+' + net : String(net)
    html += '<div class="table-row"><div class="col-rank' + (i < 3 ? ' top' : '') + '">'
    if (i < 3) html += ['🥇', '🥈', '🥉'][i]
    else html += (i + 1)
    html += '</div><div class="col-name">' + esc(s.name)
    if (qualifyCount > 0 && i < qualifyCount) html += ' <span class="qualify-tag">出线</span>'
    html += '</div><div class="col-stat text-bold">' + s.wins + '</div><div class="col-stat">' + s.losses + '</div><div class="col-stat' + (net > 0 ? ' text-primary' : (net < 0 ? ' text-danger' : '')) + '">' + netStr + '</div><div class="col-points"><span class="score-badge">' + s.points + '</span></div></div>'
  })
  html += '</div>'
  return html
}

function mountRankings(p) {
  if (typeof listenToTournament === 'function') listenToTournament(p.id)
  document.getElementById('btn-home').onclick = function () { location.hash = '/' }
  document.querySelectorAll('[data-rtab]').forEach(function (el) {
    el.onclick = function () { _ps.rankTab = el.dataset.rtab; render() }
  })
}

/* ====================================================================
   VIEWER MODE INITIALIZATION
   ==================================================================== */
function initViewerMode() {
  var search = location.search
  if (search.indexOf('share=') >= 0) {
    var encoded = search.split('share=')[1]
    if (encoded) {
      encoded = encoded.split('&')[0]
      var tourney = loadShareData(encoded)
      if (tourney) {
        _viewer = true
        _viewerTournament = tourney
        location.hash = '/result?id=' + tourney.id
        return true
      }
    }
  }
  return false
}

/* ====================================================================
   INIT
   ==================================================================== */
window.addEventListener('hashchange', render)
document.addEventListener('DOMContentLoaded', function () {
  initViewerMode()
  render()
  if (typeof initFirebase === 'function' && !_viewer) {
    console.log('[App] Starting Firebase init...')
    initFirebase().then(function () {
      console.log('[App] Firebase done, firebaseReady=' + _firebaseReady + ', tournaments=' + getTournaments().length)
      var cs = document.getElementById('cloud-status')
      if (cs) {
        if (_firebaseReady) {
          cs.textContent = '✅ 云端已连接'
          setTimeout(function () { cs.style.display = 'none' }, 2000)
        } else {
          cs.textContent = '⚠️ 云端连接失败，仅显示本地数据'
          cs.style.color = 'rgba(255,160,80,.7)'
        }
      }
      render()
    })
  }
})
