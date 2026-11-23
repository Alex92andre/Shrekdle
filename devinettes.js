(() => {
  const $ = selector => document.querySelector(selector);
  const game = document.body.dataset.game;
  const fiche = game === 'fiche';
  const api = ShrekAPI.create(game);
  const inp = $('#inp'), sug = $('#sug'), frame = $('#frame'), pic = $('#pic');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let state = null, catalog = [], options = [], active = -1, busy = false;
  let photoVersion = 0, imageURL = '', thumbs = [], reloadAt = 0;

  const norm = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[’`]/g,"'").replace(/\s+/g,' ').trim();
  const noArt = s => s.replace(/^(l'|le |la |les |un |une |des )/, '');
  function say(text, kind = '') {
    $('#msg').textContent = text;
    $('#msg').className = 'msg ' + kind;
  }
  $('#msg').setAttribute('aria-live','polite');
  function toast(text) {
    const tip = $('#toast');
    tip.textContent = text; tip.classList.add('show');
    clearTimeout(tip.timer); tip.timer = setTimeout(() => tip.classList.remove('show'), 2600);
  }
  function el(tag, klass = '', text = '') {
    const item = document.createElement(tag);
    item.className = klass; item.textContent = text;
    return item;
  }
  function timer() {
    if (!state) return;
    const ms = state.resetsAt - Date.now(), t = Math.max(0, Math.floor(ms / 1000));
    $('#cd').textContent = [t/3600,t%3600/60,t%60].map(n => String(Math.floor(n)).padStart(2,'0')).join(':');
    if (ms <= 0 && !busy && Date.now() > reloadAt) {
      reloadAt = Date.now() + 15000;
      load('state').then(ok => { if (ok) say('Nouveau défi du jour.'); });
    }
  }

  function hideOptions() {
    options = []; active = -1;
    sug.replaceChildren(); sug.classList.remove('on');
    inp.setAttribute('aria-expanded','false'); inp.removeAttribute('aria-activedescendant');
  }
  function showOptions() {
    hideOptions();
    const term = norm(inp.value);
    if (!term || !state) return;
    options = catalog.filter(c => !state.tries.some(t => t.id === c.id) && c.keys.some(k => k.startsWith(term)));
    options.forEach((c,i) => {
      const li = el('li','',c.name);
      li.dataset.i = i; li.id = 'character-option-' + i; li.setAttribute('role','option');
      const hit = !noArt(norm(c.name)).startsWith(term) && c.aliases.find(a => noArt(norm(a)).startsWith(term));
      if (hit) li.append(el('small','','('+hit+')'));
      sug.append(li);
    });
    sug.classList.toggle('on', options.length > 0);
    inp.setAttribute('aria-expanded', String(options.length > 0));
  }
  function mark() {
    [...sug.children].forEach((li,i) => {
      li.classList.toggle('act', i === active);
      li.setAttribute('aria-selected', String(i === active));
    });
    const item = sug.children[active];
    if (item) {
      inp.setAttribute('aria-activedescendant', item.id);
      item.scrollIntoView({block:'nearest'});
    }
  }
  inp.addEventListener('input', () => { say(''); showOptions(); });
  inp.addEventListener('keydown', e => {
    if (['ArrowDown','ArrowUp'].includes(e.key) && options.length) {
      e.preventDefault(); active = active < 0 ? (e.key === 'ArrowDown' ? 0 : options.length-1)
        : (active + options.length + (e.key === 'ArrowDown' ? 1 : -1)) % options.length;
      mark();
    } else if (e.key === 'Escape') hideOptions();
  });
  sug.addEventListener('mousedown', e => { if (e.target.closest('li')) e.preventDefault(); });
  sug.addEventListener('click', e => {
    const li = e.target.closest('li');
    if (li && options[Number(li.dataset.i)]) guess(options[Number(li.dataset.i)]);
  });
  document.addEventListener('click', e => { if (!e.target.closest('.field')) hideOptions(); });
  $('#form').addEventListener('submit', e => {
    e.preventDefault();
    if (!state || busy) return;
    const term = norm(inp.value);
    if (!term) return;
    const exact = catalog.find(c => c.keys.includes(term));
    const selected = active >= 0 ? options[active] : exact || (options.length === 1 ? options[0] : null);
    if (!selected) return say('Choisis un personnage dans la liste.', 'bad');
    guess(selected);
  });

  function renderFiche(fresh) {
    thumbs.forEach(u => URL.revokeObjectURL(u)); thumbs = [];
    const grid = $('#grid');
    const header = el('div','rowx');
    ['', 'Personnage', 'Espèce', 'Genre', '1re apparition', 'Âge'].forEach(text => header.append(el('div','h',text)));
    grid.replaceChildren(header);
    [...state.tries].reverse().forEach((entry, rowIndex) => {
      const row = el('div','rowx');
      const cell = (kind, text) => {
        const d = el('div','cell '+kind,text);
        d.style.setProperty('--i', row.children.length);
        if (!fresh || rowIndex) d.style.animation = 'none';
        row.append(d);
        return d;
      };
      const thumb = cell('im'+(entry.ok?' win':''), noArt(norm(entry.name)).charAt(0).toUpperCase());
      if (entry.portrait) api.image(state.round, entry.id).then(url => {
        if (!thumb.isConnected) return URL.revokeObjectURL(url);
        thumbs.push(url);
        const image = el('img'); image.alt = ''; image.src = url; thumb.replaceChildren(image);
      }).catch(() => {});
      cell('nm'+(entry.ok?' win':''), entry.name);
      entry.cells.forEach(c => {
        const d = cell(c.ok?'ok':'no',c.text);
        if (c.year) d.append(el('small','',String(c.year)));
        if (c.direction) d.append(el('span','ar',c.direction));
      });
      grid.append(row);
    });
    $('#legend').style.display = state.tries.length ? 'block' : 'none';
  }
  function showTextClues(lines) {
    frame.classList.add('nofile');
    const content = el('div');
    content.append(el('strong','','Indice du marais'));
    (lines?.length ? lines : ['Image indisponible. Réessaie en rechargeant la page.'])
      .forEach(text => content.append(el('p','',text)));
    $('#miss').replaceChildren(content);
  }
  function paintPortrait() {
    const v = ++photoVersion;
    if (!state.portrait) {
      if (imageURL) URL.revokeObjectURL(imageURL);
      imageURL = ''; pic.removeAttribute('src'); showTextClues(state.clues);
      return;
    }
    api.image(state.round).then(url => {
      if (v !== photoVersion) return URL.revokeObjectURL(url);
      if (imageURL) URL.revokeObjectURL(imageURL);
      imageURL = url; pic.src = url; frame.classList.remove('nofile');
    }).catch(() => { if (v === photoVersion) showTextClues([]); });
  }
  function renderPortrait() {
    $('#tv').textContent = state.tries.length;
    const hist = $('#hist'); hist.replaceChildren();
    state.tries.forEach((entry,i) => {
      const row = el('li',entry.ok?'ok':'');
      row.append(el('span','n',i+1), document.createTextNode(entry.name), el('span','x',entry.ok?'✓':'✗'));
      hist.prepend(row);
    });
    paintPortrait();
  }
  function render(fresh = false) {
    $('#cnt').textContent = state.tries.length;
    $('#mode').textContent = state.mode === 'daily' ? 'Défi du jour' : 'Mode libre';
    $('#freebar').style.display = state.mode === 'free' ? 'block' : 'none';
    $('#win').classList.toggle('on', state.won);
    if (state.won) {
      const n = state.tries.length;
      $('#winT').textContent = 'Bravo ! C’était '+state.solution+' !';
      $('#winP').textContent = `Trouvé en ${n} essai${n>1?'s':''}.`+
        (!fiche && state.best ? ` Record : ${state.best}.` : '');
      $('#free').textContent = state.mode === 'daily' ? 'Continuer à jouer ▶' : 'Personnage suivant ▶';
      $('#cdw').style.display = state.mode === 'daily' ? 'flex' : 'none';
    }
    if (fiche) renderFiche(fresh); else renderPortrait();
    const t = Math.max(0, Math.floor((state.resetsAt-Date.now())/1000));
    $('#cd').textContent = [t/3600,t%3600/60,t%60].map(n=>String(Math.floor(n)).padStart(2,'0')).join(':');
  }
  function lock() {
    inp.disabled = $('#go').disabled = busy || !state || state.won;
    $('#free').disabled = $('#back').disabled = busy;
  }
  async function load(action, args = {}, fresh = false) {
    if (busy) return false;
    busy = true; lock();
    try {
      const next = await api.send(action,args);
      if (next.catalog) catalog = next.catalog.map(c => ({...c,
        keys: [c.name,...c.aliases].flatMap(a => [norm(a),noArt(norm(a))])
      })).sort((a,b)=>noArt(norm(a.name)).localeCompare(noArt(norm(b.name)),'fr'));
      state = next; hideOptions(); render(fresh);
      return true;
    } catch (error) {
      say(error.message + (action === 'state' ? ' Recharge la page pour retenter.' : ''), 'bad');
      return false;
    } finally { busy = false; lock(); }
  }
  async function guess(c) {
    if (busy || state.won) return;
    if (state.tries.some(t=>t.id===c.id)) return say('Tu as déjà essayé '+c.name+'.','bad');
    if (await load('guess',{round:state.round,mode:state.mode,guess:c.id}, true)) {
      inp.value = ''; hideOptions();
      say(!fiche && !state.won ? 'Raté ! Ce n’est pas '+c.name+'.' : '', 'bad');
      if (state.won) celebrate(); else inp.focus();
    }
  }
  function celebrate() {
    if (reduced.matches) return;
    const box = (frame || $('#win')).getBoundingClientRect();
    for (let i = 0; i < 22; i++) {
      const p = el('span'), angle = Math.PI * 2 * i / 22, d = 90 + Math.random() * 160;
      p.style.cssText = `position:fixed;z-index:60;width:7px;height:7px;border-radius:50%;background:#ffe9a8;pointer-events:none;left:${box.x+box.width/2}px;top:${box.y+Math.min(60,box.height/2)}px`;
      document.body.append(p);
      p.animate([{opacity:1},{opacity:0,transform:`translate(${Math.cos(angle)*d}px,${Math.sin(angle)*d}px)`}],
        {duration:850+Math.random()*450}).onfinish=()=>p.remove();
    }
  }
  $('#share').addEventListener('click',async () => {
    if (!state?.won) return;
    const n = state.tries.length;
    const marks = fiche ? '\n'+state.tries.map(t => t.cells.map(c=>c.ok?'🟩':'🟥').join('')).join('\n') : '';
    const txt = `Shrekdle · ${fiche ? 'Fiche mystère' : 'Qui est-ce ?'}${state.mode==='free'?' (mode libre)':''}\nTrouvé en ${n} essai${n>1?'s':''}.${marks}`;
    try { await navigator.clipboard.writeText(txt); toast('Résultat copié !'); }
    catch { toast('Impossible de copier.'); }
  });
  $('#free').addEventListener('click', async () => {
    if (await load('free',{round:state.round})) { inp.value=''; hideOptions(); say(''); inp.focus(); }
  });
  $('#back').addEventListener('click', async () => {
    if (await load('daily')) { inp.value=''; hideOptions(); say(''); if (!state.won) inp.focus(); }
  });
  for (let i=0; i<14; i++) {
    const p=el('span','fly');
    p.style.cssText=`left:${Math.random()*100}%;top:${10+Math.random()*85}%;--d:${9+Math.random()*9}s;--dl:${-Math.random()*16}s;--a:${20+Math.random()*40}px`;
    $('#flies').append(p);
  }
  lock(); say('Connexion au marais…'); load('state').then(ok=>{if(ok)say('');});
  setInterval(timer,1000);
})();
