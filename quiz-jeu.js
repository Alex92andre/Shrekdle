/* The game UI uses only the current question and server-authorized feedback. */
const GAME = {phase:'loading', ohStage:0, state:null, busy:false, retryAt:0};
const quizAPI = ShrekAPI.create('quiz');
const quizEscape = ShrekAPI.escape;
const QUIZ_LEVELS = {easy:'Facile',medium:'Moyen',hard:'Difficile'};
const goodLines = ['Bonne pioche. La porte grince…','Bien. Un grognement d’approbation.','Un cran de plus. Continue.','L’ogre approuve. C’est rare.'];
const badLines = ['Et non. La porte claque d’un cran.','Un grognement sourd dans le noir.','Même l’Âne faisait mieux.','GRRR. La porte s’est refermée.'];
const quizReduced = matchMedia('(prefers-reduced-motion: reduce)');
const quizDate = key => new Date(`${key}T12:00:00Z`);
const dateLabel = key => quizDate(key).toLocaleDateString('fr-FR',{
  timeZone:'UTC',weekday:'long',day:'numeric',month:'long'
});
const mainBox = $('#mainBox');
const animateMain = () => {
  if (!quizReduced.matches) mainBox.animate([{opacity:0,transform:'translateY(10px)'},
    {opacity:1,transform:'translateY(0)'}],{duration:300,easing:'ease-out'});
};

function quizStats() {
  const {day,stats:st} = GAME.state;
  $('#pillN').textContent = st.streak+(st.streak>1?' jours':' jour');
  $('#pill').classList.toggle('zero',st.streak===0);
  $('#streakN').textContent=st.streak; $('#streakU').textContent=st.streak>1?'jours':'jour';
  $('#bestN').textContent=st.best; $('#winsN').textContent=st.wins;
  $('#rightN').textContent=st.totalRight;
  $('#pctN').textContent=st.totalPlayed?'('+Math.round(st.totalRight/(st.totalPlayed*5)*100)+' %)':'';
  $('#flame').classList.toggle('lit',st.streak>0);
  $('#week').replaceChildren(...Array.from({length:7},(_,i) => {
    const d = quizDate(day);
    d.setUTCDate(d.getUTCDate()+i-6);
    const key=d.toISOString().slice(0,10), h=st.history[key], span=document.createElement('span');
    span.className='wd'+(h?(h.ok?' win':' lose'):i===6?' today':'');
    span.title=cap(dateLabel(key))+(h?' — '+h.s+'/5':'');
    return span;
  }));
}
function showQuizError(message) {
  let p = $('#quizError');
  if (!p) {
    p=document.createElement('p'); p.id='quizError'; p.className='fb-note'; p.setAttribute('role','alert');
    mainBox.append(p);
  }
  p.textContent=message;
  if (!$('#quizRetry')) {
    const button=document.createElement('button');
    button.type='button'; button.id='quizRetry'; button.className='btn dark'; button.textContent='Actualiser la partie';
    button.addEventListener('click',refreshQuiz);
    mainBox.append(button);
  }
}
function quizKicker() {
  return `<div class="p-kicker">Quiz du jour — ${cap(dateLabel(GAME.state.day))}</div>`;
}
function renderReady() {
  GAME.phase='ready'; setOh(0,'instant');
  $('#ohSide').style.display='none';
  mainBox.innerHTML=quizKicker()+
    '<h2 class="p-title">Shrek s’est enfermé. Fais-le sortir.</h2>'+
    '<button type="button" class="btn big" id="startBtn">Frapper à la porte →</button>';
  $('#startBtn').addEventListener('click',() => {
    $('#startBtn').disabled=true;
    GAME.phase='entering';
    heroPoke();
    setTimeout(() => {
      if (GAME.phase!=='entering') return;
      showPose('idle',true); setOh(0,'slam'); ohBubble('OCCUPÉ !');
      renderQuestion();
      $('#quizQuestion').focus({preventScroll:true});
    }, quizReduced.matches?0:570);
  });
  animateMain();
}
function renderQuestion(freshFeedback=false) {
  GAME.phase='quiz';
  const {question:q,step,feedback:fb,marks} = GAME.state;
  mainBox.innerHTML=
    `<span class="q-count">Question ${step+1} / 5 · <span class="lvl ${q.level}">${QUIZ_LEVELS[q.level]}</span></span>`+
    `<h3 class="q-text" id="quizQuestion" tabindex="-1">${quizEscape(q.text)}</h3>`+
    '<div class="opts">'+q.options.map((o,k) => {
      const kind=!fb?'':k===fb.correct?' correct':k===fb.selected?' wrong':' dim';
      return `<button type="button" class="opt${kind}" data-k="${k}"${fb?' disabled':''}>`+
        `<span class="key">${'ABCD'[k]}</span><span>${quizEscape(o)}</span></button>`;
    }).join('')+'</div><div class="feedback" id="fb"></div>';
  mainBox.querySelectorAll('.opt').forEach(button=>button.addEventListener('click',()=>quizTurn('answer',{choice:Number(button.dataset.k)})));
  const rights=marks.filter(Boolean).length;
  if (!freshFeedback || quizReduced.matches) setOh(rights,'instant');
  if (fb) {
    if (freshFeedback && !quizReduced.matches) {
      if (fb.ok) {
        setOh(rights,'open'); ohBubble(rights===5?'…':'Héhé.');
        if (rights===5 && step===4) setTimeout(pounce,700);
      } else {
        setOh(rights,'slam'); ohBubble(pick(['GRRR…','HÉ !','Tss.'])); rageFace();
      }
    }
    $('#fb').innerHTML=
      `<p class="fb-line ${fb.ok?'fb-good':'fb-bad'}">${fb.ok?pick(goodLines):pick(badLines)}</p>`+
      `<p class="fb-note">${quizEscape(fb.note)}</p>`+
      `<button type="button" class="btn dark" id="nextBtn">${step<4?'Question suivante →':'Voir le score →'}</button>`;
    $('#nextBtn').addEventListener('click',()=>quizTurn('next'));
    if (freshFeedback) $('#nextBtn').focus();
  }
  if (!freshFeedback) animateMain();
}
async function quizTurn(action, fields={}) {
  if (GAME.busy) return;
  GAME.busy=true;
  const buttons=[...mainBox.querySelectorAll('button:not(:disabled)')];
  buttons.forEach(b=>b.disabled=true);
  try {
    const {round,step}=GAME.state;
    GAME.state=await quizAPI.send(action,{round,step,...fields});
    if (GAME.state.done) {quizStats(); renderDone(true);}
    else {
      renderQuestion(action==='answer');
      if (action==='next') $('#quizQuestion').focus();
    }
  } catch (error) {
    showQuizError(error.message);
    buttons.forEach(b=>b.disabled=false);
  } finally {GAME.busy=false;}
}
function renderDone(just) {
  const {score,stats:st,recap} = GAME.state, success=score>=4;
  GAME.phase='done';
  const title=just?(success?(score===5?'Shrek A TRAVERSÉ ton écran.':'La porte a cédé.'):'CLAQUET. Porte close.'):'Shrek a déjà claqué la porte du jour.';
  mainBox.innerHTML=quizKicker()+
    `<div class="verdict-head"><div class="v-score">${score}<small> / 5</small></div><span class="badge ${success?'ok':'no'}">${success?'Réussi':'Manqué'}</span></div>`+
    `<h2 class="p-title">${title}</h2><p class="v-line">Série en cours : ${st.streak} jour${st.streak>1?'s':''}.</p>`+
    '<div class="recap">'+recap.map(q=>`<div class="recap-item"><span class="rmk ${q.ok?'ok':'no'}">${q.ok?'✓':'✕'}</span>`+
      `<div>${quizEscape(q.text)}<br>Bonne réponse : <span class="r-ans">${quizEscape(q.answer)}</span></div></div>`).join('')+'</div>'+
    '<div class="p-actions">'+
    (score===5&&just&&!quizReduced.matches?'<button type="button" class="btn dark" id="replayBtn">Revoir le jaillissement</button>':'')+
    '<button type="button" class="btn dark" id="copyBtn">Copier mon score</button>'+
    '<span class="cd-hint">Prochaine porte dans <b data-cd>…</b></span></div>';
  $('#copyBtn').addEventListener('click',copyQuiz);
  $('#replayBtn')?.addEventListener('click',pounce);
  setOh(success?score:0,just&&!quizReduced.matches?(success?'open':'slam'):'instant');
  if (just && !success && !quizReduced.matches) rageFace();
  tickQuiz(); animateMain();
}
async function copyQuiz() {
  const {day,score,marks,stats:st}=GAME.state;
  const date=quizDate(day).toLocaleDateString('fr-FR',{timeZone:'UTC'});
  const txt=`Shrekdle · ${date}\n${marks.map(ok=>ok?'●':'✕').join(' ')} → ${score}/5\nSérie : ${st.streak} jour${st.streak>1?'s':''} (record : ${st.best})`;
  try {await navigator.clipboard.writeText(txt); toast('Score copié.');}
  catch {toast('Impossible de copier.');}
}
async function refreshQuiz() {
  if (GAME.busy) return;
  GAME.busy=true;
  try {
    const old=GAME.state;
    GAME.state=await quizAPI.send('state');
    quizStats();
    if (GAME.state.done) renderDone(false);
    else if (GAME.state.marks.length || (old?.round===GAME.state.round && GAME.phase==='quiz')) renderQuestion();
    else renderReady();
  } catch (error) {
    if (!GAME.state) mainBox.replaceChildren();
    showQuizError(error.message);
  } finally {GAME.busy=false;}
}
function tickQuiz() {
  if (!GAME.state) return;
  const ms=GAME.state.resetsAt-Date.now();
  document.querySelectorAll('[data-cd]').forEach(el=>el.textContent=fmtCD(ms));
  if (ms<=0 && !GAME.busy && Date.now()>GAME.retryAt) {
    GAME.retryAt=Date.now()+15000; refreshQuiz();
  }
}
buildFireflies(); buildHeroPuppet(); buildOuthouse(); refreshQuiz();
setInterval(tickQuiz,1000);
