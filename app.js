// SonicStage Pro PWA 0.12.0 - musically exact click scheduler
import { getMeterInfo, continuousClickEvents, isBeatStart, secondsPerQuarter } from './click-timing.js';
// Stage-first architecture: audio state lives outside the view, so changing tabs or opening drawers does not stop playback.

const NOTES = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const TIME_SIGNATURES = ['1/1','2/1','3/1','4/1','2/2','3/2','4/2','1/4','2/4','3/4','4/4','5/4','6/4','7/4','8/4','9/4','10/4','12/4','2/8','3/8','5/8','6/8','7/8','8/8','9/8','10/8','11/8','12/8','13/8','15/8','16/8','5/16','6/16','7/16','9/16','12/16','Custom'];
const SUBS = [
  ['quarter','1/4','Quarter'],
  ['eighth','1/8','Eighth'],
  ['sixteenth','1/16','Sixteenth'],
  ['thirty','1/32','Thirty-Second'],
  ['triplet','TRIPLET','Eighth-Note Triplet']
];
const DEFAULT_SUB = {quarter:100,eighth:72,sixteenth:48,thirty:30,triplet:44};
const DEFAULT_SETTINGS = {route:'STEREO',padHold:true,clickVol:82,padVol:72,master:82,clickPan:0,padPan:0,guideVol:78,guidePan:0,countIn:true,clickOn:true,showMeters:true,guideMuted:false,faderColors:{click:'#ef6464',guide:'#f0b35a',pad:'#27e38f',master:'#4dc9ff'}};
const COUNT_IDS = ['one','two','three','four','five','six','seven','eight'];
// No third-party audio is bundled. Click, pad, and count-in sounds are imported by the user and stored locally in IndexedDB.
const LEGACY_DEFAULT_TITLES = new Set(['House of Miracles','Battle Belongs','Champion','Never Lost','Promises','Graves Into Gardens','Way Maker','Goodness of God']);
const STORAGE = {
  songs:'ssp6-songs', sub:'ssp6-sub', padFiles:'ssp6-pad-files', clickFiles:'ssp6-click-files', countFiles:'ssp6-count-files', settings:'ssp6-settings'
};
const LEGACY = {
  songs:'ssp4-songs', sub:'ssp4-sub', padFiles:'ssp4-pad-files', clickFiles:'ssp4-click-files', settings:'ssp4-settings'
};

const clone = v => JSON.parse(JSON.stringify(v));
const escapeHtml = s => String(s ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const fmt = sec => { sec=Math.max(0,Math.floor(sec)); return `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`; };
const safeName = name => { const s=String(name||''); return s.length>31 ? `${s.slice(0,28)}…` : s; };
const readJSON = (key,fallback) => { try { const v=localStorage.getItem(key); return v ? JSON.parse(v) : clone(fallback); } catch { return clone(fallback); } };

function migrateSongs(){
  const existing = readJSON(STORAGE.songs, null);
  if(Array.isArray(existing)) return existing.filter(s => s && !LEGACY_DEFAULT_TITLES.has(String(s.title||'')));
  const legacy = readJSON(LEGACY.songs, []);
  if(!Array.isArray(legacy)) return [];
  return legacy.filter(s => s && !LEGACY_DEFAULT_TITLES.has(String(s.title||'')));
}
function mergeLegacy(key, fallback){
  const current=readJSON(key,null);
  if(current!==null) return current;
  return readJSON(LEGACY[key.replace('ssp6-','ssp4-')] || LEGACY[key],fallback);
}

const state = {
  screen:'performance', drawer:null, menu:false, editorSong:null, addSongOpen:false, padPlayerOpen:false, clickSubsOpen:false, chordsOpen:false,
  playing:false, starting:false, transitioning:false, countInBeat:null, songIndex:0, elapsed:0, clickOn:true,
  padKey:'C', padOn:true, muted:false, bpm:120, master:82, padVol:72,
  sub:mergeLegacy(STORAGE.sub,DEFAULT_SUB),
  songs:migrateSongs(),
  padFiles:mergeLegacy(STORAGE.padFiles,Object.fromEntries(NOTES.map(n=>[n,'DEFAULT']))),
  clickFiles:mergeLegacy(STORAGE.clickFiles,{quarter:'DEFAULT',eighth:'DEFAULT',sixteenth:'DEFAULT',thirty:'DEFAULT',triplet:'DEFAULT'}),
  countFiles:readJSON(STORAGE.countFiles,Object.fromEntries(COUNT_IDS.map(id=>[id,'DEFAULT']))),
  settings:{...DEFAULT_SETTINGS,...mergeLegacy(STORAGE.settings,DEFAULT_SETTINGS)},
  chordsBySong:readJSON('ssp6-chords',{}),
  setlistSavedAt:null
};
state.sub={...DEFAULT_SUB,...(state.sub||{})};
state.padFiles={...Object.fromEntries(NOTES.map(n=>[n,'DEFAULT'])),...(state.padFiles||{})};
state.clickFiles={quarter:'DEFAULT',eighth:'DEFAULT',sixteenth:'DEFAULT',thirty:'DEFAULT',triplet:'DEFAULT',...(state.clickFiles||{})};
state.countFiles={...Object.fromEntries(COUNT_IDS.map(id=>[id,'DEFAULT'])),...(state.countFiles||{})};
state.songs=Array.isArray(state.songs)?state.songs.map((s,i)=>({id:s.id||crypto.randomUUID(),title:s.title||`Song ${i+1}`,key:NOTES.includes(s.key)?s.key:'C',bpm:Number.isFinite(Number(s.bpm))?Number(s.bpm):120,timeSig:s.timeSig||'4/4',artName:s.artName||'',duration:Number.isFinite(Number(s.duration))?Number(s.duration):420})):[];
state.settings={...DEFAULT_SETTINGS,...state.settings,faderColors:{...DEFAULT_SETTINGS.faderColors,...(state.settings?.faderColors||{})}};
state.chordsBySong=state.chordsBySong&&typeof state.chordsBySong==='object'?state.chordsBySong:{};
state.songs=state.songs.map(s=>({...s,mix:{click:82,guide:78,pad:72,...(s.mix||{})}}));
state.clickOn=state.settings.clickOn!==false;
state.bpm=Number(state.songs[0]?.bpm||120); state.padKey=state.songs[0]?.key||'C';
if(state.songs[0]?.mix){state.settings.clickVol=Number(state.songs[0].mix.click);state.settings.guideVol=Number(state.songs[0].mix.guide);state.padVol=Number(state.songs[0].mix.pad);}

// Audio engine lives outside UI rendering and is never recreated on navigation.
let audioCtx=null, masterGain=null, padGain=null, clickGain=null, guideGain=null, padPan=null, clickPan=null, guidePan=null;
let schedulerTimer=0, clockTimer=0, nextClickTime=0, clickStep=0, clickBarIndex=0, clickEventIndex=0, transitionToken=0;
let guideReadyPromise=Promise.resolve();
const transitionTimers=new Set();
let dragFader=null;
let dbPromise=null;
const decodedCache=new Map();
const activePads=new Map();
const imageUrlCache=new Map();
let songStartWall=0, songStartAudioTime=0, toastTimer=0, lastMeterUpdate=0;

const $=(sel,root=document)=>root.querySelector(sel);
const $$=(sel,root=document)=>[...root.querySelectorAll(sel)];
const currentSong=()=>state.songs[state.songIndex]||null;
const currentMix=()=>currentSong()?.mix||{click:state.settings.clickVol,guide:state.settings.guideVol,pad:state.padVol};
function loadSongMix(){const m=currentMix();state.settings.clickVol=Number(m.click??82);state.settings.guideVol=Number(m.guide??78);state.padVol=Number(m.pad??72);if(audioCtx){setGain(clickGain,state.settings.clickVol);setGain(guideGain,state.settings.guideMuted?0:state.settings.guideVol);setGain(padGain,state.padVol);}}
function saveSongMix(){const s=currentSong();if(!s)return;s.mix={click:Number(state.settings.clickVol),guide:Number(state.settings.guideVol),pad:Number(state.padVol)};}
const timeSig=()=>currentSong()?.timeSig||'4/4';
const nowClock=()=>new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});

function persist(){
  localStorage.setItem(STORAGE.songs,JSON.stringify(state.songs));
  localStorage.setItem(STORAGE.sub,JSON.stringify(state.sub));
  localStorage.setItem(STORAGE.padFiles,JSON.stringify(state.padFiles));
  localStorage.setItem(STORAGE.clickFiles,JSON.stringify(state.clickFiles));
  localStorage.setItem(STORAGE.countFiles,JSON.stringify(state.countFiles));
  localStorage.setItem(STORAGE.settings,JSON.stringify({...state.settings,padVol:state.padVol,master:state.master,clickOn:state.clickOn,clickPan:state.settings.clickPan,padPan:state.settings.padPan}));
  localStorage.setItem('ssp6-chords',JSON.stringify(state.chordsBySong));
}

function dbOpen(){
  if(dbPromise)return dbPromise;
  dbPromise=new Promise((resolve,reject)=>{
    const req=indexedDB.open('SonicStageProAudio',7);
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('audio'))db.createObjectStore('audio');};
    req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
  });
  return dbPromise;
}
function dbPut(key,blob){return dbOpen().then(db=>new Promise((resolve,reject)=>{const tx=db.transaction('audio','readwrite');tx.objectStore('audio').put(blob,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);}));}
function dbGet(key){return dbOpen().then(db=>new Promise((resolve,reject)=>{const tx=db.transaction('audio','readonly');const req=tx.objectStore('audio').get(key);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);})).catch(()=>null);}
async function getAssetBlob(key){
  // Audio is intentionally local-only: no third-party samples are bundled or fetched.
  return dbGet(key);
}
async function decodeKey(key){
  if(decodedCache.has(key))return decodedCache.get(key);
  const blob=await getAssetBlob(key); if(!blob)return null;
  try{
    const ctx=ensureAudio();
    const buf=await ctx.decodeAudioData(await blob.arrayBuffer());
    decodedCache.set(key,buf);
    return buf;
  }catch{return null;}
}
async function prefetchSmallAssets(){
  // Nothing is downloaded at startup. User-imported audio is decoded on demand and cached in memory.
  return;
}
function faderToDb(v){ if(v<=0)return '-∞'; const db=-60+(Number(v)/100)*66; return `${db>=0?'+':''}${db.toFixed(1)} dB`; }
function faderGain(v){ if(v<=0)return 0; const db=-60+(Number(v)/100)*66; return Math.pow(10,db/20); }
function setGain(nodeOrParam,v){ if(!nodeOrParam||!audioCtx)return; const param=nodeOrParam.gain&&typeof nodeOrParam.gain.setTargetAtTime==='function'?nodeOrParam.gain:nodeOrParam; if(!param?.setTargetAtTime)return; param.setTargetAtTime(faderGain(v),audioCtx.currentTime,.012); }
function applyRouting(){
  if(!audioCtx||!padPan||!clickPan)return;
  const split=state.settings.route==='SPLIT L/R';
  const now=audioCtx.currentTime;
  const clickUser=Math.max(-1,Math.min(1,(Number(state.settings.clickPan)||0)/100));
  const padUser=Math.max(-1,Math.min(1,(Number(state.settings.padPan)||0)/100));
  // In split mode click starts toward R and pad toward L, while the on-screen pan
  // controls remain live for fine adjustment. Stereo mode uses the exact pan value.
  const clickValue=split?Math.max(-1,Math.min(1,0.5+0.5*clickUser)):clickUser;
  const padValue=split?Math.max(-1,Math.min(1,-0.5+0.5*padUser)):padUser;
  padPan.pan.setTargetAtTime(padValue,now,.01);
  clickPan.pan.setTargetAtTime(clickValue,now,.01);
  applyGuidePan();
}
function applyGuidePan(){
  if(!audioCtx||!guidePan)return;
  guidePan.pan.setTargetAtTime(Math.max(-1,Math.min(1,Number(state.settings.guidePan)||0)),audioCtx.currentTime,.012);
}

function ensureAudio(){
  if(!audioCtx){
    const Ctx=window.AudioContext||window.webkitAudioContext;
    if(!Ctx)throw new Error('Web Audio not available');
    audioCtx=new Ctx();
    masterGain=audioCtx.createGain();
    padGain=audioCtx.createGain();
    clickGain=audioCtx.createGain();
    guideGain=audioCtx.createGain();
    padPan=audioCtx.createStereoPanner();
    clickPan=audioCtx.createStereoPanner();
    guidePan=audioCtx.createStereoPanner();
    masterGain.gain.value=faderGain(state.master);
    padGain.gain.value=faderGain(state.padVol);
    clickGain.gain.value=faderGain(state.settings.clickVol);
    guideGain.gain.value=faderGain(state.settings.guideVol);
    padGain.connect(padPan).connect(masterGain);
    clickGain.connect(clickPan).connect(masterGain);
    guideGain.connect(guidePan).connect(masterGain);
    masterGain.connect(audioCtx.destination);
    applyRouting();
    applyGuidePan();
  }
  if(audioCtx.state==='suspended'){
    // Safe to call from the Play/Pad/count-in user gesture. Do not await.
    audioCtx.resume().catch(()=>{});
  }
  return audioCtx;
}
function keepAudioAlive(){
  if(!state.playing||!audioCtx)return;
  if(audioCtx.state==='suspended')audioCtx.resume().catch(()=>{});
}
function render(){
  const app=$('#app');
  const base=state.screen==='performance'?renderPerformance():state.screen==='setlists'?renderSetlists():state.screen==='library'?renderLibrary():renderSettings();
  app.innerHTML=`<div class="app">${renderTopbar()}${base}${state.menu?renderMenu():''}${state.drawer==='click'?renderClickDrawer():''}${state.addSongOpen?renderAddSongDrawer():''}${state.editorSong!==null?renderEditor():''}${state.padPlayerOpen?renderPadPlayer():''}<div id="toast-host"></div></div>`;
  bindUI();
  requestAnimationFrame(()=>{drawWaveform();hydrateArt();updateAllMeters();});
}

function renderTopbar(){
  const s=currentSong();
  return `<header class="topbar">
    <div class="brand"><span class="brand-mark">∿</span><span><b>SonicStage Pro</b><small>OFFLINE STAGE</small></span></div>
    <div class="transport">
      <div class="readout"><b>${nowClock()}</b><small>${escapeHtml(s?.timeSig||'—')}</small></div>
      <div class="readout"><b>${s?Number(state.bpm).toFixed(1):'—'}</b><small>BPM</small></div>
      <div class="readout timer"><b id="timer">${fmt(state.elapsed)}</b><small>${s?`0:00 / ${fmt(s.duration)}`:'NO SONG'}</small></div>
    </div>
    <button class="top-control ${state.padOn?'active':''}" data-action="toggle-pad">PAD</button>
    <button class="top-control" data-action="prev" ${state.songs.length<2?'disabled':''}>‹</button>
    <button class="top-control play-control ${state.playing?'playing':''}" data-action="play">${state.starting?'…':state.playing?'Ⅱ':'▶'}</button>
    <button class="top-control stop-control" data-action="stop">■</button>
    <div class="top-spacer"></div>
    <button class="top-control compact click-shortcut" data-action="click-drawer">CLICK <span>${Number(state.settings.clickVol)}%</span></button><button class="top-control compact" data-action="toggle-chords">CHORDS</button>
    <button class="top-control icon-only" data-action="menu">☰</button>
  </header>`;
}

function renderPerformance(){
  const s=currentSong(); const pct=s&&s.duration?Math.min(100,(state.elapsed/s.duration)*100):0;
  const railCards=state.songs.map((x,i)=>`<div class="song-card-wrap"><button class="song-card ${i===state.songIndex?'selected':''}" data-song="${i}">
    <div class="song-art" data-art-song="${escapeHtml(x.id)}"><span>${escapeHtml(x.artName||x.title.slice(0,18)||'SONG')}</span><span class="song-more" data-edit-song="${i}" title="Edit song">⋮</span></div>
    <div class="song-caption"><span class="now">${i===state.songIndex?'▶ ':''}</span>${escapeHtml(x.title)} <em>${escapeHtml(x.key)}</em><small>${Number(x.bpm).toFixed(0)} · ${escapeHtml(x.timeSig)}</small></div>
  </button></div>`).join('');
  const railExtras=state.playing?'':`<button class="song-card add-song-tile" data-action="open-add-song"><div class="add-song-art"><span>＋</span></div><div class="song-caption">ADD SONG<small>to this setlist</small></div></button>`;
  return `<main class="stage ${state.playing?'is-playing':''}">
    <section class="song-rail">
      <div class="rail-head"><span class="rail-label">CURRENT SETLIST</span><div class="rail-tools">${state.songs.length?`<span class="save-state">${state.setlistSavedAt?'SAVED':'LOCAL'}</span>`:''}</div></div>
      <div class="song-track" id="song-track">${state.songs.length?railCards:''}${railExtras}</div>
    </section>
    <section class="timeline">
      <div class="timeline-head"><span class="meter-chip">${escapeHtml(s?.timeSig||'—')}</span><strong>${escapeHtml(s?.title||'No song loaded')}</strong><span class="timeline-time" id="timeline-time">${fmt(state.elapsed)}</span></div>
      <div class="wave-wrap"><canvas id="waveform"></canvas><div class="playhead" id="playhead" style="left:${pct}%"></div><div class="wave-glow"></div></div>
    </section>
    <section class="console">
      ${renderFaderStrip('click','CLICK',state.settings.clickVol,'C',true)}
      ${renderFaderStrip('guide','GUIDE',state.settings.guideVol,'G',false)}
      <div class="main-console-center">
        <div class="center-status">
          <div class="center-song-status"><span class="eyebrow">STAGE CONSOLE</span><b>${escapeHtml(s?.title||'Add a song to begin')}</b><small>${s?`${escapeHtml(s.key)} · ${Number(state.bpm).toFixed(1)} BPM · ${escapeHtml(s.timeSig)}`:'Your setlist is empty'}</small></div>
          <div class="console-lanes">${renderLane('Click','sequenced',state.settings.clickVol,state.clickOn)}${renderLane('Guide','count-in bus',state.settings.guideVol,!state.settings.guideMuted)}${renderLane('Pad',state.padKey,state.padVol,state.padOn&&!state.muted)}</div>
        </div>
      </div>
      ${renderPadDeck()}
      ${renderFaderStrip('master','MASTER',state.master,'M',false,true)}
    </section>
    ${state.clickSubsOpen?renderSubfaderDock():''}
    ${state.transitioning?`<div class="count-in"><span>COUNT-IN</span><strong>${escapeHtml(String(state.countInBeat??''))}</strong></div>`:''}
    ${state.chordsOpen?renderChordPanel():''}
  </main>`;
}
function renderLane(title,sub,value,on){return `<div class="lane"><span class="lane-dot ${on?'on':''}"></span><div><b>${escapeHtml(title)}</b><small>${escapeHtml(sub)}</small></div><output>${faderToDb(value)}</output></div>`;}
function panLabel(v){const n=Number(v)||0;return n===0?'C':`${n<0?'L ':'R '}${Math.abs(n)}`;}
function renderPanControl(type,value,label){return `<div class="strip-pan" data-pan-wrap="${type}"><span>PAN</span><input type="range" min="-100" max="100" value="${Number(value)||0}" data-pan="${type}" aria-label="${label} pan"><output data-pan-output="${type}">${panLabel(value)}</output></div>`;}
function renderFaderStrip(type,label,value,letter,hasSub=false,routeStrip=false){
  const action=type==='click'?'toggle-click':type==='pad'?'mute-pad':type==='guide'?'mute-guide':'noop';
  const actionLabel=type==='click'?'M':type==='pad'?'M':type==='guide'?'M':'○';
  const panValue=type==='click'?state.settings.clickPan:type==='pad'?state.settings.padPan:type==='guide'?state.settings.guidePan:0;
  const color=state.settings.faderColors?.[type]||DEFAULT_SETTINGS.faderColors.master;
  return `<aside class="fader-strip ${hasSub&&state.clickSubsOpen?'has-sub-open':''}" data-channel="${type}" style="--fader-color:${color}">
    <div class="strip-head"><span>${letter}</span><b>${label}</b></div>
    <div class="meter-rail">${Array.from({length:12},(_,i)=>`<i data-meter-seg="${12-i}"></i>`).join('')}</div>
    <div class="fader-body" data-fader-track="${type}" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value}" aria-label="${label} volume"><div class="scale"><span>+6</span><span>0</span><span>-10</span><span>-20</span><span>-40</span><span>-∞</span></div><div class="fader-rail"></div><div class="fader-active" style="height:${value}%"></div><input class="fader-native" type="range" min="0" max="100" value="${value}" data-fader="${type}" aria-label="${label} volume" tabindex="-1"><div class="fader-cap" style="bottom:calc(${value}% - 4px)"></div></div>
    <div class="strip-readout"><output data-fader-output="${type}">${faderToDb(value)}</output></div>
    ${type!=='master'?renderPanControl(type,panValue,label):`<div class="route-chip">${escapeHtml(state.settings.route)}</div>`}
    <div class="strip-buttons"><button class="strip-mini ${type==='click'?'accent':''}" data-action="${action}">${actionLabel}</button>${hasSub?`<button class="strip-mini" data-action="toggle-click-subs">SUB</button>`:''}</div>
    <span class="strip-label">${label}</span>
  </aside>`;
}
function renderSubfaderDock(){
  return `<div class="subfader-dock" data-subdock><div class="subdock-head"><div><b>CLICK SEQUENCE</b><small>Independent note subdivision levels</small></div><button data-action="toggle-click-subs">×</button></div><div class="subfader-grid">${SUBS.map(([id,label,name])=>`<div class="subfader" data-sub="${id}"><b>${label}</b><div class="mini-fader" data-sub-track="${id}" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${state.sub[id]}" aria-label="${name} volume"><div class="mini-rail"></div><div class="mini-active" style="height:${state.sub[id]}%"></div><input class="fader-native" type="range" min="0" max="100" value="${state.sub[id]}" data-sub="${id}" tabindex="-1"><div class="mini-cap" style="bottom:calc(${state.sub[id]}% - 5px)"></div></div><output>${state.sub[id]}%</output></div>`).join('')}</div><button class="subdock-full" data-action="click-drawer">OPEN CLICK MIXER</button></div>`;
}

function renderPadDeck(){return `<section class=\"pad-deck-inline\" data-channel=\"pad-deck\" style=\"--fader-color:${state.settings.faderColors?.pad||DEFAULT_SETTINGS.faderColors.pad}\"><div class=\"pad-deck-head\"><b>PAD PLAYER</b><span>${state.padOn?'ON':'OFF'} · ${state.padKey}</span><button data-action=\"open-pad-player\">OPEN</button></div><div class=\"pad-deck-body\"><div class=\"pad-deck-fader\">${renderMiniFader('pad',state.padVol,'PAD')}</div><div class=\"pad-deck-grid\">${NOTES.map(n=>`<button class=\"pad-deck-key ${state.padKey===n?'selected':''} ${activePads.has(n)?'active':''}\" data-pad=\"${n}\"><b>${n}</b></button>`).join('')}</div></div></section>`;}
function renderPadPlayer(){
  const current=state.padFiles[state.padKey];
  return `<div class="pad-overlay" data-pad-overlay data-pad-overlay-root><section class="pad-panel">
    <div class="pad-panel-head"><div><span class="eyebrow">PAD PLAYER</span><h2>Fundamental Ambient Pad</h2><small>${safeName(current&&current!=='DEFAULT'?current:'No custom sound — fallback tone available')}</small></div><div class="pad-panel-actions"><button class="panel-toggle ${state.padOn?'active':''}" data-action="toggle-pad">${state.padOn?'PAD ON':'PAD OFF'}</button><button class="panel-toggle ${state.muted?'active':''}" data-action="mute-pad">${state.muted?'MUTED':'MUTE MIDI'}</button><button class="panel-toggle ${state.settings.padHold?'active':''}" data-action="toggle-hold">${state.settings.padHold?'∞ HOLD':'ONE SHOT'}</button><button class="panel-close" data-action="close-pad-player">×</button></div></div>
    <div class="pad-panel-body"><div class="pad-mini-fader">${renderMiniFader('pad',state.padVol,'PAD')}</div><div class="pad-keyboard"><div class="key-row">${NOTES.slice(0,6).map(n=>renderPadKey(n)).join('')}</div><div class="key-row">${NOTES.slice(6).map(n=>renderPadKey(n)).join('')}</div></div></div>
    <div class="pad-panel-foot"><span>${state.padKey} selected</span><span>Tap a key to change the pad. ${state.settings.padHold?'Held keys loop until tapped again.':'One-shot mode plays once.'}</span><button data-action="retrigger">RETRIGGER</button></div>
  </section></div>`;
}
function renderPadKey(note){return `<button class="big-pad-key ${state.padKey===note?'selected':''} ${activePads.has(note)?'active':''}" data-pad="${note}"><strong>${note}</strong><small>${safeName(state.padFiles[note]&&state.padFiles[note]!=='DEFAULT'?state.padFiles[note]:'DEFAULT')}</small></button>`;}
function renderMiniFader(type,value,label){const color=state.settings.faderColors?.[type]||DEFAULT_SETTINGS.faderColors.pad;return `<div class="mini-side-strip" style="--fader-color:${color}"><b>${label}</b><div class="mini-fader-body" data-fader-track="${type}" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value}" aria-label="${label} volume"><div class="mini-rail"></div><div class="mini-active" style="height:${value}%"></div><input type="range" min="0" max="100" value="${value}" data-fader="${type}" tabindex="-1"><div class="mini-cap" style="bottom:calc(${value}% - 5px)"></div></div><output data-fader-output="${type}">${faderToDb(value)}</output></div>`;}

function renderSetlists(){
  return `<main class="secondary"><div class="secondary-head"><div><span class="eyebrow">SETLIST</span><h1>Service Setlist</h1><p>No preset songs are installed. Build your own setlist and save it locally.</p></div><div class="head-actions"><button class="secondary-btn primary" data-action="open-add-song">＋ ADD SONG</button><button class="secondary-btn" data-action="save-setlist">SAVE SETLIST</button></div></div>
  <div class="setlist-board">${state.songs.length?state.songs.map((s,i)=>`<article class="setlist-row ${i===state.songIndex?'current':''}"><button class="setlist-main" data-song="${i}"><span>${String(i+1).padStart(2,'0')}</span><div><b>${escapeHtml(s.title)}</b><small>${escapeHtml(s.key)} · ${Number(s.bpm).toFixed(1)} BPM · ${escapeHtml(s.timeSig)}</small></div></button></article>`).join(''):`<div class="empty-state"><b>Your setlist is empty.</b><span>Add a song from the Performance screen or here.</span><button data-action="open-add-song">＋ ADD FIRST SONG</button></div>`}</div></main>`;
}
function renderAddSongDrawer(){
  return `<div class="overlay" data-close-overlay="1"><aside class="drawer add-drawer"><div class="drawer-head"><div><span class="eyebrow">SETLIST</span><h2>Add a Song</h2><small>Choose an existing locally saved song or create a new one.</small></div><button data-action="close-add-song">×</button></div><div class="drawer-body"><label class="search-box"><span>⌕</span><input id="song-search" placeholder="Search saved songs…"></label><button class="new-song-card" data-action="create-song"><span>＋</span><div><b>New Song</b><small>Title, key, BPM, time signature and artwork</small></div></button><div class="drawer-section"><h3>SAVED SONGS</h3><div class="add-library" id="add-library">${state.songs.length?state.songs.map((s,i)=>`<div class="add-library-row" data-library-title="${escapeHtml(s.title.toLowerCase())}"><div class="mini-art" data-art-song="${escapeHtml(s.id)}"><span>${escapeHtml(s.title.slice(0,10))}</span></div><div><b>${escapeHtml(s.title)}</b><small>${escapeHtml(s.key)} · ${Number(s.bpm).toFixed(1)} BPM · ${escapeHtml(s.timeSig)}</small></div><button data-choose-song="${i}">ADD</button></div>`).join(''):`<div class="drawer-empty">No saved songs yet.</div>`}</div></div></div></aside></div>`;
}
function renderEditor(){
  const s=state.songs[state.editorSong]; if(!s)return '';
  const isPresetCustom = s.artName||'';
  return `<div class="overlay"><aside class="drawer editor"><div class="drawer-head"><div><span class="eyebrow">SONG SETUP</span><h2>${state.editorSong<state.songs.length?'Edit Song':'New Song'}</h2><small>Song-specific settings are stored on this device.</small></div><button data-action="close-editor">×</button></div><div class="drawer-body"><div class="editor-art-block"><div class="editor-art" data-editor-art><span>${escapeHtml(s.title.slice(0,16))}</span></div><label class="file-pick">CHANGE ARTWORK<input id="edit-art" type="file" accept="image/*"></label><small>${safeName(isPresetCustom||'No artwork selected')}</small></div><div class="editor-grid"><label>TITLE<input id="edit-title" value="${escapeHtml(s.title)}"></label><label>KEY<select id="edit-key">${NOTES.map(n=>`<option ${n===s.key?'selected':''}>${n}</option>`).join('')}</select></label><label>BPM<input id="edit-bpm" type="number" min="20" max="400" step="0.1" value="${Number(s.bpm)}"></label><label>TIME SIGNATURE<select id="edit-time-sig">${TIME_SIGNATURES.filter(x=>x!=='Custom').map(x=>`<option ${x===s.timeSig?'selected':''}>${x}</option>`).join('')}<option value="Custom" ${TIME_SIGNATURES.includes(s.timeSig)?'':'selected'}>Custom</option></select></label><label id="custom-ts-wrap" class="${TIME_SIGNATURES.includes(s.timeSig)?'hidden':''}">CUSTOM<input id="edit-custom-ts" value="${escapeHtml(TIME_SIGNATURES.includes(s.timeSig)?'':s.timeSig)}" placeholder="e.g. 13/8"></label></div><div class="editor-actions"><button class="save" data-action="save-editor">SAVE SONG</button><button data-action="delete-song">DELETE</button></div></div></aside></div>`;
}
function renderClickDrawer(){
  return `<div class="overlay" data-close-overlay="1"><aside class="drawer click-drawer"><div class="drawer-head"><div><span class="eyebrow">CLICK ENGINE</span><h2>Click Sequence Mixer</h2><small>${escapeHtml(timeSig())} · ${Number(state.bpm).toFixed(1)} BPM</small></div><button data-action="close-drawer">×</button></div><div class="drawer-body"><div class="click-master-row"><div><b>CLICK MASTER</b><small>Main performance fader</small></div><output>${faderToDb(state.settings.clickVol)}</output><input type="range" min="0" max="100" value="${state.settings.clickVol}" data-fader="click"><button class="drawer-test" data-click-preview="quarter">TEST</button></div>${SUBS.map(([id,label,name])=>`<div class="mix-row"><div><b>${label}</b><small>${name}</small></div><button data-click-preview="${id}">♪</button><input type="range" min="0" max="100" value="${state.sub[id]}" data-sub="${id}"><output>${state.sub[id]}%</output><label class="tiny-file">SOUND<input type="file" accept="audio/*" data-upload-file="click:${id}"></label></div>`).join('')}<div class="drawer-section"><h3>COUNT-IN</h3><div class="count-row"><label>ENABLE COUNT-IN<input type="checkbox" id="count-in-toggle" ${state.settings.countIn?'checked':''}></label></div>${COUNT_IDS.map(id=>`<div class="file-line"><span>${id.toUpperCase()}</span><label>${safeName(state.countFiles[id]&&state.countFiles[id]!=='DEFAULT'?state.countFiles[id]:'Choose audio…')}<input type="file" accept="audio/*" data-upload-file="count:${id}"></label></div>`).join('')}<small class="helper">4/4 uses the live pattern 1 · 2 · 1 · 2 · 3 · 4. Other meters adapt to their beat unit.</small></div><div class="drawer-section guide-track-section"><h3>GUIDE TRACK — COUNT-IN BUS</h3><div class="guide-controls"><div class="guide-control"><span>VOLUME</span><input type="range" min="0" max="100" value="${state.settings.guideVol}" data-guide-vol><output>${state.settings.guideVol}%</output></div><div class="guide-control"><span>PAN</span><input type="range" min="-100" max="100" value="${state.settings.guidePan}" data-guide-pan><output>${Number(state.settings.guidePan)>0?'R ':Number(state.settings.guidePan)<0?'L ':''}${Math.abs(Number(state.settings.guidePan))}%</output></div></div><div class="guide-route-note">Count-in voice audio is routed through this dedicated bus. Guide volume and pan are independent of Click Master.</div></div><div class="drawer-section"><h3>OUTPUT</h3><button class="route-button" data-action="route">${state.settings.route==='STEREO'?'STEREO OUT':'SPLIT L / R'}</button></div></div></aside></div>`;
}
function renderLibrary(){
  return `<main class="secondary"><div class="secondary-head"><div><span class="eyebrow">AUDIO LIBRARY</span><h1>Stage Sounds</h1><p>Audio stays local in IndexedDB. Nothing here requires a cloud account.</p></div></div><div class="library-grid"><section class="card"><h3>Click Sounds</h3>${SUBS.map(([id,label,name])=>`<div class="file-line"><span>${label} ${name}</span><label>${safeName(state.clickFiles[id]&&state.clickFiles[id]!=='DEFAULT'?state.clickFiles[id]:'Choose audio…')}<input type="file" accept="audio/*" data-upload-file="click:${id}"></label></div>`).join('')}</section><section class="card"><h3>12-Key Ambient Pad</h3>${NOTES.map(n=>`<div class="file-line"><span>${n}</span><label>${safeName(state.padFiles[n]&&state.padFiles[n]!=='DEFAULT'?state.padFiles[n]:'Choose audio…')}<input type="file" accept="audio/*" data-upload-file="pad:${n}"></label></div>`).join('')}</section><section class="card"><h3>Count-In Numbers</h3>${COUNT_IDS.map(id=>`<div class="file-line"><span>${id.toUpperCase()}</span><label>${safeName(state.countFiles[id]&&state.countFiles[id]!=='DEFAULT'?state.countFiles[id]:'Choose audio…')}<input type="file" accept="audio/*" data-upload-file="count:${id}"></label></div>`).join('')}</section></div></main>`;
}
function renderSettings(){
  const fc=state.settings.faderColors||DEFAULT_SETTINGS.faderColors;
  return `<main class="secondary settings-page"><div class="secondary-head"><div><span class="eyebrow">SETTINGS</span><h1>Performance Setup</h1><p>All stage controls and local assignments live here.</p></div></div><div class="settings-grid settings-all">
    <section class="card"><h3>PERFORMANCE CONTROLS</h3><div class="settings-button-row"><button class="secondary-btn primary" data-action="save-setlist">SAVE SETLIST</button><button class="secondary-btn" data-action="click-drawer">CLICK ${Number(state.settings.clickVol)}%</button><button class="secondary-btn" data-action="route">${state.settings.route==='STEREO'?'STEREO OUT':'SPLIT L / R'}</button></div><div class="setting"><b>Current song</b><span>${escapeHtml(currentSong()?.title||'No song selected')} · ${currentSong()?`${escapeHtml(currentSong().key)} · ${Number(currentSong().bpm).toFixed(1)} BPM · ${escapeHtml(currentSong().timeSig)}`:'Add a song from Setlist'}</span></div></section>
    <section class="card"><h3>AUDIO & PAD</h3><div class="setting"><b>Pad startup</b><span>${state.padOn?'PAD is armed. Pressing Play starts the selected song key automatically.':'PAD is off.'}</span></div><div class="settings-button-row"><button class="secondary-btn ${state.padOn?'primary':''}" data-action="toggle-pad">${state.padOn?'PAD ON':'PAD OFF'}</button><button class="secondary-btn ${state.settings.padHold?'primary':''}" data-action="toggle-hold">${state.settings.padHold?'HOLD / LOOP':'ONE SHOT'}</button></div><div class="setting"><b>Count-in</b><span>${state.settings.countIn?'Enabled':'Disabled'}</span><label class="setting-check"><input type="checkbox" id="settings-count-in" ${state.settings.countIn?'checked':''}> Enable count-in</label></div></section>
    <section class="card"><h3>FADER COLORS</h3><div class="color-grid">${[['click','CLICK'],['guide','GUIDE'],['pad','PAD'],['master','MASTER']].map(([id,label])=>`<label><span>${label}</span><input type="color" value="${fc[id]}" data-fader-color="${id}"></label>`).join('')}</div><small class="helper">Colors are stored locally and remain associated with the channel.</small></section>
    <section class="card"><h3>GUIDE BUS</h3><div class="setting"><b>Volume</b><span>${Number(state.settings.guideVol)}%</span></div><div class="setting"><b>Pan</b><span>${panLabel(state.settings.guidePan)}</span></div><div class="settings-button-row"><button class="secondary-btn ${state.settings.guideMuted?'':'primary'}" data-action="mute-guide">${state.settings.guideMuted?'GUIDE MUTED':'GUIDE ACTIVE'}</button></div></section>
    <section class="card"><h3>CLICK SEQUENCE</h3><div class="setting"><b>Subdivisions</b><span>1/4 · 1/8 · 1/16 · 1/32 · Triplet</span></div><div class="settings-button-row"><button class="secondary-btn" data-action="click-drawer">OPEN CLICK MIXER</button></div></section>
    <section class="card"><h3>OFFLINE AUDIO LIBRARY</h3><div class="setting"><b>Click / guide / pad sounds</b><span>Import your own sounds here. Audio is stored locally on this device; no third-party audio is bundled with SonicStage.</span></div><div class="settings-button-row"><button class="secondary-btn" data-screen="library" data-action="screen">OPEN AUDIO LIBRARY</button></div></section>
    <section class="card"><h3>CHORD SHEETS / DOCS</h3><div class="setting"><b>Song</b><span>${state.chordsBySong[currentSong()?.id]?.name?escapeHtml(state.chordsBySong[currentSong().id].name):'No chord document attached'}</span></div><label class="file-pick">UPLOAD CHORD DOC<input id="settings-chord-file" type="file" accept=".txt,.text,.md,.html,.htm,.docx,.doc"></label><div class="chord-preview">${escapeHtml(state.chordsBySong[currentSong()?.id]?.text||'Upload a text/HTML chord sheet. The imported text is saved locally and can be viewed from the Chords button.')}</div></section>
    <section class="card"><h3>SOUND ASSIGNMENTS</h3><div class="assignment-block"><b>CLICK</b>${SUBS.map(([id,label])=>`<label class="assignment-line"><span>${label}</span><span>${safeName(state.clickFiles[id]&&state.clickFiles[id]!=='DEFAULT'?state.clickFiles[id]:'Not assigned — fallback tone')}</span><input type="file" accept="audio/*" data-upload-file="click:${id}"></label>`).join('')}</div><div class="assignment-block"><b>PAD KEYS</b><div class="assignment-pad-grid">${NOTES.map(n=>`<label class="assignment-line"><span>${n}</span><span>${safeName(state.padFiles[n]&&state.padFiles[n]!=='DEFAULT'?state.padFiles[n]:'Not assigned — fallback tone')}</span><input type="file" accept="audio/*" data-upload-file="pad:${n}"></label>`).join('')}</div></div><div class="assignment-block"><b>COUNT-IN / GUIDE</b>${COUNT_IDS.map(id=>`<label class="assignment-line"><span>${id.toUpperCase()}</span><span>${safeName(state.countFiles[id]&&state.countFiles[id]!=='DEFAULT'?state.countFiles[id]:'Not assigned — fallback tone')}</span><input type="file" accept="audio/*" data-upload-file="count:${id}"></label>`).join('')}</div></section>
    <section class="card"><h3>STORAGE</h3><div class="setting"><b>Setlist</b><span>${state.songs.length} saved song${state.songs.length===1?'':'s'}.</span></div><div class="setting"><b>Per-song faders</b><span>Click, Guide and Pad levels are stored separately for each song.</span></div><div class="setting"><b>Offline</b><span>Metadata uses local storage; imported audio and artwork use IndexedDB.</span></div></section>
  </div></main>`;
}
function renderMenu(){
  return `<div class="menu-panel" data-menu-panel><div class="menu-brand">SONICSTAGE PRO</div>${[['performance','Performance'],['setlists','Setlist'],['library','Audio Library'],['settings','Settings']].map(([id,label])=>`<button class="menu-item ${state.screen===id?'active':''}" data-screen="${id}" data-action="screen">${label}</button>`).join('')}</div>`;
}

function bindUI(){
  $$('[data-action]').forEach(el=>el.addEventListener('click',e=>handleAction(el.dataset.action,el,e)));
  $$('[data-song]').forEach(el=>el.addEventListener('click',()=>selectSong(Number(el.dataset.song))));
  $$('[data-edit-song]').forEach(el=>el.addEventListener('click',e=>{e.stopPropagation();state.editorSong=Number(el.dataset.editSong);render();}));
  $$('[data-choose-song]').forEach(el=>el.addEventListener('click',()=>chooseExistingSong(Number(el.dataset.chooseSong))));
  $$('[data-pad]').forEach(el=>el.addEventListener('pointerdown',e=>{e.preventDefault();selectPad(el.dataset.pad);}));
  $$('[data-fader]').forEach(el=>el.addEventListener('input',()=>updateFader(el.dataset.fader,Number(el.value))));
  $$('[data-sub]').filter(el=>el.tagName==='INPUT').forEach(el=>el.addEventListener('input',()=>updateSub(el.dataset.sub,Number(el.value))));
  $$('[data-pan]').forEach(el=>el.addEventListener('input',()=>updatePan(el.dataset.pan,Number(el.value))));
  bindCustomFaders();
  $('[data-guide-vol]')?.addEventListener('input',e=>updateGuideVolume(Number(e.target.value)));
  $('[data-guide-pan]')?.addEventListener('input',e=>updateGuidePan(Number(e.target.value)));
  $$('[data-upload-file]').forEach(el=>el.addEventListener('change',()=>{if(el.files?.[0]){const [type,id]=el.dataset.uploadFile.split(':');storeAsset(type,id,el.files[0]);}}));
  $$('[data-click-preview]').forEach(el=>el.addEventListener('click',()=>previewClick(el.dataset.clickPreview)));
  $('#song-search')?.addEventListener('input',e=>filterSongLibrary(e.target.value));
  $('#edit-time-sig')?.addEventListener('change',()=>$('#custom-ts-wrap')?.classList.toggle('hidden',$('#edit-time-sig').value!=='Custom'));
  $('#edit-art')?.addEventListener('change',e=>previewEditorArt(e.target.files?.[0]));
  $('#count-in-toggle')?.addEventListener('change',e=>{state.settings.countIn=e.target.checked;persist();});
  $('#settings-count-in')?.addEventListener('change',e=>{state.settings.countIn=e.target.checked;persist();});
  $$('[data-fader-color]').forEach(el=>el.addEventListener('input',e=>{state.settings.faderColors[e.target.dataset.faderColor]=e.target.value;persist();render();}));
  $('#settings-chord-file')?.addEventListener('change',e=>{if(e.target.files?.[0])importChordFile(e.target.files[0]);});
  $$('[data-close-overlay="1"]').forEach(el=>el.addEventListener('click',e=>{if(e.target.dataset.closeOverlay==='1'){state.drawer=null;state.addSongOpen=false;state.padPlayerOpen=false;render();}}));
  if(state.menu)document.addEventListener('click',closeMenuOnOutside,{once:true});
  $('[data-pad-overlay-root]')?.addEventListener('click',e=>{if(e.target.dataset.padOverlayRoot!==undefined){state.padPlayerOpen=false;render();}});
}
function pointerValueFromTrack(track,clientY){
  const r=track.getBoundingClientRect();
  const inset=Math.min(8,Math.max(2,r.height*.03));
  const usable=Math.max(1,r.height-inset*2);
  const y=Math.max(inset,Math.min(r.height-inset,clientY-r.top));
  return Math.round((1-(y-inset)/usable)*100);
}
function bindCustomFaders(){
  $$('[data-fader-track], [data-sub-track]').forEach(track=>{
    if(track.dataset.bound==='1')return;
    track.dataset.bound='1';
    const kind=track.matches('[data-sub-track]')?'sub':'main';
    const type=kind==='sub'?track.dataset.subTrack:track.dataset.faderTrack;
    const apply=e=>{
      e.preventDefault();
      const value=pointerValueFromTrack(track,e.clientY);
      if(kind==='sub')updateSub(type,value); else updateFader(type,value);
    };
    track.addEventListener('pointerdown',e=>{
      if(e.button!==undefined && e.button!==0 && e.pointerType!=='touch')return;
      try{track.setPointerCapture(e.pointerId);}catch{}
      track.classList.add('dragging');
      apply(e);
    },{passive:false});
    track.addEventListener('pointermove',e=>{if(track.hasPointerCapture?.(e.pointerId))apply(e);},{passive:false});
    const end=e=>{try{if(track.hasPointerCapture?.(e.pointerId))track.releasePointerCapture(e.pointerId);}catch{}track.classList.remove('dragging');};
    track.addEventListener('pointerup',end);
    track.addEventListener('pointercancel',end);
    track.addEventListener('keydown',e=>{
      let v=kind==='sub'?Number(state.sub[type]||0):(type==='click'?Number(state.settings.clickVol):type==='pad'?Number(state.padVol):type==='guide'?Number(state.settings.guideVol):Number(state.master));
      if(e.key==='ArrowUp'||e.key==='ArrowRight')v+=2;
      else if(e.key==='ArrowDown'||e.key==='ArrowLeft')v-=2;
      else if(e.key==='PageUp')v+=10;
      else if(e.key==='PageDown')v-=10;
      else if(e.key==='Home')v=0;
      else if(e.key==='End')v=100;
      else return;
      e.preventDefault();
      if(kind==='sub')updateSub(type,Math.max(0,Math.min(100,v)));else updateFader(type,Math.max(0,Math.min(100,v)));
    });
  });
}

function updateGuideVolume(v){const value=Math.max(0,Math.min(100,v));state.settings.guideVol=value;saveSongMix();if(guideGain)setGain(guideGain,state.settings.guideMuted?0:value);persist();const out=document.querySelector('[data-guide-vol-out]')||$('[data-guide-vol]')?.nextElementSibling;if(out)out.textContent=`${value}%`;const input=$('[data-guide-vol]');if(input)input.value=value;}
function updateGuidePan(v){const value=Math.max(-100,Math.min(100,v));state.settings.guidePan=value;applyGuidePan();persist();const out=document.querySelector('[data-guide-pan-out]')||$('[data-guide-pan]')?.nextElementSibling;if(out)out.textContent=panLabel(value);const input=$('[data-guide-pan]');if(input)input.value=value;}
function updatePan(type,v){const value=Math.max(-100,Math.min(100,Number(v)||0));if(type==='click')state.settings.clickPan=value;else if(type==='pad')state.settings.padPan=value;else if(type==='guide')state.settings.guidePan=value;else return;persist();if(audioCtx)applyRouting();const input=$(`[data-pan="${type}"]`);if(input)input.value=value;const out=$(`[data-pan-output="${type}"]`);if(out)out.textContent=panLabel(value);}
function closeMenuOnOutside(e){if(!e.target.closest('[data-menu-panel]')&&!e.target.closest('[data-action="menu"]')){state.menu=false;render();}}
function handleAction(action,el){
  switch(action){
    case 'play': togglePlay(); break;
    case 'stop': stopPlayback(); break;
    case 'prev': if(state.songs.length)transitionOrSelect(Math.max(0,state.songIndex-1)); break;
    case 'toggle-pad': state.padOn=!state.padOn; if(!state.padOn)stopAllPads(); else if(state.playing)startPad(state.padKey); ensureAudio(); render(); break;
    case 'mute-pad': state.muted=!state.muted; if(state.muted)stopAllPads(); else if(state.playing)startPad(state.padKey); render(); break;
    case 'mute-guide': state.settings.guideMuted=!state.settings.guideMuted; setGain(guideGain,state.settings.guideMuted?0:state.settings.guideVol); persist(); render(); break;
    case 'toggle-hold': state.settings.padHold=!state.settings.padHold; if(!state.settings.padHold)activePads.forEach((_,n)=>stopPad(n)); persist(); render(); break;
    case 'retrigger': stopPad(state.padKey); startPad(state.padKey); break;
    case 'open-pad-player': state.padPlayerOpen=true; render(); break;
    case 'close-pad-player': state.padPlayerOpen=false; render(); break;
    case 'click-drawer': state.drawer='click'; state.menu=false; render(); break;
    case 'toggle-click-subs': state.clickSubsOpen=!state.clickSubsOpen; render(); break;
    case 'close-drawer': state.drawer=null; render(); break;
    case 'route': state.settings.route=state.settings.route==='STEREO'?'SPLIT L/R':'STEREO'; persist(); if(audioCtx)applyRouting(); render(); break;
    case 'menu': state.menu=!state.menu; render(); break;
    case 'screen': state.screen=el.dataset.screen; state.menu=false; state.drawer=null; state.addSongOpen=false; state.editorSong=null; state.padPlayerOpen=false; keepAudioAlive(); render(); break;
    case 'open-add-song': if(!state.playing){state.addSongOpen=true;render();} break;
    case 'close-add-song': state.addSongOpen=false; render(); break;
    case 'create-song': state.addSongOpen=false; createSong(); break;
    case 'edit-current': if(currentSong()){state.editorSong=state.songIndex;render();} break;
    case 'close-editor': state.editorSong=null; render(); break;
    case 'save-editor': saveEditor(); break;
    case 'delete-song': deleteSong(); break;
    case 'save-setlist': saveSetlist(); break;
    case 'toggle-chords': state.chordsOpen=!state.chordsOpen; render(); break;
    case 'toggle-click': state.clickOn=!state.clickOn; state.settings.clickOn=state.clickOn; persist(); render(); break;
    case 'noop': break;
  }
}
function saveSetlist(){persist();state.setlistSavedAt=Date.now();toast('Setlist saved locally');render();}
function createSong(){
  const s={id:crypto.randomUUID(),title:`New Song ${state.songs.length+1}`,key:'C',bpm:120,timeSig:'4/4',artName:'',duration:420};
  state.songs.push(s);state.songIndex=state.songs.length-1;state.bpm=120;state.padKey='C';loadSongMix();persist();state.editorSong=state.songs.length-1;render();
}
function chooseExistingSong(index){
  const s=state.songs[index]; if(!s)return; state.songIndex=index;state.bpm=Number(s.bpm);state.padKey=s.key;state.addSongOpen=false;loadSongMix();render();
}
function deleteSong(){
  if(state.editorSong===null||!state.songs[state.editorSong])return;
  const wasPlaying=state.playing; stopAllPads(); state.songs.splice(state.editorSong,1);state.songIndex=Math.min(state.songIndex,Math.max(0,state.songs.length-1));state.editorSong=null;state.bpm=Number(currentSong()?.bpm||120);state.padKey=currentSong()?.key||'C';loadSongMix();persist();render(); if(wasPlaying)render();
}
async function saveEditor(){
  const s=state.songs[state.editorSong];if(!s)return;
  const title=$('#edit-title')?.value.trim(); const bpm=Number($('#edit-bpm')?.value); const key=$('#edit-key')?.value; const select=$('#edit-time-sig')?.value; const custom=$('#edit-custom-ts')?.value.trim();
  const ts=select==='Custom'?custom:select;
  if(!title||!Number.isFinite(bpm)||bpm<20||bpm>400||!NOTES.includes(key)||!/^[1-9][0-9]?\/(?:1|2|4|8|16|32|64)$/.test(ts)||Number(ts.split('/')[0])>64){toast('Enter a valid title, key, BPM and time signature');return;}
  s.title=title;s.key=key;s.bpm=bpm;s.timeSig=ts;
  const file=$('#edit-art')?.files?.[0]; if(file){await dbPut(`song-art:${s.id}`,file);s.artName=file.name;imageUrlCache.delete(s.id);}else if(!s.artName){s.artName='';}
  state.bpm=bpm;state.padKey=key;state.editorSong=null;loadSongMix();persist();render();
}
function selectSong(index){
  if(!state.songs[index]||index===state.songIndex)return;
  if(state.playing && state.settings.countIn){startTransition(index);return;}
  stopAllPads(); state.songIndex=index;state.elapsed=0;state.bpm=Number(currentSong().bpm);state.padKey=currentSong().key;loadSongMix();
  if(state.playing && audioCtx){resetClickClock();startPad(state.padKey);} render();
}
function transitionOrSelect(index){if(!state.songs[index])return;if(state.playing&&state.settings.countIn)startTransition(index);else selectSong(index);}
function cancelTransitions(){
  transitionToken++;
  for(const t of transitionTimers)clearTimeout(t);
  transitionTimers.clear();
  state.transitioning=false;
  state.countInBeat=null;
}
function startTransition(targetIndex){
  const target=state.songs[targetIndex];
  if(!target||targetIndex===state.songIndex||!state.playing)return;
  let ctx;
  try{ctx=ensureAudio();}catch{toast('Audio engine unavailable');return;}
  cancelTransitions();
  const token=++transitionToken;
  state.transitioning=true;
  state.padPlayerOpen=false;
  state.addSongOpen=false;
  state.clickSubsOpen=false;
  state.countInBeat='…';
  render();
  const meter=getMeterInfo(target.timeSig);
  const quarterSec=secondsPerQuarter(Number(target.bpm));
  const beatOffsets=meter.beatStartsQuarters;
  const pattern=countInPattern(target.timeSig);
  guideReadyPromise.then(()=>{
    if(token!==transitionToken||!state.transitioning||!state.playing)return;
    const countStart=ctx.currentTime+.04;
    state.countInBeat=pattern[0]??1;
    updateCountOverlay();
    pattern.forEach((n,i)=>{
      const offset=beatOffsets[i] ?? i*meter.unitQuarter;
      scheduleCountInVoice(n,countStart+offset*quarterSec);
    });
    pattern.forEach((n,i)=>{
      const offset=beatOffsets[i] ?? i*meter.unitQuarter;
      const timer=setTimeout(()=>{
        transitionTimers.delete(timer);
        if(token!==transitionToken||!state.transitioning||!state.playing)return;
        state.countInBeat=n;
        updateCountOverlay();
      },Math.round(offset*quarterSec*1000));
      transitionTimers.add(timer);
    });
    const countDuration=beatOffsets.length?beatOffsets[beatOffsets.length-1]*quarterSec:meter.barQuarter*quarterSec;
    const totalMs=Math.max(100,Math.round((countDuration+quarterSec)+50));
    const finalTimer=setTimeout(()=>{
      transitionTimers.delete(finalTimer);
      if(token!==transitionToken||!state.transitioning||!state.playing)return;
      stopAllPads();
      state.songIndex=targetIndex;
      state.elapsed=0;
      state.bpm=Number(target.bpm);
      state.padKey=target.key;
      loadSongMix();
      state.transitioning=false;
      state.countInBeat=null;
      resetClickClock();
      startPad(state.padKey);
      render();
      toast(`Now playing ${target.title}`);
    },totalMs);
    transitionTimers.add(finalTimer);
  }).catch(()=>{});
}
function countInPattern(sig){
  const meter=getMeterInfo(sig);
  return meter.beatStartsQuarters.map((_,i)=>i+1);
}
function scheduleCountInVoice(number,time){
  const ctx=ensureAudio();
  const id=COUNT_IDS[Math.max(0,Math.min(COUNT_IDS.length-1,number-1))]||'one';
  const buf=decodedCache.get(`count:${id}`);
  const guideLevel=Number(state.settings.guideVol)||0;
  if(guideLevel<=0)return;
  const volume=Math.min(1,faderGain(guideLevel)*.95);
  if(buf){
    const src=ctx.createBufferSource(),g=ctx.createGain();
    src.buffer=buf;
    g.gain.value=volume;
    src.connect(g).connect(guideGain);
    src.start(Math.max(time,ctx.currentTime+.005));
    return;
  }
  const o=ctx.createOscillator(),g=ctx.createGain();
  const freqs=[1320,1080,950,820,760,700,650,600];
  const t=Math.max(time,ctx.currentTime+.005);
  o.type='triangle';
  o.frequency.value=freqs[Math.max(0,Math.min(freqs.length-1,number-1))];
  g.gain.setValueAtTime(.0001,t);
  g.gain.exponentialRampToValueAtTime(Math.min(.32,Math.max(.015,volume*.25)),t+.006);
  g.gain.exponentialRampToValueAtTime(.0001,t+.16);
  o.connect(g).connect(guideGain);
  o.start(t);
  o.stop(t+.18);
}

function updateCountOverlay(){const el=$('.count-in strong');if(el)el.textContent=String(state.countInBeat??'');}
function resetClickClock(){
  if(!audioCtx||!state.playing)return;
  songStartAudioTime=audioCtx.currentTime+.07;
  nextClickTime=songStartAudioTime;
  clickStep=0;
  clickBarIndex=0;
  clickEventIndex=0;
  clearTimeout(schedulerTimer);
  scheduleClickGrid();
}
function scheduleClickVoice(type,when,level,frequency,duration){
  if(!audioCtx||!clickGain||level<=0)return;
  const ctx=audioCtx;
  const t=Math.max(when,ctx.currentTime+.002);
  // Triplets use their own sound slot, but fall back to the eighth-note sample
  // until the user assigns a dedicated triplet sample.
  const buf=decodedCache.get(`click:${type}`) || (type==='triplet'?decodedCache.get('click:eighth'):null);
  const g=ctx.createGain();
  g.gain.value=Math.max(0,Math.min(1,level));
  g.connect(clickGain);
  if(buf){
    const src=ctx.createBufferSource();
    src.buffer=buf;
    src.connect(g);
    src.start(t);
    return;
  }
  const o=ctx.createOscillator();
  o.type='sine';
  o.frequency.setValueAtTime(frequency,t);
  g.gain.setValueAtTime(.0001,t);
  g.gain.exponentialRampToValueAtTime(Math.max(.004,Math.min(.3,.23*level)),t+.004);
  g.gain.exponentialRampToValueAtTime(.0001,t+duration);
  o.connect(g);
  o.start(t);
  o.stop(t+duration+.01);
}

function scheduleClickGrid(){
  if(!state.playing||!state.clickOn||!audioCtx)return;
  const now=audioCtx.currentTime;
  const lookAhead=.8;
  const meter=getMeterInfo(timeSig());
  const quarterSec=secondsPerQuarter(state.bpm);
  const barSec=meter.barQuarter*quarterSec;
  const barStart=songStartAudioTime||now;
  const enabled=SUBS.filter(([id])=>Number(state.sub[id])>0).map(([id])=>id);
  if(!enabled.length){
    clearTimeout(schedulerTimer);
    schedulerTimer=setTimeout(scheduleClickGrid,25);
    return;
  }

  // Keep each rhythmic layer on a continuous musical phase. This matters in
  // meters such as 5/8 and 7/8, where an eighth-note triplet does not divide
  // evenly into one bar. Bar boundaries affect accents, not triplet phase.
  const relativeStart=Math.max(0,(nextClickTime-barStart)/quarterSec);
  const relativeEnd=(now+lookAhead-barStart)/quarterSec;
  const events=continuousClickEvents(relativeStart,relativeEnd,enabled);
  for(const event of events){
    const when=barStart+event.quarterOffset*quarterSec;
    if(when < nextClickTime-1e-7)continue;
    const id=event.id;
    const ratio=Number(state.sub[id])/100;
    const barQuarter=((event.quarterOffset % meter.barQuarter)+meter.barQuarter)%meter.barQuarter;
    const accent=isBeatStart(meter,barQuarter);
    const frequency=id==='quarter'?(accent?1320:980):id==='eighth'?(accent?1160:820):id==='sixteenth'?(accent?900:720):id==='thirty'?(accent?780:620):(accent?720:560);
    const duration=id==='quarter'?.065:id==='eighth'?.052:id==='sixteenth'?.036:id==='thirty'?.024:.042;
    scheduleClickVoice(id,when,accent?Math.min(1,ratio*1.12):ratio,frequency,duration);
  }
  // Advance to the first exact layer event after the look-ahead window.
  const future=continuousClickEvents(relativeEnd,relativeEnd+2,enabled)[0];
  nextClickTime=future?barStart+future.quarterOffset*quarterSec:now+.05;
  clearTimeout(schedulerTimer);
  schedulerTimer=setTimeout(scheduleClickGrid,20);
}
function warmClickAssets(){
  const clickPromise=Promise.all(SUBS.map(([id])=>decodeKey(`click:${id}`).catch(()=>null)));
  guideReadyPromise=Promise.all(COUNT_IDS.map(id=>decodeKey(`count:${id}`).catch(()=>null)));
  Promise.all([clickPromise,guideReadyPromise]).catch(()=>{});
}
function previewClick(id){
  try{
    const ctx=ensureAudio();
    const now=ctx.currentTime+.01;
    scheduleClickVoice(id,now,1,id==='quarter'?1320:id==='eighth'?1050:id==='sixteenth'?760:id==='thirty'?650:700,.08);
    toast(`${id.toUpperCase()} click`);
  }catch{toast('Audio engine unavailable');}
}

function togglePlay(){
  if(state.starting||state.transitioning)return;
  if(!currentSong()){toast('Add a song first');return;}
  try{
    const ctx=ensureAudio();
    if(state.playing){
      state.playing=false;
      clearTimeout(schedulerTimer);
      stopClock();
      cancelTransitions();
      stopAllPads();
      render();
      return;
    }
    state.starting=true;
    state.muted=false;
    state.clickOn=state.settings.clickOn!==false;
    state.playing=true;
    state.starting=false;
    songStartWall=performance.now()-state.elapsed*1000;
    songStartAudioTime=ctx.currentTime+.02;
    nextClickTime=songStartAudioTime;
    clickStep=0;
    setGain(clickGain,state.settings.clickVol);
    warmClickAssets();
    startPad(state.padKey);
    scheduleClickGrid();
    startClock();
    render();
  }catch(err){
    state.starting=false;
    state.playing=false;
    toast(`Audio could not start: ${err?.message||'unknown error'}`);
    render();
  }
}

function startClock(){stopClock();const tick=()=>{if(!state.playing)return;const s=currentSong();if(!s)return;state.elapsed=Math.min(Number(s.duration||0),(performance.now()-songStartWall)/1000);const timer=$('#timer'),tt=$('#timeline-time'),p=$('#playhead');if(timer)timer.textContent=fmt(state.elapsed);if(tt)tt.textContent=fmt(state.elapsed);if(p)p.style.left=`${s.duration?Math.min(100,(state.elapsed/s.duration)*100):0}%`;if(state.elapsed>=s.duration){stopPlayback();return;}clockTimer=requestAnimationFrame(tick);};clockTimer=requestAnimationFrame(tick);}
function stopClock(){if(clockTimer)cancelAnimationFrame(clockTimer);clockTimer=0;}
function stopPlayback(){state.playing=false;state.starting=false;clearTimeout(schedulerTimer);stopClock();cancelTransitions();stopAllPads();state.elapsed=0;if(audioCtx)setGain(clickGain,state.settings.clickVol);render();}
async function startPad(note){
  if(!state.padOn||state.muted)return;
  try{
    const ctx=ensureAudio();
    if(activePads.has(note)){stopPad(note);return;}
    const key=`pad:${note}`;
    const cached=decodedCache.get(key);
    if(cached){playPadBuffer(note,cached,ctx);return;}
    // Start a quiet fallback immediately so the pad control never appears dead.
    playPadFallback(note,ctx);
    decodeKey(key).then(buf=>{
      if(!buf||!state.padOn||state.muted)return;
      const active=activePads.get(note);
      if(active && active.buffer===false)stopPad(note);
      if(!activePads.has(note))playPadBuffer(note,buf,ctx);
    }).catch(()=>{});
  }catch{toast('Could not start pad audio');}
}

function playPadBuffer(note,buf,ctx){
  if(activePads.has(note))return;
  const src=ctx.createBufferSource(),g=ctx.createGain();
  src.buffer=buf; src.loop=state.settings.padHold;
  g.gain.setValueAtTime(.0001,ctx.currentTime); g.gain.linearRampToValueAtTime(1,ctx.currentTime+.055);
  src.connect(g).connect(padGain); src.start();
  activePads.set(note,{src,g,buffer:true}); updatePadOnly();
}
function playPadFallback(note,ctx){
  if(activePads.has(note))return;
  const o=ctx.createOscillator(),g=ctx.createGain();
  const freq=220*Math.pow(2,NOTES.indexOf(note)/12); o.type='sine'; o.frequency.value=freq;
  g.gain.setValueAtTime(.0001,ctx.currentTime); g.gain.linearRampToValueAtTime(.085,ctx.currentTime+.055);
  o.connect(g).connect(padGain); o.start();
  activePads.set(note,{src:o,g,buffer:false}); updatePadOnly();
  if(!state.settings.padHold)setTimeout(()=>stopPad(note),1100);
}
function stopPad(note){const item=activePads.get(note);if(!item||!audioCtx)return;try{const now=audioCtx.currentTime;item.g.gain.cancelScheduledValues(now);item.g.gain.setTargetAtTime(.0001,now,.02);item.src.stop(now+.07);}catch{}activePads.delete(note);updatePadOnly();}
function stopAllPads(){[...activePads.keys()].forEach(stopPad);}
function selectPad(note){if(!NOTES.includes(note)||!state.padOn||state.muted)return;for(const n of [...activePads.keys()])if(n!==note)stopPad(n);state.padKey=note;updatePadOnly();startPad(note);}
function updatePadOnly(){
  $$('[data-pad]').forEach(b=>{b.classList.toggle('selected',b.dataset.pad===state.padKey);b.classList.toggle('active',activePads.has(b.dataset.pad));});
  const t=$('[data-pad-overlay] .pad-panel-head small'); if(t){const n=state.padFiles[state.padKey];t.textContent=safeName(n&&n!=='DEFAULT'?n:'No custom sound — fallback tone available');}
  const lines=document.querySelectorAll('[data-channel="pad"] .strip-readout output'); lines.forEach(o=>o.textContent=faderToDb(state.padVol));
}
function updateFader(type,value){
  const v=Math.max(0,Math.min(100,Number(value)||0));
  if(type==='click')state.settings.clickVol=v;
  else if(type==='pad')state.padVol=v;
  else if(type==='guide')state.settings.guideVol=v;
  else state.master=v;
  if(type!=='master')saveSongMix();
  persist();
  if(audioCtx){
    if(type==='click')setGain(clickGain,v);
    else if(type==='pad')setGain(padGain,v);
    else if(type==='guide')setGain(guideGain,state.settings.guideMuted?0:v);
    else setGain(masterGain,v);
  }
  $$(`[data-fader="${type}"]`).forEach(el=>{el.value=v;});
  $$(`[data-fader-track="${type}"]`).forEach(el=>{el.setAttribute('aria-valuenow',String(v));});
  $$(`[data-channel="${type}"] .fader-active`).forEach(el=>el.style.height=`${v}%`);
  $$(`[data-channel="${type}"] .fader-cap`).forEach(el=>el.style.bottom=`calc(${v}% - 4px)`);
  $$(`[data-channel="${type}"] [data-fader-output="${type}"]`).forEach(el=>el.textContent=faderToDb(v));
  $$(`[data-fader-track="${type}"] [data-fader-output="${type}"]`).forEach(el=>el.textContent=faderToDb(v));
}
function updateSub(id,value){
  const v=Math.max(0,Math.min(100,Number(value)||0));
  state.sub[id]=v;persist();
  $$(`[data-sub="${id}"] input`).forEach(el=>el.value=v);
  $$(`[data-sub="${id}"] .mini-active`).forEach(x=>x.style.height=`${v}%`);
  $$(`[data-sub="${id}"] .mini-cap`).forEach(x=>x.style.bottom=`calc(${v}% - 5px)`);
  $$(`[data-sub-track="${id}"]`).forEach(el=>el.setAttribute('aria-valuenow',String(v)));
  $$(`[data-sub="${id}"] output`).forEach(el=>el.textContent=`${v}%`);
}

async function readDocxText(file){
  const bytes=new Uint8Array(await file.arrayBuffer());
  const view=new DataView(bytes.buffer);
  let eocd=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65558);i--){if(view.getUint32(i,true)===0x06054b50){eocd=i;break;}}
  if(eocd<0)throw new Error('Not a ZIP/DOCX file');
  const cdSize=view.getUint32(eocd+12,true),cdOffset=view.getUint32(eocd+16,true);
  let pos=cdOffset;
  const decoder=new TextDecoder();
  while(pos<cdOffset+cdSize){
    if(view.getUint32(pos,true)!==0x02014b50)break;
    const method=view.getUint16(pos+10,true),compSize=view.getUint32(pos+20,true),nameLen=view.getUint16(pos+28,true),extraLen=view.getUint16(pos+30,true),commentLen=view.getUint16(pos+32,true),localOffset=view.getUint32(pos+42,true);
    const name=decoder.decode(bytes.subarray(pos+46,pos+46+nameLen));
    if(name==='word/document.xml'){
      const lp=localOffset;
      const localNameLen=view.getUint16(lp+26,true),localExtraLen=view.getUint16(lp+28,true);
      const data=bytes.subarray(lp+30+localNameLen+localExtraLen,lp+30+localNameLen+localExtraLen+compSize);
      let raw;
      if(method===0)raw=data;
      else if(method===8){
        if(!('DecompressionStream' in window))throw new Error('DOCX decompression unavailable');
        const ds=new DecompressionStream('deflate-raw');
        raw=new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer());
      }else throw new Error('Unsupported DOCX compression');
      return decoder.decode(raw).replace(/<w:tab\/>/g,'\t').replace(/<w:br\s*\/>/g,'\n').replace(/<w:cr\s*\/>/g,'\n').replace(/<w:p[^>]*>/g,'').replace(/<\/w:p>/g,'\n').replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\n{3,}/g,'\n\n').trim();
    }
    pos+=46+nameLen+extraLen+commentLen;
  }
  throw new Error('word/document.xml not found');
}
async function importChordFile(file){
  const song=currentSong();if(!song)return;
  try{
    const ext=file.name.toLowerCase().split('.').pop();
    let text;
    if(ext==='docx')text=await readDocxText(file);
    else if(ext==='doc'){toast('Old .doc files are not supported offline; save it as .docx, .txt, or .html');return;}
    else{text=await file.text();if(ext==='html'||ext==='htm')text=text.replace(/<br\s*\/?>(?=)/gi,'\n').replace(/<[^>]+>/g,' ');}
    text=text.replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\r/g,'').trim();
    state.chordsBySong[song.id]={name:file.name,text};persist();render();toast('Chord sheet saved to this song');
  }catch(err){toast(`Could not read chord sheet: ${err?.message||'invalid file'}`);}
}
function renderChordPanel(){const c=state.chordsBySong[currentSong()?.id];return `<section class="chord-panel"><div class="chord-head"><b>CHORDS</b><span>${escapeHtml(c?.name||'No document')}</span></div><pre>${escapeHtml(c?.text||'Upload a chord sheet in Settings')}</pre></section>`;}

async function storeAsset(type,id,file){
  try{
    await dbPut(`${type}:${id}`,file);
    decodedCache.delete(`${type}:${id}`);
    if(type==='pad')state.padFiles[id]=file.name;
    else if(type==='click')state.clickFiles[id]=file.name;
    else if(type==='count')state.countFiles[id]=file.name;
    persist();
    // Decode after storage, but do not block the UI on it.
    decodeKey(`${type}:${id}`).catch(()=>{});
    toast(`${file.name} saved locally`);
    render();
  }catch{toast('Could not store this file');}
}

function previewEditorArt(file){if(!file)return;const url=URL.createObjectURL(file);const box=$('[data-editor-art]');if(box){box.style.backgroundImage=`url("${url}")`;box.classList.add('has-image');}}
function filterSongLibrary(q){const query=String(q||'').trim().toLowerCase();$$('.add-library-row').forEach(row=>row.hidden=!!query&&!String(row.dataset.libraryTitle||'').includes(query));}
async function hydrateArt(){
  await Promise.all(state.songs.map(async s=>{
    const boxes=$$(`[data-art-song="${CSS.escape(s.id)}"]`); if(!boxes.length)return;
    let url=imageUrlCache.get(s.id);
    if(!url){const blob=await dbGet(`song-art:${s.id}`);if(blob){url=URL.createObjectURL(blob);imageUrlCache.set(s.id,url);}}
    boxes.forEach(box=>{if(url){box.style.backgroundImage=`url("${url}")`;box.classList.add('has-image');}});
  }));
}

function drawWaveform(){
  const c=$('#waveform');if(!c)return;const r=c.getBoundingClientRect();if(!r.width||!r.height)return;const d=Math.min(2,window.devicePixelRatio||1);const w=Math.floor(r.width*d),h=Math.floor(r.height*d);if(c.width!==w||c.height!==h){c.width=w;c.height=h;}const ctx=c.getContext('2d');ctx.clearRect(0,0,w,h);const mid=h*.55;ctx.strokeStyle='rgba(220,224,226,.5)';ctx.lineWidth=Math.max(1,d);for(let i=0;i<84;i++){const x=(i+.5)/84*w;const base=Math.abs(Math.sin(i*.81)*.48)+Math.abs(Math.cos(i*.22)*.2);const amp=h*(.12+base*.25);ctx.beginPath();ctx.moveTo(x,mid-amp);ctx.lineTo(x,mid+amp);ctx.stroke();}}
function updateAllMeters(){
  const playing=state.playing; const t=performance.now();
  if(!playing&&t-lastMeterUpdate<60)return; lastMeterUpdate=t;
  $$('[data-channel] .meter-rail i').forEach((seg,i)=>{const level=playing?(i<8?0.28+0.62*Math.abs(Math.sin(t/190+i*.7)):0.18):0.04;seg.style.opacity=level;});
  if(playing)requestAnimationFrame(updateAllMeters);
}
function toast(msg){let host=$('#toast-host');if(!host){host=document.createElement('div');host.id='toast-host';document.body.appendChild(host);}const el=document.createElement('div');el.className='toast';el.textContent=msg;host.appendChild(el);clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.remove(),1800);}

window.addEventListener('resize',()=>{if(state.screen==='performance')requestAnimationFrame(drawWaveform);});
window.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state.playing)keepAudioAlive();});
window.addEventListener('focus',()=>keepAudioAlive());
window.addEventListener('keydown',e=>{if(e.target instanceof HTMLInput||e.target instanceof HTMLSelect||e.target instanceof HTMLTextArea)return;if(e.code==='Space'){e.preventDefault();togglePlay();}if(e.code==='ArrowLeft'&&state.songs.length)transitionOrSelect(Math.max(0,state.songIndex-1));if(e.code==='ArrowRight'&&state.songs.length)transitionOrSelect(Math.min(state.songs.length-1,state.songIndex+1));});
window.addEventListener('beforeunload',()=>{clearTimeout(schedulerTimer);stopClock();});

persist();
render();
setTimeout(()=>{dbOpen().catch(()=>{}); prefetchSmallAssets().catch(()=>{});},250);
if('serviceWorker' in navigator&&location.hostname!=='localhost'&&location.hostname!=='127.0.0.1')window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
