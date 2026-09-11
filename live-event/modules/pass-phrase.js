/* Pass-Phrase - Build a Strong Password (mixed-length-chunk deck, difficulty ramp)
   Rebalanced 15-chunk decks (was 20) with scarce premium pool: only 2-3 upper/symbol/number
   chunks per deck so Very Strong takes genuine choice. Rounds provide difficulty; weak
   sample + deck (1-char singles, 2-char pairs like "Ka","Th", 3-char fragments like
   "Syn","Sec") are either static content (content/pass-phrase.json) or generated at
   runtime weighted by difficulty. Capped by total character count (PP_MAX_CHARS = 15)
   not tile count - a "Syn" tile counts as 3 toward the 15-char cap. Deck (15) still
   offers real choice but no surplus. Strength meter only + facilitator hint + shuffle. */
(function () {
  const TIMER_SECONDS = 45;
  const MAX_SLOTS = 12; // legacy tile-count cap, kept for old single-char content fallback
  const MAX_CHARS = 15; // chunk-aware cap: total characters reached, not deck tiles (now 15 per request)
  let rounds = [];
  // Each of the 5 rounds now expands into TWO steps - Choose (pick the compliant password
  // among 4) then Build (existing tap-chunks mechanic) - so a 5-round content file drives a
  // 10-step sequence: Choose1, Build1, Choose2, Build2, ... `index` below indexes into `steps`,
  // not `rounds` directly - use `steps[index].round` wherever the old code read `rounds[index]`.
  let steps = [];
  let index = 0;
  let locked = false;
  let timer = null;
  let prevTierLevel = null;
  let shuffleUsed = false;

  let passwordChunks = []; // array of chunks (each is 1-3 char string) placed in password row
  let deckChunks = []; // array of remaining deck chunks
  let currentWeak = '';
  let dragged = null;

  // Keep legacy aliases for minimal diff elsewhere (will be reassigned)
  let passwordChars = passwordChunks;
  let deckChars = deckChunks;

  // ----- Pools - meaningful weak templates + mixed-length chunk deck -----
  // Rebalanced deck is 15 mixed chunks: 1-3 char fragments + 2-char pairs + singles.
  // Easy leans on more 3-char fragments (length fast), hard on fewer + weak-contaminated
  // filler so Very Strong needs deliberate premium picks. Only 2-3 upper/symbol/number
  // singles per deck — scarce by design (see app.py _pp_generate_deck docstring).
  const DECK_SIZE = 15;
  const NAMES = ["Rahul","Priya","Amit","Neha","Arjun","Sneha","Vikram","Ananya","Rohan","Isha","Karan","Meera"];
  const PLACES = ["Mumbai","Delhi","Chennai","Kolkata","Goa","Pune","Jaipur","Kochi","Hyderabad"];
  const YEARS = ["1998","1999","2000","2001","2002","2003","1995","1990","1992"];
  const PHRASE_WORDS = ["Ocean","Voyage","Anchor","Harbor","Bridge","Compass","Horizon","Voyager","Marina","Delta"];
  const UPPER_POOL = (function(){ var a=[]; for(var i=65;i<=90;i++) a.push(String.fromCharCode(i)); return a; })();
  const LOWER_POOL = (function(){ var a=[]; for(var i=97;i<=122;i++) a.push(String.fromCharCode(i)); return a; })();
  const NUM_POOL = (function(){ var a=[]; for(var i=48;i<=57;i++) a.push(String.fromCharCode(i)); return a; })();
  const SYM_POOL = ['!','@','#','$','%','^','&','*','-','_','+','=','?','~','<','>'];
  const CHUNK_TWO_POOL = ["Ka","Ri","Th","On","An","Re","Co","Ma","Be","Su","Un","Ex","Mi","Tr","Ch","Sh","Pr","St","Li","En","Or","Al","El","Ar","on","th","an","er","in"];
  const CHUNK_THREE_POOL = ["Syn","Sec","Net","Cyb","Log","Key","Byt","Cod","Def","Hak","Bot","Vpn","Pwd","Enc","Fir","Wal","Loc","Saf","Gua","Shi"];

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
  function randomChunks(pool, count, allowDup){
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
      // Easy: pure personal data, all lowercase, short - e.g. rahul1998, neha2001, mumbai123
      if(Math.random() < 0.5) return name.toLowerCase() + year.slice(-2);
      if(Math.random() < 0.5) return place.toLowerCase() + String(100 + Math.floor(Math.random()*900));
      return name.toLowerCase() + String(Math.floor(Math.random()*900)+100);
    } else if(difficulty === 'medium'){
      // Medium: Name + Place/Year pattern - RahulMumbai98, PriyaGoa2001 - has upper but still predictable
      var base = name + place + year.slice(-2);
      // 30% chance lower first letter to keep it familiar
      if(Math.random() < 0.3) base = base.charAt(0).toLowerCase() + base.slice(1);
      return base;
    } else {
      // Hard: Name_Place_Year with one symbol but still personal - Rahul_Mumbai1998, Priya#Goa2001!
      var sep = pickRandom(['_','-','@','#']);
      var tail = Math.random() < 0.5 ? year : year.slice(-2);
      var hard = name + sep + place + tail;
      if(Math.random() < 0.3) hard += pickRandom(SYM_POOL.slice(0,6));
      return hard;
    }
  }

  function generateDeck(difficulty, weak){
    // Rebalanced 15-chunk deck - scarce premium pool (2-3 per type) + difficulty-shaped
    // length mix. Easy: 3×3-char +3×2-char (length fast), Medium: 2×3+3×2, Hard:
    // 1×3+2×2 plus weak-contaminated filler so optimal must dodge weak penalty.
    // Mirrors _pp_generate_deck in app.py exactly.
    var hasUpper = /[A-Z]/.test(weak);
    var hasNum = /[0-9]/.test(weak);
    var hasSym = /[^A-Za-z0-9]/.test(weak);
    var missingUpper = !hasUpper;
    var missingNum = !hasNum;
    var missingSym = !hasSym;
    var threeCount, twoCount, upperCount, symCount, numCount, allowDup;
    if(difficulty === 'easy'){
      threeCount = 3;
      twoCount = 3;
      upperCount = 2;
      symCount = 2;
      numCount = 2;
      allowDup = false;
    } else if(difficulty === 'medium'){
      threeCount = 2;
      twoCount = 3;
      upperCount = 2;
      symCount = 2;
      numCount = 2;
      allowDup = false;
    } else {
      threeCount = 1;
      twoCount = 2;
      upperCount = 1;
      if(missingUpper && Math.random() < 0.4) upperCount = 2;
      symCount = 1;
      if(missingSym && Math.random() < 0.5) symCount = 2;
      numCount = 1;
      if(missingNum && Math.random() < 0.35) numCount = 2;
      allowDup = Math.random() < 0.3;
    }
    var deck = [];
    deck = deck.concat(randomChunks(CHUNK_THREE_POOL, threeCount, allowDup));
    deck = deck.concat(randomChunks(CHUNK_TWO_POOL, twoCount, allowDup));
    deck = deck.concat(randomChars(UPPER_POOL, upperCount, allowDup));
    deck = deck.concat(randomChars(SYM_POOL, symCount, allowDup));
    deck = deck.concat(randomChars(NUM_POOL, numCount, allowDup));
    var lowerNeeded = DECK_SIZE - deck.length;
    lowerNeeded = Math.max(2, lowerNeeded);

    if(difficulty === 'hard'){
      var weakLowers = weak.split('').filter(function(c){ return /[a-z]/.test(c); });
      var lowers = [];
      for(var i=0;i<lowerNeeded;i++){
        var r = Math.random();
        if(r < 0.45 && weakLowers.length){
          lowers.push(weakLowers[Math.floor(Math.random()*weakLowers.length)]);
        } else if(r < 0.70){
          lowers.push(LOWER_POOL[Math.floor(Math.random()*LOWER_POOL.length)]);
        } else if(r < 0.85){
          lowers.push(SYM_POOL[Math.floor(Math.random()*SYM_POOL.length)]);
        } else {
          lowers.push(NUM_POOL[Math.floor(Math.random()*NUM_POOL.length)]);
        }
      }
      for(var d=0; d<2; d++){
        if(Math.random() < 0.5 && deck.length){
          var dup = deck[Math.floor(Math.random()*deck.length)];
          lowers[d % lowers.length] = dup;
        }
      }
      deck = deck.concat(lowers);
    } else if(difficulty === 'medium'){
      var weakLowersM = weak.split('').filter(function(c){ return /[a-z]/.test(c); });
      var lowersM = [];
      for(var i=0;i<lowerNeeded;i++){
        if(weakLowersM.length && Math.random() < 0.18) lowersM.push(weakLowersM[Math.floor(Math.random()*weakLowersM.length)]);
        else lowersM.push(LOWER_POOL[Math.floor(Math.random()*LOWER_POOL.length)]);
      }
      deck = deck.concat(lowersM);
    } else {
      deck = deck.concat(randomChars(LOWER_POOL, lowerNeeded, allowDup));
    }
    deck = shuffled(deck).slice(0, DECK_SIZE);
    if(difficulty !== 'hard'){
      if(missingUpper && !deck.some(function(c){ return /[A-Z]/.test(c); })) deck[0] = pickRandom(UPPER_POOL);
      if(missingSym && !deck.some(function(c){ return /[^A-Za-z0-9]/.test(c); })) deck[1] = pickRandom(SYM_POOL);
      if(missingNum && !deck.some(function(c){ return /[0-9]/.test(c); })) deck[2] = pickRandom(NUM_POOL);
    } else {
      if(missingUpper && !deck.some(function(c){ return /[A-Z]/.test(c); })) deck[0] = pickRandom(UPPER_POOL);
      if(missingSym && !deck.some(function(c){ return /[^A-Za-z0-9]/.test(c); })) deck[1] = pickRandom(SYM_POOL);
      if(missingNum && !deck.some(function(c){ return /[0-9]/.test(c); })) deck[2] = pickRandom(NUM_POOL);
    }
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
    introPolicy: document.getElementById('introPolicy'),
    introStartBtn: document.getElementById('introStartBtn'),
    hintBar: document.getElementById('facilitatorHintBar'),
    hintText: document.getElementById('hintBarText'),
    shuffleBtn: document.getElementById('shuffleBtn'),
    themeEyebrow: document.getElementById('themeEyebrow'),
    weakViolates: document.getElementById('weakViolates'),
    chooseWrap: document.getElementById('chooseWrap'),
    choosePrompt: document.getElementById('choosePrompt'),
    chooseOptions: document.getElementById('chooseOptions'),
    chooseReveal: document.getElementById('chooseReveal'),
    buildWrap: document.getElementById('buildWrap')
  };
  let rememberThisText = '';
  let contentData = null;
  let introDismissed = false;

  function renderDots(){
    els.dots.innerHTML = steps.map(function(s,i){
      var cls = i===index ? 'dot current' : (i < index ? 'dot done' : 'dot');
      cls += s.type === 'choose' ? ' dot-choose' : ' dot-build';
      var roundNum = Math.floor(i/2)+1;
      var label = s.type==='choose' ? 'R'+roundNum+' Choose' : 'R'+roundNum+' Build';
      return '<button type="button" class="'+cls+'" data-jump="'+i+'" aria-label="Go to '+label+'" title="'+label+' ('+(i+1)+'/'+steps.length+')"></button>';
    }).join('');
    Array.from(els.dots.querySelectorAll('[data-jump]')).forEach(function(btn){
      btn.addEventListener('click', function(){ goTo(Number(btn.dataset.jump)); });
    });
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
    var crack=' - ';
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

  // Theoretical best for this round's deck (admin facilitator hint - brute force 2^15)
  function computeTheoreticalBest(deck, weak){
    var n = deck.length;
    var best = {score:0, label:'Weak', level:'weak'};
    if(n <= 16){
      var totalMasks = 1 << n;
      for(var mask=0; mask<totalMasks; mask++){
        var pw = '';
        var len = 0;
        var ok = true;
        for(var i=0;i<n;i++) if((mask>>i)&1){
          var ch = String(deck[i]);
          len += ch.length;
          if(len > MAX_CHARS){ ok=false; break; }
          pw += ch;
        }
        if(!ok) continue;
        var res = computeStrength(pw, weak);
        if(res.score > best.score){
          best = res;
          best.password = pw;
          if(best.score===100) break;
        }
      }
      return best;
    }
    // fallback sampling
    var bestScore=0, bestRes={score:0,label:'Weak',level:'weak'};
    for(var s=0;s<1200;s++){
      var pw2='';
      for(var i=0;i<n;i++) if(Math.random()<0.5) pw2+=String(deck[i]);
      if(pw2.length>MAX_CHARS) pw2=pw2.slice(0,MAX_CHARS);
      var r2=computeStrength(pw2, weak);
      if(r2.score>bestScore){ bestScore=r2.score; bestRes=r2; bestRes.password=pw2; }
    }
    return bestRes;
  }
  function computeCeilingWithRemaining(currentPw, remainingDeck, weak){
    var curLen = currentPw.length;
    if(curLen >= MAX_CHARS) return computeStrength(currentPw, weak);
    var best = computeStrength(currentPw, weak);
    var n = remainingDeck.length;
    if(n===0) return best;
    if(n <= 15){
      var totalMasks = 1 << n;
      for(var mask=0; mask<totalMasks; mask++){
        var add='';
        var addLen=0;
        var ok=true;
        for(var i=0;i<n;i++) if((mask>>i)&1){
          var ch=String(remainingDeck[i]);
          addLen+=ch.length;
          if(curLen+addLen > MAX_CHARS){ ok=false; break; }
          add+=ch;
        }
        if(!ok) continue;
        var pw = currentPw + add;
        var res = computeStrength(pw, weak);
        if(res.score > best.score){
          best=res;
          if(best.score===100) break;
        }
      }
      return best;
    }
    return best;
  }
  function updateFacilitatorHint(){
    if(!els.hintBar || !els.hintText) return;
    // Admin-only hint: show theoretical ceiling given what's left (remaining deck + current)
    var pw = getPasswordStr();
    var ceiling = computeCeilingWithRemaining(pw, deckChunks.slice(), currentWeak);
    var bestOverall = computeTheoreticalBest(deckChunks.concat(passwordChunks), currentWeak);
    // deckChunks+passwordChunks is the full original deck for this round
    var overallBestScore = bestOverall.score;
    var pct = overallBestScore ? Math.round((ceiling.score / overallBestScore)*100) : 0;
    var curScore = computeStrength(pw, currentWeak).score;
    var curPct = overallBestScore ? Math.round((curScore / overallBestScore)*100) : 0;
    els.hintText.textContent = 'Facilitator — ceiling with what\'s left: ' + ceiling.score + ' /100 (' + ceiling.label + ', ' + pct + '% of round best ' + overallBestScore + ') · current: ' + curScore + ' (' + curPct + '% of best) · overall best: ' + overallBestScore + ' (' + bestOverall.label + ')';
    els.hintBar.classList.remove('le-hidden');
  }

  function getPasswordStr(){ return passwordChunks.join(''); }
  function getTotalChars(){ return getPasswordStr().length; }

  function updateStrength(){
    var pw=getPasswordStr();
    var result=computeStrength(pw, currentWeak);
    els.meterFill.style.width=result.score+'%';
    els.meterFill.style.background=result.color;
    els.strengthScore.textContent=result.score+' / 100';
    els.strengthLabel.textContent='Strength: '+result.label;
    els.strengthLabel.style.color=result.color;
    els.crackTime.textContent=result.crack;
    if(els.countLabel){
      els.countLabel.textContent=pw.length+' / '+MAX_CHARS+' chars';
      els.countLabel.style.color=pw.length>=MAX_CHARS ? '#b45309' : 'var(--muted)';
    }
    els.tiles.className='pp-tiles strength-'+result.level;
    els.tiles.style.borderColor=result.level==='weak' ? '#fecaca' : result.level==='fair' ? '#fde68a' : result.level==='strong' || result.level==='very-strong' ? '#6ee7b7' : 'var(--line)';
    els.tiles.style.background=result.level==='weak' ? '#fef2f2' : result.level==='fair' ? '#fffbeb' : result.level==='strong' || result.level==='very-strong' ? '#f0fdf4' : '#fff';
    if(getTotalChars()>=MAX_CHARS) els.tiles.classList.add('is-full');
    else els.tiles.classList.remove('is-full');
    // Tier-crossing pulse animation — brief flash on the meter bar itself
    if(prevTierLevel && prevTierLevel !== result.level){
      els.meterFill.classList.remove('tier-pulse');
      // force reflow to restart animation
      void els.meterFill.offsetWidth;
      els.meterFill.classList.add('tier-pulse');
      els.tiles.classList.remove('tier-pulse');
      void els.tiles.offsetWidth;
      els.tiles.classList.add('tier-pulse');
      setTimeout(function(){
        if(els.meterFill) els.meterFill.classList.remove('tier-pulse');
        if(els.tiles) els.tiles.classList.remove('tier-pulse');
      }, 700);
    }
    prevTierLevel = result.level;
    var canSolve=(result.level==='strong' || result.level==='very-strong') && !locked;
    els.solvedBtn.disabled=!canSolve;
    if(canSolve) els.solvedBtn.classList.add('pulse-highlight');
    else els.solvedBtn.classList.remove('pulse-highlight');
    if(els.deck) els.deck.classList.toggle('deck-full', getTotalChars()>=MAX_CHARS);
    // Facilitator-only ceiling hint (admin view, not participant-facing)
    try{ updateFacilitatorHint(); }catch(e){}
    // shuffle button state
    if(els.shuffleBtn){
      els.shuffleBtn.disabled = locked || shuffleUsed || deckChunks.length===0;
      els.shuffleBtn.style.opacity = (locked || shuffleUsed) ? '0.45' : '1';
    }
    return result;
  }

  function createDeckTile(ch, idx){
    var tile=document.createElement('div');
    tile.className='pp-tile pp-deck-tile';
    var isFull=getTotalChars() + String(ch).length > MAX_CHARS;
    tile.draggable=!locked && !isFull;
    if(isFull) tile.classList.add('is-inert');
    tile.dataset.source='deck';
    tile.dataset.idx=String(idx);
    tile.innerHTML='<span class="pp-tile-letter">'+LiveEvent.escapeHtml(ch)+'</span>';
    // Chunk tiles may be 2-char like "Ka" or 3-char like "Syn" - slightly wider but still
    // touch-friendly; each length gets its own width/font-size step (see console.css).
    var chLen = String(ch).length;
    if(chLen>=3) tile.classList.add('chunk-tile3');
    else if(chLen===2) tile.classList.add('chunk-tile');
    tile.addEventListener('dragstart', function(e){
      if(locked || getTotalChars() + String(ch).length > MAX_CHARS){ e.preventDefault(); return; }
      dragged={source:'deck', idx:idx, char:ch};
      tile.classList.add('dragging');
      try{ e.dataTransfer.setData('text/plain', ch); }catch(err){}
      e.dataTransfer.effectAllowed='copyMove';
    });
    tile.addEventListener('dragend', function(){ tile.classList.remove('dragging'); dragged=null; });
    tile.addEventListener('click', function(){
      if(locked || getTotalChars() + String(ch).length > MAX_CHARS) return;
      var removed=deckChunks.splice(idx,1)[0];
      passwordChunks.push(removed);
      // keep aliases in sync
      passwordChars = passwordChunks; deckChars = deckChunks;
      renderTiles();
      renderDeck();
      updateStrength();
    });
    return tile;
  }

  function renderDeck(){
    if(!els.deck) return;
    els.deck.innerHTML='';
    deckChunks.forEach(function(ch,i){
      els.deck.appendChild(createDeckTile(ch,i));
    });
    if(deckChunks.length===0){
      var empty=document.createElement('div');
      empty.className='pp-deck-empty';
      empty.textContent=' - ';
      els.deck.appendChild(empty);
    }
  }

  function renderTiles(){
    els.tiles.innerHTML='';
    passwordChunks.forEach(function(ch,i){
      var tile=document.createElement('div');
      tile.className='pp-tile';
      var chLen=String(ch).length;
      if(chLen>=3) tile.classList.add('chunk-tile3');
      else if(chLen===2) tile.classList.add('chunk-tile');
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
          var moved=passwordChunks.splice(dragged.idx,1)[0];
          var targetIdx=dragged.idx < i ? i-1 : i;
          passwordChunks.splice(targetIdx + (dragged.idx < i ? 1 : 0), 0, moved);
          passwordChars = passwordChunks;
        } else if(dragged.source==='deck'){
          // Check char cap before inserting at position i
          var newTotal = getTotalChars() + String(dragged.char).length;
          if(newTotal > MAX_CHARS) return;
          var deckChar=deckChunks.splice(dragged.idx,1)[0];
          passwordChunks.splice(i,0,deckChar);
          passwordChars = passwordChunks; deckChars = deckChunks;
        }
        dragged=null;
        renderTiles();
        renderDeck();
        updateStrength();
      });
      tile.addEventListener('dblclick', function(){
        if(locked) return;
        var returned=passwordChunks.splice(i,1)[0];
        deckChunks.push(returned);
        passwordChars = passwordChunks; deckChars = deckChunks;
        renderTiles();
        renderDeck();
        updateStrength();
      });
      els.tiles.appendChild(tile);
    });
    // Empty placeholders reflect remaining char capacity (not tile count) - chunk-aware
    var totalChars = getTotalChars();
    var remaining= Math.max(0, MAX_CHARS - totalChars);
    // Show at most 12 placeholders visually to avoid overflow, but ensure char cap is clear in label
    var placeholders = Math.min(remaining, 8);
    // If already many tiles, show fewer placeholders to keep row readable at 375px
    if(passwordChunks.length > 6) placeholders = Math.min(placeholders, 4);
    for(var s=0;s<placeholders;s++){
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
        if(dragged.source==='deck' && getTotalChars() + String(dragged.char).length > MAX_CHARS) return;
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
        if(getTotalChars() + String(dragged.char).length > MAX_CHARS) return;
        var c=deckChunks.splice(dragged.idx,1)[0];
        if(c===undefined) return;
        passwordChunks.push(c);
        passwordChars = passwordChunks; deckChars = deckChunks;
        dragged=null;
        renderTiles();
        renderDeck();
        updateStrength();
      } else if(dragged.source==='password'){
        var moved=passwordChunks.splice(dragged.idx,1)[0];
        passwordChunks.push(moved);
        passwordChars = passwordChunks;
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
      var returned=passwordChunks.splice(dragged.idx,1)[0];
      if(returned===undefined) return;
      var targetTile=e.target.closest ? e.target.closest('.pp-deck-tile') : null;
      if(targetTile && targetTile.dataset.idx!=null){
        var tIdx=parseInt(targetTile.dataset.idx,10);
        if(!isNaN(tIdx)) deckChunks.splice(tIdx,0,returned);
        else deckChunks.push(returned);
      } else {
        deckChunks.push(returned);
      }
      passwordChars = passwordChunks; deckChars = deckChunks;
      dragged=null;
      renderTiles();
      renderDeck();
      updateStrength();
    });
  }
  initDrops();

  function doShuffle(){
    if(locked || shuffleUsed) return;
    if(deckChunks.length < 3) return;
    // Swap 3-4 unused deck chunks for fresh ones (same difficulty pool mix)
    var r = steps[index] && steps[index].round;
    var difficulty = (r && r.difficulty) || 'medium';
    var count = Math.min(4, Math.max(3, Math.floor(Math.random()*2)+3));
    count = Math.min(count, deckChunks.length);
    // Preserve current deck's composition pools for shuffle: pick fresh random chunks
    // from same pools (upper/symbol/num/lower) to keep difficulty curve intact.
    var fresh = [];
    // Use generateDeck helper pools: for simplicity, generate a fresh deck and take first `count`
    // unused-like chunks that are not already in remaining deck to ensure variety.
    var tmpWeak = currentWeak || generateWeakPassword(difficulty);
    var tmpDeck = generateDeck(difficulty, tmpWeak);
    // Filter tmpDeck to chunks not already abundant in current deck (avoid duplicate flood)
    var available = tmpDeck.filter(function(ch){ return deckChunks.indexOf(ch)===-1; });
    if(available.length < count) available = tmpDeck.slice();
    available = shuffled(available);
    fresh = available.slice(0, count);
    // Replace: pick random indices in deckChunks to swap
    var idxs = [];
    while(idxs.length < count){
      var rIdx = Math.floor(Math.random()*deckChunks.length);
      if(idxs.indexOf(rIdx)===-1) idxs.push(rIdx);
    }
    idxs.forEach(function(idx, j){
      deckChunks[idx] = fresh[j % fresh.length];
    });
    shuffleUsed = true;
    if(els.shuffleBtn){
      els.shuffleBtn.disabled = true;
      els.shuffleBtn.innerHTML = '<i class="fa-solid fa-shuffle"></i> Shuffled (1/1 used)';
    }
    renderDeck();
    updateStrength();
  }
  if(els.shuffleBtn) els.shuffleBtn.addEventListener('click', doShuffle);

  // Shared chrome (counter/timer/dots/Next label) for BOTH step types, then dispatches to
  // whichever phase-specific renderer applies. External callers (goTo/next/prev/dismissIntro/
  // LiveEvent.onAction) only ever call renderRound() - unchanged surface, so nothing else in
  // this file needs to know steps vs rounds exists.
  function renderRound(){
    var step = steps[index];
    if(!step) return;
    var roundNum = Math.floor(index/2)+1;
    var totalRounds = rounds.length;
    var phaseLabel = step.type==='choose' ? 'Choose' : 'Build';
    els.counter.textContent = 'Round ' + roundNum + ' of ' + totalRounds + ' \u00b7 ' + phaseLabel + '  \u00b7  Step ' + (index+1) + ' of ' + steps.length;
    if(els.rememberCard) els.rememberCard.classList.add('le-hidden');
    var isLast = index === steps.length - 1;
    els.nextBtn.innerHTML = isLast ? '<i class="fa-solid fa-rotate"></i> Restart - Back to Start' : '<i class="fa-solid fa-forward"></i> Next';
    // Gentle pulse on Next when Choose is already answered (so facilitator knows to move on)
    if(step.type==='choose' && choosePicked) els.nextBtn.classList.add('pulse-highlight');
    else if(step.type==='build' && locked) els.nextBtn.classList.add('pulse-highlight');
    else els.nextBtn.classList.remove('pulse-highlight');
    if(timer) timer.stop();
    timer = LiveEvent.createTimer(els.timerEl, TIMER_SECONDS, { onExpire: function(){} });
    timer.start();
    renderDots();
    if(step.type === 'choose') renderChoosePhase(step.round);
    else renderBuildPhase(step.round);
  }

  // Choose phase - 4 candidate passwords, exactly one actually compliant with the stated
  // policy (content's top-level "policy" string, shown on the intro screen). Select-then-reveal
  // pattern matching clue-quest.js's own .cq-option mechanic (disable-after-pick, correct/
  // incorrect coloring) - namespaced .pp-choice-* here since candidate strings run longer than
  // clue-quest's short answers. Shuffled fresh each visit so replaying a round doesn't always
  // put the compliant option in the same slot.
  var choosePicked = false;
  var currentChoices = null;
  function renderChoosePhase(r){
    if(els.themeEyebrow) els.themeEyebrow.textContent = 'Choose the Compliant Password - pick the one that actually meets the policy';
    if(els.chooseWrap) els.chooseWrap.classList.remove('le-hidden');
    if(els.buildWrap) els.buildWrap.classList.add('le-hidden');
    els.solvedBtn.style.display = 'none';
    choosePicked = false;
    currentChoices = shuffled(r.choices || []);
    if(els.chooseReveal){ els.chooseReveal.classList.add('le-hidden'); els.chooseReveal.innerHTML = ''; }
    if(els.chooseOptions){
      els.chooseOptions.innerHTML = currentChoices.map(function(c,i){
        return '<button type="button" class="pp-choice-btn" data-choice-idx="'+i+'">'+LiveEvent.escapeHtml(c.text)+'</button>';
      }).join('');
      Array.from(els.chooseOptions.children).forEach(function(btn){
        btn.addEventListener('click', function(){
          if(choosePicked) return;
          choosePicked = true;
          var idx = parseInt(btn.dataset.choiceIdx, 10);
          var picked = currentChoices[idx];
          Array.from(els.chooseOptions.children).forEach(function(b, bi){
            b.disabled = true;
            var c = currentChoices[bi];
            if(c.compliant) b.classList.add('correct');
            else if(bi===idx) b.classList.add('incorrect');
          });
          if(els.chooseReveal){
            var verdictLine = picked.compliant
              ? '<div class="pp-choice-verdict correct"><i class="fa-solid fa-check"></i> Correct - that one is compliant.</div>'
              : '<div class="pp-choice-verdict incorrect"><i class="fa-solid fa-xmark"></i> Not quite - that one breaks the policy too.</div>';
            var lines = currentChoices.map(function(c){
              return '<div>' + (c.compliant ? '✓ Compliant' : '✗ Violates') + ' — "' + LiveEvent.escapeHtml(c.text) + '": ' + LiveEvent.escapeHtml(c.reason||'') + '</div>';
            }).join('');
            els.chooseReveal.innerHTML = verdictLine + '<div class="pp-choice-reveal-lines">' + lines + '</div>';
            els.chooseReveal.classList.remove('le-hidden');
          }
          // Nudge facilitator onward — pulse Next once Choose is resolved
          if(els.nextBtn) els.nextBtn.classList.add('pulse-highlight');
        });
      });
    }
  }

  // Build phase - unchanged tap-chunks-from-deck mechanic, just renamed from the old
  // renderRound() and taking the round object as a param instead of reading rounds[index]
  // directly (index now points into `steps`, not `rounds` - see renderRound above).
  function renderBuildPhase(r){
    if(!r) return;
    if(els.themeEyebrow) els.themeEyebrow.textContent = 'Weak to Strong - Live Builder - 15 tiles, 15-character limit (scarce premium pool)';
    if(els.chooseWrap) els.chooseWrap.classList.add('le-hidden');
    if(els.buildWrap) els.buildWrap.classList.remove('le-hidden');
    els.solvedBtn.style.display = '';
    var difficulty=r.difficulty || 'medium';
    // If content already provides weakPassword/deck (new chunk deck), use those directly
    // so the console matches the static content the phone sees, rather than regenerating
    // random each render (old behavior). Fallback to generation only if missing.
    if(r.weakPassword && Array.isArray(r.deck)){
      currentWeak = r.weakPassword;
      deckChunks = r.deck.slice();
    } else {
      currentWeak=generateWeakPassword(difficulty);
      deckChunks=generateDeck(difficulty, currentWeak);
    }
    passwordChunks=[];
    passwordChars = passwordChunks; deckChars = deckChunks;
    locked=false;
    shuffleUsed=false;
    prevTierLevel=null;
    if(els.shuffleBtn){
      els.shuffleBtn.disabled=false;
      els.shuffleBtn.innerHTML='<i class="fa-solid fa-shuffle"></i> Shuffle Deck (once per round)';
    }
    if(els.weakText) els.weakText.textContent=currentWeak;
    if(els.weakViolates){
      if(r.violates){
        els.weakViolates.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> Violates: ' + LiveEvent.escapeHtml(r.violates);
        els.weakViolates.classList.remove('le-hidden');
      } else {
        els.weakViolates.classList.add('le-hidden');
      }
    }
    if(els.weakMeta){
      var hint = r.hint || '';
      var req = hint.indexOf(' - ')>-1 ? hint.split(' - ').slice(1).join(' - ').trim() : '';
      var diffLabel = difficulty.charAt(0).toUpperCase()+difficulty.slice(1);
      var twoCt = deckChunks.filter(function(c){return String(c).length===2;}).length;
      var threeCt = deckChunks.filter(function(c){return String(c).length>=3;}).length;
      if(req){
        els.weakMeta.textContent = diffLabel+' - ' + req + ' - deck has ' + DECK_SIZE + ' chunks (' + twoCt + ' ×2-char, ' + threeCt + ' ×3-char) to rebuild strong (cap '+MAX_CHARS+' chars)';
      } else {
        var metaBase = difficulty==='easy' ? 'Based on: name + birth year - very guessable (e.g. rahul1998)' : difficulty==='medium' ? 'Based on: Name + Place + year - still personal (e.g. RahulMumbai98)' : 'Based on: Name_Place_Year + symbol - looks strong but personal data remains';
        els.weakMeta.textContent = diffLabel+' - ' + metaBase + ' - deck has ' + DECK_SIZE + ' chunks (' + twoCt + ' ×2-char, ' + threeCt + ' ×3-char) to rebuild strong (cap '+MAX_CHARS+' chars)';
      }
    }
    els.solvedBtn.disabled=true;
    els.solvedBtn.classList.remove('pulse-highlight');
    renderTiles();
    renderDeck();
    updateStrength();
  }

  function goTo(newIndex){
    if(newIndex<0 || newIndex>=steps.length) return;
    index=newIndex;
    renderRound();
  }
  function next(){
    if(index < steps.length -1){ goTo(index+1); return; }
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
    if(els.nextBtn) els.nextBtn.classList.add('pulse-highlight');
    if(timer) timer.stop();
    if(index===steps.length-1 && els.rememberCard){
      els.rememberText.textContent=rememberThisText;
      els.rememberCard.classList.remove('le-hidden');
    }
  }

  // Brief framing screen before the rounds start - see console.css's
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
      // Expand 5 rounds into 10 steps: Choose1, Build1, Choose2, Build2, ... - see the
      // `steps` doc comment near its declaration.
      steps = [];
      rounds.forEach(function(rd){
        steps.push({ type: 'choose', round: rd });
        steps.push({ type: 'build', round: rd });
      });
      rememberThisText = data.rememberThis || '';
      if(els.introText) els.introText.textContent = data.whyThisMatters || '';
      if(els.introPolicy) els.introPolicy.textContent = data.policy || '';
      contentData = data;
      if(introDismissed) beginActivity();
    })
    .catch(function(err){
      if(els.tiles) els.tiles.textContent="Could not load this activity. Check your connection and refresh.";
      console.error(err);
    });
})();
