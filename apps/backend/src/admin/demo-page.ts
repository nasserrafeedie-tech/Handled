/**
 * The demo week page: one business's full week, made by the real product,
 * laid out the way a follower would meet it — day by day, picture first.
 *
 * Same shell rules as the operator page: no token in the HTML or the URL. It
 * reads the one the operator page saved in this browser, or asks for it.
 */
export const DEMO_PAGE_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Handled — Demo week</title>
<style>
  :root{--paper:#F8F3EA;--card:#FFFDF8;--ink:#1A140D;--clay:#8C2F39;--soft:rgba(26,20,13,.62);--edge:rgba(26,20,13,.12)}
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  .wrap{max-width:1120px;margin:0 auto;padding:24px 16px 64px}
  h1{font-size:1.6rem;margin:0 0 .3rem}
  h2{font-size:1.05rem;margin:2rem 0 .6rem}
  .cap{color:var(--soft);font-size:.85rem;margin:.2rem 0 .8rem}
  button{font:inherit;padding:.55rem 1rem;border-radius:8px;border:1px solid var(--edge);background:var(--card);cursor:pointer}
  button.primary{background:var(--clay);color:#fff;border-color:var(--clay)}
  button:disabled{opacity:.5;cursor:default}
  input{font:inherit;padding:.5rem;border:1px solid var(--edge);border-radius:8px;width:min(360px,100%)}
  .hide{display:none}
  .bar{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;margin:1rem 0}
  .status{padding:.7rem 1rem;border-radius:10px;background:var(--card);border:1px solid var(--edge)}
  .err{color:#a01c1c}
  .facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:.6rem}
  .fact{background:var(--card);border:1px solid var(--edge);border-radius:10px;padding:.7rem .9rem}
  .fact b{display:block;font-size:.78rem;color:var(--soft);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
  .posts{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:1rem}
  .post{background:var(--card);border:1px solid var(--edge);border-radius:14px;overflow:hidden;display:flex;flex-direction:column}
  .post .head{padding:.7rem .9rem;display:flex;justify-content:space-between;gap:.5rem;font-size:.85rem}
  .post .head b{font-size:.95rem}
  .media{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;background:#eee}
  .media img{width:100%;flex:0 0 100%;aspect-ratio:1/1;object-fit:cover;scroll-snap-align:start;display:block}
  .media.none{aspect-ratio:auto;padding:1.2rem;color:var(--soft);font-size:.85rem;background:#f1ebe0}
  .count{font-size:.78rem;color:var(--soft);padding:.35rem .9rem 0}
  .caption{padding:.6rem .9rem;white-space:pre-wrap}
  .tags{padding:0 .9rem .6rem;color:#2d5f8a;font-size:.85rem}
  .note{margin:0 .9rem .8rem;padding:.5rem .7rem;border-radius:8px;background:#f3ecdf;font-size:.82rem;color:var(--soft)}
  .pill{display:inline-block;font-size:.72rem;padding:.1rem .5rem;border-radius:99px;background:#efe7d8;margin-left:.3rem}
  table{border-collapse:collapse;width:100%;background:var(--card);border:1px solid var(--edge);border-radius:10px;overflow:hidden}
  td,th{text-align:left;padding:.45rem .7rem;border-bottom:1px solid var(--edge);font-size:.88rem}
</style>
</head>
<body>
<div class="wrap">
  <div id="gate" class="hide">
    <h1>Demo week</h1>
    <p>Paste the admin token. It stays in this browser only.</p>
    <p><input id="tok" type="password" placeholder="admin token" autocomplete="off"></p>
    <p><button class="primary" onclick="saveToken()">Open</button></p>
    <div id="gateErr" class="err"></div>
  </div>

  <div id="app" class="hide">
    <h1 id="title">Demo week</h1>
    <p class="cap">A full Pro week made by the real product: the planner, the writer, the
      scroll test, the carousel builder, the designer and the photo generator. Nothing is
      posted and nothing is texted: this account has no phone, no email and no linked
      socials, and it is paused.</p>
    <p class="cap" id="source"></p>

    <div class="bar">
      <button class="primary" id="go" onclick="start()">Make the week</button>
      <a href="/admin">Back to the operator page</a>
    </div>
    <div id="status" class="status">Loading…</div>

    <h2>Who made what</h2>
    <div id="models" class="facts"></div>

    <h2>The week</h2>
    <div id="posts" class="posts"></div>

    <h2>What it cost</h2>
    <div id="spend"></div>
  </div>
</div>

<script>
const KEY='handled:admin:token';
let TOKEN=localStorage.getItem(KEY);
let timer=null;

function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>(
  {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function saveToken(){
  const v=document.getElementById('tok').value.trim();
  if(!v)return;
  TOKEN=v;localStorage.setItem(KEY,v);load();
}
async function api(path,opts){
  const r=await fetch(path,Object.assign({headers:{'x-admin-token':TOKEN,'content-type':'application/json'}},opts||{}));
  if(!r.ok)throw new Error(r.status===404?'Token rejected':'HTTP '+r.status);
  return r.json();
}
const LABEL={educational_tip:'Tip',product_spotlight:'Spotlight',promo:'Offer',testimonial:'What patients say',
  seasonal:'Seasonal',behind_the_scenes:'Behind the scenes',ugc_repost:'Repost',were_open:'We are open'};
function day(iso){
  if(!iso)return 'Unscheduled';
  return new Date(iso).toLocaleString('en-US',{timeZone:'America/Los_Angeles',weekday:'long',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
}

async function load(){
  if(!TOKEN){document.getElementById('gate').classList.remove('hide');return;}
  try{
    const v=await api('/admin/demo-week');
    document.getElementById('gate').classList.add('hide');
    document.getElementById('app').classList.remove('hide');
    render(v);
    clearTimeout(timer);
    if(v.running)timer=setTimeout(load,15000);
  }catch(e){
    document.getElementById('gate').classList.remove('hide');
    document.getElementById('gateErr').textContent=e.message;
  }
}

async function start(){
  if(!confirm('This makes a full week of 7 posts with real models and real image generation. It costs about $7 in API usage (at most about $12) and takes 10 to 20 minutes. Nothing is posted or texted. Go?'))return;
  document.getElementById('go').disabled=true;
  try{
    const r=await api('/admin/demo-week',{method:'POST',body:JSON.stringify({business:'south-bay-dental-smiles'})});
    if(r.error)throw new Error(r.error);
    setTimeout(load,2000);
  }catch(e){
    document.getElementById('status').innerHTML='<span class="err">Could not start: '+esc(e.message)+'</span>';
    document.getElementById('go').disabled=false;
  }
}

function render(v){
  document.getElementById('title').textContent=v.business+' — demo week';
  document.getElementById('source').textContent=v.source?'Business facts from '+v.source+'.':'';
  document.getElementById('go').disabled=!!v.running;
  const r=v.run;
  let st;
  if(v.running)st='Working: '+esc(r.step)+'. This page refreshes on its own.';
  else if(r&&r.step==='done')st='Done. '+r.drafted+' of '+r.planned+' posts made.';
  else if(r&&r.step==='stopped')st='<span class="err">Stopped.</span>';
  else if(v.posts&&v.posts.length)st='Showing the last week that was made.';
  else st='Nothing made yet. Press Make the week.';
  if(r&&r.problems&&r.problems.length)
    st+='<br><span class="err">'+r.problems.map(esc).join('<br>')+'</span>';
  document.getElementById('status').innerHTML=st;

  const m=v.models||{};
  document.getElementById('models').innerHTML=[
    ['Plan and captions',m.captions],
    ['Scroll test and photo checks',m.judge],
    ['Designed covers and graphics',m.designs],
    ['Generated photos',m.photos||'No image key set, so no photos'],
  ].filter(x=>x[1]!==undefined).map(x=>'<div class="fact"><b>'+esc(x[0])+'</b>'+esc(x[1])+'</div>').join('');

  const posts=v.posts||[];
  document.getElementById('posts').innerHTML=posts.length?posts.map(p=>{
    const media=p.media.length
      ?'<div class="media">'+p.media.map((u,i)=>'<img loading="lazy" src="'+esc(u)+'" alt="'+esc(i===0?p.altText||'':'slide '+(i+1))+'">').join('')+'</div>'+
        (p.media.length>1?'<div class="count">'+p.media.length+' slides, swipe</div>':'')
      :'<div class="media none">'+(v.running?'Visual on its way…':'No visual on this post')+'</div>';
    return '<div class="post"><div class="head"><span><b>'+esc(day(p.when))+'</b><br>'+esc(p.platform)+
      '<span class="pill">'+esc(LABEL[p.archetype]||p.archetype)+'</span>'+(p.aiImage?'<span class="pill">AI photo</span>':'')+
      '</span><span class="cap">'+(p.status==='pending_approval'?'waiting for a yes':esc(p.status))+'</span></div>'+
      media+'<div class="caption">'+esc(p.caption)+'</div>'+
      (p.hashtags&&p.hashtags.length?'<div class="tags">'+p.hashtags.map(h=>'#'+esc(String(h).replace(/^#/,''))).join(' ')+'</div>':'')+
      (p.photoAsk?'<div class="note">With a real owner, this post would first ask for a photo: '+esc(p.photoAsk)+'</div>':'')+
      '</div>';
  }).join(''):'<p class="cap">No posts yet.</p>';

  const s=v.spend;
  document.getElementById('spend').innerHTML=s&&s.byModel&&s.byModel.length
    ?'<table><tr><th>Model</th><th>Calls</th><th>Cost</th></tr>'+s.byModel.map(x=>'<tr><td>'+esc(x.model)+'</td><td>'+x.calls+'</td><td>$'+x.usd.toFixed(2)+'</td></tr>').join('')+
      '<tr><th>Total</th><th></th><th>$'+s.usd.toFixed(2)+'</th></tr></table><p class="cap">'+esc(s.note)+'</p>'
    :'<p class="cap">Nothing spent yet.</p>';
}

load();
</script>
</body>
</html>`;
