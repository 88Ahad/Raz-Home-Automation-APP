// ═══════════════════════════════════════════════════════════
//  ESP32 রিলে কন্ট্রোলার v8.1 — Firebase Web Edition
//  app.js
//
//  ★ নিচের দুটো সেকশন আপনার তথ্য দিয়ে পূরণ করুন ★
// ═══════════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  set,
  get,
  update,
  onValue,
  off
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

// ─────────────────────────────────────────────────────────
//  ★ Firebase Config — আপনার Project এর তথ্য দিন
// ─────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL:       "https://YOUR_PROJECT_ID-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

// ─────────────────────────────────────────────────────────
//  ★ ESP32 IP — WiFi স্ক্যানারের জন্য (শুধু local access)
//  ESP32 যে IP তে আছে সেটা দিন। WiFi মোডে: 192.168.0.106
//  AP মোডে: 192.168.4.1
// ─────────────────────────────────────────────────────────
let ESP32_IP = localStorage.getItem("esp32ip") || "192.168.0.106";

// ═══════════════════════════════════════════════════════════
//  Firebase Initialize
// ═══════════════════════════════════════════════════════════
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getDatabase(app);

// ═══════════════════════════════════════════════════════════
//  গ্লোবাল স্টেট — v8.1 এর মতো হুবহু
// ═══════════════════════════════════════════════════════════
let manualRelayData = {};   // /manual_relays থেকে
let autoRelayData   = {};   // /auto_relays থেকে
let sensorData      = {};   // /sensors থেকে
let configData      = {};   // /config থেকে
let savedNetsData   = {};   // /wifi/savedNetworks থেকে
let currentUser     = null;
let scanRes         = [];
let scanning        = false;
let lastSeenReceivedAt = 0;
const ONLINE_THRESHOLD = 12000; // ১২ সেকেন্ড

// Active Firebase listeners (cleanup এর জন্য)
let unsubSensors = null, unsubManual = null, unsubAuto = null;
let unsubConfig  = null, unsubWifi   = null;
let onlineTimer  = null;

// ═══════════════════════════════════════════════════════════
//  Utility
// ═══════════════════════════════════════════════════════════
const ge  = id => document.getElementById(id);
function setText(id, v){ const e=ge(id); if(e) e.textContent=v; }
function setVal(id, v) { const e=ge(id); if(e) e.value=v; }
function showMsg(id){
  const e=ge(id); if(!e) return;
  e.style.display="inline";
  setTimeout(()=>e.style.display="none", 2500);
}
function toast(msg){
  const t=ge("toast"); t.textContent=msg;
  t.className="toast show";
  setTimeout(()=>t.className="toast", 3000);
}
function esc(s){
  return String(s||"")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function fmtUptime(s){
  const m=Math.floor(s/60), h=Math.floor(m/60);
  return h>0 ? h+"h "+(m%60)+"m "+(s%60)+"s" : m+"m "+(s%60)+"s";
}

// ═══════════════════════════════════════════════════════════
//  Badge আপডেট — v8.1 হুবহু
// ═══════════════════════════════════════════════════════════
function setFBBadge(connected){
  const e=ge("fbBadge"); if(!e) return;
  if(connected){ e.className="badge badge-online";  e.textContent="🟢 Firebase"; }
  else          { e.className="badge badge-offline"; e.textContent="⚫ Firebase"; }
}
function setESP32Badge(online, mode){
  const e=ge("esp32Badge"); if(!e) return;
  if(online){
    const m = mode==="wifi" ? "📶 WiFi" : "📡 AP";
    e.className="badge badge-esp-online";
    e.textContent="🟢 ESP32 "+m;
  } else {
    e.className="badge badge-esp-offline";
    e.textContent="🔴 ESP32 অফলাইন";
  }
}

// ═══════════════════════════════════════════════════════════
//  লগইন / লগআউট
// ═══════════════════════════════════════════════════════════
ge("loginBtn").addEventListener("click", async () => {
  const email = ge("emailField").value.trim();
  const pass  = ge("passField").value;
  const msg   = ge("authMsg");
  const btn   = ge("loginBtn");
  msg.textContent = "";
  if(!email || !pass){ msg.textContent="⚠️ ইমেইল ও পাসওয়ার্ড দিন।"; return; }
  btn.textContent="সংযোগ হচ্ছে..."; btn.disabled=true;
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch(e){
    msg.textContent = "❌ " + (
      e.code==="auth/wrong-password"  ? "ভুল পাসওয়ার্ড" :
      e.code==="auth/user-not-found"  ? "ইউজার পাওয়া যায়নি" :
      e.code==="auth/invalid-email"   ? "ইমেইল সঠিক নয়" :
      e.code==="auth/too-many-requests"? "অনেকবার চেষ্টা, কিছুক্ষণ পরে আবার চেষ্টা করুন" :
      e.message
    );
    btn.textContent="প্রবেশ করুন"; btn.disabled=false;
  }
});

["emailField","passField"].forEach(id=>{
  ge(id).addEventListener("keydown", e=>{ if(e.key==="Enter") ge("loginBtn").click(); });
});

ge("logoutBtn").addEventListener("click", ()=> signOut(auth));

// ═══════════════════════════════════════════════════════════
//  Auth State — লগইন/লগআউট হলে
// ═══════════════════════════════════════════════════════════
onAuthStateChanged(auth, user => {
  if(user){
    currentUser = user;
    ge("loginScreen").style.display = "none";
    ge("dashboard").style.display   = "block";
    ge("loginBtn").textContent = "প্রবেশ করুন";
    ge("loginBtn").disabled    = false;
    setFBBadge(true);
    setText("si-user", user.email);
    setText("si-fb",   "✅ সংযুক্ত");
    startAllListeners();
    startOnlineChecker();
  } else {
    currentUser = null;
    ge("loginScreen").style.display = "flex";
    ge("dashboard").style.display   = "none";
    ge("loginBtn").textContent = "প্রবেশ করুন";
    ge("loginBtn").disabled    = false;
    setFBBadge(false);
    setESP32Badge(false);
    stopAllListeners();
    if(onlineTimer){ clearInterval(onlineTimer); onlineTimer=null; }
  }
});

// ═══════════════════════════════════════════════════════════
//  Online Checker — ১২ সেকেন্ডে heartbeat না পেলে Offline
// ═══════════════════════════════════════════════════════════
function startOnlineChecker(){
  if(onlineTimer) clearInterval(onlineTimer);
  onlineTimer = setInterval(()=>{
    if(!currentUser) return;
    const timeSince = Date.now() - lastSeenReceivedAt;
    const isOnline  = lastSeenReceivedAt>0 && timeSince<ONLINE_THRESHOLD;
    setESP32Badge(isOnline, sensorData.wifiMode);
    setText("si-status", isOnline ? "🟢 অনলাইন" : "🔴 অফলাইন");
  }, 3000);
}

// ═══════════════════════════════════════════════════════════
//  Firebase Listeners — সব ডেটা Real-time
// ═══════════════════════════════════════════════════════════
function startAllListeners(){

  // ── /sensors ───────────────────────────────────────────
  unsubSensors = onValue(ref(db, "/sensors"), snap => {
    sensorData = snap.val() || {};

    // হার্টবিট ট্র্যাক
    if(sensorData.online===true || sensorData.lastSeen!==undefined){
      lastSeenReceivedAt = Date.now();
    }

    updateSensorUI();
    checkAlarms();
    setText("si-lastupdate", new Date().toLocaleTimeString("bn-BD"));
    setESP32Badge(true, sensorData.wifiMode);
    setText("si-status", "🟢 অনলাইন");
  });

  // ── /manual_relays ─────────────────────────────────────
  unsubManual = onValue(ref(db, "/manual_relays"), snap => {
    manualRelayData = snap.val() || {};
    renderManualRelayGrid();
    updateRelayCount();
  });

  // ── /auto_relays ───────────────────────────────────────
  unsubAuto = onValue(ref(db, "/auto_relays"), snap => {
    autoRelayData = snap.val() || {};
    renderAutoRelayGrid();
    updateRelayCount();
    // অটো ট্যাব খোলা থাকলে config ও রিফ্রেশ করো
    if(ge("tab-auto")?.classList.contains("active")){
      renderAutoRelayConfigs();
    }
  });

  // ── /config ────────────────────────────────────────────
  unsubConfig = onValue(ref(db, "/config"), snap => {
    configData = snap.val() || {};
    // সেটিংস ফিল্ড আপডেট
    if(configData.highVoltageThreshold !== undefined){
      setVal("hiV", configData.highVoltageThreshold);
      setVal("loV", configData.lowVoltageThreshold);
    }
    if(configData.tempAlarmHigh !== undefined){
      setVal("tmpHi", configData.tempAlarmHigh);
      setVal("tmpLo", configData.tempAlarmLow);
    }
    checkAlarms();
  });

  // ── /wifi/savedNetworks ────────────────────────────────
  unsubWifi = onValue(ref(db, "/wifi/savedNetworks"), snap => {
    savedNetsData = snap.val() || {};
    // WiFi ট্যাব খোলা থাকলে রিফ্রেশ
    if(ge("tab-wifi")?.classList.contains("active")){
      renderSavedNetworks();
    }
  });
}

function stopAllListeners(){
  if(unsubSensors) { off(ref(db,"/sensors"));             unsubSensors=null; }
  if(unsubManual)  { off(ref(db,"/manual_relays"));       unsubManual=null;  }
  if(unsubAuto)    { off(ref(db,"/auto_relays"));         unsubAuto=null;    }
  if(unsubConfig)  { off(ref(db,"/config"));              unsubConfig=null;  }
  if(unsubWifi)    { off(ref(db,"/wifi/savedNetworks"));  unsubWifi=null;    }
}

// ═══════════════════════════════════════════════════════════
//  Sensor UI — v8.1 হুবহু
// ═══════════════════════════════════════════════════════════
function updateSensorUI(){
  const d = sensorData;
  const v = d.voltage     ?? 0;
  const t = d.temperature ?? 0;

  // ভোল্টেজ
  setText("voltVal", v.toFixed(1)+"V");
  const vb = ge("voltBadge");
  if(vb){
    vb.textContent = d.voltageMode==="high" ? "🔋 হাই মোড" : "🪫 লো মোড";
    vb.className   = "stat-badge "+(d.voltageMode==="high" ? "badge-ok" : "badge-warn");
  }

  // তাপমাত্রা
  setText("tempVal", t.toFixed(1)+"°C");
  const tb  = ge("tempBadge");
  const thi = configData.tempAlarmHigh ?? 45;
  const tlo = configData.tempAlarmLow  ?? 5;
  if(tb){
    if     (t>=thi){ tb.textContent="🔴 অতিরিক্ত গরম";   tb.className="stat-badge badge-high"; }
    else if(t<=tlo){ tb.textContent="🔵 অতিরিক্ত ঠান্ডা"; tb.className="stat-badge badge-warn"; }
    else           { tb.textContent="✅ স্বাভাবিক";        tb.className="stat-badge badge-ok";   }
  }

  // আপটাইম
  const s=d.uptime??0, m=Math.floor(s/60), h=Math.floor(m/60);
  setText("uptimeVal", h>0 ? h+"h "+(m%60)+"m" : m+"m "+(s%60)+"s");
  setText("heapBadge", "RAM: "+((d.freeHeap??0)/1024).toFixed(1)+"KB");

  // WiFi ট্যাব
  setText("wf-mode",  d.wifiMode==="wifi" ? "📶 WiFi" : "📡 AP মোড");
  setText("wf-ip",    d.ip   || "—");
  setText("wf-ssid",  d.ssid || "—");

  // সিস্টেম ট্যাব
  setText("si-ip",    d.ip   || "—");
  setText("si-ssid",  d.ssid || "—");
  setText("si-mode",  d.wifiMode==="wifi"
    ? "📶 WiFi — "+(d.ssid||"")
    : "📡 AP মোড");
  setText("si-heap",  ((d.freeHeap??0)/1024).toFixed(1)+" KB");
  setText("si-uptime",fmtUptime(s));
  setText("si-vmode", d.voltageMode==="high" ? "🔋 হাই মোড" : "🪫 লো মোড");
}

// ═══════════════════════════════════════════════════════════
//  অ্যালার্ম — v8.1 হুবহু
// ═══════════════════════════════════════════════════════════
function checkAlarms(){
  const b = ge("alarmBanner"); if(!b) return;
  const alarms = [];
  const t  = sensorData.temperature  ?? 0;
  const v  = sensorData.voltage      ?? 0;
  const hi = configData.tempAlarmHigh ?? 45;
  const lo = configData.tempAlarmLow  ?? 5;
  if(t>=hi)  alarms.push("⚠️ তাপমাত্রা বেশি: "+t.toFixed(1)+"°C");
  if(t<=lo)  alarms.push("❄️ তাপমাত্রা কম: " +t.toFixed(1)+"°C");
  if(v<10.5) alarms.push("🪫 ভোল্টেজ বিপজ্জনক: "+v.toFixed(1)+"V");
  if(alarms.length){ b.innerHTML="🚨 "+alarms.join(" &nbsp;|&nbsp; "); b.style.display="block"; }
  else b.style.display="none";
}

// ═══════════════════════════════════════════════════════════
//  সক্রিয় রিলে গণনা — v8.1 হুবহু
// ═══════════════════════════════════════════════════════════
function updateRelayCount(){
  let active=0;
  for(let i=0;i<10;i++) if(manualRelayData["relay"+i]?.state) active++;
  for(let i=0;i<4; i++) if(autoRelayData["relay"+i]?.state)   active++;
  setText("relayCount", active+" / 14");
  setText("si-active",  active+" / 14 টি চালু");
}

// ═══════════════════════════════════════════════════════════
//  ম্যানুয়াল রিলে গ্রিড — v8.1 হুবহু
//  Firebase: /manual_relays/relayN/state
// ═══════════════════════════════════════════════════════════
function renderManualRelayGrid(){
  const grid = ge("manualGrid"); if(!grid) return;

  for(let i=0; i<10; i++){
    const key    = "relay"+i;
    const data   = manualRelayData[key] || { state:false, name:"Switch "+(i+1), isPushButton: i===9 };
    const isOn   = data.state      ?? false;
    const isPush = data.isPushButton ?? (i===9);

    let btn = ge("mr"+i);
    if(!btn){
      // নতুন বাটন তৈরি
      btn = document.createElement("div");
      btn.id        = "mr"+i;
      btn.className = "relay-btn"+(isOn?" on":"");
      btn.innerHTML = manHTML(i, data, isOn, isPush);
      attachManEvents(btn, i, isPush);
      grid.appendChild(btn);
    } else {
      // শুধু state আপডেট
      btn.className = "relay-btn"+(isOn?" on":"");
      const ind = btn.querySelector(".relay-indicator");
      const st2 = btn.querySelector(".relay-status");
      if(ind) ind.className = "relay-indicator "+(isOn?"on":"off");
      if(st2){
        st2.className = "relay-status "+(isOn?"on":"off");
        st2.lastChild.textContent = " "+(isOn?"চালু":"বন্ধ");
      }
    }
  }
}

function manHTML(i, data, isOn, isPush){
  return `
<span class="relay-icon">${isPush?"🔘":"🔌"}</span>
<div class="relay-name">${esc(data.name)}</div>
<div class="relay-status ${isOn?"on":"off"}">
  <span class="relay-indicator ${isOn?"on":"off"}"></span>
  ${isOn?"চালু":"বন্ধ"}
</div>
${isPush?'<div class="push-badge">⚡ পুশ বাটন</div>':""}`;
}

function attachManEvents(btn, i, isPush){
  if(isPush){
    // Push button — ধরলে ON, ছাড়লে OFF (Firebase এ সেট করো)
    btn.addEventListener("mousedown",  ()=> fbSetRelayState(i, true));
    btn.addEventListener("mouseup",    ()=> fbSetRelayState(i, false));
    btn.addEventListener("touchstart", ()=> fbSetRelayState(i, true),  {passive:true});
    btn.addEventListener("touchend",   ()=> fbSetRelayState(i, false), {passive:true});
  } else {
    btn.addEventListener("click", ()=>{
      const cur = manualRelayData["relay"+i]?.state ?? false;
      fbSetRelayState(i, !cur);
    });
  }
}

// Firebase এ রিলে state সেট করো
async function fbSetRelayState(i, s){
  // তাৎক্ষণিক UI আপডেট
  const btn = ge("mr"+i);
  if(btn){
    btn.className = "relay-btn"+(s?" on":"");
    const ind = btn.querySelector(".relay-indicator");
    const st2 = btn.querySelector(".relay-status");
    if(ind) ind.className = "relay-indicator "+(s?"on":"off");
    if(st2){
      st2.className = "relay-status "+(s?"on":"off");
      st2.lastChild.textContent = " "+(s?"চালু":"বন্ধ");
    }
  }
  // Firebase এ লিখো — ESP32 পড়ে রিলে চালু/বন্ধ করবে
  try {
    await set(ref(db, "/manual_relays/relay"+i+"/state"), s);
  } catch(e){ console.error("Relay set error:", e); }
}

// ═══════════════════════════════════════════════════════════
//  অটো রিলে গ্রিড — v8.1 হুবহু (শুধু status দেখায়)
// ═══════════════════════════════════════════════════════════
function renderAutoRelayGrid(){
  const grid = ge("autoGrid"); if(!grid) return;

  for(let i=0; i<4; i++){
    const key  = "relay"+i;
    const data = autoRelayData[key] || { state:false, name:"Auto Relay "+(i+1) };
    const isOn = data.state ?? false;
    const od   = data.onDelaySec  ?? 0;
    const od2  = data.offDelaySec ?? 0;

    let btn = ge("ar"+i);
    if(!btn){
      btn = document.createElement("div");
      btn.id        = "ar"+i;
      btn.className = "relay-btn"+(isOn?" on":"");
      btn.style.cursor = "default";
      btn.innerHTML = autoHTML(data, isOn, od, od2);
      grid.appendChild(btn);
    } else {
      btn.className = "relay-btn"+(isOn?" on":"");
      const ind = btn.querySelector(".relay-indicator");
      const st2 = btn.querySelector(".relay-status");
      if(ind) ind.className = "relay-indicator "+(isOn?"on":"off");
      if(st2) st2.className = "relay-status "+(isOn?"on":"off");
      // timer badge
      let tb = btn.querySelector(".timer-badge");
      if(data.timerActive && data.timerRemainSec>0){
        if(!tb){ tb=document.createElement("div"); tb.className="timer-badge"; btn.appendChild(tb); }
        tb.textContent = "⏳ "+data.timerRemainSec+"s পরে";
      } else if(tb) tb.remove();
    }
  }
}

function autoHTML(data, isOn, od, od2){
  return `
<span class="relay-icon">⚙️</span>
<div class="relay-name">${esc(data.name)}</div>
<div class="relay-status ${isOn?"on":"off"}">
  <span class="relay-indicator ${isOn?"on":"off"}"></span>
  ${isOn?"চালু":"বন্ধ"}
</div>
<div class="auto-badge">🤖 ভোল্টেজ নিয়ন্ত্রিত</div>
${(od>0||od2>0)?`<div class="delay-badge">⏱ ON:${od}s / OFF:${od2}s</div>`:""}`;
}

// ═══════════════════════════════════════════════════════════
//  অটো রিলে কনফিগ প্যানেল — v8.1 হুবহু
//  Firebase: /auto_relays/relayN
// ═══════════════════════════════════════════════════════════
function renderAutoRelayConfigs(){
  const container = ge("autoConfigs"); if(!container) return;
  container.innerHTML = "";

  for(let i=0; i<4; i++){
    const key  = "relay"+i;
    const data = autoRelayData[key] || {};
    const name = data.name || ("Auto Relay "+(i+1));
    const od   = data.onDelaySec  ?? 0;
    const od2  = data.offDelaySec ?? 0;

    const panel = document.createElement("div");
    panel.className = "auto-config-panel";
    panel.innerHTML = `
<div class="panel-header" onclick="togglePanel('apb${i}')">
  <span>⚙️ ${esc(name)} <small style="color:var(--muted)">(রিলে ${i+1})</small></span>
  <span class="panel-arrow">▼</span>
</div>
<div class="panel-body" id="apb${i}">
  <div class="form-group" style="margin-bottom:14px">
    <label>📛 রিলে নাম</label>
    <div style="display:flex;gap:8px">
      <input type="text" id="an${i}" value="${esc(name)}" style="flex:1">
      <button class="save-btn" style="padding:8px 14px;font-size:13px"
        onclick="saveAutoName(${i})">💾</button>
    </div>
  </div>
  <div class="param-grid">
    <div class="form-group">
      <label>🔋 হাই ভোল্টেজে চালু</label>
      <label class="toggle-row" style="margin:0">
        <span id="ahvl${i}">${data.enabledInHighVoltage?"✅ চালু":"❌ বন্ধ"}</span>
        <label class="toggle-switch">
          <input type="checkbox" ${data.enabledInHighVoltage?"checked":""}
            onchange="saveAutoToggle(${i},'enabledInHighVoltage',this.checked);
                      document.getElementById('ahvl${i}').textContent=this.checked?'✅ চালু':'❌ বন্ধ'">
          <span class="toggle-slider"></span>
        </label>
      </label>
    </div>
    <div class="form-group">
      <label>🪫 লো ভোল্টেজে চালু</label>
      <label class="toggle-row" style="margin:0">
        <span id="alvl${i}">${data.enabledInLowVoltage?"✅ চালু":"❌ বন্ধ"}</span>
        <label class="toggle-switch">
          <input type="checkbox" ${data.enabledInLowVoltage?"checked":""}
            onchange="saveAutoToggle(${i},'enabledInLowVoltage',this.checked);
                      document.getElementById('alvl${i}').textContent=this.checked?'✅ চালু':'❌ বন্ধ'">
          <span class="toggle-slider"></span>
        </label>
      </label>
    </div>
  </div>
  <div class="delay-section">
    <div class="delay-title">⏱️ ডিলে টাইমার</div>
    <div class="param-grid" style="margin-top:10px">
      <div class="form-group">
        <label>চালু হওয়ার ডিলে (সেকেন্ড)</label>
        <input type="number" id="aon${i}" value="${od}" min="0" max="3600">
        <small>ভোল্টেজ পরিবর্তনের পর এতটুকু অপেক্ষা করে চালু হবে</small>
      </div>
      <div class="form-group">
        <label>বন্ধ হওয়ার ডিলে (সেকেন্ড)</label>
        <input type="number" id="aoff${i}" value="${od2}" min="0" max="3600">
        <small>ভোল্টেজ পরিবর্তনের পর এতটুকু অপেক্ষা করে বন্ধ হবে</small>
      </div>
    </div>
    <div style="margin-top:12px;display:flex;align-items:center;gap:12px">
      <button class="save-btn" onclick="saveAutoDelay(${i})">💾 ডিলে সেভ করুন</button>
      <span id="adm${i}" class="save-msg" style="display:none">✅ সেভ হয়েছে</span>
    </div>
  </div>
</div>`;
    container.appendChild(panel);
  }
}

// প্যানেল টগল
window.togglePanel = (id) => {
  const b = ge(id);
  b.classList.toggle("open");
  const arrow = b.previousElementSibling.querySelector(".panel-arrow");
  if(arrow) arrow.textContent = b.classList.contains("open") ? "▲" : "▼";
};

// রিলে নাম সেভ → Firebase
window.saveAutoName = async (i) => {
  const name = ge("an"+i)?.value.trim(); if(!name) return;
  await update(ref(db, "/auto_relays/relay"+i), { name });
};

// টগল সেভ → Firebase
window.saveAutoToggle = async (i, key, value) => {
  await set(ref(db, "/auto_relays/relay"+i+"/"+key), value);
};

// ডিলে সেভ → Firebase
window.saveAutoDelay = async (i) => {
  const on  = parseFloat(ge("aon"+i)?.value)  || 0;
  const off = parseFloat(ge("aoff"+i)?.value) || 0;
  await update(ref(db, "/auto_relays/relay"+i), { onDelaySec:on, offDelaySec:off });
  showMsg("adm"+i);
};

// ═══════════════════════════════════════════════════════════
//  সেটিংস — v8.1 হুবহু
//  Firebase: /config
// ═══════════════════════════════════════════════════════════
ge("saveVoltBtn").addEventListener("click", async () => {
  const hi = parseFloat(ge("hiV")?.value);
  const lo = parseFloat(ge("loV")?.value);
  if(isNaN(hi)||isNaN(lo)) return;
  if(hi<=lo){ alert("হাই থ্রেশহোল্ড লো-র চেয়ে বেশি হতে হবে!"); return; }
  await update(ref(db, "/config"), { highVoltageThreshold:hi, lowVoltageThreshold:lo });
  showMsg("voltMsg");
});

ge("saveTempBtn").addEventListener("click", async () => {
  const hi = parseFloat(ge("tmpHi")?.value);
  const lo = parseFloat(ge("tmpLo")?.value);
  if(isNaN(hi)||isNaN(lo)) return;
  await update(ref(db, "/config"), { tempAlarmHigh:hi, tempAlarmLow:lo });
  showMsg("tempMsg");
});

// ═══════════════════════════════════════════════════════════
//  WiFi — সেভ নেটওয়ার্ক: Firebase | স্ক্যান/কানেক্ট: ESP32 API
// ═══════════════════════════════════════════════════════════

// সেভ নেটওয়ার্ক রেন্ডার (Firebase থেকে)
function renderSavedNetworks(){
  const list = ge("savedList"); if(!list) return;
  const nets = savedNetsData;
  const keys = Object.keys(nets||{});

  if(!keys.length){
    list.innerHTML='<div class="scan-empty">কোনো নেটওয়ার্ক সেভ করা নেই</div>';
    return;
  }

  const currentSSID = sensorData.ssid || "";
  list.innerHTML = keys.map(k => {
    const n = nets[k];
    const isConn = (sensorData.wifiMode==="wifi" && n.ssid===currentSSID);
    return `
<div class="saved-net-item">
  <div>
    <div class="wifi-ssid">${esc(n.ssid)}</div>
    <div class="wifi-meta">${isConn?"🟢 সংযুক্ত":"⚪ সেভড"}</div>
  </div>
  <div style="display:flex;gap:8px">
    ${isConn
      ? `<button class="mini-btn disconnect-btn" onclick="disconnWiFi()">✂️ বিচ্ছিন্ন</button>`
      : `<button class="mini-btn connect-btn" onclick="qConn('${esc(n.ssid)}')">🔗</button>`}
    <button class="mini-btn danger-btn" onclick="rmNet('${k}','${esc(n.ssid)}')">🗑️</button>
  </div>
</div>`;
  }).join("");
}

// WiFi স্ক্যান — সরাসরি ESP32 API
ge("scanBtn").addEventListener("click", doScan);
async function doScan(){
  if(scanning) return;
  scanning = true;
  const btn  = ge("scanBtn"), list = ge("scanList");
  btn.textContent="⏳ স্ক্যান হচ্ছে..."; btn.disabled=true;
  list.innerHTML='<div class="scan-loading">📡 নেটওয়ার্ক খোঁজা হচ্ছে...</div>';
  try {
    const r = await fetch(`http://${ESP32_IP}/api/wifi/scan`,
      { signal: AbortSignal.timeout(15000) });
    const d = await r.json();
    scanRes = (d.networks||[]).sort((a,b)=>b.rssi-a.rssi);
    if(!scanRes.length){
      list.innerHTML='<div class="scan-empty">কোনো নেটওয়ার্ক পাওয়া যায়নি</div>';
    } else {
      const savedSSIDs = Object.values(savedNetsData||{}).map(n=>n.ssid);
      list.innerHTML = scanRes.map((n,i)=>`
<div class="wifi-net-item" onclick="selNet(${i})">
  <div>
    <div class="wifi-ssid">${esc(n.ssid)}${
      savedSSIDs.includes(n.ssid)?'<span class="saved-tag">✓ সেভড</span>':""}</div>
    <div class="wifi-meta">${n.secure?"🔒":"🔓"} ${n.secure?"সুরক্ষিত":"উন্মুক্ত"} · ${n.rssi} dBm</div>
  </div>
  <div class="wifi-bars">${bars(n.rssi)}</div>
</div>`).join("");
    }
  } catch(e){
    list.innerHTML='<div class="scan-error">✗ স্ক্যান ব্যর্থ — ESP32 IP চেক করুন ('+ESP32_IP+')</div>';
  }
  scanning=false; btn.textContent="🔍 স্ক্যান করুন"; btn.disabled=false;
}

function bars(r){
  const s = r>=-55?4:r>=-65?3:r>=-75?2:1;
  return [1,2,3,4].map(b=>`<span class="bar${b<=s?" active":""}"></span>`).join("");
}

// নেটওয়ার্ক সিলেক্ট করলে Modal খোলো
window.selNet = (i) => {
  const n = scanRes[i]; if(!n) return;
  ge("conn-ssid").value = n.ssid;
  ge("conn-ssid-lbl").textContent = n.ssid;
  ge("conn-pass").value = "";
  ge("connectPanel").style.display = "flex";
  ge("conn-pass-group").style.display = n.secure?"block":"none";
  ge("conn-pass").focus();
};

ge("cancelConnBtn").addEventListener("click", closeConn);
ge("conn-pass").addEventListener("keydown", e=>{ if(e.key==="Enter") doConnect(); });
function closeConn(){ ge("connectPanel").style.display="none"; }

// কানেক্ট — ESP32 API + Firebase এ SSID সেভ
ge("connBtn").addEventListener("click", doConnect);
async function doConnect(){
  const ssid = ge("conn-ssid")?.value.trim();
  const pass  = ge("conn-pass")?.value;
  if(!ssid) return;
  const btn = ge("connBtn");
  btn.textContent="⏳ সংযোগ হচ্ছে..."; btn.disabled=true;
  try {
    // ESP32 কে সংযোগের নির্দেশ দাও
    await fetch(`http://${ESP32_IP}/api/wifi/connect`, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ssid, password:pass}),
      signal: AbortSignal.timeout(8000)
    });
    // Firebase এ SSID সেভ করো (পাসওয়ার্ড সেভ করা হয় না)
    const newKey = "net_"+Date.now();
    await set(ref(db, "/wifi/savedNetworks/"+newKey), { ssid });
    toast("📡 "+ssid+" এ সংযোগ হচ্ছে...");
  } catch(e){
    toast("⚠️ ESP32 API সংযোগ ব্যর্থ — কিন্তু Firebase এ সেভ হয়েছে");
    // তবু Firebase এ সেভ করি
    const newKey = "net_"+Date.now();
    await set(ref(db, "/wifi/savedNetworks/"+newKey), { ssid }).catch(()=>{});
  }
  btn.textContent="✅ সংযোগ করুন"; btn.disabled=false;
  closeConn();
}

// সেভড নেটওয়ার্ক থেকে দ্রুত কানেক্ট
window.qConn = (ssid) => {
  ge("conn-ssid").value = ssid;
  ge("conn-ssid-lbl").textContent = ssid;
  ge("conn-pass").value = "";
  ge("connectPanel").style.display = "flex";
  ge("conn-pass-group").style.display = "block";
};

// WiFi বিচ্ছিন্ন — ESP32 API
window.disconnWiFi = async () => {
  if(!confirm("WiFi থেকে বিচ্ছিন্ন হবেন?")) return;
  try {
    await fetch(`http://${ESP32_IP}/api/wifi/disconnect`, {
      method:"POST", signal:AbortSignal.timeout(8000)
    });
    toast("📡 AP মোড চালু হচ্ছে...");
  } catch(e){ toast("⚠️ ESP32 API সংযোগ ব্যর্থ"); }
};

// নেটওয়ার্ক মুছো — Firebase থেকে
window.rmNet = async (fbKey, ssid) => {
  if(!confirm(`"${ssid}" মুছবেন?`)) return;
  await set(ref(db, "/wifi/savedNetworks/"+fbKey), null);
  toast("🗑️ মুছে গেছে");
};

// ═══════════════════════════════════════════════════════════
//  ট্যাব নেভিগেশন — v8.1 হুবহু
// ═══════════════════════════════════════════════════════════
document.querySelectorAll(".tab").forEach(t => {
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(x => x.classList.remove("active"));
    t.classList.add("active");
    const el = ge("tab-"+t.dataset.tab);
    if(el) el.classList.add("active");
    if(t.dataset.tab==="auto")  renderAutoRelayConfigs();
    if(t.dataset.tab==="wifi")  renderSavedNetworks();
  });
});
