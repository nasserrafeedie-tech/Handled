/**
 * The operator's page — the one screen Nasser opens to run the business.
 *
 * Deliberately NOT a customer dashboard (§2: customers never get one; the whole
 * product is a text conversation). This is for the person running Handled.
 *
 * The token is never baked into this HTML — the page ships as an empty shell and
 * asks for it, so the URL itself is safe to bookmark, share a screenshot of, or
 * leave open. It is held in localStorage and sent as a header on each fetch,
 * with a Forget button for a shared machine. That is a real trade: script
 * injection on this page could read it. There are no third-party scripts, no
 * user-supplied HTML rendered as markup, and it beats the alternative of a token
 * in the URL, which leaks into history, referrers and screenshots.
 *
 * The outbox leads because of what it costs to miss: while SMS is relayed by
 * hand, a text Handled wrote and nobody carried is a customer sitting in
 * silence, believing they have been forgotten.
 */
export const ADMIN_PAGE_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Handled — Operator</title>
<style>
  :root {
    --paper:#F8F3EA; --parchment:#EFE7D8; --ink:#1A140D;
    --clay:#8C2F39; --clay-dark:#74232D; --brass:#C79A45;
    --edge:rgba(26,20,13,.12); --soft:rgba(26,20,13,.6);
    --green:#4F6B4A;
    --mono:ui-monospace,SFMono-Regular,Menlo,monospace;
  }
  @media (prefers-color-scheme:dark){
    :root{ --paper:#14100B; --parchment:#1E1811; --ink:#F3EADC;
      --clay:#D9848B; --clay-dark:#C96A72; --edge:rgba(243,234,220,.15);
      --soft:rgba(243,234,220,.62); --green:#8FAE87; }
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);
    font:15px/1.55 ui-sans-serif,-apple-system,'Segoe UI',sans-serif}
  .wrap{max-width:70rem;margin:0 auto;padding:2rem 1.2rem 5rem}
  h1{font-size:1.5rem;margin:0;letter-spacing:-.02em}
  h2{font-size:1.05rem;margin:2.2rem 0 .7rem;letter-spacing:-.01em}
  .head{display:flex;align-items:center;gap:1rem;flex-wrap:wrap;
    padding-bottom:1rem;border-bottom:1px solid var(--edge)}
  .grow{flex:1}
  button{font:inherit;font-size:.85rem;padding:.4rem .8rem;border-radius:.45rem;
    border:1px solid var(--edge);background:var(--parchment);color:var(--ink);
    cursor:pointer}
  button:hover{border-color:var(--clay)}
  button.primary{background:var(--clay);color:var(--paper);border-color:var(--clay)}
  input{font:inherit;padding:.5rem .7rem;border-radius:.45rem;
    border:1px solid var(--edge);background:var(--parchment);color:var(--ink);
    min-width:20rem}
  .cards{display:grid;gap:.7rem;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));
    margin-top:1.2rem}
  .card{border:1px solid var(--edge);border-radius:.6rem;padding:.8rem .9rem;
    background:var(--parchment)}
  .card .n{font-size:1.6rem;font-weight:600;font-variant-numeric:tabular-nums}
  .card .l{font-size:.7rem;text-transform:uppercase;letter-spacing:.1em;color:var(--soft)}
  .card.alert{border-color:var(--clay)} .card.alert .n{color:var(--clay)}
  table{width:100%;border-collapse:collapse;font-size:.85rem}
  th{text-align:left;font-size:.66rem;text-transform:uppercase;letter-spacing:.1em;
    color:var(--soft);font-weight:500;padding:0 .7rem .45rem 0;
    border-bottom:1px solid var(--edge)}
  td{padding:.55rem .7rem .55rem 0;border-bottom:1px solid var(--edge);
    vertical-align:top}
  .scroll{overflow-x:auto}
  .pill{font-family:var(--mono);font-size:.65rem;padding:.15rem .4rem;
    border-radius:.3rem;background:var(--edge);white-space:nowrap}
  .pill.warn{background:rgba(140,47,57,.15);color:var(--clay)}
  .pill.ok{background:rgba(79,107,74,.18);color:var(--green)}
  .msg{border:1px solid var(--edge);border-left:3px solid var(--brass);
    border-radius:.5rem;padding:.8rem .9rem;margin-bottom:.6rem;background:var(--parchment)}
  .msg .to{font-family:var(--mono);font-size:.68rem;color:var(--soft);
    margin-bottom:.4rem;display:flex;gap:.6rem;align-items:center;flex-wrap:wrap}
  .msg .body{white-space:pre-wrap;font-size:.9rem}
  .msg .acts{margin-top:.6rem;display:flex;gap:.5rem}
  .empty{color:var(--soft);font-size:.88rem;padding:.5rem 0}
  .mixbar{display:flex;height:1.4rem;border-radius:.4rem;overflow:hidden;
    border:1px solid var(--edge);background:var(--parchment)}
  .mixbar span{display:block;min-width:2px}
  .mixlegend{display:flex;flex-wrap:wrap;gap:.4rem 1.1rem;margin:.6rem 0 .2rem;
    font-size:.82rem}
  .mixlegend span{display:inline-flex;align-items:center;gap:.4rem}
  .mixlegend i{width:.7rem;height:.7rem;border-radius:2px;display:inline-block}
  .mixlegend b{font-variant-numeric:tabular-nums}
  .mixlegend em{color:var(--soft);font-style:normal;font-size:.75rem}
  .err{border:1px solid var(--clay);background:rgba(140,47,57,.08);color:var(--clay);
    padding:.7rem .9rem;border-radius:.5rem;margin-top:1rem;font-size:.88rem}
  .gate{max-width:26rem;margin:5rem auto;text-align:center}
  .gate p{color:var(--soft);font-size:.9rem}
  .hide{display:none}
  .cap{font-size:.72rem;color:var(--soft);margin:.2rem 0 .8rem}
</style>
</head>
<body>
<div class="wrap">

  <div id="gate" class="gate">
    <h1>Handled — Operator</h1>
    <p>Paste the admin token. Held in this browser only, never in the URL.</p>
    <p><input id="tok" type="password" placeholder="admin token" autocomplete="off"></p>
    <p><button class="primary" onclick="saveToken()">Open</button></p>
    <div id="gateErr"></div>
  </div>

  <div id="app" class="hide">
    <div class="head">
      <h1>Handled</h1>
      <span class="grow"></span>
      <span id="stamp" class="cap"></span>
      <button onclick="load()">Refresh</button>
      <button onclick="forget()">Forget token</button>
    </div>

    <div id="err"></div>
    <div id="cards" class="cards"></div>

    <h2>Media mix — what treatment posts actually got</h2>
    <p class="cap">Emergent, not a setting. Watch it before touching the
      archetype weights, the 2/week photo-ask cap, or the AI-image opt-in.</p>
    <div id="mediamix"></div>

    <h2>Outbox — texts waiting to be sent by hand</h2>
    <p class="cap">While Twilio is unverified, nothing sends these. If you don't
      carry them, the customer hears nothing.</p>
    <div id="outbox"></div>

    <h2>Waiting on the owner</h2>
    <p class="cap">Posts drafted and not yet approved.</p>
    <div class="scroll"><table id="pending"></table></div>

    <h2>Customers</h2>
    <div class="scroll"><table id="customers"></table></div>

    <h2>Failures</h2>
    <div class="scroll"><table id="failures"></table></div>
  </div>
</div>

<script>
const KEY='handled:admin:token';
let TOKEN=localStorage.getItem(KEY);

function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>(
  {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function saveToken(){
  const v=document.getElementById('tok').value.trim();
  if(!v)return;
  TOKEN=v; localStorage.setItem(KEY,v); load();
}
function forget(){
  localStorage.removeItem(KEY); TOKEN=null;
  document.getElementById('app').classList.add('hide');
  document.getElementById('gate').classList.remove('hide');
}
async function api(path,opts){
  const r=await fetch(path,Object.assign({headers:{'x-admin-token':TOKEN,
    'content-type':'application/json'}},opts||{}));
  if(!r.ok)throw new Error(r.status===404?'Token rejected':'HTTP '+r.status);
  return r.json();
}
function when(d){
  if(!d)return '—';
  const t=new Date(d), mins=Math.round((Date.now()-t)/60000);
  if(mins<60)return mins+'m ago';
  if(mins<1440)return Math.round(mins/60)+'h ago';
  return t.toLocaleDateString();
}

async function load(){
  document.getElementById('gateErr').innerHTML='';
  try{
    const [ov,ob]=await Promise.all([api('/admin/overview'),api('/admin/outbox')]);
    document.getElementById('gate').classList.add('hide');
    document.getElementById('app').classList.remove('hide');
    document.getElementById('err').innerHTML='';
    document.getElementById('stamp').textContent='as of '+new Date().toLocaleTimeString();
    render(ov,ob);
  }catch(e){
    const box=TOKEN&&!document.getElementById('app').classList.contains('hide')
      ?'err':'gateErr';
    document.getElementById(box).innerHTML='<div class="err">'+esc(e.message)+'</div>';
  }
}

function render(ov,ob){
  const c=ov.counts||{};
  document.getElementById('cards').innerHTML=[
    card(ob.pending,'to relay',ob.pending>0),
    card(c.activeCustomers,'active'),
    card(c.customers,'customers'),
    card(c.leads,'leads'),
    card(c.failedPosts,'failed',c.failedPosts>0),
  ].join('');

  // Media mix
  const mm = ov.mediaMix || {};
  const total = mm.totalPosts || 0;
  const pct = (n) => total ? Math.round((n / total) * 100) : 0;
  const rows = [
    ['Carousels', mm.carousel || 0, 'var(--clay)'],
    ['AI images', mm.aiImage || 0, 'var(--brass)'],
    ['Owner photos', mm.ownerPhoto || 0, 'var(--green)'],
    ['Text only', mm.textOnly || 0, 'var(--soft)'],
  ];
  document.getElementById('mediamix').innerHTML = total === 0
    ? '<p class="empty">No posts produced yet — the mix appears once a week is drafted.</p>'
    : '<div class="mixbar">' + rows.map(([,n,c]) =>
        pct(n) > 0 ? '<span style="width:'+pct(n)+'%;background:'+c+'"></span>' : ''
      ).join('') + '</div>' +
      '<div class="mixlegend">' + rows.map(([label,n,c]) =>
        '<span><i style="background:'+c+'"></i>'+esc(label)+' '+
        '<b>'+pct(n)+'%</b> <em>('+n+')</em></span>'
      ).join('') + '</div>' +
      '<p class="cap">'+total+' posts produced · photo asks: '+
      (mm.photoAsks?.fulfilled||0)+' fulfilled, '+(mm.photoAsks?.pending||0)+' pending</p>';

  // Outbox
  document.getElementById('outbox').innerHTML = ob.messages.length
    ? ob.messages.map(m=>
      '<div class="msg"><div class="to"><span class="pill">'+esc(m.to)+'</span>'+
      (m.business?'<span>'+esc(m.business)+'</span>':'')+
      '<span>'+esc(when(m.written))+'</span></div>'+
      '<div class="body">'+esc(m.body)+'</div>'+
      '<div class="acts">'+
      '<button onclick="copyMsg(this)" data-b="'+esc(m.body)+'">Copy</button>'+
      '<button onclick="relay(\''+esc(m.id)+'\')">Mark sent</button>'+
      '</div></div>').join('')
    : '<p class="empty">Nothing waiting.</p>';

  // Pending approval
  const pend=(ov.recentPosts||[]).filter(p=>p.approvalState==='awaiting_owner');
  document.getElementById('pending').innerHTML = pend.length
    ? '<tr><th>Platform</th><th>Caption</th><th>Scheduled</th><th></th></tr>'+
      pend.map(p=>'<tr><td><span class="pill">'+esc(p.platform)+'</span></td>'+
      '<td>'+esc((p.caption||'').slice(0,110))+'…</td>'+
      '<td>'+esc(when(p.scheduledTime))+'</td>'+
      '<td><button onclick="approve(\''+esc(p.id)+'\')">Approve</button></td></tr>').join('')
    : '<tr><td class="empty">Nothing awaiting approval.</td></tr>';

  // Customers — plan tier is the thing worth seeing at a glance, because
  // starter silently means no carousels.
  document.getElementById('customers').innerHTML =
    '<tr><th>Business</th><th>Phone</th><th>Plan</th><th>Status</th><th>Onboarded</th></tr>'+
    (ov.customers||[]).map(x=>'<tr><td>'+esc(x.businessName||'—')+'</td>'+
    '<td class="pill">'+esc(x.phone)+'</td>'+
    '<td><span class="pill '+(x.plan==='starter'?'warn':'ok')+'">'+esc(x.plan)+
      (x.plan==='starter'?' · no carousels':'')+'</span></td>'+
    '<td>'+esc(x.status)+'</td>'+
    '<td>'+(x.onboarded?'yes':'<span class="pill warn">no</span>')+'</td></tr>').join('');

  document.getElementById('failures').innerHTML = (ov.failedPosts||[]).length
    ? '<tr><th>When</th><th>Why</th></tr>'+ov.failedPosts.map(f=>
      '<tr><td>'+esc(when(f.updatedAt))+'</td><td>'+
      esc((f.failureReason||'').slice(0,180))+'</td></tr>').join('')
    : '<tr><td class="empty">None.</td></tr>';
}

function card(n,l,alert){
  return '<div class="card'+(alert?' alert':'')+'"><div class="n">'+
    (n==null?'—':n)+'</div><div class="l">'+l+'</div></div>';
}

async function copyMsg(btn){
  await navigator.clipboard.writeText(btn.dataset.b);
  btn.textContent='Copied'; setTimeout(()=>btn.textContent='Copy',1200);
}
async function relay(id){
  await api('/admin/outbox/relayed',{method:'POST',
    body:JSON.stringify({messageIds:[id]})});
  load();
}
async function approve(id){
  // Who approved is required by the endpoint and stored on the post. Asking
  // here rather than defaulting keeps that trail honest — the whole point is
  // that it names a human, not the operator's convenience.
  const who=prompt('Who approved this, and how?\\n(e.g. "Dr. Rafeedie, by text 22 Jul")');
  if(!who||who.trim().length<3)return;
  await api('/admin/approve',{method:'POST',
    body:JSON.stringify({postId:id,approvedBy:who.trim()})});
  load();
}

if(TOKEN)load();
</script>
</body>
</html>`;
