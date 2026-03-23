/* ========================================
   data.js — Storage, Algorithms, Utilities
   ======================================== */

/* ===== Cloud Sync (Supabase REST API) ===== */
var _firebaseReady = false
var _userId = null
var _activeListeners = {}
var _syncQueue = []

function getMyUserId() {
  if (!_userId) _userId = localStorage.getItem('tennis_uid')
  if (!_userId) {
    _userId = 'u_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
    localStorage.setItem('tennis_uid', _userId)
  }
  return _userId
}

function isCreator(tournament) {
  if (!tournament) return false
  if (!tournament.creatorId) return true
  return tournament.creatorId === getMyUserId()
}

function _isFirebaseConfigured() {
  return typeof supabaseConfig !== 'undefined' && supabaseConfig &&
    supabaseConfig.url && supabaseConfig.url !== 'YOUR_SUPABASE_URL' &&
    supabaseConfig.anonKey && supabaseConfig.anonKey !== 'YOUR_ANON_KEY'
}

function _sbHeaders(prefer) {
  var h = {
    'apikey': supabaseConfig.anonKey,
    'Authorization': 'Bearer ' + supabaseConfig.anonKey,
    'Content-Type': 'application/json'
  }
  if (prefer) h['Prefer'] = prefer
  return h
}

function _sbFetch(path, opts) {
  var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  var timer = ctrl ? setTimeout(function () { ctrl.abort() }, 15000) : null
  if (ctrl && opts) opts.signal = ctrl.signal
  else if (ctrl) opts = { signal: ctrl.signal }
  return fetch(supabaseConfig.url + path, opts || {}).then(function (r) {
    if (timer) clearTimeout(timer)
    return r
  }).catch(function (e) {
    if (timer) clearTimeout(timer)
    throw e
  })
}

function initFirebase() {
  return new Promise(function (resolve) {
    if (!_isFirebaseConfigured()) {
      console.log('[Cloud] Not configured')
      resolve()
      return
    }
    _userId = getMyUserId()
    console.log('[Cloud] User:', _userId)
    var _done = false
    var _timer = setTimeout(function () {
      if (!_done) { _done = true; console.warn('[Cloud] Sync timeout (15s)'); resolve() }
    }, 15000)
    _syncFromCloud().then(function () {
      _firebaseReady = true
      _flushSyncQueue()
      console.log('[Cloud] Ready, tournaments:', getTournaments().length)
      if (!_done) { _done = true; clearTimeout(_timer); resolve() }
    }).catch(function (e) {
      console.error('[Cloud] Init failed:', e.message || e)
      if (!_done) { _done = true; clearTimeout(_timer); resolve() }
    })
  })
}

function _cleanData(obj) {
  if (obj === null || obj === undefined) return null
  if (typeof obj === 'number' && !isFinite(obj)) return 0
  if (typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(_cleanData)
  var clean = {}
  Object.keys(obj).forEach(function (k) {
    if (obj[k] !== undefined) clean[k] = _cleanData(obj[k])
  })
  return clean
}

function _syncFromCloud() {
  console.log('[Cloud] Syncing...')
  return _sbFetch('/rest/v1/tournaments?select=data&order=created_at.desc&limit=500', {
    headers: _sbHeaders()
  }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status)
    return r.json()
  }).then(function (rows) {
    console.log('[Cloud] Got', rows.length, 'rows from cloud')
    var cloudMap = {}
    rows.forEach(function (row) {
      var d = row.data
      if (d && d.id) cloudMap[d.id] = d
    })
    var localList = getTournaments()
    var deletedIds = JSON.parse(localStorage.getItem('tennis_deleted') || '[]')
    var pushCount = 0
    localList.forEach(function (lt) {
      if (deletedIds.indexOf(lt.id) >= 0) return
      if (!cloudMap[lt.id]) {
        if (isCreator(lt)) {
          if (!lt.creatorId) lt.creatorId = getMyUserId()
          if (!lt.createTime) lt.createTime = Date.now()
          lt.updateTime = Date.now()
          cloudMap[lt.id] = lt
          _pushToCloud(lt)
          pushCount++
        }
      } else if ((lt.updateTime || 0) > (cloudMap[lt.id].updateTime || 0)) {
        cloudMap[lt.id] = lt
        _pushToCloud(lt)
        pushCount++
      }
    })
    deletedIds.forEach(function (did) { delete cloudMap[did] })
    var merged = Object.keys(cloudMap).map(function (k) { return cloudMap[k] })
    merged.sort(function (a, b) { return (b.createTime || 0) - (a.createTime || 0) })
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
    console.log('[Cloud] Pushed', pushCount, ', total:', merged.length)
  })
}

function _pushToCloud(tournament) {
  if (!tournament || !tournament.id) return Promise.resolve()
  if (!_firebaseReady || !_isFirebaseConfigured()) {
    _syncQueue.push(JSON.parse(JSON.stringify(tournament)))
    return Promise.resolve()
  }
  var data = _cleanData(JSON.parse(JSON.stringify(tournament)))
  var row = {
    id: tournament.id,
    name: tournament.name || '',
    data: data,
    creator_id: tournament.creatorId || getMyUserId(),
    created_at: tournament.createTime || Date.now(),
    updated_at: Date.now()
  }
  return _sbFetch('/rest/v1/tournaments', {
    method: 'POST',
    headers: _sbHeaders('resolution=merge-duplicates,return=minimal'),
    body: JSON.stringify(row)
  }).then(function (r) {
    if (!r.ok) return r.text().then(function (t) { throw new Error(t) })
    console.log('[Cloud] Saved:', tournament.id)
  }).catch(function (e) {
    console.error('[Cloud] Push failed:', tournament.id, e.message || e)
  })
}

function _flushSyncQueue() {
  if (_syncQueue.length === 0) return
  console.log('[Cloud] Flushing queue:', _syncQueue.length, 'items')
  var q = _syncQueue.slice()
  _syncQueue = []
  q.forEach(function (t) { _pushToCloud(t) })
}

function _deleteFromCloud(id) {
  if (!_isFirebaseConfigured() || !id) return
  _sbFetch('/rest/v1/tournaments?id=eq.' + encodeURIComponent(id), {
    method: 'DELETE',
    headers: _sbHeaders('return=minimal')
  }).catch(function (e) {
    console.error('[Cloud] Delete failed:', id, e)
  })
}

function refreshFromCloud() {
  if (!_isFirebaseConfigured()) return Promise.resolve()
  return _syncFromCloud()
}

function listenToTournament() {}
function stopListenTournament() {}

/* ===== Local Storage ===== */
var STORAGE_KEY = 'tennis_tournaments_v2'

function getTournaments() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [] }
  catch (e) { return [] }
}
function getTournament(id) {
  return getTournaments().find(function (t) { return t.id === id }) || null
}
function saveTournament(tournament) {
  if (tournament && tournament.format === 'duel-meet' && typeof syncDuelMeetDerivedData === 'function') syncDuelMeetDerivedData(tournament)
  if (!tournament.creatorId) tournament.creatorId = getMyUserId()
  tournament.updateTime = Date.now()
  var list = getTournaments()
  var idx = list.findIndex(function (t) { return t.id === tournament.id })
  if (idx >= 0) list[idx] = tournament; else list.unshift(tournament)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  _pushToCloud(tournament)
}
function deleteTournament(id) {
  var list = getTournaments().filter(function (t) { return t.id !== id })
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  var del = JSON.parse(localStorage.getItem('tennis_deleted') || '[]')
  if (del.indexOf(id) < 0) del.push(id)
  localStorage.setItem('tennis_deleted', JSON.stringify(del))
  _deleteFromCloud(id)
}

/* ===== Utility ===== */
function generateId() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 9) }

function formatTime(ts) {
  var d = new Date(ts), p = function(n) { return n.toString().padStart(2,'0') }
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes())
}

function esc(s) {
  if (!s) return ''
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')
}

function parseCSV(text) {
  var lines = text.split(/\r?\n/).filter(function(l){return l.trim()})
  var players = [], hdr = ['姓名','name','名字','选手','player']
  for (var i = 0; i < lines.length; i++) {
    var parts = lines[i].split(/[,，\t;；|]/).map(function(s){return s.trim()})
    if (parts.length >= 2) {
      var nm = parts[0], sc = parts[1]
      if (i===0 && hdr.some(function(k){return nm.toLowerCase().includes(k.toLowerCase())})) continue
      var score = parseInt(sc)
      if (nm && !isNaN(score)) players.push({id:generateId(), name:nm, score:Math.max(0,score)})
    }
  }
  return players
}

function parseExcel(arrayBuffer) {
  if (typeof XLSX === 'undefined') return []
  var wb = XLSX.read(arrayBuffer, {type:'array'})
  var ws = wb.Sheets[wb.SheetNames[0]]
  var data = XLSX.utils.sheet_to_json(ws, {header:1})
  var players = [], hdr = ['姓名','name','名字','选手','player']
  for (var i = 0; i < data.length; i++) {
    var row = data[i]
    if (!row || row.length < 2) continue
    var nm = String(row[0]).trim(), sc = parseInt(row[1])
    if (i===0 && hdr.some(function(k){return nm.toLowerCase().includes(k.toLowerCase())})) continue
    if (nm && !isNaN(sc)) players.push({id:generateId(), name:nm, score:Math.max(0,sc)})
  }
  return players
}

/* ===== Duel Meet Format ===== */
var DUEL_MEET_TYPES = {
  'men-singles': { label: '男单', pointValue: 1, slots: ['male'] },
  'women-singles': { label: '女单', pointValue: 1, slots: ['female'] },
  'men-doubles': { label: '男双', pointValue: 2, slots: ['male', 'male'] },
  'women-doubles': { label: '女双', pointValue: 2, slots: ['female', 'female'] },
  'mixed-doubles': { label: '混双', pointValue: 2, slots: ['male', 'female'] }
}

function initDuelMeetData() {
  return {
    teamA: { id: 'duel_team_a', name: 'A队', malePlayers: [], femalePlayers: [] },
    teamB: { id: 'duel_team_b', name: 'B队', malePlayers: [], femalePlayers: [] },
    config: { menSingles: 0, womenSingles: 0, menDoubles: 0, womenDoubles: 0, mixedDoubles: 0 },
    matchPlan: []
  }
}

function _duelRosterToMembers(list, gender) {
  return (list || []).map(function (pl) {
    return {
      id: pl.id,
      name: pl.name + (gender === 'male' ? '（男）' : '（女）'),
      score: 0,
      gender: gender
    }
  })
}

function syncDuelMeetDerivedData(tournament) {
  if (!tournament || tournament.format !== 'duel-meet') return tournament
  var dm = tournament.duelMeet || initDuelMeetData()
  var allPlayers = []
  ;['teamA', 'teamB'].forEach(function (teamKey) {
    var team = dm[teamKey] || {}
    ;(team.malePlayers || []).forEach(function (pl) {
      allPlayers.push({ id: pl.id, name: pl.name, score: 0, gender: 'male', teamKey: teamKey })
    })
    ;(team.femalePlayers || []).forEach(function (pl) {
      allPlayers.push({ id: pl.id, name: pl.name, score: 0, gender: 'female', teamKey: teamKey })
    })
  })
  tournament.players = allPlayers
  tournament.groups = allPlayers.length > 0 ? [
    {
      name: dm.teamA && dm.teamA.name ? dm.teamA.name : 'A队',
      members: _duelRosterToMembers((dm.teamA && dm.teamA.malePlayers) || [], 'male').concat(_duelRosterToMembers((dm.teamA && dm.teamA.femalePlayers) || [], 'female'))
    },
    {
      name: dm.teamB && dm.teamB.name ? dm.teamB.name : 'B队',
      members: _duelRosterToMembers((dm.teamB && dm.teamB.malePlayers) || [], 'male').concat(_duelRosterToMembers((dm.teamB && dm.teamB.femalePlayers) || [], 'female'))
    }
  ] : null
  tournament.duelMeet = dm
  return tournament
}

function _pushDuelPlan(list, typeKey, count) {
  var def = DUEL_MEET_TYPES[typeKey]
  for (var i = 0; i < count; i++) {
    list.push({
      id: makeMatchId('dm'),
      duelType: typeKey,
      matchLabel: def.label + ' 第' + (i + 1) + '场',
      pointValue: def.pointValue,
      team1PlayerIds: new Array(def.slots.length).fill(''),
      team2PlayerIds: new Array(def.slots.length).fill('')
    })
  }
}

function generateDuelMeetMatchPlan(config) {
  var plan = []
  var cfg = config || {}
  _pushDuelPlan(plan, 'men-singles', Math.max(0, parseInt(cfg.menSingles) || 0))
  _pushDuelPlan(plan, 'women-singles', Math.max(0, parseInt(cfg.womenSingles) || 0))
  _pushDuelPlan(plan, 'men-doubles', Math.max(0, parseInt(cfg.menDoubles) || 0))
  _pushDuelPlan(plan, 'women-doubles', Math.max(0, parseInt(cfg.womenDoubles) || 0))
  _pushDuelPlan(plan, 'mixed-doubles', Math.max(0, parseInt(cfg.mixedDoubles) || 0))
  return plan
}

function _buildDuelLineupName(teamName, players) {
  return teamName + ' · ' + players.map(function (pl) { return pl.name }).join('/')
}

function _buildDuelTeamPayload(teamId, teamName, players) {
  return {
    id: teamId,
    name: _buildDuelLineupName(teamName, players),
    baseName: teamName,
    players: players.map(function (pl) { return { id: pl.id, name: pl.name, gender: pl.gender } }),
    score: 0
  }
}

function generateDuelMeetMatches(duelMeet) {
  if (!duelMeet) return []
  var teamA = duelMeet.teamA || {}
  var teamB = duelMeet.teamB || {}
  var map = {}
  ;['teamA', 'teamB'].forEach(function (teamKey) {
    var team = duelMeet[teamKey] || {}
    ;(team.malePlayers || []).forEach(function (pl) { map[pl.id] = { id: pl.id, name: pl.name, gender: 'male', teamKey: teamKey } })
    ;(team.femalePlayers || []).forEach(function (pl) { map[pl.id] = { id: pl.id, name: pl.name, gender: 'female', teamKey: teamKey } })
  })
  return (duelMeet.matchPlan || []).map(function (plan, idx) {
    var team1Players = (plan.team1PlayerIds || []).map(function (id) { return map[id] }).filter(Boolean)
    var team2Players = (plan.team2PlayerIds || []).map(function (id) { return map[id] }).filter(Boolean)
    return {
      id: plan.id || makeMatchId('dm'),
      stage: 'duel-meet',
      duelType: plan.duelType,
      matchLabel: plan.matchLabel || ((DUEL_MEET_TYPES[plan.duelType] || {}).label || '对对碰') + ' 第' + (idx + 1) + '场',
      pointValue: plan.pointValue || ((DUEL_MEET_TYPES[plan.duelType] || {}).pointValue || 1),
      round: idx + 1,
      team1: _buildDuelTeamPayload((teamA.id || 'duel_team_a'), teamA.name || 'A队', team1Players),
      team2: _buildDuelTeamPayload((teamB.id || 'duel_team_b'), teamB.name || 'B队', team2Players),
      score1: '',
      score2: '',
      winnerId: null,
      status: 'pending'
    }
  })
}

function calculateDuelMeetStandings(tournament) {
  if (!tournament || tournament.format !== 'duel-meet') return []
  var dm = tournament.duelMeet || initDuelMeetData()
  var standings = [
    { id: (dm.teamA && dm.teamA.id) || 'duel_team_a', name: (dm.teamA && dm.teamA.name) || 'A队', wins: 0, losses: 0, points: 0, scoreFor: 0, scoreAgainst: 0, played: 0 },
    { id: (dm.teamB && dm.teamB.id) || 'duel_team_b', name: (dm.teamB && dm.teamB.name) || 'B队', wins: 0, losses: 0, points: 0, scoreFor: 0, scoreAgainst: 0, played: 0 }
  ]
  var map = {}
  standings.forEach(function (it) { map[it.id] = it })
  ;(tournament.matches || []).filter(function (m) { return m.stage === 'duel-meet' && m.status === 'finished' && m.winnerId }).forEach(function (m) {
    var pointValue = m.pointValue || ((DUEL_MEET_TYPES[m.duelType] || {}).pointValue || 1)
    var s1 = parseNetGames(m.score1)
    if (map[m.team1.id]) {
      map[m.team1.id].played++
      map[m.team1.id].scoreFor += s1.won
      map[m.team1.id].scoreAgainst += s1.lost
      if (m.winnerId === m.team1.id) { map[m.team1.id].wins++; map[m.team1.id].points += pointValue }
      else map[m.team1.id].losses++
    }
    if (map[m.team2.id]) {
      map[m.team2.id].played++
      map[m.team2.id].scoreFor += s1.lost
      map[m.team2.id].scoreAgainst += s1.won
      if (m.winnerId === m.team2.id) { map[m.team2.id].wins++; map[m.team2.id].points += pointValue }
      else map[m.team2.id].losses++
    }
  })
  return standings.sort(function (a, b) {
    if (b.points !== a.points) return b.points - a.points
    var netA = a.scoreFor - a.scoreAgainst, netB = b.scoreFor - b.scoreAgainst
    if (netB !== netA) return netB - netA
    if (b.wins !== a.wins) return b.wins - a.wins
    return a.name.localeCompare(b.name)
  })
}

function groupsToText(tournament) {
  var fl = {
    'round-robin':'单循环', 'group-knockout':'小组循环+淘汰赛',
    'single-knockout':'单循环+淘汰赛', 'nine-team':'9组大战赛', 'duel-meet':'对对碰'
  }
  if (tournament && tournament.format === 'duel-meet') {
    var dm = tournament.duelMeet || initDuelMeetData()
    var st = calculateDuelMeetStandings(tournament)
    var text = '【' + tournament.name + '】\n'
    text += '类型：团体赛 | 赛制：对对碰\n'
    text += '━━━━━━━━━━━━━━━━━━\n\n'
    text += '◆ ' + ((dm.teamA && dm.teamA.name) || 'A队') + '\n'
    ;(dm.teamA.malePlayers || []).forEach(function (pl, idx) { text += '  男' + (idx + 1) + '. ' + pl.name + '\n' })
    ;(dm.teamA.femalePlayers || []).forEach(function (pl, idx) { text += '  女' + (idx + 1) + '. ' + pl.name + '\n' })
    text += '\n◆ ' + ((dm.teamB && dm.teamB.name) || 'B队') + '\n'
    ;(dm.teamB.malePlayers || []).forEach(function (pl, idx) { text += '  男' + (idx + 1) + '. ' + pl.name + '\n' })
    ;(dm.teamB.femalePlayers || []).forEach(function (pl, idx) { text += '  女' + (idx + 1) + '. ' + pl.name + '\n' })
    if (st.length > 0) {
      text += '\n◆ 当前排名\n'
      st.forEach(function (row, idx) {
        var net = (row.scoreFor || 0) - (row.scoreAgainst || 0)
        text += '  ' + (idx + 1) + '. ' + row.name + ' - 积分' + row.points + '，胜' + row.wins + '，负' + row.losses + '，净局' + (net > 0 ? '+' : '') + net + '\n'
      })
    }
    return text.trim()
  }
  var text = '【'+tournament.name+'】\n'
  text += '类型：'+(tournament.type==='singles'?'单打':'双打')+' | 赛制：'+(fl[tournament.format]||'未知')+'\n'
  text += '━━━━━━━━━━━━━━━━━━\n\n'
  if (!tournament.groups) return text
  tournament.groups.forEach(function(g){
    text += '◆ '+g.name+'组\n'
    g.members.forEach(function(m,idx){
      text += '  '+(idx+1)+'. '+m.name+' ('+m.score+'分)'+(m.isSeed?' ★种子':'')+'\n'
      if (tournament.type==='doubles'&&m.player1&&m.player2)
        text += '     '+m.player1.name+'('+m.player1.score+') + '+m.player2.name+'('+m.player2.score+')\n'
    })
    text += '\n'
  })
  return text.trim()
}

function exportToExcel(headers, rows, filename) {
  if (typeof XLSX === 'undefined') { showToast('Excel库未加载'); return }
  var data = [headers].concat(rows)
  var ws = XLSX.utils.aoa_to_sheet(data)
  var wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  XLSX.writeFile(wb, filename)
}

/* ===== Sharing ===== */
function generateShareData(tournamentId) {
  var t = getTournament(tournamentId)
  if (!t) return null
  try {
    var json = JSON.stringify(t)
    return btoa(unescape(encodeURIComponent(json)))
  } catch(e) { return null }
}

function loadShareData(encoded) {
  try {
    var json = decodeURIComponent(escape(atob(encoded)))
    return JSON.parse(json)
  } catch(e) { return null }
}

/* ===== Core Algorithms ===== */
function shuffleArray(arr) {
  var a = arr.slice()
  for (var i = a.length-1; i > 0; i--) {
    var j = Math.floor(Math.random()*(i+1)); var tmp=a[i]; a[i]=a[j]; a[j]=tmp
  }
  return a
}

function getSnakeIndex(i, gc) {
  var p = 2*gc, pos = i%p
  return pos < gc ? pos : 2*gc-1-pos
}

function snakeGroup(items, groupCount, seedCount) {
  seedCount = seedCount||0
  if (groupCount<=0||!items.length) return []
  var groups = []
  for (var i=0;i<groupCount;i++) groups.push({name:String.fromCharCode(65+(i%26))+(i>=26?String(Math.floor(i/26)):''),members:[]})
  var sorted = items.map(function(x){return Object.assign({},x)}).sort(function(a,b){return b.score-a.score})
  for (var i=0;i<sorted.length;i++) { sorted[i].isSeed=i<seedCount; groups[getSnakeIndex(i,groupCount)].members.push(sorted[i]) }
  return groups
}

function randomGroup(items, groupCount, seedCount) {
  seedCount = seedCount||0
  if (groupCount<=0||!items.length) return []
  var groups = []
  for (var i=0;i<groupCount;i++) groups.push({name:String.fromCharCode(65+(i%26))+(i>=26?String(Math.floor(i/26)):''),members:[]})
  var sorted = items.map(function(x){return Object.assign({},x)}).sort(function(a,b){return b.score-a.score})
  var seeds = sorted.slice(0,seedCount), rest = shuffleArray(sorted.slice(seedCount))
  for (var i=0;i<seeds.length;i++) { seeds[i].isSeed=true; groups[getSnakeIndex(i,groupCount)].members.push(seeds[i]) }
  rest.forEach(function(item){
    var min=Infinity, cands=[]
    groups.forEach(function(g,i){ if(g.members.length<min){min=g.members.length;cands=[i]} else if(g.members.length===min) cands.push(i) })
    item.isSeed=false; groups[cands[Math.floor(Math.random()*cands.length)]].members.push(item)
  })
  return groups
}

function randomPairFn(players) {
  var sh = shuffleArray(players), teams = [], bye = null
  for (var i=0;i+1<sh.length;i+=2) {
    var p1=sh[i],p2=sh[i+1]
    teams.push({id:'team_'+Date.now()+'_'+i,player1:{id:p1.id,name:p1.name,score:p1.score},player2:{id:p2.id,name:p2.name,score:p2.score},score:p1.score+p2.score,name:p1.name+'/'+p2.name})
  }
  if (sh.length%2===1) bye=sh[sh.length-1]
  return {teams:teams,bye:bye}
}

function smartPairFn(players) {
  var sorted=players.slice().sort(function(a,b){return b.score-a.score}), teams=[], bye=null
  if (sorted.length%2===1) bye=sorted.splice(Math.floor(sorted.length/2),1)[0]
  for (var i=0;i<Math.floor(sorted.length/2);i++) {
    var p1=sorted[i],p2=sorted[sorted.length-1-i]
    teams.push({id:'team_'+Date.now()+'_'+i,player1:{id:p1.id,name:p1.name,score:p1.score},player2:{id:p2.id,name:p2.name,score:p2.score},score:p1.score+p2.score,name:p1.name+'/'+p2.name})
  }
  return {teams:teams,bye:bye}
}

/* ===== Match Generation ===== */
var _matchCounter = 0
function makeMatchId(prefix) { _matchCounter++; return prefix+'_'+Date.now().toString(36)+'_'+_matchCounter }

function generateGroupMatches(members, groupName) {
  if (!members||members.length<2) return []
  var matches=[], list=members.map(function(m){return Object.assign({},m)})
  if (list.length%2===1) list.push(null)
  var n=list.length
  for (var r=0;r<n-1;r++) {
    for (var i=0;i<n/2;i++) {
      var t1=list[i],t2=list[n-1-i]
      if (t1&&t2) matches.push({id:makeMatchId('gm'),stage:'group',groupName:groupName,round:r+1,
        team1:{id:t1.id,name:t1.name,score:t1.score},team2:{id:t2.id,name:t2.name,score:t2.score},
        score1:'',score2:'',winnerId:null,status:'pending'})
    }
    var last=list.pop(); list.splice(1,0,last)
  }
  return matches
}

function generateAllGroupMatches(groups) {
  var all=[]
  groups.forEach(function(g){all=all.concat(generateGroupMatches(g.members,g.name))})
  return all
}

function parseNetGames(scoreStr) {
  if (!scoreStr) return {won:0,lost:0}
  var won=0,lost=0
  String(scoreStr).split(/[,，]/).forEach(function(part){
    var m=part.trim().match(/(\d+)\s*[-:：]\s*(\d+)/)
    if(m){won+=parseInt(m[1]);lost+=parseInt(m[2])}
  })
  return {won:won,lost:lost}
}

function calculateStandings(matches, members) {
  var map={}
  members.forEach(function(m){map[m.id]={id:m.id,name:m.name,score:m.score,played:0,wins:0,losses:0,points:0,scoreFor:0,scoreAgainst:0}})
  matches.filter(function(m){return m.status==='finished'&&m.winnerId}).forEach(function(m){
    var s1=parseNetGames(m.score1)
    if (map[m.team1.id]) {
      map[m.team1.id].played++
      map[m.team1.id].scoreFor+=s1.won
      map[m.team1.id].scoreAgainst+=s1.lost
      if(m.winnerId===m.team1.id){map[m.team1.id].wins++;map[m.team1.id].points+=2} else{map[m.team1.id].losses++;map[m.team1.id].points+=1}
    }
    if (map[m.team2.id]) {
      map[m.team2.id].played++
      map[m.team2.id].scoreFor+=s1.lost
      map[m.team2.id].scoreAgainst+=s1.won
      if(m.winnerId===m.team2.id){map[m.team2.id].wins++;map[m.team2.id].points+=2} else{map[m.team2.id].losses++;map[m.team2.id].points+=1}
    }
  })
  return Object.values(map).sort(function(a,b){
    if(b.points!==a.points) return b.points-a.points
    if(b.wins!==a.wins) return b.wins-a.wins
    var netA=a.scoreFor-a.scoreAgainst, netB=b.scoreFor-b.scoreAgainst
    if(netB!==netA) return netB-netA
    return b.score-a.score
  })
}

/* ===== Four-Player Rotation Doubles ===== */
function generateFourRotationMatches(players) {
  if (players.length !== 4) return { matches: [] }
  var p = players.map(function (pl) { return { id: pl.id, name: pl.name, score: pl.score || 0 } })
  var rounds = [
    { r: 1, t1: [p[0], p[1]], t2: [p[2], p[3]] },
    { r: 2, t1: [p[0], p[2]], t2: [p[1], p[3]] },
    { r: 3, t1: [p[0], p[3]], t2: [p[1], p[2]] }
  ]
  var matches = []
  rounds.forEach(function (rd) {
    var t1Name = rd.t1[0].name + ' & ' + rd.t1[1].name
    var t2Name = rd.t2[0].name + ' & ' + rd.t2[1].name
    matches.push({
      id: makeMatchId('fr'),
      stage: 'rotation',
      round: rd.r,
      matchLabel: '第' + rd.r + '轮',
      groupName: '轮转',
      team1: { id: 'fr_' + rd.r + '_1', name: t1Name, members: [rd.t1[0].id, rd.t1[1].id] },
      team2: { id: 'fr_' + rd.r + '_2', name: t2Name, members: [rd.t2[0].id, rd.t2[1].id] },
      score1: '', score2: '', winnerId: null, status: 'pending'
    })
  })
  return { matches: matches }
}

function calculateFourRotationStandings(matches, players) {
  var map = {}
  players.forEach(function (pl) {
    map[pl.id] = { id: pl.id, name: pl.name, score: pl.score || 0, played: 0, wins: 0, losses: 0, gamesFor: 0, gamesAgainst: 0 }
  })
  matches.filter(function (m) { return m.status === 'finished' && m.winnerId }).forEach(function (m) {
    var s1 = parseNetGames(m.score1)
    var winTeam = m.winnerId === m.team1.id ? m.team1 : m.team2
    var loseTeam = m.winnerId === m.team1.id ? m.team2 : m.team1
    var winGames = m.winnerId === m.team1.id ? s1 : parseNetGames(m.score2)
    var loseGames = m.winnerId === m.team1.id ? parseNetGames(m.score2) : s1
    ;(winTeam.members || []).forEach(function (pid) {
      if (map[pid]) { map[pid].played++; map[pid].wins++; map[pid].gamesFor += winGames.won; map[pid].gamesAgainst += winGames.lost }
    })
    ;(loseTeam.members || []).forEach(function (pid) {
      if (map[pid]) { map[pid].played++; map[pid].losses++; map[pid].gamesFor += loseGames.won; map[pid].gamesAgainst += loseGames.lost }
    })
  })
  return Object.values(map).sort(function (a, b) {
    if (b.wins !== a.wins) return b.wins - a.wins
    var netA = a.gamesFor - a.gamesAgainst, netB = b.gamesFor - b.gamesAgainst
    if (netB !== netA) return netB - netA
    if (b.gamesFor !== a.gamesFor) return b.gamesFor - a.gamesFor
    return b.score - a.score
  })
}

/* ===== Knockout Bracket ===== */
function makeKoMatch(t1, t2) {
  return {id:makeMatchId('ko'),
    team1:t1?{id:t1.id,name:t1.name,score:t1.score}:null,
    team2:t2?{id:t2.id,name:t2.name,score:t2.score}:null,
    score1:'',score2:'',winnerId:null,status:(t1&&t2)?'pending':'waiting'}
}

function generateKnockoutBracket(groupStandings, qualifyCount, hasThirdPlace) {
  var gn=Object.keys(groupStandings).sort(), pairs=[]
  if(gn.length===2){var a=groupStandings[gn[0]],b=groupStandings[gn[1]];var c=Math.min(qualifyCount,a.length,b.length);for(var i=0;i<c;i++)pairs.push([a[i],b[c-1-i]])}
  else if(gn.length===4){var gs=gn.map(function(n){return groupStandings[n]});if(qualifyCount>=2)pairs.push([gs[0][0],gs[1][1]],[gs[2][0],gs[3][1]],[gs[1][0],gs[0][1]],[gs[3][0],gs[2][1]]);else pairs.push([gs[0][0],gs[1][0]],[gs[2][0],gs[3][0]])}
  else{var all=[];gn.forEach(function(n){groupStandings[n].slice(0,qualifyCount).forEach(function(t){all.push(t)})});for(var i=0;i<all.length;i+=2)if(i+1<all.length)pairs.push([all[i],all[i+1]])}
  if(!pairs.length) return []
  function rn(c){if(c===1)return'决赛';if(c===2)return'半决赛';if(c===4)return'四分之一决赛';return(c*2)+'进'+c}
  var rounds=[], cur=pairs.map(function(p){return makeKoMatch(p[0],p[1])})
  rounds.push({roundName:rn(cur.length),matches:cur})
  while(cur.length>1){var next=[];for(var i=0;i<cur.length;i+=2)next.push(makeKoMatch(null,null));rounds.push({roundName:rn(next.length),matches:next});cur=next}
  if(hasThirdPlace&&rounds.length>=2) rounds.push({roundName:'三四名决赛',isThirdPlace:true,matches:[makeKoMatch(null,null)]})
  return rounds
}

function advanceKnockoutWinner(knockout, roundIdx, matchIdx, winner, loser) {
  if(!knockout||!knockout[roundIdx]) return knockout
  knockout[roundIdx].matches[matchIdx].winnerId=winner.id
  knockout[roundIdx].matches[matchIdx].status='finished'
  var mainRounds=knockout.filter(function(r){return!r.isThirdPlace})
  var tpRound=knockout.find(function(r){return r.isThirdPlace})
  var mainIdx=mainRounds.indexOf(knockout[roundIdx])
  if(mainIdx>=0&&mainIdx+1<mainRounds.length){
    var nr=mainRounds[mainIdx+1],ni=Math.floor(matchIdx/2)
    if(nr.matches[ni]){
      if(matchIdx%2===0) nr.matches[ni].team1={id:winner.id,name:winner.name,score:winner.score}
      else nr.matches[ni].team2={id:winner.id,name:winner.name,score:winner.score}
      if(nr.matches[ni].team1&&nr.matches[ni].team2) nr.matches[ni].status='pending'
    }
  }
  if(tpRound&&loser&&mainIdx>=0&&mainIdx===mainRounds.length-2){
    var tp=tpRound.matches[0]
    if(!tp.team1)tp.team1={id:loser.id,name:loser.name,score:loser.score}
    else if(!tp.team2)tp.team2={id:loser.id,name:loser.name,score:loser.score}
    if(tp.team1&&tp.team2)tp.status='pending'
  }
  return knockout
}

function generateSingleKnockoutBracket(standings, teamCount, rule, hasThirdPlace) {
  var teams=standings.slice(0,Math.min(teamCount,standings.length))
  if(teams.length<2) return []
  var rounds=[]
  if(teams.length===2||teamCount===2){rounds.push({roundName:'决赛',matches:[makeKoMatch(teams[0],teams[1])]});return rounds}
  if(teams.length>=4&&rule==='direct'){
    rounds.push({roundName:'决赛',matches:[makeKoMatch(teams[0],teams[1])]})
    if(hasThirdPlace) rounds.push({roundName:'三四名决赛',isThirdPlace:true,matches:[makeKoMatch(teams[2],teams[3])]})
    return rounds
  }
  if(teams.length>=4){
    rounds.push({roundName:'半决赛',matches:[makeKoMatch(teams[0],teams[3]),makeKoMatch(teams[1],teams[2])]})
    rounds.push({roundName:'决赛',matches:[makeKoMatch(null,null)]})
    if(hasThirdPlace) rounds.push({roundName:'三四名决赛',isThirdPlace:true,matches:[makeKoMatch(null,null)]})
    return rounds
  }
  rounds.push({roundName:'决赛',matches:[makeKoMatch(teams[0],teams[1])]})
  return rounds
}

/* ===== 9-Team Battle Format ===== */
var NINE_STAGES = ['group','round6','revival','semi','final','third','ranking']
var NINE_STAGE_LABELS = {group:'小组赛',round6:'6强赛',revival:'复活赛',semi:'4强赛',final:'决赛/季军赛',third:'',ranking:'排位赛'}

function init9TeamData() {
  return {
    stageStatus: {group:'pending',round6:'pending',revival:'pending',semi:'pending',final:'pending',ranking:'pending'},
    round6Winners: [],
    round6Losers: [],
    revivalQualifier: null,
    semiFinalDrawn: false,
    semiFinalWinners: [],
    semiFinalLosers: [],
    finalRankings: []
  }
}

function generate9TeamRound6Matches(groupStandings, rule) {
  var A=groupStandings['A']||[], B=groupStandings['B']||[], C=groupStandings['C']||[]
  if(A.length<2||B.length<2||C.length<2) return []
  function mkTeam(t){return {id:t.id,name:t.name,score:t.score}}
  if (rule === 'random') {
    var pool = [A[0],A[1],B[0],B[1],C[0],C[1]]
    pool = shuffleArray(pool)
    return [
      {id:makeMatchId('r6'),stage:'round6',matchLabel:'6强赛1',team1:mkTeam(pool[0]),team2:mkTeam(pool[1]),score1:'',score2:'',winnerId:null,status:'pending'},
      {id:makeMatchId('r6'),stage:'round6',matchLabel:'6强赛2',team1:mkTeam(pool[2]),team2:mkTeam(pool[3]),score1:'',score2:'',winnerId:null,status:'pending'},
      {id:makeMatchId('r6'),stage:'round6',matchLabel:'6强赛3',team1:mkTeam(pool[4]),team2:mkTeam(pool[5]),score1:'',score2:'',winnerId:null,status:'pending'}
    ]
  }
  return [
    {id:makeMatchId('r6'),stage:'round6',matchLabel:'6强赛1 (A1vsB2)',team1:mkTeam(A[0]),team2:mkTeam(B[1]),score1:'',score2:'',winnerId:null,status:'pending'},
    {id:makeMatchId('r6'),stage:'round6',matchLabel:'6强赛2 (B1vsC2)',team1:mkTeam(B[0]),team2:mkTeam(C[1]),score1:'',score2:'',winnerId:null,status:'pending'},
    {id:makeMatchId('r6'),stage:'round6',matchLabel:'6强赛3 (C1vsA2)',team1:mkTeam(C[0]),team2:mkTeam(A[1]),score1:'',score2:'',winnerId:null,status:'pending'}
  ]
}

function generate9TeamRevivalMatches(losers) {
  if(losers.length<2) return []
  var matches = []
  for(var i=0;i<losers.length;i++){
    for(var j=i+1;j<losers.length;j++){
      matches.push({id:makeMatchId('rv'),stage:'revival',round:matches.length+1,matchLabel:'复活赛'+(matches.length+1),
        team1:{id:losers[i].id,name:losers[i].name,score:losers[i].score},
        team2:{id:losers[j].id,name:losers[j].name,score:losers[j].score},
        score1:'',score2:'',winnerId:null,status:'pending',isRevival:true})
    }
  }
  return matches
}

function generate9TeamSemiFinalDraw(winners, revivalWinner) {
  var pool = winners.concat([revivalWinner])
  pool = shuffleArray(pool)
  return [
    {id:makeMatchId('sf'),stage:'semi',matchLabel:'4强赛1',
      team1:{id:pool[0].id,name:pool[0].name,score:pool[0].score},
      team2:{id:pool[1].id,name:pool[1].name,score:pool[1].score},
      score1:'',score2:'',winnerId:null,status:'pending'},
    {id:makeMatchId('sf'),stage:'semi',matchLabel:'4强赛2',
      team1:{id:pool[2].id,name:pool[2].name,score:pool[2].score},
      team2:{id:pool[3].id,name:pool[3].name,score:pool[3].score},
      score1:'',score2:'',winnerId:null,status:'pending'}
  ]
}

function generate9TeamFinals(sfWinners, sfLosers) {
  var matches = []
  if(sfWinners.length===2) matches.push({id:makeMatchId('fn'),stage:'final',matchLabel:'决赛',
    team1:{id:sfWinners[0].id,name:sfWinners[0].name,score:sfWinners[0].score},
    team2:{id:sfWinners[1].id,name:sfWinners[1].name,score:sfWinners[1].score},
    score1:'',score2:'',winnerId:null,status:'pending'})
  if(sfLosers.length===2) matches.push({id:makeMatchId('tp'),stage:'third',matchLabel:'三四名决赛',
    team1:{id:sfLosers[0].id,name:sfLosers[0].name,score:sfLosers[0].score},
    team2:{id:sfLosers[1].id,name:sfLosers[1].name,score:sfLosers[1].score},
    score1:'',score2:'',winnerId:null,status:'pending'})
  return matches
}

function generate9TeamRankingMatches(thirdPlaceTeams) {
  if(thirdPlaceTeams.length<2) return []
  var matches = []
  for(var i=0;i<thirdPlaceTeams.length;i++){
    for(var j=i+1;j<thirdPlaceTeams.length;j++){
      matches.push({id:makeMatchId('rk'),stage:'ranking',round:matches.length+1,matchLabel:'排位赛'+(matches.length+1),
        team1:{id:thirdPlaceTeams[i].id,name:thirdPlaceTeams[i].name,score:thirdPlaceTeams[i].score},
        team2:{id:thirdPlaceTeams[j].id,name:thirdPlaceTeams[j].name,score:thirdPlaceTeams[j].score},
        score1:'',score2:'',winnerId:null,status:'pending'})
    }
  }
  return matches
}

function get9TeamStageMatches(tournament, stage) {
  return (tournament.matches||[]).filter(function(m){return m.stage===stage})
}

function is9TeamStageComplete(tournament, stage) {
  var ms = get9TeamStageMatches(tournament, stage)
  return ms.length > 0 && ms.every(function(m){return m.status==='finished'})
}

function get9TeamGroupStandings(tournament) {
  var standings = {}
  ;(tournament.groups||[]).forEach(function(g){
    var gm = (tournament.matches||[]).filter(function(m){return m.stage==='group'&&m.groupName===g.name})
    standings[g.name] = calculateStandings(gm, g.members)
  })
  return standings
}

function compute9TeamFinalRankings(tournament) {
  var rankings = []
  var nt = tournament.nineTeam || {}
  var allMatches = tournament.matches || []

  var finalMatch = allMatches.find(function(m){return m.stage==='final'&&m.status==='finished'})
  var thirdMatch = allMatches.find(function(m){return m.stage==='third'&&m.status==='finished'})

  if(finalMatch && finalMatch.winnerId) {
    var w = finalMatch.team1.id===finalMatch.winnerId ? finalMatch.team1 : finalMatch.team2
    var l = finalMatch.team1.id===finalMatch.winnerId ? finalMatch.team2 : finalMatch.team1
    rankings.push({rank:1,team:w,label:'冠军'})
    rankings.push({rank:2,team:l,label:'亚军'})
  }
  if(thirdMatch && thirdMatch.winnerId) {
    var w = thirdMatch.team1.id===thirdMatch.winnerId ? thirdMatch.team1 : thirdMatch.team2
    var l = thirdMatch.team1.id===thirdMatch.winnerId ? thirdMatch.team2 : thirdMatch.team1
    rankings.push({rank:3,team:w,label:'季军'})
    rankings.push({rank:4,team:l,label:'第四名'})
  }

  var revivalMatches = allMatches.filter(function(m){return m.stage==='revival'})
  var revivalTeams = []
  var teamIds = new Set()
  revivalMatches.forEach(function(m){
    if(m.team1&&!teamIds.has(m.team1.id)){teamIds.add(m.team1.id);revivalTeams.push(m.team1)}
    if(m.team2&&!teamIds.has(m.team2.id)){teamIds.add(m.team2.id);revivalTeams.push(m.team2)}
  })
  if(revivalTeams.length>0){
    var revStandings = calculateStandings(revivalMatches, revivalTeams)
    var qualifierId = nt.revivalQualifier ? nt.revivalQualifier.id : null
    var nonQualifiers = revStandings.filter(function(s){return s.id!==qualifierId})
    nonQualifiers.forEach(function(s,i){
      rankings.push({rank:5+i,team:{id:s.id,name:s.name,score:s.score},label:'第'+(5+i)+'名'})
    })
  }

  var rankingMatches = allMatches.filter(function(m){return m.stage==='ranking'})
  var rankingTeams = []
  var rIds = new Set()
  rankingMatches.forEach(function(m){
    if(m.team1&&!rIds.has(m.team1.id)){rIds.add(m.team1.id);rankingTeams.push(m.team1)}
    if(m.team2&&!rIds.has(m.team2.id)){rIds.add(m.team2.id);rankingTeams.push(m.team2)}
  })
  if(rankingTeams.length>0){
    var rkStandings = calculateStandings(rankingMatches, rankingTeams)
    rkStandings.forEach(function(s,i){
      rankings.push({rank:7+i,team:{id:s.id,name:s.name,score:s.score},label:'第'+(7+i)+'名'})
    })
  }

  rankings.sort(function(a,b){return a.rank-b.rank})
  return rankings
}

/* ===== Image Export ===== */
var IMG_THEMES = {
  light: {bg:'#F8FAFB',text:'#1A1D28',accent:'#6B8E23',sub:'#6B7280',border:'rgba(0,0,0,.06)',badge:'#8BCC26',badgeText:'#111',cardBg:'rgba(0,0,0,.02)',headerBg:'#8BCC26',headerText:'#111',tagBg:'rgba(173,255,47,.08)',tagText:'#5A7A1E'},
  green: {bg:'#F5FFE8',text:'#2D3A10',accent:'#6B8E23',sub:'#4B5563',border:'rgba(139,204,38,.08)',badge:'#8BCC26',badgeText:'#111',cardBg:'rgba(139,204,38,.03)',headerBg:'#8BCC26',headerText:'#111',tagBg:'rgba(139,204,38,.08)',tagText:'#5A7A1E'},
  dark:  {bg:'#0E1015',text:'#EAEDF3',accent:'#ADFF2F',sub:'rgba(255,255,255,.45)',border:'rgba(255,255,255,.06)',badge:'#ADFF2F',badgeText:'#111',cardBg:'rgba(255,255,255,.04)',headerBg:'#1A1D28',headerText:'#EAEDF3',tagBg:'rgba(173,255,47,.1)',tagText:'#CCFF66'},
  purple:{bg:'#0F0A1A',text:'#E8E0F0',accent:'#A78BFA',sub:'#7C6F96',border:'rgba(167,139,250,.1)',badge:'#A78BFA',badgeText:'#fff',cardBg:'rgba(167,139,250,.04)',headerBg:'#1E1530',headerText:'#E8E0F0',tagBg:'rgba(167,139,250,.08)',tagText:'#C4B5FD'}
}

function renderExportImage(title, bodyHtml, theme) {
  var th = IMG_THEMES[theme] || IMG_THEMES.light
  var container = document.createElement('div')
  container.style.cssText = 'position:fixed;left:-9999px;top:0;width:520px;padding:0;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI",Helvetica,Arial,sans-serif;color:'+th.text+';border-radius:20px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3);'
  var headerHtml = '<div style="background:'+th.headerBg+';padding:28px 32px 24px;position:relative;overflow:hidden">'
  headerHtml += '<div style="position:absolute;top:-30px;right:-30px;width:120px;height:120px;border-radius:50%;background:rgba(255,255,255,.1)"></div>'
  headerHtml += '<div style="position:absolute;bottom:-20px;left:-20px;width:80px;height:80px;border-radius:50%;background:rgba(255,255,255,.06)"></div>'
  headerHtml += '<div style="font-size:28px;margin-bottom:4px;position:relative;font-weight:900;color:'+th.headerText+'">TENNIS GO!</div>'
  headerHtml += '<div style="font-size:20px;font-weight:800;color:'+th.headerText+';position:relative;line-height:1.3">'+esc(title)+'</div>'
  headerHtml += '<div style="font-size:12px;color:rgba(255,255,255,.7);margin-top:8px;position:relative">'+formatTime(Date.now())+'</div>'
  headerHtml += '</div>'
  var bodyWrap = '<div style="background:'+th.bg+';padding:24px 28px 20px">'+bodyHtml+'</div>'
  var footer = '<div style="background:'+th.bg+';padding:12px 28px 18px;text-align:center;border-top:1px solid '+th.border+'"><div style="font-size:11px;color:'+th.sub+'">TENNIS GO!</div></div>'
  container.innerHTML = headerHtml + bodyWrap + footer
  document.body.appendChild(container)
  return { el: container, theme: th }
}

function captureAndDownload(el, filename, callback) {
  if (typeof html2canvas === 'undefined') {
    showToast('图片导出库加载中，请稍后再试')
    document.body.removeChild(el)
    return
  }
  html2canvas(el, {scale:2, backgroundColor:null, useCORS:true}).then(function(canvas) {
    document.body.removeChild(el)
    var link = document.createElement('a')
    link.download = filename
    link.href = canvas.toDataURL('image/png')
    link.click()
    if (callback) callback()
    showToast('图片已保存')
  }).catch(function() {
    document.body.removeChild(el)
    showToast('导出失败')
  })
}
