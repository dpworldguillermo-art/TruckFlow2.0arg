const result=document.getElementById('result');
document.getElementById('upload').addEventListener('click',async()=>{
  const file=document.getElementById('file').files[0]; const token=document.getElementById('token').value.trim();
  if(!file||!token){result.textContent='Selecciona un Excel e ingresa el token.';return}
  result.textContent='Procesando…';
  try{
    const data=await file.arrayBuffer(); const wb=XLSX.read(data,{type:'array',cellDates:true}); const ws=wb.Sheets[wb.SheetNames[0]];
    const grid=XLSX.utils.sheet_to_json(ws,{header:1,defval:null}); const hi=grid.findIndex(r=>Array.isArray(r)&&r.includes('Transaction Type'));
    if(hi<0) throw new Error('No se encontró la fila de encabezados con Transaction Type.');
    const headers=grid[hi].map(v=>v==null?'':String(v).trim()); const rows=grid.slice(hi+1).filter(r=>r.some(v=>v!==null&&v!=='')).map(r=>Object.fromEntries(headers.map((h,i)=>[h,normalize(r[i])])));
    const payload={sourceFile:file.name,generatedAt:new Date().toISOString(),count:rows.length,rows};
    const resp=await fetch('/api/data',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify(payload)});
    if(!resp.ok) throw new Error(await resp.text()); result.textContent=`Publicado correctamente.\n${rows.length} registros.\n${file.name}`;
  }catch(e){result.textContent='Error: '+e.message}
});
function normalize(v){if(v instanceof Date)return v.getFullYear()+'-'+String(v.getMonth()+1).padStart(2,'0')+'-'+String(v.getDate()).padStart(2,'0')+' '+String(v.getHours()).padStart(2,'0')+':'+String(v.getMinutes()).padStart(2,'0')+':'+String(v.getSeconds()).padStart(2,'0');return v}
