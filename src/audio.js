/* Arrowvania audio: baked-WAV effects, the live-synth charge hum / power-shot
   boom / bomb blast / speed-boost shimmer, the menu music element, and the two
   HUD volume controls. Sound settings persist in localStorage.
   create() needs ASSETS for the baked sfx data URLs, and canPlayMusic so the
   music only starts while the menu is up. */
const AUDIOLIB = (() => {
  function create({ ASSETS, canPlayMusic }){
  // master mix, SFX_GAIN halves every effect on top of the SFX slider
  const SFX_GAIN = 0.5;
  const SND = { music: { vol: 0.5, muted: false }, sfx: { vol: 0.5, muted: false } };
  // persist the player's sound settings
  try {
    const p = JSON.parse(localStorage.getItem('arrowvania.audio') || '{}');
    if (typeof p.musicVol === 'number') SND.music.vol = p.musicVol;
    if (typeof p.musicMuted === 'boolean') SND.music.muted = p.musicMuted;
    if (typeof p.sfxVol === 'number') SND.sfx.vol = p.sfxVol;
    if (typeof p.sfxMuted === 'boolean') SND.sfx.muted = p.sfxMuted;
  } catch (_) {}
  function saveAudioPrefs(){
    try { localStorage.setItem('arrowvania.audio', JSON.stringify({
      musicVol: SND.music.vol, musicMuted: SND.music.muted,
      sfxVol: SND.sfx.vol, sfxMuted: SND.sfx.muted })); } catch (_) {}
  }
  // baked WAVs decode once, the charge hum is synthesized live so it can hold while the button is held
  let AC = null, chargeSnd = null;
  const sfxBuf = {};
  const sfxReady = [];   // decode promises, the first-load gate waits on these
  // same loading system as Recurve / Astro Siege: build the context and start every
  // decode at load (the context sleeps until the first gesture resumes it), so the
  // Play click can never race its own sound
  (function setupAudio(){
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    AC = new Ctx({ latencyHint: 'interactive' });
    for (const k of ['step','jump','fire','dirt','wood']){
      const url = ASSETS['sfx_' + k]; if (!url) continue;
      const bin = atob(url.split(',')[1]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      sfxReady.push(AC.decodeAudioData(bytes.buffer)
        .then(b => { sfxBuf[k] = b; })
        .catch(err => console.error('sfx failed to decode: ' + k, err)));
    }
    sfxReady.push(fetch('assets/audio/card_select.mp3').then(r => r.arrayBuffer()).then(b => AC.decodeAudioData(b))
      .then(b => { sfxBuf['select'] = b; })
      .catch(err => console.error('sfx failed to decode: select', err)));
  })();
  function initAudio(){ if (AC && AC.state === 'suspended') AC.resume(); }
  function playSfx(name, vol, rate){
    if (!AC || SND.sfx.muted) return;
    const b = sfxBuf[name]; if (!b) return;
    if (AC.state === 'suspended') AC.resume();
    const src = AC.createBufferSource(); src.buffer = b;
    src.playbackRate.value = rate || 1;
    const g = AC.createGain(); g.gain.value = (vol == null ? 1 : vol)*SND.sfx.vol*SFX_GAIN;
    src.connect(g); g.connect(AC.destination); src.start();
  }
  function chargeSndStart(){
    if (!AC || chargeSnd) return;
    const osc = AC.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 55;
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    const g = AC.createGain(); g.gain.value = 0;
    const lfo = AC.createOscillator(); lfo.frequency.value = 3;
    const lfoG = AC.createGain(); lfoG.gain.value = 0;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    osc.connect(lp); lp.connect(g); g.connect(AC.destination);
    osc.start(); lfo.start();
    chargeSnd = { osc, lfo, lfoG, g };
  }
  function chargeSndUpdate(c){
    if (!chargeSnd) return;
    const v = SND.sfx.muted ? 0 : (0.2 + 0.8*c)*0.1*SND.sfx.vol*SFX_GAIN;
    chargeSnd.osc.frequency.value = 55*Math.pow(2, 1.6*c);
    chargeSnd.lfo.frequency.value = 3 + 12*c;
    chargeSnd.g.gain.value = v;
    chargeSnd.lfoG.gain.value = 0.4*v;
  }
  function chargeSndStop(){
    if (!chargeSnd) return;
    chargeSnd.osc.stop(); chargeSnd.lfo.stop(); chargeSnd = null;
  }
  // power-shot impact, a deep boom synthesized live and mixed like the terrain hits
  let boomNoise = null;
  function playBoom(){
    if (!AC || SND.sfx.muted) return;
    if (AC.state === 'suspended') AC.resume();
    const t = AC.currentTime;
    if (!boomNoise){
      const len = Math.floor(AC.sampleRate * 0.5);
      boomNoise = AC.createBuffer(1, len, AC.sampleRate);
      const d = boomNoise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random()*2 - 1;
    }
    const out = AC.createGain();
    out.gain.value = 0.7 * SND.sfx.vol * SFX_GAIN;   // in line with the wood/dirt impacts
    out.connect(AC.destination);
    const o = AC.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(32, t + 0.5);
    const og = AC.createGain(); og.gain.setValueAtTime(1.0, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    o.connect(og).connect(out); o.start(t); o.stop(t + 0.65);
    const n = AC.createBufferSource(); n.buffer = boomNoise;
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800, t); lp.frequency.exponentialRampToValueAtTime(180, t + 0.4);
    const ng = AC.createGain(); ng.gain.setValueAtTime(0.55, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    n.connect(lp).connect(ng).connect(out); n.start(t); n.stop(t + 0.5);
  }
  // bomb detonation: the sci-fi orb sound, stretched to ~1 second
  function playBombSound(){
    if (!AC || SND.sfx.muted) return;
    if (AC.state === 'suspended') AC.resume();
    const t = AC.currentTime;
    const out = AC.createGain(); out.gain.value = 0.8 * SND.sfx.vol * SFX_GAIN; out.connect(AC.destination);
    const sub = AC.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(100, t); sub.frequency.exponentialRampToValueAtTime(36, t + 1.0);
    const sg = AC.createGain(); sg.gain.setValueAtTime(0.9, t); sg.gain.exponentialRampToValueAtTime(0.001, t + 1.05);
    sub.connect(sg).connect(out); sub.start(t); sub.stop(t + 1.1);
    const car = AC.createOscillator(); car.type = 'sawtooth';
    car.frequency.setValueAtTime(220, t); car.frequency.exponentialRampToValueAtTime(80, t + 1.0);
    const mod = AC.createOscillator(); mod.type = 'sine'; mod.frequency.value = 120;
    const ring = AC.createGain(); ring.gain.value = 0; mod.connect(ring.gain); car.connect(ring);
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2600, t); lp.frequency.exponentialRampToValueAtTime(300, t + 1.0);
    const rg = AC.createGain(); rg.gain.setValueAtTime(0.4, t); rg.gain.exponentialRampToValueAtTime(0.001, t + 1.05);
    ring.connect(lp).connect(rg).connect(out); car.start(t); mod.start(t); car.stop(t + 1.1); mod.stop(t + 1.1);
  }
  // speed-booster loop: a darker/lower warp shimmer, held while boosting
  let boostSnd = null;
  function boostSndStart(){
    if (!AC || boostSnd) return;
    if (AC.state === 'suspended') AC.resume();
    const t = AC.currentTime;
    const vol = AC.createGain(); vol.gain.setValueAtTime(0.0001, t); vol.connect(AC.destination);
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    const g = AC.createGain(); g.gain.value = 0.35; lp.connect(g).connect(vol);   // tremolo rides on g
    const oscs = [];
    [147,147,220,294].forEach((f,i) => {
      const s = AC.createOscillator(); s.type = 'sine'; s.frequency.value = f;
      s.detune.value = (i%2 ? 1 : -1) * 14 * (1 + i*0.35);
      const sg = AC.createGain(); sg.gain.value = 0.25;
      s.connect(sg).connect(lp); s.start(t); oscs.push(s);
    });
    const trem = AC.createOscillator(); trem.type = 'sine'; trem.frequency.value = 5;
    const td = AC.createGain(); td.gain.value = 0.13; trem.connect(td).connect(g.gain); trem.start(t);
    boostSnd = { vol, oscs, trem };
  }
  function boostSndUpdate(){
    if (!boostSnd) return;
    const lvl = SND.sfx.muted ? 0 : 1.2 * SND.sfx.vol * SFX_GAIN;
    boostSnd.vol.gain.setTargetAtTime(lvl, AC.currentTime, 0.03);   // smooth fade in / mute
  }
  function boostSndStop(){
    if (!boostSnd) return;
    for (const s of boostSnd.oscs) s.stop();
    boostSnd.trem.stop();
    boostSnd = null;
  }

  const menuMusic = new Audio('assets/audio/menu.mp3'); menuMusic.loop = true;   // created at load so it prefetches
  function startMenuMusic(){
    if (!canPlayMusic()) return;
    menuMusic.volume = SND.music.muted ? 0 : SND.music.vol;
    menuMusic.play().catch(() => {});
  }
  function stopMenuMusic(){ menuMusic.pause(); menuMusic.currentTime = 0; }
  function updateMusicVol(){ menuMusic.volume = SND.music.muted ? 0 : SND.music.vol; }
  for (const id of ['music','sfx']){
    const btn = document.getElementById(id+'-mute-btn');
    const sld = document.getElementById(id+'-slider');
    if (!btn || !sld) continue;
    const ch = SND[id];
    sld.value = Math.round(ch.vol * 100);   // restore the saved slider position
    const apply = () => { btn.textContent = ch.muted ? '\u{1F507}' : '\u{1F50A}'; btn.classList.toggle('muted', ch.muted); sld.disabled = ch.muted; };
    btn.addEventListener('click', () => { ch.muted = !ch.muted; apply(); saveAudioPrefs(); if (id === 'music') updateMusicVol(); });
    sld.addEventListener('input', () => { ch.vol = sld.value / 100; saveAudioPrefs(); if (id === 'music') updateMusicVol(); });
    apply();
  }
  return { SND, sfxReady, initAudio, playSfx,
           chargeSndStart, chargeSndUpdate, chargeSndStop,
           playBoom, playBombSound,
           boostSndStart, boostSndUpdate, boostSndStop,
           startMenuMusic, stopMenuMusic };
  }
  return { create };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = AUDIOLIB;
