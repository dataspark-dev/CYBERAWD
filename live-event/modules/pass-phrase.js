/* Pass-Phrase — Build a Strong Password (generated content, difficulty ramp)
   Rounds provide only difficulty; weak sample + 15-char deck are generated at
   runtime weighted by difficulty. 12-slot cap, consuming deck tiles. Strength
   meter only — no checklist/hints. */
(function () {
  const TIMER_SECONDS = 45;
  const MAX_SLOTS = 12;
  let rounds = [];
  let index = 0;
  let locked = false;
  let timer = null;

  let passwordChars = [];
  let deckChars = [];
  let currentWeak = '';
  let dragged = null;

  // ----- Refined pools — meaningful templates for aligned weak → strong -----
  // Deck now 20 tiles, meaningful weak passwords per level (name/DOB/place), easy→hard
  const DECK_SIZE = 20;
  const NAMES = ["Rahul","Priya","Amit","Neha","Arjun","Sneha","Vikram","Ananya","Rohan","Isha","Karan","Meera"];
  const PLACES = ["Mumbai","Delhi","Chennai","Kolkata","Goa","Pune","Jaipur","Kochi","Hyderabad"];
  const YEARS = ["1998","1999","2000","2001","2002","2003","1995","1990","1992"];
  const PHRASE_WORDS = ["Ocean","Voyage","Anchor","Harbor","Bridge","Compass","Horizon","Voyager","Marina","Delta"];
  const UPPER_POOL = (function(){ var a=[]; for(var i=65;i<=90;i++) a.push(String.fromCharCode(i)); return a; })();
  const LOWER_POOL = (function(){ var a=[]; for(var i=97;i<=122;i++) a.push(String.fromCharCode(i)); return a; })();
  const NUM_POOL = (function(){ var a=[]; for(var i=48;i<=57;i++) a.push(String.fromCharCode(i)); return a; })();
  const SYM_POOL = ['!','@','#','$','%','^','&','*','-','_','+','=','?','~','<','>'];

  function pickRandom(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
  function shuffled(arr){
    var a = arr.slice();
    for(var i=a.length-1;i>0;i--){ var j=Math.floor(Math.random()*(i+1)); var t=a[i]; a[i]=a[j]; a[j]=t; }
    return a;
  }
  function randomChars(pool, count, allowDup){
    if(!allowDup){
      return shuffled(pool).slice(0, count);
    } else {
      var out=[];
      for(var i=0;i<count;i++) out.push(pool[Math.floor(Math.random()*pool.length)]);
      return out;
    }
  }

  function generateWeakPassword(difficulty){
    var name = pickRandom(NAMES);
    var place = pickRandom(PLACES);
    var year = pickRandom(YEARS);
    if(difficulty === 'easy'){
      // Easy: pure personal data, all lowercase, short — e.g. rahul1998, neha2001, mumbai123
      if(Math.random() < 0.5) return name.toLowerCase() + year.slice(-2);
      if(Math.random() < 0.5) return place.toLowerCase() + String(100 + Math.floor(Math.random()*900));
      return name.toLowerCase() + String(Math.floor(Math.random()*900)+100);
    } else if(difficulty === 'medium'){
      // Medium: Name + Place/Year pattern — RahulMumbai98, PriyaGoa2001 — has upper but still predictable
      var base = name + place + year.slice(-2);
      // 30% chance lower first letter to keep it familiar
      if(Math.random() < 0.3) base = base.charAt(0).toLowerCase() + base.slice(1);
      return base;
    } else {
      // Hard: Name_Place_Year with one symbol but still personal — Rahul_Mumbai1998, Priya#Goa2001!
      var sep = pickRandom(['_','-','@','#']);
      var tail = Math.random() < 0.5 ? year : year.slice(-2);
      var hard = name + sep + place + tail;
      if(Math.random() < 0.3) hard += pickRandom(SYM_POOL.slice(0,6));
      return hard;
    }
  }

  function generateDeck(difficulty, weak){
    // 20-word deck — aligned template words, easy→hard
    // Each tile is a WORD (not single char) — meaningful, aligned, easy to scan
    // Easy: many helpful phrase/place/year + symbols, Medium: balanced, Hard: decoy-heavy
    var deck = [];
    var weakLower = weak.toLowerCase();
    var useWords = true; // deck of WORDS
    if(difficulty === 'easy'){
      // Easy: 6 phrase words + 4 places + 3 years + 4 symbols/numbers + 3 connectors
      deck = deck.concat(shuffled(PHRASE_WORDS).slice(0,4));
      deck = deck.concat(shuffled(PLACES).slice(0,3));
      deck = deck.concat(shuffled(YEARS).slice(0,3).map(function(y){ return y.slice(-2); }));
      deck = deck.concat(shuffled(SYM_POOL).slice(0,3));
      deck = deck.concat(['2024','99','007']);
      deck = deck.concat(shuffled(NAMES).slice(0,4));
    } else if(difficulty === 'medium'){
      deck = deck.concat(shuffled(PHRASE_WORDS).slice(0,3));
      deck = deck.concat(shuffled(PLACES).slice(0,4));
      deck = deck.concat(shuffled(YEARS).slice(0,3));
      deck = deck.concat(shuffled(SYM_POOL).slice(0,3));
      deck = deck.concat(shuffled(NAMES).slice(0,4));
      deck = deck.concat(['Voyage','Anchor']);
      if(deck.length < DECK_SIZE) deck = deck.concat(shuffled(PHRASE_WORDS).slice(0, DECK_SIZE - deck.length));
    } else {
      // Hard: decoy-heavy — many repeats of weak parts, few new helpers
      var weakParts = [];
      // split weak into chunks to use as decoys
      var w = weak.replace(/[^A-Za-z0-9]/g,'');
      for(var i=0;i<w.length;i+=3) weakParts.push(w.slice(i,i+3));
      deck = deck.concat(weakParts.slice(0,5)); // decoy repeats
      deck = deck.concat(shuffled(PHRASE_WORDS).slice(0,2));
      deck = deck.concat(shuffled(PLACES).slice(0,2));
      deck = deck.concat(shuffled(SYM_POOL).slice(0,2));
      deck = deck.concat(shuffled(YEARS).slice(0,2));
      deck = deck.concat(shuffled(NAMES).slice(0,3));
      // fill remaining with decoy letters
      while(deck.length < DECK_SIZE){
        deck.push(weakLower.charAt(Math.floor(Math.random()*weakLower.length)) || pickRandom(LOWER_POOL));
      }
    }
    deck = shuffled(deck).slice(0, DECK_SIZE);
    // Ensure at least one symbol and one number for easy/medium to make strong achievable
    if(difficulty !== 'hard'){
      var hasSym = deck.some(function(c){ return /[^A-Za-z0-9]/.test(c); });
      var hasNum = deck.some(function(c){ return /[0-9]/.test(c); });
      if(!hasSym) deck[0] = pickRandom(SYM_POOL);
      if(!hasNum) deck[1] = pickRandom(YEARS).slice(-2);
    }
    // Align template words — normalize to Title Case for words, keep symbols/numbers as-is
    deck = deck.map(function(c){
      if(/^[A-Za-z]{2,}$/.test(c)) return c.charAt(0).toUpperCase() + c.slice(1).toLowerCase();
      return c;
    });
    return deck;
  }

  const els = {
    counter: document.getElementById('itemCounter'),
    weakText: document.getElementById('weakText'),
    weakMeta: document.getElementById('weakMeta'),
    tiles: document.getElementById('tilesContainer'),
    deck: document.getElementById('deckContainer'),
    countLabel: document.getElementById('slotCount'),
    meterFill: document.getElementById('meterFill'),
    strengthLabel: document.getElementById('strengthLabel'),
    strengthScore: document.getElementById('strengthScore'),
    crackTime: document.getElementById('crackTime'),
    timerEl: document.getElementById('timer'),
    solvedBtn: document.getElementById('solvedBtn'),
    nextBtn: document.getElementById('nextBtn'),
    dots: document.getElementById('progressDots'),
    rememberCard: document.getElementById('rememberCard'),
    rememberText: document.getElementById('rememberText'),
    introScreen: document.getElementById('introScreen'),
    activityBody: document.getElementById('activityBody'),
    introText: document.getElementById('introText'),
    introStartBtn: document.getElementById('introStartBtn')
  };
  let rememberThisText = '';
  let contentData = null;
  let introDismissed = false;

  function renderDots(){
    els.dots.innerHTML = rounds.map(function(_,i){
      var cls = i===index ? 'dot current' : (i < index ? 'dot done' : 'dot');
      return '<span class="'+cls+'"></span>';
    }).join('');
  }

  function computeStrength(pw, weak){
    var checks = {
      length: pw.length >= 12,
      upper: /[A-Z]/.test(pw),
      lower: /[a-z]/.test(pw),
      number: /[0-9]/.test(pw),
      special: /[^A-Za-z0-9]/.test(pw)
    };
    var score=0;
    if(pw.length >=12) score+=25;
    else if(pw.length >=8) score+=10;
    if(pw.length >=16) score+=10;
    if(checks.upper) score+=15;
    if(checks.lower) score+=15;
    if(checks.number) score+=15;
    if(checks.special) score+=15;
    if(checks.upper && checks.lower && checks.number && checks.special && pw.length>=12) score+=5;
    if(weak){
      var normPw=pw.toLowerCase();
      var normWeak=weak.toLowerCase();
      if(normPw===normWeak) score=Math.max(0,score-30);
      else if(normPw.includes(normWeak) || normWeak.includes(normPw)) score=Math.max(0,score-15);
      if(pw.length - weak.length <=2 && normPw.includes(normWeak.slice(0,4))) score=Math.max(0,score-10);
    }
    if(/(.)\1{2,}/.test(pw)) score=Math.max(0,score-10);
    score=Math.min(100,Math.max(0,score));
    var charset=0;
    if(checks.lower) charset+=26;
    if(checks.upper) charset+=26;
    if(checks.number) charset+=10;
    if(checks.special) charset+=12;
    var crack='—';
    if(pw.length>0 && charset>0){
      var entropy=pw.length*Math.log2(charset);
      var guesses=Math.pow(2,entropy);
      var perSec=1e9;
      var s=guesses/perSec;
      if(s<1) crack='< 1 second';
      else if(s<60) crack=Math.round(s)+' seconds';
      else if(s<3600) crack=Math.round(s/60)+' minutes';
      else if(s<86400) crack=Math.round(s/3600)+' hours';
      else if(s<2592000) crack=Math.round(s/86400)+' days';
      else if(s<31536000) crack=Math.round(s/2592000)+' months';
      else if(s<315360000) crack=Math.round(s/31536000)+' years';
      else crack='centuries';
    }
    var label='Weak', level='weak', color='#ef4444';
    if(pw.length===0){ label='Weak'; level='weak'; color='#ef4444'; }
    else if(score<40){ label='Weak'; level='weak'; color='#ef4444'; }
    else if(score<60){ label='Fair'; level='fair'; color='#f59e0b'; }
    else if(score<80){ label='Strong'; level='strong'; color='#10b981'; }
    else { label='Very Strong'; level='very-strong'; color='#065f46'; }
    return {score:score, checks:checks, label:label, level:level, color:color, crack:crack};
  }

  function updateStrength(){
    var pw=passwordChars.join('');
    var result=computeStrength(pw, currentWeak);
    els.meterFill.style.width=result.score+'%';
    els.meterFill.style.background=result.color;
    els.strengthScore.textContent=result.score+' / 100';
    els.strengthLabel.textContent='Strength: '+result.label;
    els.strengthLabel.style.color=result.color;
    els.crackTime.textContent=result.crack;
    if(els.countLabel){
      els.countLabel.textContent=pw.length+' / '+MAX_SLOTS;
      els.countLabel.style.color=pw.length>=MAX_SLOTS ? '#b45309' : 'var(--muted)';
    }
    els.tiles.className='pp-tiles strength-'+result.level;
    els.tiles.style.borderColor=result.level==='weak' ? '#fecaca' : result.level==='fair' ? '#fde68a' : result.level==='strong' || result.level==='very-strong' ? '#6ee7b7' : 'var(--line)';
    els.tiles.style.background=result.level==='weak' ? '#fef2f2' : result.level==='fair' ? '#fffbeb' : result.level==='strong' || result.level==='very-strong' ? '#f0fdf4' : '#fff';
    if(passwordChars.length>=MAX_SLOTS) els.tiles.classList.add('is-full');
    else els.tiles.classList.remove('is-full');
    var canSolve=(result.level==='strong' || result.level==='very-strong') && !locked;
    els.solvedBtn.disabled=!canSolve;
    if(canSolve) els.solvedBtn.classList.add('pulse-highlight');
    else els.solvedBtn.classList.remove('pulse-highlight');
    if(els.deck) els.deck.classList.toggle('deck-full', passwordChars.length>=MAX_SLOTS);
    return result;
  }

  function createDeckTile(ch, idx){
    var tile=document.createElement('div');
    tile.className='pp-tile pp-deck-tile';
    var isFull=passwordChars.length>=MAX_SLOTS;
    tile.draggable=!locked && !isFull;
    if(isFull) tile.classList.add('is-inert');
    tile.dataset.source='deck';
    tile.dataset.idx=String(idx);
    tile.innerHTML='<span class="pp-tile-letter">'+LiveEvent.escapeHtml(ch)+'</span>';
    tile.addEventListener('dragstart', function(e){
      if(locked || passwordChars.length>=MAX_SLOTS){ e.preventDefault(); return; }
      dragged={source:'deck', idx:idx, char:ch};
      tile.classList.add('dragging');
      try{ e.dataTransfer.setData('text/plain', ch); }catch(err){}
      e.dataTransfer.effectAllowed='copyMove';
    });
    tile.addEventListener('dragend', function(){ tile.classList.remove('dragging'); dragged=null; });
    tile.addEventListener('click', function(){
      if(locked || passwordChars.length>=MAX_SLOTS) return;
      var removed=deckChars.splice(idx,1)[0];
      passwordChars.push(removed);
      renderTiles();
      renderDeck();
      updateStrength();
    });
    return tile;
  }

  function renderDeck(){
    if(!els.deck) return;
    els.deck.innerHTML='';
    deckChars.forEach(function(ch,i){
      els.deck.appendChild(createDeckTile(ch,i));
    });
    if(deckChars.length===0){
      var empty=document.createElement('div');
      empty.className='pp-deck-empty';
      empty.textContent='—';
      els.deck.appendChild(empty);
    }
  }

  function renderTiles(){
    els.tiles.innerHTML='';
    passwordChars.forEach(function(ch,i){
      var tile=document.createElement('div');
      tile.className='pp-tile';
      tile.draggable=!locked;
      tile.dataset.source='password';
      tile.dataset.idx=String(i);
      tile.innerHTML='<span class="pp-tile-letter">'+LiveEvent.escapeHtml(ch)+'</span>';
      tile.addEventListener('dragstart', function(e){
        if(locked){ e.preventDefault(); return; }
        dragged={source:'password', idx:i, char:ch};
        tile.classList.add('dragging');
        try{ e.dataTransfer.setData('text/plain', ch); }catch(err){}
        e.dataTransfer.effectAllowed='move';
      });
      tile.addEventListener('dragend', function(){
        tile.classList.remove('dragging');
        Array.from(els.tiles.children).forEach(function(t){ t.classList.remove('drag-over'); });
        if(els.tiles) els.tiles.classList.remove('drag-over');
        dragged=null;
      });
      tile.addEventListener('dragover', function(e){
        if(locked || !dragged) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = dragged.source==='deck' ? 'copy' : 'move';
        tile.classList.add('drag-over');
      });
      tile.addEventListener('dragleave', function(){ tile.classList.remove('drag-over'); });
      tile.addEventListener('drop', function(e){
        e.preventDefault();
        e.stopPropagation();
        tile.classList.remove('drag-over');
        if(locked || !dragged) return;
        if(dragged.source==='password'){
          if(dragged.idx===i) return;
          var moved=passwordChars.splice(dragged.idx,1)[0];
          var targetIdx=dragged.idx < i ? i-1 : i;
          passwordChars.splice(targetIdx + (dragged.idx < i ? 1 : 0), 0, moved);
        } else if(dragged.source==='deck'){
          if(passwordChars.length>=MAX_SLOTS) return;
          var deckChar=deckChars.splice(dragged.idx,1)[0];
          passwordChars.splice(i,0,deckChar);
        }
        dragged=null;
        renderTiles();
        renderDeck();
        updateStrength();
      });
      tile.addEventListener('dblclick', function(){
        if(locked) return;
        var returned=passwordChars.splice(i,1)[0];
        deckChars.push(returned);
        renderTiles();
        renderDeck();
        updateStrength();
      });
      els.tiles.appendChild(tile);
    });
    var remaining=MAX_SLOTS-passwordChars.length;
    for(var s=0;s<remaining;s++){
      var slot=document.createElement('div');
      slot.className='pp-slot';
      slot.setAttribute('aria-hidden','true');
      els.tiles.appendChild(slot);
    }
  }

  function initDrops(){
    // Use document-level tracking for dragged to stay robust even if pointer leaves element
    els.tiles.addEventListener('dragover', function(e){
      if(locked || !dragged) return;
      // Allow drop anywhere inside tiles container that is not directly over a password tile
      // (tiles handle their own dragover). Slots/hints are pointer-events:none so this fires for empty area.
      var overTile = e.target.closest && e.target.closest('.pp-tile[data-source="password"]');
      if(!overTile){
        if(dragged.source==='deck' && passwordChars.length>=MAX_SLOTS) return;
        e.preventDefault();
        if(e.dataTransfer) e.dataTransfer.dropEffect = dragged.source==='deck' ? 'copy' : 'move';
        els.tiles.classList.add('drag-over');
      }
    });
    els.tiles.addEventListener('dragleave', function(e){
      // Only remove when truly leaving the container (not child)
      if(!e.relatedTarget || !els.tiles.contains(e.relatedTarget)){
        els.tiles.classList.remove('drag-over');
      }
    });
    els.tiles.addEventListener('drop', function(e){
      if(locked || !dragged) return;
      // If dropping directly on a tile, that tile's drop handler already handled it
      var overTile = e.target.closest && e.target.closest('.pp-tile[data-source="password"]');
      if(overTile) return;
      // Otherwise, check if drop is inside tiles container (empty slots area)
      var inside = e.target===els.tiles || (e.target.closest && e.target.closest('#tilesContainer'));
      if(!inside) return;
      e.preventDefault();
      e.stopPropagation();
      els.tiles.classList.remove('drag-over');
      if(dragged.source==='deck'){
        if(passwordChars.length>=MAX_SLOTS) return;
        var c=deckChars.splice(dragged.idx,1)[0];
        if(c===undefined) return;
        passwordChars.push(c);
        dragged=null;
        renderTiles();
        renderDeck();
        updateStrength();
      } else if(dragged.source==='password'){
        var moved=passwordChars.splice(dragged.idx,1)[0];
        passwordChars.push(moved);
        dragged=null;
        renderTiles();
        updateStrength();
      }
    });
    els.deck.addEventListener('dragover', function(e){
      if(locked || !dragged) return;
      if(dragged.source!=='password') return;
      e.preventDefault();
      if(e.dataTransfer) e.dataTransfer.dropEffect='move';
      els.deck.classList.add('drag-over');
    });
    els.deck.addEventListener('dragleave', function(e){
      if(!e.relatedTarget || !els.deck.contains(e.relatedTarget)){
        els.deck.classList.remove('drag-over');
      }
    });
    els.deck.addEventListener('drop', function(e){
      if(locked || !dragged) return;
      if(dragged.source!=='password') return;
      e.preventDefault();
      e.stopPropagation();
      els.deck.classList.remove('drag-over');
      var returned=passwordChars.splice(dragged.idx,1)[0];
      if(returned===undefined) return;
      var targetTile=e.target.closest ? e.target.closest('.pp-deck-tile') : null;
      if(targetTile && targetTile.dataset.idx!=null){
        var tIdx=parseInt(targetTile.dataset.idx,10);
        if(!isNaN(tIdx)) deckChars.splice(tIdx,0,returned);
        else deckChars.push(returned);
      } else {
        deckChars.push(returned);
      }
      dragged=null;
      renderTiles();
      renderDeck();
      updateStrength();
    });
  }
  initDrops();

  function renderRound(){
    var r=rounds[index];
    if(!r) return;
    els.counter.textContent=r.label+' of '+rounds.length;
    var difficulty=r.difficulty || 'medium';
    currentWeak=generateWeakPassword(difficulty);
    deckChars=generateDeck(difficulty, currentWeak);
    passwordChars=[];
    locked=false;
    if(els.weakText) els.weakText.textContent=currentWeak;
    if(els.weakMeta){
      var meta = difficulty==='easy' ? 'Based on: name + birth year — very guessable (e.g. rahul1998)' : difficulty==='medium' ? 'Based on: Name + Place + year — still personal (e.g. RahulMumbai98)' : 'Based on: Name_Place_Year + symbol — looks strong but personal data remains';
      els.weakMeta.textContent = meta + ' — deck has ' + DECK_SIZE + ' chars to rebuild strong (upper, symbol, number, phrase)';
    }
    els.solvedBtn.disabled=true;
    els.solvedBtn.classList.remove('pulse-highlight');
    if(els.rememberCard) els.rememberCard.classList.add('le-hidden');
    renderTiles();
    renderDeck();
    updateStrength();
    var isLast=index===rounds.length-1;
    els.nextBtn.innerHTML=isLast ? '<i class="fa-solid fa-rotate"></i> Restart — Back to Start' : '<i class="fa-solid fa-forward"></i> Next Round';
    if(timer) timer.stop();
    timer=LiveEvent.createTimer(els.timerEl, TIMER_SECONDS, { onExpire: function(){} });
    timer.start();
    renderDots();
  }

  function goTo(newIndex){
    if(newIndex<0 || newIndex>=rounds.length) return;
    index=newIndex;
    renderRound();
  }
  function next(){
    if(index < rounds.length -1){ goTo(index+1); return; }
    index=0;
    renderRound();
  }
  function prev(){ if(index>0) goTo(index-1); }
  function solved(){
    if(locked) return;
    locked=true;
    els.solvedBtn.disabled=true;
    els.solvedBtn.classList.remove('pulse-highlight');
    if(els.tiles){ els.tiles.style.borderColor='#10b981'; els.tiles.style.background='#ecfdf5'; }
    if(timer) timer.stop();
    if(index===rounds.length-1 && els.rememberCard){
      els.rememberText.textContent=rememberThisText;
      els.rememberCard.classList.remove('le-hidden');
    }
  }

  // Brief framing screen before the rounds start — see console.css's
  // "UNDERSTANDING LAYER" section. One screen, no timer, dismissed by Start.
  function beginActivity(){
    if(!contentData) return;
    els.introScreen.classList.add('le-hidden');
    els.activityBody.classList.remove('le-hidden');
    renderRound();
  }

  function dismissIntro(){
    if(introDismissed) return;
    introDismissed=true;
    beginActivity();
  }

  if(els.introStartBtn) els.introStartBtn.addEventListener('click', dismissIntro);

  els.solvedBtn.addEventListener('click', solved);
  els.nextBtn.addEventListener('click', next);
  LiveEvent.onAction({
    advance: function(){ if(!introDismissed){ dismissIntro(); return; } next(); },
    next: function(){ if(!introDismissed){ dismissIntro(); return; } next(); },
    prev: function(){ if(introDismissed) prev(); }
  });

  fetch('../content/pass-phrase.json')
    .then(function(r){ return r.json(); })
    .then(function(data){
      if(Array.isArray(data)) rounds=data;
      else if(data && Array.isArray(data.rounds)) rounds=data.rounds;
      else rounds=[];
      // ensure difficulty present
      rounds.forEach(function(rd){
        if(!rd.difficulty) rd.difficulty='medium';
      });
      rememberThisText = data.rememberThis || '';
      if(els.introText) els.introText.textContent = data.whyThisMatters || '';
      contentData = data;
      if(introDismissed) beginActivity();
    })
    .catch(function(err){
      if(els.tiles) els.tiles.textContent='FAILED TO LOAD CONTENT';
      console.error(err);
    });
})();
