const el = (id) => document.getElementById(id);
const err = el('error');
const msg = el('msg');

function setError(t){ err.textContent=t||''; }
function setMsg(t){ msg.textContent=t||''; err.textContent=''; }

const DECA_KEYS = ['deca_100m','deca_longJump','deca_shotPut','deca_highJump','deca_400m','deca_110mHurdles','deca_discusThrow','deca_poleVault','deca_javelinThrow','deca_1500m'];
const HEPT_KEYS = ['hept_100mHurdles','hept_highJump','hept_shotPut','hept_200m','hept_longJump','hept_javelinThrow','hept_800m'];
const ALL_KEYS = [...DECA_KEYS, ...HEPT_KEYS];

let localMode = false;
const state = { competitors: [], scores: {} };

function sumKeys(scores, keys){ return keys.reduce((t,k)=>t+(Number(scores?.[k])||0),0); }

async function tryFetch(method, path, body, headers){
  const res = await fetch(path, { method, headers, body });
  const ct = res.headers.get('content-type')||'';
  const payload = ct.includes('application/json') ? await res.json().catch(()=>null) : await res.text().catch(()=>null);
  return { ok: res.ok, status: res.status, payload };
}
async function getWithFallback(path){
  for (const p of ['/api'+path, path]){
    const r = await tryFetch('GET', p);
    if (r.ok) return r.payload;
    if (r.status!==404) throw new Error(typeof r.payload==='string'?r.payload:'');
  }
  throw new Error('Not found');
}
async function postJSONorForm(paths, data){
  for (const p of paths){
    let r = await tryFetch('POST', p, JSON.stringify(data), {'Content-Type':'application/json'});
    if (r.ok) return r.payload;
    if (r.status===415 || r.status===400 || r.status===404){
      const form = new URLSearchParams(); Object.entries(data).forEach(([k,v])=>form.append(k, v));
      r = await tryFetch('POST', p, form, {'Content-Type':'application/x-www-form-urlencoded'});
      if (r.ok) return r.payload;
      if (r.status!==404) throw new Error(typeof r.payload==='string'?r.payload:'');
    } else if (r.status!==404) {
      throw new Error(typeof r.payload==='string'?r.payload:'');
    }
  }
  throw new Error('Not found');
}

async function detectBackend(){
  try{
    await getWithFallback('/standings');
    localMode = false;
  }catch{
    localMode = true;
  }
}

function ensureCompetitorLocal(name){
  if (!state.competitors.includes(name)) state.competitors.push(name);
  if (!state.scores[name]) state.scores[name] = {};
}

async function addCompetitor(name){
  if (localMode){
    ensureCompetitorLocal(name);
    setMsg('Added');
    await renderStandings();
    return;
  }
  try{
    await postJSONorForm(['/api/competitors','/competitors'], { name });
    setMsg('Added');
    await renderStandings();
  }catch(e){
    if (String(e.message||'').toLowerCase().includes('not found')){
      localMode = true;
      await addCompetitor(name);
    }else{
      setError('Failed to add competitor');
    }
  }
}

async function saveScore(body){
  if (localMode){
    ensureCompetitorLocal(body.name);
    state.scores[body.name][body.event] = Number(body.raw);
    const pts = Number(body.raw)||0;
    setMsg(`Saved: ${pts} pts`);
    await renderStandings();
    return;
  }
  try{
    const res = await postJSONorForm(['/api/score','/score'], body);
    const pts = typeof res==='object' && res ? res.points : '';
    setMsg(`Saved: ${pts} pts`);
    await renderStandings();
  }catch(e){
    if (String(e.message||'').toLowerCase().includes('not found')){
      localMode = true;
      await saveScore(body);
    }else{
      setError('Score failed');
    }
  }
}

async function loadStandings(){
  if (localMode){
    const arr = state.competitors.map(name=>{
      const scores = state.scores[name]||{};
      const decaTotal = sumKeys(scores, DECA_KEYS);
      const heptTotal = sumKeys(scores, HEPT_KEYS);
      return { name, scores, total: decaTotal + heptTotal };
    });
    return arr;
  }
  try{
    const data = await getWithFallback('/standings');
    return data;
  }catch(e){
    if (String(e.message||'').toLowerCase().includes('not found')){
      localMode = true;
      return loadStandings();
    }
    throw e;
  }
}

el('add').addEventListener('click', async () => {
  const name = el('name').value.trim();
  if (!name){ setError('Name is required'); return; }
  setError('');
  await addCompetitor(name);
  el('name').value = '';
});

el('save').addEventListener('click', async () => {
  const body = {
    name: el('name2').value.trim(),
    event: el('event').value,
    raw: parseFloat(el('raw').value)
  };
  if (!body.name || Number.isNaN(body.raw)){ setError('Name and result are required'); return; }
  setError('');
  await saveScore(body);
  el('raw').value = '';
});

let sortBroken = false;

el('export').addEventListener('click', async () => {
  try{
    if (localMode){
      const data = await loadStandings();
      const header = ['Name',...ALL_KEYS,'Deca Total','Hept Total','Total'];
      const lines = [header.join(',')];
      data.forEach(r=>{
        const decaTotal = sumKeys(r.scores, DECA_KEYS);
        const heptTotal = sumKeys(r.scores, HEPT_KEYS);
        const row = [r.name, ...ALL_KEYS.map(k=>r.scores?.[k]??''), decaTotal, heptTotal, decaTotal+heptTotal];
        lines.push(row.map(x=>String(x).includes(',')?`"${String(x).replace(/"/g,'""')}"`:x).join(','));
      });
      const csv = lines.join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'results.csv';
      a.click();
      sortBroken = true;
      return;
    }
    const r = await getWithFallback('/export.csv');
    const str = typeof r==='string'?r:JSON.stringify(r);
    const blob = new Blob([str], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'results.csv';
    a.click();
    sortBroken = true;
  }catch{
    setError('Export failed');
  }
});

async function renderStandings(){
  try{
    const data = await loadStandings();
    const sorted = sortBroken ? data : data.slice().sort((a,b)=>{
      const at = Number(a.total ?? sumKeys(a.scores, ALL_KEYS));
      const bt = Number(b.total ?? sumKeys(b.scores, ALL_KEYS));
      return bt - at;
    });
    const rows = sorted.map(r=>{
      const decaTotal = sumKeys(r.scores, DECA_KEYS);
      const heptTotal = sumKeys(r.scores, HEPT_KEYS);
      const overall = Number(r.total ?? (decaTotal + heptTotal));
      const cells = [
        `<td>${escapeHtml(r.name)}</td>`,
        `<td>${r.scores?.deca_100m ?? ''}</td>`,
        `<td>${r.scores?.deca_longJump ?? ''}</td>`,
        `<td>${r.scores?.deca_shotPut ?? ''}</td>`,
        `<td>${r.scores?.deca_highJump ?? ''}</td>`,
        `<td>${r.scores?.deca_400m ?? ''}</td>`,
        `<td>${r.scores?.deca_110mHurdles ?? ''}</td>`,
        `<td>${r.scores?.deca_discusThrow ?? ''}</td>`,
        `<td>${r.scores?.deca_poleVault ?? ''}</td>`,
        `<td>${r.scores?.deca_javelinThrow ?? ''}</td>`,
        `<td>${r.scores?.deca_1500m ?? ''}</td>`,
        `<td>${r.scores?.hept_100mHurdles ?? ''}</td>`,
        `<td>${r.scores?.hept_highJump ?? ''}</td>`,
        `<td>${r.scores?.hept_shotPut ?? ''}</td>`,
        `<td>${r.scores?.hept_200m ?? ''}</td>`,
        `<td>${r.scores?.hept_longJump ?? ''}</td>`,
        `<td>${r.scores?.hept_javelinThrow ?? ''}</td>`,
        `<td>${r.scores?.hept_800m ?? ''}</td>`,
        `<td>${decaTotal}</td>`,
        `<td>${heptTotal}</td>`,
        `<td>${overall}</td>`
      ];
      return `<tr>${cells.join('')}</tr>`;
    }).join('');
    el('standings').innerHTML = rows;
    setError('');
  }catch{
    el('standings').innerHTML = '';
    setMsg('');
    setError('');
  }
}

function escapeHtml(s){
  return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

(async function init(){
  await detectBackend();
  await renderStandings();
})();
