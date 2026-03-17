/* ========================================
   data.js — Storage, Algorithms, Utilities
   ======================================== */

/* ===== Firebase Cloud Sync ===== */
var _db = null
var _userId = null
var _firebaseReady = false

function getMyUserId() { return _userId || localStorage.getItem('tennis_uid') || null }

function isCreator(tournament) {
  if (!tournament) return false
  if (!tournament.creatorId) return true
  return tournament.creatorId === getMyUserId()
}

function _isFirebaseConfigured() {
  return typeof firebaseConfig !== 'undefined' && firebaseConfig && firebaseConfig.projectId && firebaseConfig.projectId !== '' && firebaseConfig.projectId !== 'YOUR_PROJECT_ID'
}

function initFirebase() {
  return new Promise(function (resolve) {
    if (typeof firebase === 'undefined' || !firebase.apps || !_isFirebaseConfigured()) { resolve(); return }
    try {
      firebase.initializeApp(firebaseConfig)
      _db = firebase.firestore()
      firebase.auth().signInAnonymously().then(function (result) {
        _userId = result.user.uid
        localStorage.setItem('tennis_uid', _userId)
        return _syncFromCloud()
      }).then(function () {
        _firebaseReady = true; resolve()
      }).catch(function () { resolve() })
    } catch (e) { resolve() }
  })
}

function _syncFromCloud() {
  if (!_db) return Promise.resolve()
  return _db.collection('tournaments').orderBy('createTime', 'desc').get().then(function (snapshot) {
    var cloudList = []
    snapshot.forEach(function (doc) { cloudList.push(doc.data()) })
    var localList = getTournaments()
    var cloudIds = {}; cloudList.forEach(function (t) { cloudIds[t.id] = true })
    localList.forEach(function (lt) {
      if (!cloudIds[lt.id]) {
        if (!lt.creatorId) lt.creatorId = getMyUserId()
        cloudList.unshift(lt)
        _pushToCloud(lt)
      }
    })
    cloudList.sort(function (a, b) { return (b.createTime || 0) - (a.createTime || 0) })
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cloudList))
  })
}

function _pushToCloud(tournament) {
  if (!_db || !tournament || !tournament.id) return
  try { _db.collection('tournaments').doc(tournament.id).set(JSON.parse(JSON.stringify(tournament))) } catch (e) {}
}

function _deleteFromCloud(id) {
  if (!_db || !id) return
  try { _db.collection('tournaments').doc(id).delete() } catch (e) {}
}

function refreshFromCloud() {
  if (!_db) return Promise.resolve()
  return _syncFromCloud()
}

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

function groupsToText(tournament) {
  var fl = {
    'round-robin':'单循环', 'group-knockout':'小组循环+淘汰赛',
    'single-knockout':'单循环+淘汰赛', 'nine-team':'9组大战赛'
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
  light: {bg:'linear-gradient(160deg,#FAFBFF 0%,#E8ECF4 50%,#F0F4F8 100%)',text:'#1A1A2E',accent:'#6C5CE7',sub:'#636E72',border:'rgba(108,92,231,.12)',badge:'linear-gradient(135deg,#6C5CE7,#A29BFE)',badgeText:'#fff',cardBg:'rgba(108,92,231,.04)',headerBg:'linear-gradient(135deg,#6C5CE7,#A29BFE)',headerText:'#fff',tagBg:'rgba(108,92,231,.1)',tagText:'#6C5CE7'},
  green: {bg:'linear-gradient(160deg,#E8F5E9 0%,#C8E6C9 50%,#A5D6A7 100%)',text:'#1B5E20',accent:'#2E7D32',sub:'#388E3C',border:'rgba(46,125,50,.15)',badge:'linear-gradient(135deg,#2E7D32,#4CAF50)',badgeText:'#fff',cardBg:'rgba(46,125,50,.05)',headerBg:'linear-gradient(135deg,#2E7D32,#43A047)',headerText:'#fff',tagBg:'rgba(46,125,50,.1)',tagText:'#2E7D32'},
  dark:  {bg:'linear-gradient(160deg,#0B0B1A 0%,#1A1A3E 50%,#12122A 100%)',text:'#EEEEFF',accent:'#9B7FFF',sub:'#8888AA',border:'rgba(155,127,255,.15)',badge:'linear-gradient(135deg,#7C5CFC,#9B7FFF)',badgeText:'#fff',cardBg:'rgba(155,127,255,.06)',headerBg:'linear-gradient(135deg,#7C5CFC,#9B7FFF)',headerText:'#fff',tagBg:'rgba(155,127,255,.12)',tagText:'#B8A4FF'},
  purple:{bg:'linear-gradient(160deg,#1A0B2E 0%,#2D1B69 40%,#16213E 100%)',text:'#F0E6FF',accent:'#BB86FC',sub:'#9575CD',border:'rgba(187,134,252,.15)',badge:'linear-gradient(135deg,#BB86FC,#E040FB)',badgeText:'#fff',cardBg:'rgba(187,134,252,.06)',headerBg:'linear-gradient(135deg,#BB86FC,#E040FB)',headerText:'#fff',tagBg:'rgba(187,134,252,.12)',tagText:'#CE93D8'}
}

function renderExportImage(title, bodyHtml, theme) {
  var th = IMG_THEMES[theme] || IMG_THEMES.light
  var container = document.createElement('div')
  container.style.cssText = 'position:fixed;left:-9999px;top:0;width:520px;padding:0;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI",Helvetica,Arial,sans-serif;color:'+th.text+';border-radius:20px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3);'
  var headerHtml = '<div style="background:'+th.headerBg+';padding:28px 32px 24px;position:relative;overflow:hidden">'
  headerHtml += '<div style="position:absolute;top:-30px;right:-30px;width:120px;height:120px;border-radius:50%;background:rgba(255,255,255,.1)"></div>'
  headerHtml += '<div style="position:absolute;bottom:-20px;left:-20px;width:80px;height:80px;border-radius:50%;background:rgba(255,255,255,.06)"></div>'
  headerHtml += '<div style="font-size:28px;margin-bottom:4px;position:relative;font-weight:900;color:'+th.headerText+'">🎾 TENNIS GO!</div>'
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
