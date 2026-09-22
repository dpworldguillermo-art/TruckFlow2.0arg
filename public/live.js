const LIVE_COLORS = ['#0F52BA','#2563EB','#38BDF8','#1D4ED8','#4F46E5','#6366F1','#0284C7','#3B82F6','#4338CA','#60A5FA'];
const liveState = { rows: [], sourceFile: '', generatedAt: '' };
const q = s => document.querySelector(s);

function normalizedStatus(row){
  return String(row?.Status || '').trim().toUpperCase();
}

function parseDateValue(value){
  if(!value) return null;
  if(value instanceof Date) return value;
  const s=String(value).trim();
  const normalized=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)?s.replace(' ','T'):s;
  const d=new Date(normalized);
  return Number.isNaN(d.getTime())?null:d;
}

function currentShift(now=new Date()){
  const start=new Date(now); start.setSeconds(0,0);
  const end=new Date(now); end.setSeconds(0,0);
  const hour=now.getHours();
  let name='';
  if(hour>=7 && hour<19){
    start.setHours(7,0,0,0); end.setHours(19,0,0,0); name='TURNO 1 · 07:00 - 19:00';
  } else if(hour>=19){
    start.setHours(19,0,0,0); end.setDate(end.getDate()+1); end.setHours(7,0,0,0); name='TURNO 2 · 19:00 - 07:00';
  } else {
    start.setDate(start.getDate()-1); start.setHours(19,0,0,0); end.setHours(7,0,0,0); name='TURNO 2 · 19:00 - 07:00';
  }
  return {start,end,name};
}

function inShift(row, shift){
  const start=parseDateValue(row['Start Date']);
  return start && start>=shift.start && start<shift.end;
}

function durationMinutes(row, now=new Date()){
  const start=parseDateValue(row['Start Date']);
  if(!start) return null;
  let finish=now;
  if(normalizedStatus(row)==='COMPLETE'){
    const handled=parseDateValue(row['Handled']);
    if(handled) finish=handled;
  }
  const mins=(finish.getTime()-start.getTime())/60000;
  return Number.isFinite(mins) && mins>=0 ? mins : null;
}

function avgMinutes(rows, now=new Date()){
  const values=rows.map(r=>durationMinutes(r,now)).filter(Number.isFinite);
  if(!values.length) return null;
  return values.reduce((a,b)=>a+b,0)/values.length;
}

function formatTime(minutes){
  if(minutes==null || !Number.isFinite(minutes)) return '--:--';
  const total=Math.max(0,Math.round(minutes));
  const h=Math.floor(total/60),m=total%60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

function escapeLive(v){
  return String(v ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function sparkline(values,color){
  const clean=values.filter(Number.isFinite);
  if(!clean.length) return '<span class="spark-empty">—</span>';
  const w=62,h=24,p=2;
  if(clean.length===1){
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="M2 14 L60 14" fill="none" stroke="${color}" stroke-width="2"/></svg>`;
  }
  const min=Math.min(...clean),max=Math.max(...clean),span=Math.max(1,max-min);
  const pts=clean.map((v,i)=>{
    const x=p+(i/(clean.length-1))*(w-p*2);
    const y=h-p-((v-min)/span)*(h-p*2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const area=`${p},${h-p} ${pts} ${w-p},${h-p}`;
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polygon points="${area}" fill="${color}1f"/><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

async function loadLiveData(){
  let payload=null;
  try{
    const r=await fetch('/api/data',{cache:'no-store'});
    if(r.ok) payload=await r.json();
  }catch(_e){}
  if(!payload){
    const r=await fetch('./data/latest.json',{cache:'no-store'});
    if(!r.ok) throw new Error('No se pudo cargar la data');
    payload=await r.json();
  }
  liveState.rows=Array.isArray(payload.rows)?payload.rows:[];
  liveState.sourceFile=payload.sourceFile||'sin nombre';
  liveState.generatedAt=payload.generatedAt||'';
  renderLive();
}

function renderLive(){
  const now=new Date();
  const shift=currentShift(now);
  const eligible=liveState.rows.filter(r=>{
    const st=normalizedStatus(r);
    return (st==='OK'||st==='COMPLETE') && inShift(r,shift);
  });
  const active=eligible.filter(r=>normalizedStatus(r)==='OK');

  q('#shiftLabel').textContent=shift.name;
  q('#liveUpdated').textContent=liveState.generatedAt?`Actualizado: ${new Date(liveState.generatedAt).toLocaleString('es-PE')}`:'';
  q('#totalServed').textContent=eligible.length;
  q('#activeNow').textContent=active.length;
  q('#avgTotal').textContent=formatTime(avgMinutes(eligible,now));
  q('#avgActive').textContent=formatTime(avgMinutes(active,now));

  renderTypeDetail(active,now);
  renderDistribution(active);
}

function renderTypeDetail(active,now){
  const host=q('#typeDetailRows');
  const groups=new Map();
  active.forEach(r=>{
    const type=String(r['Transaction Type']||'SIN TIPO').trim()||'SIN TIPO';
    if(!groups.has(type)) groups.set(type,[]);
    groups.get(type).push(r);
  });
  const items=[...groups.entries()].sort((a,b)=>b[1].length-a[1].length || a[0].localeCompare(b[0]));
  if(!items.length){host.innerHTML='<div class="live-no-data">No hay operaciones con Status OK en el turno actual.</div>';return;}
  const max=Math.max(...items.map(([,rows])=>rows.length),1);
  host.innerHTML=items.map(([type,rows],i)=>{
    const color=LIVE_COLORS[i%LIVE_COLORS.length];
    const pct=Math.max(5,(rows.length/max)*100);
    const vals=rows.slice().sort((a,b)=>(parseDateValue(a['Start Date'])||0)-(parseDateValue(b['Start Date'])||0)).map(r=>durationMinutes(r,now));
    const avg=avgMinutes(rows,now);
    return `<div class="live-detail-row">
      <strong class="live-type">${escapeLive(type)}</strong>
      <div class="course-bar"><div class="course-fill" style="width:${pct}%;background:${color}"></div><span>En curso</span><b>${rows.length}</b></div>
      <div class="type-average">${sparkline(vals,color)}<strong>${formatTime(avg)}</strong></div>
    </div>`;
  }).join('');
}

function renderDistribution(active){
  const donut=q('#distributionDonut'),legend=q('#distributionLegend');
  const groups=new Map();
  active.forEach(r=>{
    const type=String(r['Transaction Type']||'SIN TIPO').trim()||'SIN TIPO';
    groups.set(type,(groups.get(type)||0)+1);
  });
  const items=[...groups.entries()].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]));
  const total=active.length;
  if(!total){
    donut.style.background='#e6ebf2';
    donut.innerHTML='<span>0</span>';
    legend.innerHTML='<div class="live-no-data">Sin operaciones en curso para distribuir.</div>';
    return;
  }
  let acc=0; const segments=[];
  items.forEach(([type,count],i)=>{
    const start=acc; acc+=(count/total)*360;
    segments.push(`${LIVE_COLORS[i%LIVE_COLORS.length]} ${start.toFixed(2)}deg ${acc.toFixed(2)}deg`);
  });
  donut.style.background=`conic-gradient(${segments.join(',')})`;
  donut.innerHTML=`<span>${total}<small>EN CURSO</small></span>`;
  legend.innerHTML=items.map(([type,count],i)=>{
    const pct=Math.round((count/total)*100);
    return `<div class="legend-item"><i style="background:${LIVE_COLORS[i%LIVE_COLORS.length]}"></i><strong>${escapeLive(type)}</strong><span>${pct}%</span></div>`;
  }).join('');
}

loadLiveData().catch(err=>{console.error(err);q('#liveUpdated').textContent='Error al actualizar los datos'});
setInterval(()=>loadLiveData().catch(()=>{}),15000);
setInterval(renderLive,60000);
