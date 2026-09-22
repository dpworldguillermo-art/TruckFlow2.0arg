const GATE_IN = new Set(['Dray In','Receive Empty','Receive Export']);
const GATE_OUT = new Set(['Deliver Empty','Dray Off','Deliver Import']);

function gateOf(type){
  if(GATE_IN.has(type)) return 'GATE IN';
  if(GATE_OUT.has(type)) return 'GATE OUT';
  return 'OTRO';
}

function parseStart(value){
  if(!value) return null;
  if(value instanceof Date) return value;
  const s = String(value).trim();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s) ? s.replace(' ','T') : s;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function elapsedMinutes(row, now = new Date()){
  const start = parseStart(row['Start Date']);
  if(!start) return null;
  return Math.max(0, Math.floor((now.getTime()-start.getTime())/60000));
}

function statusClass(type, minutes){
  if(minutes == null) return 'status-red';
  const gate = gateOf(type);
  if(gate === 'GATE IN'){
    if(minutes <= 20) return 'status-green';
    if(minutes <= 35) return 'status-yellow';
    return 'status-red';
  }
  if(gate === 'GATE OUT'){
    if(minutes < 36) return 'status-green';
    if(minutes <= 45) return 'status-yellow';
    return 'status-red';
  }
  return 'status-red';
}

function displayPosition(unitPosition){
  const s = String(unitPosition || '').trim().toUpperCase();
  if(s.startsWith('Y')) return 'RUMA';
  if(s.startsWith('T')) return 'TIP';
  return 'TIP';
}

function slotPosition(row){
  const type = String(row['Transaction Type'] || '').trim();
  const ticket = String(row['Ticket Position'] || '').trim();
  const unit = String(row['Unit Position'] || '').trim();
  if(GATE_IN.has(type)){
    if(ticket.toUpperCase() === 'INSP' && unit.toUpperCase().startsWith('Y')){
      return unit.slice(-7);
    }
    return 'TIP';
  }
  if(GATE_OUT.has(type)) return ticket || 'TIP';
  return 'TIP';
}

function hasSLI(row){
  const v = row['Unit Código Integral'];
  return v !== null && v !== undefined && String(v).trim() !== '';
}


function hasArrumaje(row){
  return String(row?.Stow || '').trim().toUpperCase() === 'ARRUMAJE';
}

function containerNumber(row){
  const primary = row?.['Ctr Number'];
  if(primary !== null && primary !== undefined && String(primary).trim() !== '') return String(primary).trim();
  const fallback = row?.['Ctr Nbr Request'];
  if(fallback !== null && fallback !== undefined && String(fallback).trim() !== '') return String(fallback).trim();
  return '—';
}

function truckingCompanyName(row){
  const candidates = [
    row?.['Trucking Company Name'],
    row?.['Trucking Company'],
    row?.['Truck Company Name']
  ];
  for(const value of candidates){
    if(value !== null && value !== undefined && String(value).trim() !== ''){
      return String(value).trim();
    }
  }
  return '—';
}

function averageMinutes(rows, gate, now = new Date()){
  const vals = rows
    .filter(r => String(r.Status || '').trim().toUpperCase() === 'OK')
    .filter(r => gateOf(r['Transaction Type']) === gate)
    .map(r => elapsedMinutes(r, now))
    .filter(v => Number.isFinite(v));
  if(!vals.length) return null;
  return vals.reduce((a,b)=>a+b,0)/vals.length;
}

function formatHHMM(minutes){
  if(minutes == null || !Number.isFinite(minutes)) return '--:--';
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total/60);
  const m = total%60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}
