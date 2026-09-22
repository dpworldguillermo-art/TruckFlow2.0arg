const state={rows:[],type:'all',sli:'all',onlyOut:false,sort:{key:'time',dir:'desc'}};
const $=s=>document.querySelector(s);
const isStatusOK=r=>String(r?.Status||'').trim().toUpperCase()==='OK';

async function loadData(){
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
  state.rows=Array.isArray(payload.rows)?payload.rows:[];
  $('#lastUpdate').textContent=payload.generatedAt?`Actualizado: ${new Date(payload.generatedAt).toLocaleString('es-PE')}`:'';
  buildTypeFilters(); render();
}

function buildTypeFilters(){
  const host=$('#typeFilters');
  const types=['all',...new Set(state.rows.filter(isStatusOK).map(r=>r['Transaction Type']).filter(Boolean))];
  host.innerHTML='';
  for(const type of types){
    const b=document.createElement('button');b.className='chip'+(state.type===type?' active':'');
    b.dataset.type=type;b.textContent=type==='all'?'Todos':type;host.appendChild(b);
  }
}

function getView(){
  const now=new Date();
  // ARGENTINA: conservar todos los registros recibidos, pero mostrar solo Status = OK.
  // Así COMPLETE y otros estados siguen almacenados para futuras páginas/módulos.
  let rows=state.rows.filter(isStatusOK).map(r=>({...r,__min:elapsedMinutes(r,now),__gate:gateOf(r['Transaction Type']),__pos:displayPosition(r['Unit Position']),__status:statusClass(r['Transaction Type'],elapsedMinutes(r,now))}));
  if(state.type!=='all') rows=rows.filter(r=>r['Transaction Type']===state.type);
  if(state.sli==='with') rows=rows.filter(hasSLI);
  if(state.sli==='without') rows=rows.filter(r=>!hasSLI(r));
  if(state.onlyOut) rows=rows.filter(r=>r.__status==='status-red');
  const {key,dir}=state.sort; const mult=dir==='asc'?1:-1;
  const val=r=>({type:r['Transaction Type']||'',truck:r['Truck Visit Truck License']||'',status:r.__status,time:r.__min??-1,position:r.__pos}[key]);
  rows.sort((a,b)=>{const av=val(a),bv=val(b);return (typeof av==='number'&&typeof bv==='number'?(av-bv):String(av).localeCompare(String(bv)))*mult});
  return rows;
}

function render(){
  const rows=getView(); const body=$('#tbody'); body.innerHTML='';
  if(!rows.length){body.innerHTML='<tr class="empty-row"><td colspan="5">No hay registros para los filtros seleccionados.</td></tr>'}
  rows.forEach(r=>{
    const tr=document.createElement('tr');
    const cls=r.__gate==='GATE IN'?'gate-in':'gate-out';
    const maneuver=r['Transaction Type']||'';
    tr.innerHTML=`<td><span class="type-badge ${cls}"><strong>${r.__gate}</strong><small>${escapeHtml(maneuver)}</small></span></td>
      <td><div class="truck-cell"><button class="truck-link">${escapeHtml(r['Truck Visit Truck License']||'—')}</button><div class="truck-tags">${hasSLI(r)?'<span class="sli-tag">SLI</span>':''}${hasArrumaje(r)?'<span class="arr-tag">ARR</span>':''}</div></div></td>
      <td><span class="status-dot ${r.__status}" title="${r.__status.replace('status-','')}"></span></td>
      <td><strong>${r.__min==null?'—':r.__min+' min'}</strong></td>
      <td><span class="position-pill ${r.__pos==='RUMA'?'ruma':''}">${r.__pos}</span></td>`;
    tr.querySelector('.truck-link').addEventListener('click',()=>openTruck(r));body.appendChild(tr);
  });
  const okTotal=state.rows.filter(isStatusOK).length;
  $('#showingCount').textContent=`Mostrando: ${rows.length} / ${okTotal}`;
  renderKpis();
}

function renderKpis(){
  const now=new Date();
  const ok=state.rows.filter(isStatusOK);
  const inRows=ok.filter(r=>gateOf(r['Transaction Type'])==='GATE IN');
  const outRows=ok.filter(r=>gateOf(r['Transaction Type'])==='GATE OUT');
  const ia=averageMinutes(state.rows,'GATE IN',now), oa=averageMinutes(state.rows,'GATE OUT',now);
  $('#gateInAvg').textContent=formatHHMM(ia); $('#gateOutAvg').textContent=formatHHMM(oa);
  $('#gateInTrucks').textContent=inRows.length; $('#gateOutTrucks').textContent=outRows.length;
  setGauge($('#gateInGauge'),ia,35); setGauge($('#gateOutGauge'),oa,45);
}

function setGauge(el,value,target){
  const ratio=value==null?0:Math.min(value/(target*1.6),1); const deg=180+ratio*180;
  el.querySelector('.needle').style.transform=`rotate(${deg}deg)`;
}

function openTruck(r){
  $('#dTruck').textContent=r['Truck Visit Truck License']||'—';
  $('#dContainer').textContent=containerNumber(r);
  $('#dTruckingCompany').textContent=truckingCompanyName(r);
  $('#dSlot').textContent=slotPosition(r);
  $('#truckDialog').showModal();
}

function escapeHtml(v){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}

$('#filtersToggle').addEventListener('click',()=>{const p=$('#filtersPanel');p.hidden=!p.hidden;$('#filtersToggle').textContent=p.hidden?'Filtros':'Ocultar filtros'});
$('#typeFilters').addEventListener('click',e=>{const b=e.target.closest('[data-type]');if(!b)return;state.type=b.dataset.type;buildTypeFilters();render()});
$('#sliFilters').addEventListener('click',e=>{const b=e.target.closest('[data-sli]');if(!b)return;state.sli=b.dataset.sli;document.querySelectorAll('[data-sli]').forEach(x=>x.classList.toggle('active',x===b));render()});
$('#outOfRangeToggle').addEventListener('click',()=>{state.onlyOut=!state.onlyOut;$('#outOfRangeToggle').classList.toggle('active',state.onlyOut);render()});
document.querySelectorAll('th[data-sort]').forEach(th=>th.addEventListener('click',()=>{const k=th.dataset.sort;if(state.sort.key===k)state.sort.dir=state.sort.dir==='asc'?'desc':'asc';else state.sort={key:k,dir:'asc'};render()}));
$('#dialogClose').addEventListener('click',()=>$('#truckDialog').close());$('#dialogX').addEventListener('click',()=>$('#truckDialog').close());

loadData().catch(err=>{console.error(err);$('#lastUpdate').textContent='Error al actualizar los datos'});
setInterval(()=>loadData().catch(()=>{}),15000);
setInterval(render,60000);
