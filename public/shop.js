(()=>{'use strict';
const $=(sel,within=document)=>within.querySelector(sel), $$=(sel,within=document)=>[...within.querySelectorAll(sel)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let PRODUCTS=[], byId={}, S={symbol:'£',price:60,shipping:15,cutoffHour:10,timezone:'Europe/London',lowStock:5,maxPerOrder:25,countries:[]};
const cart=JSON.parse(localStorage.getItem('flav4_bag')||'{}');
let filter='all', currentId=null, step='bag', lastFocus=null, toastTimer, placed=null;
const form=JSON.parse(sessionStorage.getItem('flav4_form')||'{}');
 form.country='GB';
const fmt=n=>S.symbol+Number(n).toFixed(2);
const fmtShort=n=>S.symbol+(Number.isInteger(Number(n))?Number(n):Number(n).toFixed(2));
const saveCart=()=>localStorage.setItem('flav4_bag',JSON.stringify(cart));
const cartCount=()=>Object.values(cart).reduce((a,b)=>a+b,0);
const cartSubtotal=()=>cartCount()*S.price;
const cartShipping=()=>cartCount()>0?S.shipping:0;
const cartTotal=()=>cartSubtotal()+cartShipping();
const stockOf=p=>Math.max(0,Number(p.stock||0));
const stockLine=p=>{const n=stockOf(p);if(n===0)return`<span class="stock-line out">SOLD OUT</span>`;if(n<=S.lowStock)return`<span class="stock-line low">ONLY ${n} LEFT</span>`;return`<span class="stock-line">IN STOCK</span>`;};

async function load(){
 const r=await fetch('/api/catalog',{cache:'no-store'}); const d=await r.json();
 PRODUCTS=d.products; byId=Object.fromEntries(PRODUCTS.map(p=>[p.id,p])); S=d.settings;
 // drop anything in the bag that no longer exists
 Object.keys(cart).forEach(id=>{if(!byId[id])delete cart[id];}); saveCart();
 $('#filterNote').textContent=`${fmtShort(S.price)} PER SLEEVE · 10 PACKS OF 20`;
 $('#feeBig').textContent=fmtShort(S.shipping);
 $('#mobileLede').textContent=`UK tracked next-working-day delivery, ${fmtShort(S.shipping)} per order (eligible postcodes).`;
 $('#detailPrice').textContent=fmt(S.price);
 renderProducts(); updateCount(); cutoff();
}
function renderProducts(){
 const grid=$('#productGrid');
 grid.innerHTML=PRODUCTS.filter(p=>filter==='all'||p.family===filter).map(p=>`
 <article class="product-card ${stockOf(p)===0?'is-out':''}" style="--accent:${p.accent};--art-a:${p.artA};--art-b:${p.artB}" aria-label="${esc(p.brand+' '+p.flavour)}">
   <div class="product-art"><span class="giant-index">${p.number}</span><span class="art-top-meta">FLAV4 / ${esc(p.brand)}<br>${esc(p.series.toUpperCase())}</span>
     <button type="button" data-view="${p.id}" aria-label="View ${esc(p.brand+' '+p.flavour)} details"><img src="${p.image}" width="376" height="424" loading="eager" decoding="async" alt="${esc(p.brand+' '+p.flavour)} product artwork"></button>
     <span class="art-rail">FLAV4 / ${esc(p.brand)} ${esc(p.flavour.toUpperCase())}</span>
   </div>
   <div class="product-copy"><div><small>${esc(p.brand)} / ${esc(p.series)}</small><h3>${esc(p.flavour.toUpperCase())}</h3><p>${stockLine(p)}</p></div><div class="product-price"><strong>${fmtShort(S.price)}</strong><small>PER SLEEVE</small></div></div>
   <div class="product-controls"><button type="button" data-view="${p.id}">VIEW DETAILS <span>↗</span></button><button type="button" data-add="${p.id}" ${stockOf(p)===0?'disabled':''}>${stockOf(p)===0?'SOLD OUT':'ADD TO BAG'} <span>＋</span></button></div>
 </article>`).join('');
}
function updateCount(){const count=cartCount();$('#bagCount').textContent=count;$$('[data-open-bag]').forEach(b=>b.setAttribute('aria-label',`Open your bag, ${count} ${count===1?'item':'items'}`));}
function toast(message){const node=$('#toast');clearTimeout(toastTimer);node.textContent=message;node.classList.add('visible');toastTimer=setTimeout(()=>node.classList.remove('visible'),2700);}
function openLayer(id){lastFocus=document.activeElement;$('#'+id).hidden=false;document.body.style.overflow='hidden';setTimeout(()=>{$('.panel-close',$('#'+id))?.focus()},60);}
function closeLayer(id){$('#'+id).hidden=true;document.body.style.overflow='';lastFocus?.focus?.();}
function viewProduct(id){const p=byId[id];if(!p)return;currentId=id;
 $('#detailTitle').textContent=p.brand;$('#detailFamily').textContent=p.series.toUpperCase()+' / FLAV4 '+p.number;
 $('#detailFlavor').textContent=p.flavour.toUpperCase();$('#detailDescription').textContent=p.description;
 $('#detailImage').src=p.studio||p.image;$('#detailImage').alt=p.brand+' '+p.flavour+(p.studio?' studio image':' artwork');$('#detailImagePane').classList.toggle('is-studio',!!p.studio);$('#detailMediaTabs').hidden=!(p.studio&&p.real);$('#detailTabStudio').classList.add('selected');$('#detailTabPhoto').classList.remove('selected');$('#detailTabStudio').setAttribute('aria-pressed','true');$('#detailTabPhoto').setAttribute('aria-pressed','false');
 $('#detailImagePane').style.background=`radial-gradient(ellipse at 50% 50%, ${p.accent}5c, transparent 62%), linear-gradient(150deg,${p.artA},${p.artB})`;
 $('#detailVisualLabel').textContent=p.studio?'STUDIO VISUAL':'PRODUCT GALLERY';
 $('#detailOriginal').hidden=!p.real;if(p.real){$('#detailSourceImage').src=p.real;$('#detailSourceImage').alt=p.brand+' '+p.flavour+' pack photograph';}
 const n=stockOf(p);$('#detailStock').innerHTML=n===0?'<span class="stock-line out">SOLD OUT — back soon.</span>':n<=S.lowStock?`<span class="stock-line low">Only ${n} left.</span> One sleeve is ten packs of twenty.`:'In stock. One sleeve is ten packs of twenty.';
 $('#detailAdd').disabled=n===0;$('#detailAdd').innerHTML=n===0?'SOLD OUT':'ADD TO BAG <span>＋</span>';
 openLayer('detailOverlay');
}
function addProduct(id){const p=byId[id];if(!p)return;const cur=cart[id]||0;if(cur>=stockOf(p)){toast(`ONLY ${stockOf(p)} ${p.flavour.toUpperCase()} AVAILABLE`);return;}cart[id]=Math.min(S.maxPerOrder,cur+1);saveCart();updateCount();renderBag();toast(`${p.brand} ${p.flavour.toUpperCase()} ADDED TO YOUR BAG`);}
function changeQty(id,change){const p=byId[id];if(!p)return;let next=(cart[id]||0)+change;if(next<=0)delete cart[id];else{if(next>stockOf(p)){toast(`ONLY ${stockOf(p)} AVAILABLE`);next=stockOf(p);}cart[id]=Math.min(S.maxPerOrder,next);}saveCart();updateCount();renderBag();}
function bagItemsMarkup(){const lines=PRODUCTS.filter(p=>cart[p.id]>0);
 if(!lines.length)return `<div class="bag-empty"><div class="bag-empty-icon">◇</div><h3>YOUR BAG<br>IS EMPTY.</h3><p>Browse the products and add what you need.</p><button type="button" data-continue-browse>VIEW PRODUCTS ↗</button></div>`;
 return lines.map(p=>`<div class="bag-item"><div class="bag-thumb"><img src="${p.image}" alt="${esc(p.brand+' '+p.flavour)} packaging"></div><div class="bag-item-info"><small>${esc(p.brand)} / ${esc(p.series)}</small><strong>${esc(p.flavour.toUpperCase())}</strong><span>${fmtShort(S.price)} per sleeve</span><div class="qty-controls" role="group" aria-label="Quantity for ${esc(p.flavour)}"><button type="button" data-qty="${p.id}" data-change="-1" aria-label="Decrease ${esc(p.flavour)}">−</button><output>${cart[p.id]}</output><button type="button" data-qty="${p.id}" data-change="1" aria-label="Increase ${esc(p.flavour)}">+</button></div></div><span class="bag-unit-price">${fmt(S.price*cart[p.id])}</span></div>`).join('')+`<p class="qty-note">One sleeve is ten packs of twenty. UK delivery is one £15 charge per order, however many sleeves you add.</p>`;
}
const F=[
 {k:'name',label:'FULL NAME',ph:'Name on the parcel',full:true,auto:'name'},
 {k:'email',label:'EMAIL',ph:'For your confirmation',type:'email',auto:'email'},
 {k:'phone',label:'PHONE',ph:'For the courier',type:'tel',auto:'tel'},
 {k:'country',label:'DELIVERY COUNTRY',select:true,full:true},
 {k:'address1',label:'STREET ADDRESS',ph:'Building, street',full:true,auto:'address-line1'},
 {k:'address2',label:'APARTMENT / FLOOR (OPTIONAL)',ph:'',full:true,auto:'address-line2'},
 {k:'city',label:'CITY',ph:'',auto:'address-level2'},
 {k:'region',label:'COUNTY (OPTIONAL)',ph:'',auto:'address-level1'},
 {k:'postcode',label:'UK POSTCODE',ph:'e.g. SW1A 1AA',auto:'postal-code'},
 {k:'notes',label:'NOTE FOR US (OPTIONAL)',ph:'Delivery instructions, anything we should know',textarea:true,full:true},
];
function formMarkup(){
 return `<p class="bag-post-intro">UK delivery only. We will email your tracking reference after the courier accepts your parcel.</p><form class="co-form" id="coForm" novalidate autocomplete="on">
 ${F.map(f=>`<div class="co-field ${f.full?'full':''}" data-field="${f.k}"><label for="co-${f.k}">${f.label}</label>${f.select?`<select id="co-${f.k}" name="${f.k}" autocomplete="country"><option value="">Choose your country</option>${S.countries.map(c=>`<option value="${c.code}" ${form.country===c.code?'selected':''}>${esc(c.name)}</option>`).join('')}</select>`:f.textarea?`<textarea id="co-${f.k}" name="${f.k}" placeholder="${esc(f.ph)}">${esc(form[f.k]||'')}</textarea>`:`<input id="co-${f.k}" name="${f.k}" type="${f.type||'text'}" placeholder="${esc(f.ph)}" value="${esc(form[f.k]||'')}" autocomplete="${f.auto||'on'}">`}<div class="field-error" hidden></div></div>`).join('')}
 <input type="text" name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
 <label class="co-check full" data-field="adult"><input type="checkbox" id="co-adult" ${form.adult?'checked':''}><span>I confirm I am 18 or over and that my delivery address is in the UK.</span></label>
 </form>`;
}
function readForm(){const f=$('#coForm');if(!f)return;F.forEach(x=>{const el=f.elements[x.k];if(el)form[x.k]=el.value.trim();});form.adult=$('#co-adult').checked;sessionStorage.setItem('flav4_form',JSON.stringify(form));}
function showErrors(errors){$$('.co-field,.co-check').forEach(el=>{const k=el.dataset.field;const e=errors[k];el.classList.toggle('invalid',!!e);const box=$('.field-error',el);if(box){box.hidden=!e;box.textContent=e||'';}});const first=$('.invalid');if(first)first.scrollIntoView({behavior:'smooth',block:'center'});}
function validateForm(){readForm();const e={};
 if((form.name||'').length<2)e.name='Enter your full name.';
 if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email||''))e.email='Enter a valid email address.';
 if((form.phone||'').length<6)e.phone='Enter a phone number the courier can reach.';
 if(form.country!=='GB')e.country='We only deliver within the UK.';
 if((form.address1||'').length<4)e.address1='Enter your street address.';
 if((form.city||'').length<2)e.city='Enter your town or city.';
  if(!/^(GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})$/i.test(form.postcode||''))e.postcode='Enter a valid UK postcode.';
 if(!form.adult)e.adult='You must confirm you are 18 or over.';
 showErrors(e);return !Object.keys(e).length;
}
const countryName=c=>(S.countries.find(x=>x.code===c)||{}).name||c;
const addressBlock=()=>[form.name,form.address1,form.address2,form.city,form.region,form.postcode,countryName(form.country)].filter(Boolean).join('\n');
function reviewMarkup(){const lines=PRODUCTS.filter(p=>cart[p.id]>0);
 return `<p class="bag-post-intro">Check it over. Press <strong>PLACE ORDER</strong> and we'll email your confirmation straight away.</p>
 <div class="review-block"><small>DELIVERING TO</small><pre>${esc(addressBlock())}</pre><p style="margin-top:10px">${esc(form.email)} · ${esc(form.phone)}</p>${form.notes?`<p style="margin-top:8px"><em>“${esc(form.notes)}”</em></p>`:''}<button type="button" class="bag-back" data-bag-edit style="margin-top:14px">← EDIT ADDRESS</button></div>
 <div class="review-lines">${lines.map(p=>`<div class="review-line"><span><small>${esc(p.brand)} / ${esc(p.series)}</small>${esc(p.flavour.toUpperCase())} × ${cart[p.id]}</span><span>${fmt(S.price*cart[p.id])}</span></div>`).join('')}</div>
 <div class="post-info"><strong>How you'll pay</strong><br>Your confirmation email comes with payment options. Card and crypto payment right here on the site is coming soon.</div>`;
}
function doneMarkup(){return `<div class="post-success"><div class="success-icon">✓</div><h3>ORDER<br>PLACED.</h3><div class="order-ref">${esc(placed.ref)}</div><p>Confirmation is on its way to <strong>${esc(form.email)}</strong> with your payment options. Tracking follows the moment it ships.</p><small>FLAV4 / THANK YOU</small></div>`;}
function renderBag(){
 const area=$('#bagContent'),bottom=$('#bagBottom');
 const titles={bag:'YOUR BAG<span>.</span>',details:'DELIVERY<span>.</span>',review:'REVIEW<span>.</span>',done:'DONE<span>.</span>'};
 const kickers={bag:'FLAV4 / YOUR BAG',details:'FLAV4 / STEP 2 OF 3',review:'FLAV4 / STEP 3 OF 3',done:'FLAV4 / ORDER CONFIRMED'};
 $('#bagHeading').innerHTML=titles[step];$('#bagKicker').textContent=kickers[step];
 if(step==='bag')area.innerHTML=bagItemsMarkup();
 if(step==='details')area.innerHTML=formMarkup();
 if(step==='review')area.innerHTML=reviewMarkup();
 if(step==='done')area.innerHTML=doneMarkup();
 const totals=step==='done'?`<div class="totals-row"><span>ORDER ${esc(placed.ref)}</span><strong>${fmt(placed.total)}</strong></div>`:`<div class="totals-row"><span>PRODUCTS (${cartCount()})</span><strong>${fmt(cartSubtotal())}</strong></div><div class="totals-row"><span>DELIVERY (ONCE)</span><strong>${fmt(cartShipping())}</strong></div><div class="totals-row totals-grand"><span>TOTAL</span><strong>${fmt(cartTotal())}</strong></div>`;
 const action={bag:`<button class="bag-primary" data-bag-next ${!cartCount()?'disabled':''}>CONTINUE TO DELIVERY <span>↗</span></button>`,
  details:`<button class="bag-primary" data-bag-review>REVIEW ORDER <span>↗</span></button><button class="bag-back" data-bag-back>← BACK TO BAG</button>`,
  review:`<button class="bag-primary" id="placeOrder" data-bag-place>PLACE ORDER <span>✓</span></button><button class="bag-back" data-bag-edit>← EDIT ADDRESS</button>`,
  done:`<button class="bag-primary" data-bag-reset>BACK TO PRODUCTS <span>↗</span></button>`}[step];
 bottom.innerHTML=`${totals}${action}<p class="bag-note">${step==='done'?'A COPY OF THIS ORDER IS IN YOUR INBOX.':'UK TRACKED DELIVERY · £15 PER ORDER · 18+ ONLY'}</p>`;
 if(step==='details'){const f=$('#coForm');f.addEventListener('input',readForm);f.addEventListener('change',readForm);}
}
async function placeOrder(){
 const btn=$('#placeOrder');btn.classList.add('is-busy');btn.innerHTML='PLACING… <span>◌</span>';
 const items=Object.entries(cart).map(([id,qty])=>({id,qty}));
 try{
  const r=await fetch('/api/orders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...form,items})});
  const d=await r.json();
  if(!r.ok){const e=d.errors||{};if(e.items){toast(e.items.toUpperCase());await load();step='bag';}else{step='details';}renderBag();if(step==='details')setTimeout(()=>showErrors(e),30);if(d.error)toast(d.error);return;}
  placed=d;Object.keys(cart).forEach(k=>delete cart[k]);saveCart();updateCount();step='done';renderBag();load();
 }catch(err){toast('CONNECTION PROBLEM — TRY AGAIN');btn.classList.remove('is-busy');btn.innerHTML='PLACE ORDER <span>✓</span>';}
}
function openBag(){if(step==='done')step='bag';renderBag();openLayer('bagOverlay');}
function cutoff(){const node=$('#cutoffStatus');if(!node)return;let o;try{o=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:S.timezone,weekday:'short',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(p=>[p.type,p.value]));}catch{return;}
 const weekday=['Mon','Tue','Wed','Thu','Fri'].includes(o.weekday);const remaining=(S.cutoffHour-Number(o.hour))*3600-Number(o.minute)*60-Number(o.second);
 if(weekday&&remaining>0){const h=Math.floor(remaining/3600),m=Math.floor((remaining%3600)/60),s=remaining%60;node.textContent=`10AM UK CUTOFF IN ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;}else{node.textContent='TODAY'S 10AM UK CUTOFF HAS PASSED';}}
function updateScroll(){const doc=document.documentElement;const max=Math.max(1,doc.scrollHeight-window.innerHeight);$('#progressLine').style.width=(Math.max(0,Math.min(1,scrollY/max))*100).toFixed(3)+'%';}
load().catch(()=>toast('COULD NOT LOAD THE COLLECTION — REFRESH'));setInterval(cutoff,1000);setInterval(()=>{if($('#bagOverlay').hidden)load().catch(()=>{});},60000);
let ticking=false;window.addEventListener('scroll',()=>{if(!ticking){requestAnimationFrame(()=>{updateScroll();ticking=false;});ticking=true;}},{passive:true});updateScroll();
if('IntersectionObserver' in window){const observer=new IntersectionObserver(entries=>{entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('is-visible');observer.unobserve(e.target);}});},{threshold:.12});$$('.reveal').forEach(el=>observer.observe(el));}else{$$('.reveal').forEach(el=>el.classList.add('is-visible'));}
document.addEventListener('click',e=>{const target=e.target.closest('button,a');if(!target)return;
 const data=target.dataset;
 if(data.view){viewProduct(data.view);return;}
 if(data.add){addProduct(data.add);return;}
 if(Object.hasOwn(data,'openBag')){openBag();return;}
 if(Object.hasOwn(data,'closeDetail')){closeLayer('detailOverlay');return;}
 if(Object.hasOwn(data,'closeBag')){closeLayer('bagOverlay');return;}
 if(data.qty){changeQty(data.qty,Number(data.change));return;}
 if(target.id==='detailTabStudio'||target.id==='detailTabPhoto'){const p=byId[currentId];if(p&&p.studio){const useStudio=target.id==='detailTabStudio';$('#detailImage').src=useStudio?p.studio:p.real;$('#detailImagePane').classList.toggle('is-studio',useStudio);$('#detailVisualLabel').textContent=useStudio?'STUDIO VISUAL':'PRODUCT PHOTOGRAPH';$('#detailTabStudio').classList.toggle('selected',useStudio);$('#detailTabPhoto').classList.toggle('selected',!useStudio);$('#detailTabStudio').setAttribute('aria-pressed',String(useStudio));$('#detailTabPhoto').setAttribute('aria-pressed',String(!useStudio));}return;}
 if(data.filter){filter=data.filter;$$('[data-filter]').forEach(b=>{b.classList.toggle('active',b.dataset.filter===filter);b.setAttribute('aria-pressed',b.dataset.filter===filter?'true':'false');});renderProducts();return;}
 if(target.id==='detailClose'){closeLayer('detailOverlay');return;}
 if(target.id==='detailAdd'){if(currentId){addProduct(currentId);closeLayer('detailOverlay');step='bag';openBag();}return;}
 if(target.id==='bagClose'){closeLayer('bagOverlay');return;}
 if(Object.hasOwn(data,'continueBrowse')){closeLayer('bagOverlay');document.getElementById('drops').scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});return;}
 if(Object.hasOwn(data,'bagNext')){step='details';renderBag();$('.bag-panel').scrollTop=0;return;}
 if(Object.hasOwn(data,'bagReview')){if(validateForm()){step='review';renderBag();$('.bag-panel').scrollTop=0;}return;}
 if(Object.hasOwn(data,'bagEdit')){step='details';renderBag();return;}
 if(Object.hasOwn(data,'bagPlace')){placeOrder();return;}
 if(Object.hasOwn(data,'bagBack')){readForm();step='bag';renderBag();return;}
 if(Object.hasOwn(data,'bagReset')){closeLayer('bagOverlay');step='bag';document.getElementById('drops').scrollIntoView({behavior:'smooth'});return;}
});
$('#detailOverlay').addEventListener('click',e=>{if(e.target.classList.contains('overlay-dismiss'))closeLayer('detailOverlay');});
$('#bagOverlay').addEventListener('click',e=>{if(e.target.classList.contains('overlay-dismiss'))closeLayer('bagOverlay');});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!$('#detailOverlay').hidden)closeLayer('detailOverlay');else if(!$('#bagOverlay').hidden)closeLayer('bagOverlay');}});
})();
