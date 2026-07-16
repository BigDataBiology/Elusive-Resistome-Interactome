// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
const PLOTLY_LAYOUT_BASE = {
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor: 'rgba(0,0,0,0)',
  font: {family:'Inter, sans-serif', color:'#1a2b28', size:12},
  margin: {t:30,l:60,r:20,b:70},
  colorway: ['#1d3557','#2a9d8f','#e76f51','#7c5cbf','#6a9c3f','#c9962e','#6b7c77']
};
function downloadButton(format){
  const label = format.toUpperCase();
  return {
    name: `Download ${label}`,
    title: `Download plot as ${label}`,
    icon: {
      width: 1000, height: 1000,
      // camera glyph + format label so the two buttons are distinguishable
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">' +
        '<path fill="currentColor" d="M500 450a170 170 0 100 340 170 170 0 000-340zm0 280a110 110 0 110-220 110 110 0 010 220z"/>' +
        '<path fill="currentColor" d="M820 320H670l-40-70a40 40 0 00-34-20H404a40 40 0 00-34 20l-40 70H180a80 80 0 00-80 80v320a80 80 0 0080 80h640a80 80 0 0080-80V400a80 80 0 00-80-80zm20 400a20 20 0 01-20 20H180a20 20 0 01-20-20V400a20 20 0 0120-20h186l58-90h152l58 90h188a20 20 0 0120 20z"/>' +
        `<text x="500" y="900" font-family="Inter, sans-serif" font-size="260" font-weight="700" text-anchor="middle" fill="currentColor">${label}</text>` +
        '</svg>'
    },
    click: gd => Plotly.downloadImage(gd, {format, filename: gd.id || 'plot'})
  };
}
const PLOTLY_CONFIG = {displaylogo:false, responsive:true,
  modeBarButtonsToRemove:['lasso2d','select2d','toImage'],
  modeBarButtonsToAdd:[downloadButton('png'), downloadButton('svg')]};

// Read a Plotly title, which may be a plain string or a {text, ...} object.
function plotlyTitle(t){
  if(!t) return '';
  return (typeof t === 'string' ? t : String(t.text || '')).trim();
}

// Serialise a Plotly graph div's rendered data to TSV, one row per data point in
// long format. Column headers come from the plot itself: the x/y axis titles, the
// colorbar title for a heatmap's value, and the legend title (or the trace names)
// for the series column. Where a title is missing we fall back to a descriptive
// default (row/column/value for a heatmap, label for a categorical axis) rather
// than a bare x/y. Names are kept distinct so no two columns collapse into one.
function plotToTSV(gd){
  const traces = (gd && gd.data) || [];
  const multi = traces.length > 1;
  const named = multi || (traces[0] && traces[0].name);
  const full = (gd && (gd._fullLayout || gd.layout)) || {};
  const xAx = full.xaxis || {}, yAx = full.yaxis || {};
  const isHeat = traces.some(t => t.type === 'heatmap');

  // Explicit column names set via layout.meta.tsv ({x, y, series, z}). This is a
  // Plotly passthrough, so it never renders on the page or in image exports, letting
  // us name TSV columns for axes we deliberately leave untitled.
  const layoutIn = (gd && gd.layout) || {};
  const tsvMeta = (layoutIn.meta && layoutIn.meta.tsv) || (full.meta && full.meta.tsv) || {};
  // Read a visible axis/legend title, dropping Plotly's editable-mode placeholder
  // ("Click to enter X axis title") that it injects for untitled axes.
  const axisTitle = t => { const s = plotlyTitle(t); return /^Click to enter .* title$/.test(s) ? '' : s; };

  const used = new Set();
  const uniq = n => { const base = n || 'col'; let k = base, i = 2; while(used.has(k)) k = `${base}_${i++}`; used.add(k); return k; };
  const sCol = named ? uniq(tsvMeta.series || axisTitle(full.legend && full.legend.title) || 'series') : null;
  let xCol, yCol, zCol;
  if(isHeat){
    xCol = uniq(tsvMeta.x || axisTitle(xAx.title) || 'column');
    yCol = uniq(tsvMeta.y || axisTitle(yAx.title) || 'row');
    const heat = traces.find(t => t.type === 'heatmap');
    zCol = uniq(tsvMeta.z || axisTitle(heat.colorbar && heat.colorbar.title) || 'value');
  } else {
    xCol = uniq(tsvMeta.x || axisTitle(xAx.title) || (xAx.type === 'category' ? 'label' : 'x'));
    yCol = uniq(tsvMeta.y || axisTitle(yAx.title) || (yAx.type === 'category' ? 'label' : 'y'));
  }

  const cols = [];
  const rows = [];
  const addCol = k => { if(!cols.includes(k)) cols.push(k); };
  traces.forEach((tr, ti) => {
    const name = tr.name || (multi ? `series ${ti+1}` : '');
    if(tr.type === 'heatmap'){
      const z = tr.z||[], xs = tr.x||[], ys = tr.y||[];
      for(let i=0;i<z.length;i++)
        for(let j=0;j<(z[i]||[]).length;j++){
          const r = {};
          if(sCol && name) r[sCol] = name;
          r[xCol] = xs[j]; r[yCol] = ys[i]; r[zCol] = z[i][j];
          Object.keys(r).forEach(addCol); rows.push(r);
        }
    } else {
      const x = tr.x||[], y = tr.y||[];
      const n = Math.max(x.length, y.length);
      for(let i=0;i<n;i++){
        const r = {};
        if(sCol && name) r[sCol] = name;
        if(x.length) r[xCol] = x[i];
        if(y.length) r[yCol] = y[i];
        Object.keys(r).forEach(addCol); rows.push(r);
      }
    }
  });
  const esc = v => v==null ? '' : String(v).replace(/[\t\r\n]/g,' ');
  return [cols.map(esc).join('\t')]
    .concat(rows.map(r => cols.map(c => c in r ? esc(r[c]) : '').join('\t')))
    .join('\n');
}

function downloadTSV(gd){
  const blob = new Blob([plotToTSV(gd)], {type:'text/tab-separated-values'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = ((gd && gd.id) || 'plot') + '.tsv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
}

// Add a "Download data (TSV)" button as a sibling right after the plot div.
// Idempotent: the plot div lives inside a .card, so re-renders find the existing
// button and skip. gd is the graph div Plotly.react/newPlot resolves with.
function ensureTsvButton(gd){
  if(!gd || !gd.insertAdjacentElement) return;
  const next = gd.nextElementSibling;
  if(next && next.classList && next.classList.contains('tsv-dl')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tsv-dl';
  btn.textContent = '⤓ Download data (TSV)';
  btn.addEventListener('click', ()=> downloadTSV(gd));
  gd.insertAdjacentElement('afterend', btn);
}

// Drop-in wrappers for Plotly.react / Plotly.newPlot that also attach a TSV
// download button once the plot has rendered.
function plot(){
  return Plotly.react.apply(Plotly, arguments).then(gd=>{ ensureTsvButton(gd); return gd; });
}
function plotNew(){
  return Plotly.newPlot.apply(Plotly, arguments).then(gd=>{ ensureTsvButton(gd); return gd; });
}

function cleanLevel(s){
  if(!s) return s;
  return s.replace(' beta-lactamase','').replace('rifampin inactivation enzyme','RIF-inact. enz.')
          .replace('MFS efflux pump','MFS efflux').replace('efflux pump','efflux')
          .replace('beta-lactam modulation resistance','beta-lactam mod.')
          .replace('target-modifying enzyme','target-modif.')
          .replace('cell wall charge','cell wall')
          .replace('variant or mutant','v/m')
          .replace('permeability modulation','permeability')
          .replace('antibiotic inactivation enzyme','Inactivation')
          .replace('antibiotic sequestration','sequestration')
          .replace('resistance by absence','by absence')
          .replace('bifunctional aminoglycoside','bifunc. aminoglyc.')
          .replace('host-dependent nutrient acquisition','nutrient acq.');
}

function wrapClassLabel(s){
  const cleaned = cleanLevel(s);
  if(!cleaned) return cleaned;
  const words = cleaned.split(' ');
  if(words.length <= 2) return cleaned;
  return words.slice(0,2).join(' ') + '<br>' + words.slice(2).join(' ');
}

function chipToggle(container, options, selected, onChange, opts={}){
  container.innerHTML='';
  const box = document.createElement('div'); box.className='chips';
  const sel = new Set(selected);
  options.forEach(opt=>{
    const c = document.createElement('span');
    c.className = 'chip' + (sel.has(opt.value) ? ' on' : '');
    c.textContent = opt.label;
    c.addEventListener('click', ()=>{
      if(sel.has(opt.value)){
        if(opts.min && sel.size<=opts.min) return;
        sel.delete(opt.value);
      } else {
        if(opts.max && sel.size>=opts.max) return;
        sel.add(opt.value);
      }
      c.classList.toggle('on');
      onChange([...sel]);
    });
    box.appendChild(c);
  });
  container.appendChild(box);
  return ()=>[...sel];
}

function makeCheckList(container, options, selected, onChange, opts={}){
  container.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'checklist';
  const sel = new Set(selected);
  options.forEach(opt=>{
    const row = document.createElement('label');
    row.className = 'check-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = sel.has(opt.value);
    cb.addEventListener('change', ()=>{
      if(cb.checked){
        if(opts.max && sel.size>=opts.max){ cb.checked=false; return; }
        sel.add(opt.value);
      } else {
        if(opts.min && sel.size<=opts.min){ cb.checked=true; return; }
        sel.delete(opt.value);
      }
      onChange([...sel]);
    });
    const span = document.createElement('span');
    span.textContent = opt.label;
    row.appendChild(cb);
    row.appendChild(span);
    box.appendChild(row);
  });
  container.appendChild(box);
}

function makeSelect(container, options, selected, multiple, onChange, size){
  container.innerHTML='';
  const s = document.createElement('select');
  if(multiple){ s.multiple = true; s.size = size||6; }
  options.forEach(o=>{
    const opt = document.createElement('option');
    opt.value = o.value; opt.textContent = o.label;
    if(multiple ? selected.includes(o.value) : selected===o.value) opt.selected = true;
    s.appendChild(opt);
  });
  s.addEventListener('change', ()=>{
    if(multiple) onChange([...s.selectedOptions].map(o=>o.value));
    else onChange(s.value);
  });
  container.appendChild(s);
  return s;
}

function habData(fileKey, habitat){
  const raw = DATA[fileKey][habitat];
  if(!raw) return [];
  return raw.columns ? fromColumnar(raw) : raw;
}
function habArgCounts(h){ return habData('habitat_arg_counts', h); }
function habGeneClassProportion(h){ return habData('habitat_gene_class_proportion', h); }
function habJaccardFull(h){ return habData('habitat_jaccard_full', h); }
function habIdentityByClass(h){ return habData('habitat_identity_by_class', h); }
function habCsc(h){ return habData('habitat_csc', h); }
function habIdentityDistribution(h){ return DATA.habitat_identity_distribution[h] || {bin_centers:[], tools:[]}; }

const EXCLUDED_HABITATS = new Set(['isolate','amplicon','built-environment']);
function getHabitats(){
  return DATA.habitat_n_samples.map(d=>d.habitat)
    .filter(h=>!EXCLUDED_HABITATS.has(h)).sort();
}

const TOOL_LABEL = {}; // tool -> display label
const TOOL_DB = {};    // tool -> db group
DATA_FILES; // no-op reference to avoid tree-shake in some bundlers (harmless)

function cleanToolLabel(s){
  return s
    .replace('-\n', '-')   // "AMRFinder-\nPlus" -> "AMRFinder-Plus"
    .replace('/n', '-')    // "RGI/nBLAST" -> "RGI-BLAST" (source data typo)
    .replace('\n', ' ');
}

function buildToolLookups(){
  DATA.tool_meta.tools.forEach(t=>{
    TOOL_LABEL[t.tool] = cleanToolLabel(t.tools_labels);
    TOOL_DB[t.tool] = t.tools_db;
  });
}

// ---------------------------------------------------------------------------
// SIDE-MENU NAVIGATION: a persistent left sidebar (Intro / Global analysis /
// By Habitat, each with a submenu) replaces the old continuous-scroll
// wizard. Only one section is rendered into #content-inner at a time.
// ---------------------------------------------------------------------------
const NAV_TREE = [
  {key:'intro', label:'Introduction'},
  {key:'global', label:'Global analysis', children:[
    {key:'global-args', label:'ARGs by Pipeline'},
    {key:'global-geneclasses', label:'Gene Classes'},
    {key:'global-csc', label:'Class-specific Coverage'},
  ]},
  {key:'habitat', label:'By Habitat', children:[
    {key:'habitat-args', label:'ARGs by Pipeline'},
    {key:'habitat-geneclasses', label:'Gene Classes'},
    {key:'habitat-abundance', label:'Abundance & Richness'},
    {key:'habitat-csc', label:'Class-specific Coverage'},
    {key:'habitat-pancore', label:'Pan-/Core-resistome'},
  ]},
  {key:'about', label:'About & contacts'},
];
const FLAT_ORDER = NAV_TREE.flatMap(n => n.children ? n.children.map(c=>c.key) : [n.key]);
function prevKey(key){ const i=FLAT_ORDER.indexOf(key); return i>0 ? FLAT_ORDER[i-1] : null; }
function nextKey(key){ const i=FLAT_ORDER.indexOf(key); return i>=0 && i<FLAT_ORDER.length-1 ? FLAT_ORDER[i+1] : null; }

function defaultHabitat(){
  const habitats = getHabitats();
  return habitats.includes('human gut') ? 'human gut' : habitats[0];
}

function setChosenHabitat(v){
  CHOSEN_HABITAT = v;
  const sel = document.querySelector('.nav-habitat-picker select');
  if(sel && sel.value!==v) sel.value = v;
}

// Appends a "Have you considered...?" FAQ accordion to the bottom of a
// section: numbered questions that expand to reveal the answer text.
// Each entry is either a plain string (numbered "1","2",...) or
// {title, text} for a custom question label.
function renderFAQ(container, answers){
  if(!answers.length) return;
  const block = document.createElement('div');
  block.className = 'faq-block';
  block.innerHTML = `<h3 class="faq-title">Key Takeaways</h3>`;
  answers.forEach((entry,i)=>{
    const isObj = entry !== null && typeof entry === 'object';
    const label = isObj ? entry.title : String(i+1);
    const text = isObj ? entry.text : entry;
    const item = document.createElement('div');
    item.className = 'faq-item';
    item.innerHTML = `
      <button class="faq-question" type="button">
        <span class="faq-arrow">▸</span><span>${label}</span>
      </button>
      <div class="faq-answer">${text}</div>`;
    const btn = item.querySelector('.faq-question');
    btn.addEventListener('click', ()=>{
      const open = item.classList.toggle('open');
      item.querySelector('.faq-arrow').textContent = open ? '▾' : '▸';
    });
    block.appendChild(item);
  });
  container.appendChild(block);
}

const ROUTE_RENDER = {
  'intro': (el)=>renderIntroSection(el),
  'global-args': (el,h,k)=>renderAnalysisSection(el, null, k),
  'global-geneclasses': (el,h,k)=>renderGeneClassesSection(el, null, k),
  'global-csc': (el,h,k)=>renderCSCSection(el, null, k),
  'habitat-args': (el,h,k)=>renderAnalysisSection(el, h, k),
  'habitat-abundance': (el,h,k)=>renderAbundance(el, h, k),
  'habitat-geneclasses': (el,h,k)=>renderGeneClassesSection(el, h, k),
  'habitat-csc': (el,h,k)=>renderCSCSection(el, h, k),
  'habitat-pancore': (el,h,k)=>renderPanCore(el, h, k),
  'about': (el)=>renderAboutSection(el),
};

let ACTIVE_KEY = null;

function navigateTo(key){
  if(!key || !ROUTE_RENDER[key]) return;
  ACTIVE_KEY = key;
  if(key.startsWith('habitat-') && !CHOSEN_HABITAT) CHOSEN_HABITAT = defaultHabitat();
  const habitat = key.startsWith('habitat-') ? CHOSEN_HABITAT : null;

  const panel = document.getElementById('content-inner');
  panel.innerHTML = '';
  const section = document.createElement('section');
  section.className = 'flow-section';
  panel.appendChild(section);

  ROUTE_RENDER[key](section, habitat, key);
  makeControlsCollapsible(section, habitat);
  updateSidebarActive();
  document.getElementById('content').scrollTo(0,0);
  window.scrollTo(0,0);
}

// Filter/threshold/pipeline panels default to collapsed behind a "Filters"
// toggle, so a page's charts show up before its controls do.
function makeControlsCollapsible(root, habitat){
  let isFirst = true;
  root.querySelectorAll('.controls').forEach(ctrl=>{
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'controls-toggle';
    toggle.innerHTML = `<span class="controls-toggle-arrow">▸</span><span>Set Filters</span>`;
    ctrl.classList.add('controls-collapsed');
    ctrl.parentNode.insertBefore(toggle, ctrl);
    toggle.addEventListener('click', ()=>{
      const collapsed = ctrl.classList.toggle('controls-collapsed');
      toggle.querySelector('.controls-toggle-arrow').textContent = collapsed ? '▸' : '▾';
    });

    if(isFirst && habitat){
      isFirst = false;
      const note = document.createElement('p');
      note.id = 'habitat-info-note';
      note.className = 'habitat-info-note';
      toggle.parentNode.insertBefore(note, toggle.nextSibling);
      updateHabitatInfoNote(habitat);
    }
  });
}

// Keeps the habitat sample/ARG-count note in sync when a page's own habitat
// selector changes it without a full navigateTo() re-render.
function updateHabitatInfoNote(habitat){
  const note = document.getElementById('habitat-info-note');
  if(!note) return;
  const nRow = DATA.habitat_n_samples.find(d=>d.habitat===habitat);
  const argRow = DATA.habitat_total_args.find(d=>d.habitat===habitat);
  const parts = [];
  if(nRow) parts.push(`<b>${nRow.n_samples.toLocaleString()}</b> metagenomes analysed`);
  if(argRow) parts.push(`<b>${argRow.n_total_args.toLocaleString()}</b> unique ARGs found`);
  note.innerHTML = (parts.length ? `${parts.join(' &middot; ')} in <b>${habitat}</b>.` : '')
    + ` You can change the habitat in the filters below, or from the left menu.`;
}

function updateSidebarActive(){
  document.querySelectorAll('#sidebar .nav-item').forEach(elm=>{
    elm.classList.toggle('active', elm.dataset.key===ACTIVE_KEY);
  });
  document.querySelectorAll('#sidebar .nav-group').forEach(grp=>{
    const hasActive = ACTIVE_KEY && ACTIVE_KEY.startsWith(grp.dataset.group+'-');
    grp.querySelector('.nav-group-title').classList.toggle('active', hasActive);
    if(hasActive) grp.classList.add('open');
  });
}

function setSidebarHidden(hidden){
  document.getElementById('app').classList.toggle('sidebar-hidden', hidden);
  localStorage.setItem('sidebarHidden', hidden ? '1' : '0');
}

function buildSidebar(){
  const nav = document.getElementById('sidebar');
  nav.innerHTML = `<div class="nav-brand"><span>ARG Pipeline<br>Explorer</span>
    <button class="sidebar-toggle-btn" type="button" id="sidebar-hide-btn" title="Hide menu">«</button></div>`;
  document.getElementById('sidebar-hide-btn').addEventListener('click', ()=>setSidebarHidden(true));
  document.getElementById('sidebar-show-btn').addEventListener('click', ()=>setSidebarHidden(false));

  NAV_TREE.forEach(node=>{
    if(!node.children){
      const btn = document.createElement('button');
      btn.className = 'nav-item';
      btn.dataset.key = node.key;
      btn.textContent = node.label;
      btn.style.fontWeight = '600';
      btn.addEventListener('click', ()=>navigateTo(node.key));
      nav.appendChild(btn);
      return;
    }

    const group = document.createElement('div');
    group.className = 'nav-group';
    group.dataset.group = node.key;

    const title = document.createElement('div');
    title.className = 'nav-group-title';
    title.innerHTML = `<span>${node.label}</span><span class="nav-caret">▸</span>`;
    title.addEventListener('click', ()=>{
      group.classList.toggle('open');
      if(group.classList.contains('open')) navigateTo(node.children[0].key);
    });
    group.appendChild(title);

    if(node.key==='habitat'){
      const picker = document.createElement('div');
      picker.className = 'nav-habitat-picker';
      group.appendChild(picker);
      makeSelect(picker, getHabitats().map(h=>({value:h,label:h})), CHOSEN_HABITAT || defaultHabitat(), false, (v)=>{
        CHOSEN_HABITAT = v;
        if(ACTIVE_KEY && ACTIVE_KEY.startsWith('habitat-')) navigateTo(ACTIVE_KEY);
      });
    }

    const children = document.createElement('div');
    children.className = 'nav-children';
    node.children.forEach(c=>{
      const btn = document.createElement('button');
      btn.className = 'nav-item';
      btn.dataset.key = c.key;
      btn.textContent = c.label;
      btn.addEventListener('click', ()=>navigateTo(c.key));
      children.appendChild(btn);
    });
    group.appendChild(children);
    nav.appendChild(group);
  });
}

function initApp(){
  buildSidebar();
  setSidebarHidden(localStorage.getItem('sidebarHidden')==='1');
  navigateTo('intro');
}

// ---------------------------------------------------------------------------
// GUIDED FLOW: intro -> choice -> analysis (continuous scroll, not separate screens)
// ---------------------------------------------------------------------------
function renderIntroSection(el){
  el.innerHTML = `
    <h2>Antibiotic Resistance Gene Detection<br>on the Global Microbial Gene Catalog</h2>
    <p class="sub">Ten ARG-detection pipelines, run on the same underlying gene catalogue, disagree far more than you'd expect. This explorer lets you interact with the dataset behind
      <em><a href="https://www.biorxiv.org/content/10.64898/2026.05.11.724158v1" target="_blank">"The elusive resistome: a global comparison reveals large discrepancies among detection pipelines"</a></em> (Inda-Díaz et al., bioRxiv 2026). The data has been deposited at <a href="https://doi.org/10.5281/zenodo.19702877" target="_blank">Zenodo</a> (https://doi.org/10.5281/zenodo.19702877)</p>

    <div class="intro-layout">
      <div class="intro-main">
        <div class="stat-row">
          <div class="stat"><div class="n">278.8M</div><div class="l">unigenes screened (<a href="https://gmgc.embl.de/" target="_blank">GMGC v1.0</a>)</div></div>
          <div class="stat"><div class="n teal">11,519</div><div class="l">metagenomic samples used for abundance &amp; richness</div></div>
          <div class="stat"><div class="n amber">13</div><div class="l">distinct habitats represented</div></div>
          <div class="stat"><div class="n">178,107</div><div class="l">unigenes flagged as ARG by ≥1 pipeline</div></div>
        </div>

        <div class="card">
          <h3>Detection pipelines</h3>
          <p class="desc">Six core tools, each with its own reference database and calling logic.</p>
          <p class="pipeline-group-label">Alignment-based</p>
          <ul class="plain">
            <li>DeepARG v2</li>
            <li>RGI v6.0.3 (CARD v4.0.0)</li>
            <li>ResFinder v2.4.0</li>
            <li>ABRicate v1.0.1 (run against ARGANNOT, MEGARes, CARD, NCBI, ResFinder)</li>
          </ul>
          <p class="pipeline-group-label">HMMs-based</p>
          <ul class="plain">
            <li>fARGene v0.1</li>
          </ul>
          <p class="pipeline-group-label">Alignment- and HMMs-based</p>
          <ul class="plain">
            <li>AMRFinderPlus v4.0.15</li>
          </ul>
        </div>
      </div>

      <div class="intro-sidebar">
        <div class="card">
          <h3 style="font-size:14px;">Citations of core pipeline papers</h3>
          <p class="desc" style="font-size:11.5px;" id="intro-citations-note">Loading…</p>
          <div id="intro-citations-chart" class="plotwrap"></div>
        </div>
      </div>
    </div>

    <div class="wizard-actions">
      <button class="btn-primary" id="intro-continue-btn">Continue to analysis →</button>
    </div>
  `;
  document.getElementById('intro-continue-btn').addEventListener('click', ()=>navigateTo('global-args'));

  drawCitationsChart();
}

const CITATION_DOIS = {
  'ResFinder':      ['10.1093/jac/dks261', '10.1093/jac/dkaa345'],
  'RGI | CARD':     ['10.1128/aac.00419-13', '10.1093/nar/gkw1004', '10.1093/nar/gkac920'],
  'ARG-ANNOT':      ['10.1128/aac.01310-13'],
  'AMRFinderPlus':  ['10.1038/s41598-021-91456-0'],
  'DeepARG':        ['10.1186/s40168-018-0401-z'],
  'MEGARes':        ['10.1093/nar/gkz1010'],
  'fARGene':        ['10.1186/s40168-017-0353-8', '10.1186/s40168-019-0670-1',
                      '10.1038/s42003-023-05174-6', '10.1099/mgen.0.000770',
                      '10.1186/s12864-017-4064-0', '10.1099/mgen.0.000455']
};

// Snapshot (Google Scholar, 14 Apr 2026) -- shown instantly while the live
// OpenAlex fetch runs, and used as a fallback if that fetch fails.
const CITATION_FALLBACK = {
  'ResFinder':     {total: 8903, since2025: 1601},
  'RGI | CARD':    {total: 7427, since2025: 2286},
  'ARG-ANNOT':     {total: 1589, since2025: 205},
  'AMRFinderPlus': {total: 1445, since2025: 755},
  'DeepARG':       {total: 964,  since2025: 289},
  'MEGARes':       {total: 479,  since2025: 121},
  'fARGene':       {total: 440,  since2025: 122}
};

function renderCitationRows(byTool){
  return Object.entries(byTool)
    .map(([tool, d]) => ({tool, before2025: d.total - d.since2025, since2025: d.since2025, total: d.total}))
    .sort((a,b) => a.total - b.total);
}

function alignCitationsSidebar(){
  const main = document.querySelector('.intro-main');
  const sidebarCard = document.querySelector('.intro-sidebar .card');
  if(!main || !sidebarCard || window.innerWidth <= 820) return;
  const targetHeight = main.offsetHeight;
  sidebarCard.style.height = targetHeight + 'px';

  const chartDiv = document.getElementById('intro-citations-chart');
  const others = Array.from(sidebarCard.children).filter(c => c !== chartDiv);
  const usedHeight = others.reduce((sum, c) => sum + c.offsetHeight, 0);
  const style = getComputedStyle(sidebarCard);
  const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const gaps = 12 * Math.max(0, others.length); // approx margin between stacked children
  const chartHeight = Math.max(160, targetHeight - usedHeight - padding - gaps);
  Plotly.relayout(chartDiv, {height: chartHeight}).catch(()=>{});
}

function plotCitations(rows, sourceLabel){
  plot('intro-citations-chart', [
    {
      type:'bar', orientation:'h', name:'Before 2025',
      y: rows.map(r=>r.tool), x: rows.map(r=>r.before2025),
      marker:{color:'#8a9a95'},
      hovertemplate:'%{y} — before 2025: %{x:,}<extra></extra>'
    },
    {
      type:'bar', orientation:'h', name:'2025–26',
      y: rows.map(r=>r.tool), x: rows.map(r=>r.since2025),
      marker:{color:'#1d3557'},
      hovertemplate:'%{y} — 2025\u201326: %{x:,}<extra></extra>'
    }
  ], {...PLOTLY_LAYOUT_BASE, barmode:'stack',
    meta:{tsv:{series:'Period', y:'Tool', x:'Citations'}},
    height: 230, margin:{t:6,l:88,r:10,b:28},
    font:{...PLOTLY_LAYOUT_BASE.font, size:10.5},
    xaxis:{title:'', gridcolor:'#dde2de', tickfont:{size:9.5}, rangemode:'nonnegative'},
    yaxis:{automargin:true, tickfont:{size:10}},
    legend:{orientation:'h', y:-0.22, font:{size:9.5}}
  }, {...PLOTLY_CONFIG, displayModeBar:false}).then(()=>{
    requestAnimationFrame(alignCitationsSidebar);
  });

  const note = document.getElementById('intro-citations-note');
  if(note) note.textContent = sourceLabel;
}

let citationsResizeHandler = null;

function drawCitationsChart(){
  // Show the fallback snapshot immediately so the sidebar never looks empty.
  plotCitations(renderCitationRows(CITATION_FALLBACK), 'Google Scholar, as of 14 Apr 2026 (loading live data\u2026)');

  if(citationsResizeHandler) window.removeEventListener('resize', citationsResizeHandler);
  let resizeTimer;
  citationsResizeHandler = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(alignCitationsSidebar, 150);
  };
  window.addEventListener('resize', citationsResizeHandler);

  // Then try to fetch live counts from OpenAlex and replace it in place.
  const allDois = Object.values(CITATION_DOIS).flat();
  const url = `https://api.openalex.org/works?filter=doi:${allDois.join('|')}&per-page=50&mailto=arg-explorer@example.com`;

  fetch(url).then(res=>{
    if(!res.ok) throw new Error('OpenAlex request failed: '+res.status);
    return res.json();
  }).then(data=>{
    const byDoi = {};
    (data.results||[]).forEach(w=>{
      if(!w.doi) return;
      byDoi[w.doi.replace('https://doi.org/','')] = w;
    });

    const liveByTool = {};
    Object.entries(CITATION_DOIS).forEach(([tool, dois])=>{
      let total = 0, since2025 = 0;
      dois.forEach(doi=>{
        const w = byDoi[doi];
        if(!w) return;
        total += w.cited_by_count || 0;
        (w.counts_by_year||[]).forEach(cy=>{ if(cy.year >= 2025) since2025 += cy.cited_by_count; });
      });
      liveByTool[tool] = {total, since2025};
    });

    // Only switch to live data if we actually got numbers for every pipeline --
    // a partial response is more confusing than just keeping the labeled fallback.
    const gotAll = Object.values(liveByTool).every(d => d.total > 0);
    if(!gotAll) throw new Error('Incomplete OpenAlex response');

    plotCitations(renderCitationRows(liveByTool), 'Live via OpenAlex, updated on load. Counts differ from Google Scholar (different index coverage).');
  }).catch(()=>{
    plotCitations(renderCitationRows(CITATION_FALLBACK), 'Google Scholar, as of 14 Apr 2026 (live fetch unavailable \u2014 showing last known snapshot).');
  });
}

// ---------------------------------------------------------------------------
// ANALYSIS SECTION 1: ARG counts, Jaccard index, identity distribution
// ---------------------------------------------------------------------------
function renderAnalysisSection(el, habitat, navKey){
  const basicTools = DATA.tool_meta.basic_tools; // fixed 10-pipeline set, no user toggle here
  const P = habitat ? 'hab-' : '';

  el.innerHTML = `
    <button class="flow-back" id="${P}analysis-back-btn">← Back</button>
    <h2>ARGs by Pipeline</h2>
    <p class="sub">${habitat
      ? 'How many ARGs each pipeline calls, how much they agree, and the identity of their matches — scoped to this habitat.'
      : `A total of 178,107 unigenes from GMGCv1 were reported as an ARG by at least one pipeline. The largest difference — 45-fold — was observed between ABRicate-ResFinder and DeepARG.`}</p>

    <div class="controls" id="${P}identity-controls">
      ${habitat ? `<div class="control">
        <label>Habitat</label>
        <div id="${P}habitat-select"></div>
      </div>` : ''}
      <div class="control">
        <label>DeepARG identity threshold</label>
        <div id="${P}args-deeparg-identity"></div>
      </div>
      <div class="control">
        <label>RGI identity threshold</label>
        <div id="${P}args-rgi-identity"></div>
      </div>
      <div class="control" style="flex:1;min-width:320px;">
        <label>Pipelines</label>
        <div id="${P}args-pipeline-chips"></div>
      </div>
    </div>

    <div class="grid3">
      <div class="card" id="${P}card-argcount">
        <h3>Number of ARGs</h3>
        <p class="desc">Total distinct unigenes detected as ARG by each pipeline.</p>
        <div id="${P}args-bar" class="plotwrap"></div>
      </div>

      <div class="card" id="${P}card-identity">
        <h3>Identity Distribution</h3>
        <p class="desc">Identity level against the reference genes. fARGene and most of AMRFinder ARGs use HMMs; no identity level is reported.</p>
        <div id="${P}args-identity" class="plotwrap"></div>
      </div>

      <div class="card" id="${P}card-jaccard">
        <h3>Jaccard Index</h3>
        <p class="desc">Larger Jaccard Index indicates higher agreement between pipelines.</p>
        <div id="${P}args-jaccard" class="plotwrap"></div>
      </div>
    </div>

    <div class="wizard-actions" style="justify-content:space-between;">
      <button class="btn-secondary" id="${P}analysis-back-btn-2">← Back</button>
      <button class="btn-primary" id="${P}analysis-continue-btn">Continue to Gene Classes →</button>
    </div>
  `;

  document.getElementById(`${P}analysis-back-btn`).addEventListener('click', ()=>navigateTo('intro'));
  document.getElementById(`${P}analysis-back-btn-2`).addEventListener('click', ()=>navigateTo('intro'));
  document.getElementById(`${P}analysis-continue-btn`).addEventListener('click', ()=>navigateTo(nextKey(navKey)));

  let deepargLevel = 'DeepARG';   // DeepARG | DeepARG70 | DeepARG80 | DeepARG90
  let rgiLevel = 'RGI-DIAMOND';   // RGI-DIAMOND | RGI-DIAMOND70/80/90
  let selectedPipelines = [...basicTools];

  function barToolSet(){
    // swap: the chosen identity level REPLACES the base pipeline
    return selectedPipelines.map(t=>{
      if(t==='DeepARG') return deepargLevel;
      if(t==='RGI-DIAMOND') return rgiLevel;
      return t;
    });
  }

  function jaccardToolSet(){
    // add-alongside, positioned right next to its base pipeline (not appended at the end)
    const set = [];
    selectedPipelines.forEach(t=>{
      set.push(t);
      if(t==='DeepARG' && deepargLevel!=='DeepARG') set.push(deepargLevel);
      if(t==='RGI-DIAMOND' && rgiLevel!=='RGI-DIAMOND') set.push(rgiLevel);
    });
    return set;
  }

  function identityToolSet(){
    // add-alongside, like jaccardToolSet(), but tags threshold variants
    // so drawIdentityDistribution() can render them as dotted lines
    const set = [];
    selectedPipelines.forEach(t=>{
      set.push({tool:t, dashed:false});
      if(t==='DeepARG' && deepargLevel!=='DeepARG') set.push({tool:deepargLevel, dashed:true});
      if(t==='RGI-DIAMOND' && rgiLevel!=='RGI-DIAMOND') set.push({tool:rgiLevel, dashed:true});
    });
    return set;
  }

  function sharedChartHeight(){
    const n = jaccardToolSet().length;
    return Math.max(420, n*44);
  }

  function drawBar(){
    const h = sharedChartHeight();
    const tools = jaccardToolSet();
    const argCounts = habitat ? habArgCounts(habitat) : DATA.arg_counts;
    const rows = tools.map(t=>argCounts.find(d=>d.tool===t)).filter(Boolean);
    plot(`${P}args-bar`, [{
      type:'bar', orientation:'h',
      y: rows.map(d=>TOOL_LABEL[d.tool]||d.tool),
      x: rows.map(d=>d.n),
      marker:{color: rows.map(d=>DB_COLOR[d.tools_db]||'#1d3557'), line:{color:'#ffffff', width:1}},
      hovertemplate: '%{y}: %{x:,}<extra></extra>'
    }], {...PLOTLY_LAYOUT_BASE, height:h,
         meta:{tsv:{y:'Tool'}},
         margin:{t:8,l:20,r:8,b:75},
         xaxis:{title:'Number of ARGs', gridcolor:'#dde2de', rangemode:'nonnegative'},
         yaxis:{automargin:true, autorange:'reversed', tickfont:{size:9.5}, tickangle:-45}}, PLOTLY_CONFIG);
  }

  function drawJaccard(){
    const h = sharedChartHeight();
    const tools = jaccardToolSet();
    const labels = tools.map(t=>TOOL_LABEL[t]||t);
    const jaccardData = habitat ? habJaccardFull(habitat) : DATA.jaccard_full;
    const jmap = new Map(jaccardData.map(d=>[d.tool_ref+'|'+d.tool_comp, d.jaccard]));
    const z = tools.map(tr => tools.map(tc=>{
      if(tr===tc) return null;
      const v = jmap.get(tr+'|'+tc);
      return v===undefined ? null : v;
    }));
    plot(`${P}args-jaccard`, [{
      type:'heatmap', z, x:labels, y:labels,
      colorscale:[[0,'#eef0ee'],[1,'#2a9d8f']], zmin:0, zmax:1,
      hovertemplate:'%{y} vs %{x}: %{z:.0%}<extra></extra>',
      colorbar:{tickformat:'.0%', thickness:10}
    }], {...PLOTLY_LAYOUT_BASE, height:h,
         meta:{tsv:{x:'Tool', y:'Tool', z:'Jaccard similarity'}},
         margin:{t:8,l:20,r:8,b:75},
         xaxis:{tickangle:-90, automargin:true, tickfont:{size:8.5}},
         yaxis:{autorange:'reversed', automargin:true, tickfont:{size:9.5}, tickangle:-45}}, PLOTLY_CONFIG);
  }

  function drawIdentityDistribution(){
    const h = sharedChartHeight();
    const idist = habitat ? habIdentityDistribution(habitat) : DATA.identity_distribution;
    const x = idist.bin_centers;
    const densityByTool = new Map(idist.tools.map(t=>[t.tool, t.density]));
    const traces = identityToolSet()
      .filter(entry=>densityByTool.has(entry.tool))
      .map(entry=>{
        const t = entry.tool;
        return {
          type:'scatter', mode:'lines', name: TOOL_LABEL[t]||t,
          x, y: densityByTool.get(t),
          line:{width:2.5, color: DB_COLOR[TOOL_DB[t]]||'#1d3557',
                dash: entry.dashed ? 'dot' : (t.startsWith('ABRicate') ? 'dash' : 'solid')},
          hovertemplate: (TOOL_LABEL[t]||t)+' — %{x:.0f}% identity: %{y:.1%}<extra></extra>'
        };
      });
    plot(`${P}args-identity`, traces, {...PLOTLY_LAYOUT_BASE, height:h,
      meta:{tsv:{series:'Tool'}},
      xaxis:{title:'Percent identity to reference', gridcolor:'#dde2de', rangemode:'nonnegative'},
      yaxis:{title:'Density', gridcolor:'#dde2de', rangemode:'nonnegative'},
      legend:{orientation:'h', y:-0.3}}, PLOTLY_CONFIG);
  }

  if(habitat){
    makeSelect(document.getElementById(`${P}habitat-select`),
      getHabitats().map(h=>({value:h,label:h})), habitat, false,
      (v)=>{habitat=v; setChosenHabitat(v); updateHabitatInfoNote(v); drawBar(); drawJaccard(); drawIdentityDistribution();});
  }

  chipToggle(document.getElementById(`${P}args-pipeline-chips`),
    basicTools.map(t=>({value:t,label:TOOL_LABEL[t]||t})), selectedPipelines,
    (vals)=>{selectedPipelines=vals; drawBar(); drawJaccard(); drawIdentityDistribution();});

  makeSelect(document.getElementById(`${P}args-deeparg-identity`),
    [{value:'DeepARG',label:'No threshold'},{value:'DeepARG70',label:'≥70%'},
     {value:'DeepARG80',label:'≥80%'},{value:'DeepARG90',label:'≥90%'}],
    deepargLevel, false, (v)=>{deepargLevel=v; drawBar(); drawJaccard(); drawIdentityDistribution();});

  makeSelect(document.getElementById(`${P}args-rgi-identity`),
    [{value:'RGI-DIAMOND',label:'No threshold'},{value:'RGI-DIAMOND70',label:'≥70%'},
     {value:'RGI-DIAMOND80',label:'≥80%'},{value:'RGI-DIAMOND90',label:'≥90%'}],
    rgiLevel, false, (v)=>{rgiLevel=v; drawBar(); drawJaccard(); drawIdentityDistribution();});

  drawBar(); drawJaccard(); drawIdentityDistribution();

  renderFAQ(el, habitat ? [] : [
    {title: "Confusing lowering thresholds for larger resistomes",
     text: "<ul><li>Despite RGI using 'perfect' and 'strict' thresholds, it reports 90% of the ARGs with <80% identity level to the reference genes.</li><li>DeepARG reports 85% of the ARGs with <80% identity level to reference genes.</li><li>Does lowering sequence identity thresholds enable discovery of ARGs?</li><li>Would this strategy work for any gene class?</li></ul>"},
    {title: "Agree to disagree",
     text: "<ul><li>The average Jaccard Index between pipelines is 16%.</li><li>ABRricate pipelines had an average Jaccard Index of 36%.</li><li>The average Jaccard Index of any pairwise comparison outside ABRricate pipelines was as low as 7%.</li></ul>"},
    {title: "Same map, same road, different destination",
     text: "<ul><li>ABRicate, compared to RGI, AMRFinderPlus, and ResFinder, shows different results.</li></ul>"}
  ]);
}

// ---------------------------------------------------------------------------
// GENE CLASSES SECTION: ARG counts (carried over), counts-by-class heatmap,
// and proportion-by-class heatmap, sharing one gene-class selection.
// ---------------------------------------------------------------------------
function renderGeneClassesSection(el, habitat, navKey){
  const basicTools = DATA.tool_meta.basic_tools;
  const defaultClasses = DATA.gene_class_order.default_20;
  const P = habitat ? 'hab-gc-' : 'gc-';

  el.innerHTML = `
    <button class="flow-back" id="${P}back-btn">← Back to ARGs by Pipeline</button>
    <h2>Gene Classes</h2>
    <p class="sub">Number of genes and identity levels broken down by ARG classes.</p>

    <div class="controls">
      ${habitat ? `<div class="control">
        <label>Habitat</label>
        <div id="${P}habitat-select"></div>
      </div>` : ''}
      <div class="control" id="${P}pipeline-controls" style="flex:1;min-width:220px;">
        <label>Pipelines</label>
        <div id="${P}pipeline-chips"></div>
      </div>
      <div class="control" id="${P}filter-controls" style="display:flex;flex-direction:row;flex-wrap:nowrap;gap:16px;flex:2;">
        <div class="control" style="flex:0 0 auto;">
          <label>DeepARG identity threshold</label>
          <div id="${P}deeparg-identity"></div>
        </div>
        <div class="control" style="flex:0 0 auto;">
          <label>RGI identity threshold</label>
          <div id="${P}rgi-identity"></div>
        </div>
        <div class="control" style="flex:1;min-width:200px;" id="${P}class-control">
          <label>Gene classes shown (default ${defaultClasses.length})</label>
          <div id="${P}class-select"></div>
        </div>
      </div>
    </div>

    <div class="grid3">
      <div class="card" id="${P}card-identity">
        <h3>Identity Distribution by Gene Class</h3>
        <p class="desc">DeepARG and RGI.</p>
        <div id="${P}identity-by-class" class="plotwrap"></div>
      </div>

      <div class="card" id="${P}card-classbar">
        <h3>Number of Genes per Gene Class</h3>
        <p class="desc">Number of unigenes detected as ARG by class and pipeline.</p>
        <div id="${P}class-bar" class="plotwrap"></div>
      </div>

      <div class="card" id="${P}card-prop">
        <h3>Gene Class Proportion</h3>
        <p class="desc">Proportion of gene classes on each pipeline's total calls.</p>
        <div id="${P}prop-heatmap" class="plotwrap"></div>
      </div>
    </div>

    <div class="wizard-actions" style="justify-content:space-between;">
      <button class="btn-secondary" id="${P}back-btn-2">← Back</button>
      <button class="btn-primary" id="${P}continue-btn">${habitat ? 'Continue to Abundance & Richness →' : 'Continue to Class-specific Coverage →'}</button>
    </div>
  `;

  document.getElementById(`${P}back-btn`).addEventListener('click', ()=>navigateTo(prevKey(navKey)));
  document.getElementById(`${P}back-btn-2`).addEventListener('click', ()=>navigateTo(prevKey(navKey)));
  document.getElementById(`${P}continue-btn`).addEventListener('click', ()=>navigateTo(nextKey(navKey)));

  let deepargLevel = 'DeepARG';
  let rgiLevel = 'RGI-DIAMOND';
  let selectedClasses = [...defaultClasses];
  let selectedPipelines = [...basicTools];

  function barToolSet(){
    // swap: the chosen identity level replaces the base pipeline
    return selectedPipelines.map(t=>{
      if(t==='DeepARG') return deepargLevel;
      if(t==='RGI-DIAMOND') return rgiLevel;
      return t;
    });
  }

  function classBarToolSet(){
    // add-alongside: keep the original pipeline, add the filtered variant next to it
    const set = [];
    selectedPipelines.forEach(t=>{
      set.push(t);
      if(t==='DeepARG' && deepargLevel!=='DeepARG') set.push(deepargLevel);
      if(t==='RGI-DIAMOND' && rgiLevel!=='RGI-DIAMOND') set.push(rgiLevel);
    });
    return set;
  }

  function geneClassProp(){ return habitat ? habGeneClassProportion(habitat) : DATA.gene_class_proportion; }
  function identityByClass(){ return habitat ? habIdentityByClass(habitat) : DATA.identity_by_class; }

  function drawIdentityByClass(){
    const classes = selectedClasses;
    const classLabels = classes.map(wrapClassLabel);
    const ibc = identityByClass();
    const traces = [deepargLevel, rgiLevel].map(t=>{
      const rows = classes.map(cl=>ibc.find(d=>d.tool===t && d.new_level===cl));
      const color = DB_COLOR[TOOL_DB[t]] || '#1B9E77';
      return {
        type:'box', orientation:'h', name: TOOL_LABEL[t]||t, y: classLabels,
        q1: rows.map(r=>r?r.q25:null), median: rows.map(r=>r?r.median:null),
        q3: rows.map(r=>r?r.q75:null), lowerfence: rows.map(r=>r?r.w1:null),
        upperfence: rows.map(r=>r?r.w2:null),
        marker:{color}, line:{color}, hoverinfo:'skip'
      };
    });
    plot(`${P}identity-by-class`, traces, {...PLOTLY_LAYOUT_BASE, boxmode:'group',
      meta:{tsv:{y:'Gene class', series:'Tool'}},
      height: Math.max(460, classes.length*42), margin:{t:10,l:20,r:8,b:95},
      xaxis:{title:'Percent identity', range:[0,102], gridcolor:'#dde2de', rangemode:'nonnegative'},
      yaxis:{automargin:true, autorange:'reversed', categoryorder:'array', categoryarray:classLabels, tickangle:-45, tickfont:{size:9.5}},
      legend:{orientation:'h', y:-0.12}}, PLOTLY_CONFIG);
  }

  function drawClassBar(){
    const tools = barToolSet();
    const classes = selectedClasses;
    const classLabels = classes.map(wrapClassLabel);
    const gcp = geneClassProp();
    const traces = tools.map(t=>{
      const row = DATA.tool_meta.tools.find(d=>d.tool===t);
      const perClass = classes.map(cl=>gcp.find(d=>d.tool===t && d.new_level===cl));
      return {
        type:'bar', orientation:'h', name: TOOL_LABEL[t]||t,
        y: classLabels,
        x: perClass.map(r=>r ? r.n : 0),
        customdata: perClass.map(r=>r ? r.p : 0),
        marker:{color: DB_COLOR[row?row.tools_db:'']||'#1d3557'},
        hovertemplate: (TOOL_LABEL[t]||t)+' — %{y}: %{x:,} (%{customdata:.1%})<extra></extra>'
      };
    });
    // dummy invisible trace to force Plotly to render the mirrored top axis
    traces.push({type:'scatter', mode:'markers', x:[0], y:[classLabels[0]],
      xaxis:'x2', showlegend:false, hoverinfo:'skip', marker:{opacity:0}});

    const dividers = classLabels.slice(0,-1).map((_,i)=>({
      type:'line', xref:'paper', x0:0, x1:1,
      yref:'y', y0:i+0.5, y1:i+0.5,
      line:{color:'#dde2de', width:1}
    }));

    plot(`${P}class-bar`, traces, {...PLOTLY_LAYOUT_BASE, barmode:'group',
      meta:{tsv:{y:'Gene class', series:'Tool'}},
      height: Math.max(500, classes.length*70),
      margin:{t:50,l:20,r:20,b:60},
      shapes: dividers,
      xaxis:{title:'Number of ARGs', gridcolor:'#dde2de', rangemode:'nonnegative'},
      xaxis2:{title:'Number of ARGs', overlaying:'x', side:'top', matches:'x', gridcolor:'#dde2de', rangemode:'nonnegative'},
      yaxis:{automargin:true, autorange:'reversed', categoryorder:'array', categoryarray:classLabels, tickangle:-45, tickfont:{size:9.5}},
      legend:{orientation:'h', y:-0.12}}, PLOTLY_CONFIG);
  }

  function drawPropHeatmap(){
    const tools = classBarToolSet();
    const classes = selectedClasses;
    const gcp = geneClassProp();
    const z = classes.map(cl => tools.map(t=>{
      const row = gcp.find(d=>d.tool===t && d.new_level===cl);
      return row ? row.p : 0;
    }));
    plot(`${P}prop-heatmap`, [{
      type:'heatmap', z, x: tools.map(t=>TOOL_LABEL[t]||t), y: classes.map(wrapClassLabel),
      colorscale:[[0,'#eef0ee'],[1,'#2a9d8f']],
      hovertemplate:'%{y} — %{x}: %{z:.1%}<extra></extra>',
      colorbar:{tickformat:'.0%', thickness:10}
    }], {...PLOTLY_LAYOUT_BASE, height: Math.max(460, classes.length*42),
         meta:{tsv:{x:'Tool', y:'Gene class', z:'Proportion'}},
         margin:{t:10,l:20,r:8,b:95},
         xaxis:{tickangle:-90, automargin:true, tickfont:{size:9.5}},
         yaxis:{automargin:true, tickfont:{size:9.5}, autorange:'reversed', tickangle:-45}}, PLOTLY_CONFIG);
  }

  makeSelect(document.getElementById(`${P}deeparg-identity`),
    [{value:'DeepARG',label:'No threshold'},{value:'DeepARG70',label:'≥70%'},
     {value:'DeepARG80',label:'≥80%'},{value:'DeepARG90',label:'≥90%'}],
    deepargLevel, false, (v)=>{deepargLevel=v; drawIdentityByClass(); drawClassBar(); drawPropHeatmap();});

  makeSelect(document.getElementById(`${P}rgi-identity`),
    [{value:'RGI-DIAMOND',label:'No threshold'},{value:'RGI-DIAMOND70',label:'≥70%'},
     {value:'RGI-DIAMOND80',label:'≥80%'},{value:'RGI-DIAMOND90',label:'≥90%'}],
    rgiLevel, false, (v)=>{rgiLevel=v; drawIdentityByClass(); drawClassBar(); drawPropHeatmap();});

  makeCheckList(document.getElementById(`${P}class-select`),
    DATA.gene_class_order.all.map(c=>({value:c,label:c})), selectedClasses,
    (vals)=>{selectedClasses = vals; drawIdentityByClass(); drawClassBar(); drawPropHeatmap();}, {min:1});

  chipToggle(document.getElementById(`${P}pipeline-chips`),
    basicTools.map(t=>({value:t,label:TOOL_LABEL[t]||t})), selectedPipelines,
    (vals)=>{selectedPipelines = vals; drawClassBar(); drawPropHeatmap();});

  if(habitat){
    makeSelect(document.getElementById(`${P}habitat-select`),
      getHabitats().map(h=>({value:h,label:h})), habitat, false,
      (v)=>{habitat=v; setChosenHabitat(v); updateHabitatInfoNote(v); drawIdentityByClass(); drawClassBar(); drawPropHeatmap();});
  }

  drawIdentityByClass(); drawClassBar(); drawPropHeatmap();

  renderFAQ(el, habitat ? [] : [
    {title: "Go with the outflow",
     text: "<ul><li>DeepARG – 23,784 (58%) of the efflux pumps were labelled by the tool as 'multidrug', a category highlighted by the authors of the tool as an important technical challenge requiring manual curation.</li><li>DeepARG – 5,290 (13%) of the efflux pumps were labelled as <strong>“unclassified”</strong> with a median <strong>“probability”</strong> of 98%.</li><li>RGI – There are significant difficulties in distinguishing between resistance-conferring pumps and homologs (<a href=\"https://doi.org/10.64898/2025.12.11.693720\" target=\"_blank\">Mukiri, K. M. et al., 2025</a>).</li></ul>"},
    {title: "Blindly pointing",
     text: "<ul><li>Resistance to rifampicin is usually conferred through point mutations in the universal bacterial gene <em>rpoB</em>, which encodes the RNA polymerase-𝛽-subunit.</li><li>DeepARG reported <em>rpoB</em> genes as ARGs without checking for specific point mutations conferring resistance and with a median identity threshold of 54%.</li></ul>"},
    {title: "The Van-ishing Act",
     text: "<ul><li>35% of <em>van</em> genes reported by RGI are <em>vanY</em> — an accessory D,D-carboxypeptidase (not the core ligase) that only increases resistance once the ligase-driven cassette is already active; it is not alone sufficient for resistance.</li><li>32% of <em>van</em> genes reported by RGI are <em>vanW</em> – an accessory gene of unknown function.</li><li>23% of <em>van</em> genes reported by RGI are <em>vanT</em> — 99% are below 80% identity. The housekeeping and regulatory gene alanine racemase and <em>vanT</em> share high sequence similarity; <em>vanT</em> alone is not sufficient for resistance.</li></ul>"}
  ]);
}

// ---------------------------------------------------------------------------
// CLASS-SPECIFIC COVERAGE (CSC) BY GENE CLASS
// ---------------------------------------------------------------------------
function renderCSCSection(el, habitat, navKey){
  const basicTools = DATA.tool_meta.basic_tools;
  const defaultClasses = DATA.gene_class_order.default_20;
  const P = habitat ? 'hab-csc-' : 'csc-';

  el.innerHTML = `
    <button class="flow-back" id="${P}back-btn">← Back to gene classes</button>
    <h2>Class-specific Coverage (CSC) by Gene Class</h2>
    <p class="sub">For each baseline pipeline, CSC asks: of the ARGs a comparison pipeline reports in a given class, what proportion does the baseline pipeline also report?</p>

    <div class="controls">
      ${habitat ? `<div class="control">
        <label>Habitat</label>
        <div id="${P}habitat-select"></div>
      </div>` : ''}
      <div class="control">
        <label>DeepARG identity threshold</label>
        <div id="${P}deeparg-identity"></div>
      </div>
      <div class="control">
        <label>RGI identity threshold</label>
        <div id="${P}rgi-identity"></div>
      </div>
      <div class="control" style="flex:1;min-width:220px;">
        <label>Gene classes shown (default ${defaultClasses.length})</label>
        <div id="${P}class-select"></div>
      </div>
      <div class="control" style="flex:1;min-width:280px;">
        <label>Reference pipelines (1–10)</label>
        <div id="${P}ref-chips"></div>
      </div>
      <div class="control" style="flex:1;min-width:280px;">
        <label>Comparison pipelines</label>
        <div id="${P}comp-chips"></div>
      </div>
    </div>

    <div class="card" id="${P}card-box">
      <h3>Class-specific Coverage</h3>
      <p class="desc">The boxplots represent the distribution of the CSC for the baseline pipeline against all other comparison pipelines.</p>
      <div id="${P}box" class="plotwrap"></div>
    </div>

    <div class="wizard-actions" style="justify-content:space-between;">
      <button class="btn-secondary" id="${P}back-btn-2">← Back</button>
      <button class="btn-primary" id="${P}continue-btn">${habitat ? 'Continue to Pan-/Core-resistome →' : 'Continue to Habitat level →'}</button>
    </div>
  `;

  document.getElementById(`${P}back-btn`).addEventListener('click', ()=>navigateTo(prevKey(navKey)));
  document.getElementById(`${P}back-btn-2`).addEventListener('click', ()=>navigateTo(prevKey(navKey)));
  document.getElementById(`${P}continue-btn`).addEventListener('click', ()=>navigateTo(nextKey(navKey)));

  let deepargLevel = 'DeepARG';
  let rgiLevel = 'RGI-DIAMOND';
  let selectedClasses = [...defaultClasses];

  // indices into basicTools; stable across identity-threshold swaps
  const defaultRefNames = ['DeepARG','fARGene','ABRicate-MEGARes','RGI-DIAMOND','AMRFinderPlus','ResFinder'];
  let selectedRefIndices = defaultRefNames.map(n=>basicTools.indexOf(n));
  // comparison pipelines: which of the 10 basic pipelines to compare against; default all
  let selectedCompIndices = basicTools.map((_,i)=>i);

  function toolSet(){
    return basicTools.map(t=>{
      if(t==='DeepARG') return deepargLevel;
      if(t==='RGI-DIAMOND') return rgiLevel;
      return t;
    });
  }

  function cscData(){ return habitat ? habCsc(habitat) : DATA.csc; }

  function refreshRefChips(){
    const ts = toolSet();
    chipToggle(document.getElementById(`${P}ref-chips`),
      ts.map((t,i)=>({value:String(i), label:TOOL_LABEL[t]||t})),
      selectedRefIndices.map(String),
      (vals)=>{selectedRefIndices = vals.map(Number); draw();},
      {min:1, max:10});
  }

  function refreshCompChips(){
    const ts = toolSet();
    chipToggle(document.getElementById(`${P}comp-chips`),
      ts.map((t,i)=>({value:String(i), label:TOOL_LABEL[t]||t})),
      selectedCompIndices.map(String),
      (vals)=>{selectedCompIndices = vals.map(Number); draw();},
      {min:1});
  }

  function draw(){
    const ts = toolSet();
    const compTools = selectedCompIndices.map(i=>ts[i]);
    const classLabels = selectedClasses.map(wrapClassLabel);
    const refs = selectedRefIndices.map(i=>ts[i]);
    const n = refs.length;
    const gap = 0.035;
    const width = (1 - gap*(n-1)) / n;
    const csc = cscData();

    const traces = [];
    const dividers = [];
    const layout = {...PLOTLY_LAYOUT_BASE,
      meta:{tsv:{x:'CSC', y:'Gene class', series:'Reference tool'}},
      height: Math.max(480, classLabels.length*46),
      margin:{t:40,l:20,r:20,b:60},
      showlegend:false,
      yaxis:{automargin:true, autorange:'reversed', categoryorder:'array', categoryarray:classLabels, tickangle:-45},
      annotations:[]
    };

    refs.forEach((refTool,i)=>{
      const xkey = i===0 ? 'x' : `x${i+1}`;
      const axisKey = i===0 ? 'xaxis' : `xaxis${i+1}`;
      const d0 = i*(width+gap), d1 = d0+width;

      if(i>0){
        dividers.push({
          type:'line', xref:'paper', yref:'paper',
          x0: d0-gap/2, x1: d0-gap/2, y0:0, y1:1,
          line:{color:'#dde2de', width:1}
        });
      }

      const rows = csc.filter(d=>d.tool_ref===refTool && compTools.includes(d.tool_comp)
        && selectedClasses.includes(d.new_level));
      const meta = DATA.tool_meta.tools.find(t=>t.tool===refTool);
      const refColor = DB_COLOR[meta?meta.tools_db:''] || '#1d3557';
      const dotColors = rows.map(d=>{
        const compMeta = DATA.tool_meta.tools.find(t=>t.tool===d.tool_comp);
        return DB_COLOR[compMeta?compMeta.tools_db:''] || '#1d3557';
      });

      traces.push({
        type:'box', orientation:'h', name: TOOL_LABEL[refTool]||refTool,
        xaxis: xkey, yaxis:'y',
        y: rows.map(d=>wrapClassLabel(d.new_level)),
        x: rows.map(d=>d.csc),
        text: rows.map(d=>TOOL_LABEL[d.tool_comp]||d.tool_comp),
        boxpoints:'all', jitter:0.6, pointpos:0, hoveron:'points',
        marker:{color: dotColors, size:6, opacity:0.9, line:{color:'#ffffff', width:0.5}},
        line:{color: refColor, width:1.5},
        fillcolor:'rgba(0,0,0,0.03)',
        hovertemplate: (TOOL_LABEL[refTool]||refTool)+' — %{y}, vs %{text}: %{x:.0%}<extra></extra>'
      });

      layout[axisKey] = {
        domain:[d0, d1], anchor:'y',
        range:[0,1.02], tickformat:'.0%', gridcolor:'#dde2de', rangemode:'nonnegative'
      };

      layout.annotations.push({
        xref:'paper', yref:'paper', x:(d0+d1)/2, y:1.03,
        xanchor:'center', yanchor:'bottom',
        text: TOOL_LABEL[refTool]||refTool, showarrow:false,
        font:{size:11, color:'#1a2b28'}
      });
    });

    layout.shapes = dividers;
    plot(`${P}box`, traces, layout, PLOTLY_CONFIG);
  }

  makeSelect(document.getElementById(`${P}deeparg-identity`),
    [{value:'DeepARG',label:'No threshold'},{value:'DeepARG70',label:'≥70%'},
     {value:'DeepARG80',label:'≥80%'},{value:'DeepARG90',label:'≥90%'}],
    deepargLevel, false, (v)=>{deepargLevel=v; refreshRefChips(); refreshCompChips(); draw();});

  makeSelect(document.getElementById(`${P}rgi-identity`),
    [{value:'RGI-DIAMOND',label:'No threshold'},{value:'RGI-DIAMOND70',label:'≥70%'},
     {value:'RGI-DIAMOND80',label:'≥80%'},{value:'RGI-DIAMOND90',label:'≥90%'}],
    rgiLevel, false, (v)=>{rgiLevel=v; refreshRefChips(); refreshCompChips(); draw();});

  refreshRefChips();
  refreshCompChips();

  if(habitat){
    makeSelect(document.getElementById(`${P}habitat-select`),
      getHabitats().map(h=>({value:h,label:h})), habitat, false,
      (v)=>{habitat=v; setChosenHabitat(v); updateHabitatInfoNote(v); draw();});
  }

  makeCheckList(document.getElementById(`${P}class-select`),
    DATA.gene_class_order.all.map(c=>({value:c,label:c})), selectedClasses,
    (vals)=>{selectedClasses=vals; draw();}, {min:1});

  draw();

  renderFAQ(el, habitat ? [] : [
    {title: "Confusing lowering thresholds for comprehensiveness",
     text: "<ul><li>Despite the large number of efflux pump and van genes, and the low identity level for those classes (and others), RGI and DeepARG did not extrapolate to report the genes that other pipelines reported.</li></ul>"},
    {title: "The long voyage starts in your known-walked neighborhood",
     text: "<ul><li>fARGene was the most comprehensive pipeline for the gene classes included in this tool. fARGene reports most genes that other pipelines report, albeit efflux pump are limited to tetracycline efflux pumps.</li></ul>"},
    {title: "The apples that fall near and far from the tree",
     text: "<ul><li>MEGARes reports the genes that ABRicate with the CARD, ResFinder, ARGANNOT, and NCBI datasets do, as it is a compilation of them.</li><li>DeepARG, despite having CARD as a reference under the construction of DeepARG-DB, does not manage to capture the genes that RGI nor ABRicate-CARD do.</li></ul>"}
  ]);
}

// ---------------------------------------------------------------------------
// ABUNDANCE & RICHNESS TAB
// ---------------------------------------------------------------------------
function renderAbundance(el, habitat, navKey){
  const basicTools = DATA.tool_meta.basic_tools;
  el.innerHTML = `
    <button class="flow-back" id="ab-back-btn">← Back to Gene Classes</button>
    <h2>Abundance &amp; Richness</h2>
    <p class="sub">Distributions of ARG abundance and richness across all samples in a habitat.</p>

    <div class="controls">
      <div class="control">
        <label>Habitat</label>
        <div id="ab-habitat-select"></div>
      </div>
      <div class="control" style="flex:1;min-width:320px;">
        <label>Pipelines</label>
        <div id="ab-pipeline-chips"></div>
      </div>
      <div class="control">
        <label>DeepARG identity threshold</label>
        <div id="ab-deeparg-identity"></div>
      </div>
      <div class="control">
        <label>RGI identity threshold</label>
        <div id="ab-rgi-identity"></div>
      </div>
    </div>

    <div class="grid3">
      <div class="card" id="ab-card-abundance">
        <h3>Relative abundance per sample</h3>
        <div id="ab-abundance-box" class="plotwrap"></div>
      </div>

      <div class="card" id="ab-card-richness">
        <h3>Richness per sample</h3>
        <div id="ab-richness-box" class="plotwrap"></div>
      </div>
    </div>

    <div class="card" id="ab-card-classfacet">
      <h3>Relative abundance per gene class</h3>
      <div class="controls" style="margin-bottom:10px;">
        <div class="control">
          <label>DeepARG identity threshold</label>
          <div id="ab-class-deeparg-identity"></div>
        </div>
        <div class="control">
          <label>RGI identity threshold</label>
          <div id="ab-class-rgi-identity"></div>
        </div>
        <div class="control" style="min-width:260px;">
          <label>Gene classes (max 15)</label>
          <div id="ab-gene-select"></div>
        </div>
      </div>
      <div id="ab-class-facet" class="plotwrap"></div>
    </div>

    <div class="wizard-actions" style="justify-content:space-between;">
      <button class="btn-secondary" id="ab-back-btn-2">← Back</button>
      <button class="btn-primary" id="ab-continue-btn">Continue to Class-specific Coverage →</button>
    </div>
  `;

  document.getElementById('ab-back-btn').addEventListener('click', ()=>navigateTo(prevKey(navKey)));
  document.getElementById('ab-back-btn-2').addEventListener('click', ()=>navigateTo(prevKey(navKey)));
  document.getElementById('ab-continue-btn').addEventListener('click', ()=>navigateTo(nextKey(navKey)));

  let selectedTools = [...basicTools];
  let deepargLevel = 'DeepARG';
  let rgiLevel = 'RGI-DIAMOND';
  let selectedGenes = [...DATA.gene_class_order.default_20];

  function barToolSet(){
    return selectedTools.map(t=>{
      if(t==='DeepARG') return deepargLevel;
      if(t==='RGI-DIAMOND') return rgiLevel;
      return t;
    });
  }

  function boxTrace(summaryRows, jitterRows, valueKey){
    const tools = barToolSet();
    const boxTraces = tools.map(t=>{
      const r = summaryRows.find(d=>d.tool===t);
      const meta = DATA.tool_meta.tools.find(m=>m.tool===t);
      const color = DB_COLOR[meta?meta.tools_db:''] || '#1d3557';
      return {
        type:'box', name: TOOL_LABEL[t]||t, showlegend:false,
        x:[TOOL_LABEL[t]||t],
        q1:[r?r.q25:null], median:[r?r.median:null], q3:[r?r.q75:null],
        lowerfence:[r?r.w1:null], upperfence:[r?r.w2:null],
        marker:{color}, line:{color}, boxpoints:false, hoveron:'boxes',
        hovertemplate: 'Median: %{median:,.1f}<br>Q1: %{q1:,.1f} · Q3: %{q3:,.1f}<extra></extra>'
      };
    });
    return [
      ...boxTraces,
      {
        type:'scatter', mode:'markers', name:'samples', showlegend:false,
        x: jitterRows.filter(d=>tools.includes(d.tool)).map(d=>TOOL_LABEL[d.tool]||d.tool),
        y: jitterRows.filter(d=>tools.includes(d.tool)).map(d=>d[valueKey]),
        marker:{color:'#0f1614', size:4, opacity:0.35},
        hovertemplate:'%{x}: %{y:,.1f}<extra></extra>'
      }
    ];
  }

  function zoomRange(summary, tools){
    const w2s = tools.map(t=>{
      const r = summary.find(d=>d.tool===t);
      return r ? r.w2 : null;
    }).filter(v=>v!=null && v>0);
    return w2s.length ? [0, Math.max(...w2s)*1.05] : undefined;
  }

  function drawAbundance(){
    const summary = DATA.abundance_summary.filter(d=>d.habitat===habitat);
    const jitter = DATA.abundance_jitter_sample.filter(d=>d.habitat===habitat);
    plot('ab-abundance-box', boxTrace(summary, jitter, 'abundance'),
      {...PLOTLY_LAYOUT_BASE, height:420, showlegend:false,
       meta:{tsv:{x:'Tool'}},
       yaxis:{title:'Relative abundance (reads/million)', gridcolor:'#dde2de', rangemode:'nonnegative',
              range: zoomRange(summary, barToolSet())},
       xaxis:{tickangle:-45}}, PLOTLY_CONFIG);
  }
  function drawRichness(){
    const summary = DATA.richness_summary.filter(d=>d.habitat===habitat);
    const jitter = DATA.abundance_jitter_sample.filter(d=>d.habitat===habitat);
    plot('ab-richness-box', boxTrace(summary, jitter, 'richness'),
      {...PLOTLY_LAYOUT_BASE, height:420, showlegend:false,
       meta:{tsv:{x:'Tool'}},
       yaxis:{title:'Richness', gridcolor:'#dde2de', rangemode:'nonnegative',
              range: zoomRange(summary, barToolSet())},
       xaxis:{tickangle:-45}}, PLOTLY_CONFIG);
  }
  function drawClassAbundance(){
    const tools = barToolSet();
    const toolLabels = tools.map(t=>TOOL_LABEL[t]||t);
    const n = selectedGenes.length;
    const gap = 0.035;
    const width = (1 - gap*(n-1)) / n;

    const traces = [];
    const dividers = [];
    const layout = {...PLOTLY_LAYOUT_BASE,
      meta:{tsv:{x:'Relative abundance', y:'Tool', series:'Tool'}},
      height: Math.max(320, tools.length*40),
      margin:{t:40,l:20,r:20,b:60},
      showlegend:false,
      yaxis:{automargin:true, autorange:'reversed', categoryorder:'array', categoryarray:toolLabels, tickfont:{size:9.5}, tickangle:-45},
      annotations:[]
    };

    selectedGenes.forEach((gene,i)=>{
      const xkey = i===0 ? 'x' : `x${i+1}`;
      const axisKey = i===0 ? 'xaxis' : `xaxis${i+1}`;
      const d0 = i*(width+gap), d1 = d0+width;

      if(i>0){
        dividers.push({
          type:'line', xref:'paper', yref:'paper',
          x0: d0-gap/2, x1: d0-gap/2, y0:0, y1:1,
          line:{color:'#dde2de', width:1}
        });
      }

      const rows = DATA.abundance_class_summary.filter(d=>d.habitat===habitat && d.gene===gene && tools.includes(d.tool));
      tools.forEach(t=>{
        const r = rows.find(d=>d.tool===t);
        const meta = DATA.tool_meta.tools.find(m=>m.tool===t);
        const color = DB_COLOR[meta?meta.tools_db:''] || '#1d3557';
        traces.push({
          type:'box', orientation:'h', xaxis:xkey, yaxis:'y', name: TOOL_LABEL[t]||t,
          y:[TOOL_LABEL[t]||t],
          q1:[r?r.q25:null], median:[r?r.q50:null], q3:[r?r.q75:null],
          lowerfence:[r?r.w1:null], upperfence:[r?r.w2:null],
          marker:{color}, line:{color}, hoveron:'boxes',
          hovertemplate: 'Median: %{median:,.2f}<br>Q1: %{q1:,.2f} · Q3: %{q3:,.2f}<extra></extra>'
        });
      });

      layout[axisKey] = {domain:[d0,d1], anchor:'y', gridcolor:'#dde2de', rangemode:'nonnegative'};
      layout.annotations.push({
        xref:'paper', yref:'paper', x:(d0+d1)/2, y:1.04,
        xanchor:'center', yanchor:'bottom',
        text: cleanLevel(gene), showarrow:false,
        font:{size:11, color:'#1a2b28'}
      });
    });

    layout.shapes = dividers;
    plot('ab-class-facet', traces, layout, PLOTLY_CONFIG);
  }
  function drawAll(){ drawAbundance(); drawRichness(); drawClassAbundance(); }

  chipToggle(document.getElementById('ab-pipeline-chips'),
    basicTools.map(t=>({value:t,label:TOOL_LABEL[t]||t})), selectedTools,
    (vals)=>{selectedTools=vals; drawAll();});

  const deepargOptions = [{value:'DeepARG',label:'No threshold'},{value:'DeepARG70',label:'≥70%'},
     {value:'DeepARG80',label:'≥80%'},{value:'DeepARG90',label:'≥90%'}];
  const rgiOptions = [{value:'RGI-DIAMOND',label:'No threshold'},{value:'RGI-DIAMOND70',label:'≥70%'},
     {value:'RGI-DIAMOND80',label:'≥80%'},{value:'RGI-DIAMOND90',label:'≥90%'}];

  function onDeepargChange(v){
    deepargLevel=v;
    [deepargSelect, classDeepargSelect].forEach(s=>{ if(s) s.value=v; });
    drawAll();
  }
  function onRgiChange(v){
    rgiLevel=v;
    [rgiSelect, classRgiSelect].forEach(s=>{ if(s) s.value=v; });
    drawAll();
  }

  const deepargSelect = makeSelect(document.getElementById('ab-deeparg-identity'),
    deepargOptions, deepargLevel, false, onDeepargChange);
  const rgiSelect = makeSelect(document.getElementById('ab-rgi-identity'),
    rgiOptions, rgiLevel, false, onRgiChange);
  const classDeepargSelect = makeSelect(document.getElementById('ab-class-deeparg-identity'),
    deepargOptions, deepargLevel, false, onDeepargChange);
  const classRgiSelect = makeSelect(document.getElementById('ab-class-rgi-identity'),
    rgiOptions, rgiLevel, false, onRgiChange);

  makeSelect(document.getElementById('ab-habitat-select'),
    getHabitats().map(h=>({value:h,label:h})), habitat, false,
    (v)=>{habitat=v; setChosenHabitat(v); updateHabitatInfoNote(v); drawAll();});
  makeCheckList(document.getElementById('ab-gene-select'),
    DATA.gene_class_order.all.map(c=>({value:c,label:c})), selectedGenes,
    (vals)=>{selectedGenes=vals.slice(0,15); drawClassAbundance();}, {min:1, max:15});

  drawAll();
}

// ---------------------------------------------------------------------------
// PAN-/CORE-RESISTOME TAB
//
// Randomly draws n samples from a habitat, N times; a gene belongs to a
// subsample's "pan" if present (rarefied count > 0) in >=1 of its n samples,
// and to its "core" if present in >=p of them. Pan-resistome = gene count
// (N=1: the actual list; N>1: the mean count across iterations, no single
// list). Core-resistome = genes that hit the p-cut in >=P of the N
// iterations (P=1 when N=1) -- always a concrete, downloadable gene list.
//
// Presence data is fetched on demand (data/core_pan/<habitat>.json), not
// eagerly loaded at startup -- the largest habitat/tool combinations run
// into the tens of MB.
// ---------------------------------------------------------------------------
const CORE_PAN_MANIFEST_CACHE = {}; // habitat -> {samples, tool_gene_counts}
const CORE_PAN_TOOL_CACHE = {};     // "habitat|tool" -> {genes, presence}
const CORE_PAN_TRANSPOSED = {};     // "habitat|tool" -> Int32Array[] (sampleIdx -> gene indices)

function habitatSlug(h){ return h.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); }

// Small per-habitat manifest (sample list + gene counts per tool), plain JSON.
async function fetchCorePanManifest(habitat){
  if(CORE_PAN_MANIFEST_CACHE[habitat]) return CORE_PAN_MANIFEST_CACHE[habitat];
  const res = await fetch(`data/core_pan/${habitatSlug(habitat)}.json`);
  if(!res.ok) throw new Error(`Failed to load manifest for ${habitat}: ${res.status}`);
  const json = await res.json();
  CORE_PAN_MANIFEST_CACHE[habitat] = json;
  return json;
}

// Per (habitat, tool) presence data, gzip-compressed -- fetched only when
// that exact combination is actually run.
async function fetchCorePanToolData(habitat, tool){
  const key = habitat+'|'+tool;
  if(CORE_PAN_TOOL_CACHE[key]) return CORE_PAN_TOOL_CACHE[key];
  const res = await fetch(`data/core_pan/${habitatSlug(habitat)}__${tool}.json.gz`);
  if(!res.ok) throw new Error(`Failed to load presence data for ${TOOL_LABEL[tool]||tool} in ${habitat}: ${res.status}`);
  const ds = new DecompressionStream('gzip');
  const decompressed = res.body.pipeThrough(ds);
  const text = await new Response(decompressed).text();
  const json = JSON.parse(text);
  CORE_PAN_TOOL_CACHE[key] = json;
  return json;
}

function getTransposed(habitat, tool, numSamples, toolData){
  const key = habitat+'|'+tool;
  if(CORE_PAN_TRANSPOSED[key]) return CORE_PAN_TRANSPOSED[key];
  const presence = toolData.presence || [];
  const sampleToGenes = Array.from({length: numSamples}, ()=>[]);
  presence.forEach((sampleIdxs, geneIdx)=>{
    sampleIdxs.forEach(si=>sampleToGenes[si].push(geneIdx));
  });
  const packed = sampleToGenes.map(arr=>Int32Array.from(arr));
  CORE_PAN_TRANSPOSED[key] = packed;
  return packed;
}

function sampleIndicesWithoutReplacement(n, total){
  const arr = new Int32Array(total);
  for(let i=0;i<total;i++) arr[i]=i;
  const take = Math.min(n, total);
  for(let i=0;i<take;i++){
    const j = i + Math.floor(Math.random()*(total-i));
    const tmp = arr[i]; arr[i]=arr[j]; arr[j]=tmp;
  }
  return arr.subarray(0, take);
}

// Runs N subsample iterations in small chunks (via setTimeout) so the main
// thread yields and the status text / timer stay live instead of freezing.
function runCorePanAsync({sampleToGenes, numGenes, numSamples, n, p, N, P}, onProgress, onDone){
  const nEff = Math.min(n, numSamples);
  const cnt = new Uint16Array(numGenes);
  const counts = new Uint16Array(numGenes);
  const threshold = p * nEff;
  let panSum = 0;
  let iter = 0;
  const t0 = performance.now();
  const CHUNK = 5;

  function step(){
    const end = Math.min(iter+CHUNK, N);
    for(; iter<end; iter++){
      counts.fill(0);
      const chosen = sampleIndicesWithoutReplacement(nEff, numSamples);
      for(let ci=0; ci<chosen.length; ci++){
        const genes = sampleToGenes[chosen[ci]];
        for(let k=0;k<genes.length;k++) counts[genes[k]]++;
      }
      let panThisIter = 0;
      for(let g=0; g<numGenes; g++){
        if(counts[g] > 0) panThisIter++;
        if(counts[g] >= threshold) cnt[g]++;
      }
      panSum += panThisIter;
    }
    onProgress(iter, N, performance.now()-t0);
    if(iter < N){
      setTimeout(step, 0);
    } else {
      const requiredP = N===1 ? 1 : Math.min(P, N);
      const coreGeneIndices = [];
      for(let g=0; g<numGenes; g++) if(cnt[g] >= requiredP) coreGeneIndices.push(g);
      onDone({
        panMean: panSum/N,
        coreGeneIndices,
        elapsedMs: performance.now()-t0
      });
    }
  }
  step();
}

function renderPanCore(el, habitat, navKey){
  const N_OPTIONS = [1, 250, 500];
  const P_OPTIONS = [30,40,50,60,70,80,90];
  const n_OPTIONS = [50,100,200,500];

  el.innerHTML = `
    <button class="flow-back" id="pc-back-btn">← Back to Class-specific Coverage</button>
    <h2>Pan- and Core-resistome</h2>
    <div style="display:grid;grid-template-columns:1fr 320px;gap:20px;align-items:stretch;margin-bottom:20px;">
      <p class="sub" style="margin-bottom:0;">Randomly draws n samples from the chosen habitat, N times.
        <strong>Pan-resistome</strong>: the average across the N subsample processes of the unique number
        of ARGs in the n samples. To be counted in the <strong>core-resistome</strong>, a gene has to be in
        at least p of the n samples, consistently enough (in at least P of the N subsample processes).</p>
      <div class="card" style="margin-bottom:0;">
        <h3 style="font-size:13px;">Samples per habitat</h3>
        <div id="pc-habitat-samples-chart" class="plotwrap"></div>
      </div>
    </div>

    <div class="controls">
      <div class="control">
        <label>Habitat</label>
        <div id="pc-habitat-select"></div>
      </div>
      <div class="control" style="flex:1;min-width:260px;">
        <label>Pipelines</label>
        <div id="pc-pipeline-chips"></div>
      </div>
      <div class="control">
        <label>DeepARG identity threshold</label>
        <div id="pc-deeparg-identity"></div>
      </div>
      <div class="control">
        <label>RGI identity threshold</label>
        <div id="pc-rgi-identity"></div>
      </div>
      <div class="control">
        <label style="text-transform:none;">n (samples per subsample)</label>
        <div id="pc-n-select"></div>
        <label style="text-transform:none;margin-top:8px;">p (core proportion within a subsample)</label>
        <div id="pc-p-select"></div>
      </div>
      <div class="control">
        <label>N (number of subsamples)</label>
        <div id="pc-bign-select"></div>
        <div id="pc-bigp-control" style="display:none;">
          <label style="margin-top:8px;">P (min subsamples a gene must qualify in)</label>
          <input type="number" id="pc-bigp-input" min="1" value="1" style="width:100%;padding:6px 8px;border:1px solid var(--line);border-radius:4px;background:var(--bg);color:var(--ink);">
        </div>
      </div>
    </div>

    <p id="pc-warning" class="footnote" style="display:none;color:var(--coral);"></p>

    <div class="wizard-actions" style="justify-content:flex-start;gap:14px;">
      <button class="btn-primary" id="pc-run-btn">Run →</button>
    </div>

    <div class="grid2">
      <div class="card">
        <h3>Pan-resistome size</h3>
        <p class="desc" id="pc-pan-desc">Mean number of distinct genes present, averaged across the N subsamples.</p>
        <div id="pc-pan-chart" class="plotwrap"></div>
      </div>
      <div class="card">
        <h3>Core-resistome size</h3>
        <p class="desc" id="pc-core-desc">Number of genes consistently detected across the subsampled habitat samples.</p>
        <div id="pc-core-chart" class="plotwrap"></div>
      </div>
    </div>

    <div class="wizard-actions">
      <button class="btn-secondary" id="pc-back-btn-2">← Back</button>
    </div>
  `;
  document.getElementById('pc-back-btn').addEventListener('click', ()=>navigateTo(prevKey(navKey)));
  document.getElementById('pc-back-btn-2').addEventListener('click', ()=>navigateTo(prevKey(navKey)));

  const basicTools = DATA.tool_meta.basic_tools;
  let selectedPipelines = [...basicTools];
  let deepargLevel = 'DeepARG';
  let rgiLevel = 'RGI-DIAMOND';
  let n = 100, p = 50, bigN = 1;

  function toolSet(){
    // swap: the chosen identity level replaces the base pipeline
    return selectedPipelines.map(t=>{
      if(t==='DeepARG') return deepargLevel;
      if(t==='RGI-DIAMOND') return rgiLevel;
      return t;
    });
  }

  function drawHabitatSamplesChart(){
    const rows = getHabitats().map(h=>{
      const r = DATA.habitat_n_samples.find(d=>d.habitat===h);
      return {habitat: h, n: r ? r.n_samples : 0};
    }).sort((a,b)=>a.n-b.n);
    plot('pc-habitat-samples-chart', [{
      type:'bar', orientation:'h',
      y: rows.map(r=>r.habitat), x: rows.map(r=>r.n),
      marker:{color: rows.map(r=>r.habitat===habitat ? '#e76f51' : '#8a9a95')},
      hovertemplate:'%{y}: %{x:,} samples<extra></extra>'
    }], {...PLOTLY_LAYOUT_BASE, height:240,
      meta:{tsv:{y:'Habitat', x:'Number of samples'}},
      margin:{t:6,l:20,r:8,b:28},
      font:{...PLOTLY_LAYOUT_BASE.font, size:10},
      xaxis:{title:'', gridcolor:'#dde2de', rangemode:'nonnegative'},
      yaxis:{automargin:true, tickfont:{size:9.5}}}, {...PLOTLY_CONFIG, displayModeBar:false});
  }

  makeSelect(document.getElementById('pc-habitat-select'),
    getHabitats().map(h=>({value:h, label:h})), habitat, false,
    (v)=>{habitat=v; setChosenHabitat(v); updateHabitatInfoNote(v); drawHabitatSamplesChart();});
  drawHabitatSamplesChart();

  chipToggle(document.getElementById('pc-pipeline-chips'),
    basicTools.map(t=>({value:t,label:TOOL_LABEL[t]||t})), selectedPipelines,
    (vals)=>{selectedPipelines=vals;});

  makeSelect(document.getElementById('pc-deeparg-identity'),
    [{value:'DeepARG',label:'No threshold'},{value:'DeepARG70',label:'≥70%'},
     {value:'DeepARG80',label:'≥80%'},{value:'DeepARG90',label:'≥90%'}],
    deepargLevel, false, (v)=>{deepargLevel=v;});

  makeSelect(document.getElementById('pc-rgi-identity'),
    [{value:'RGI-DIAMOND',label:'No threshold'},{value:'RGI-DIAMOND70',label:'≥70%'},
     {value:'RGI-DIAMOND80',label:'≥80%'},{value:'RGI-DIAMOND90',label:'≥90%'}],
    rgiLevel, false, (v)=>{rgiLevel=v;});

  makeSelect(document.getElementById('pc-n-select'),
    n_OPTIONS.map(v=>({value:String(v), label:String(v)})), String(n), false,
    (v)=>{n=+v;});

  makeSelect(document.getElementById('pc-p-select'),
    P_OPTIONS.map(v=>({value:String(v), label:v+'%'})), String(p), false,
    (v)=>{p=+v;});

  const bigPControl = document.getElementById('pc-bigp-control');
  const bigPInput = document.getElementById('pc-bigp-input');
  const warningEl = document.getElementById('pc-warning');
  makeSelect(document.getElementById('pc-bign-select'),
    N_OPTIONS.map(v=>({value:String(v), label:String(v)})), String(bigN), false,
    (v)=>{
      bigN=+v;
      bigPControl.style.display = bigN>1 ? 'flex' : 'none';
      if(bigN>1){
        bigPInput.max = bigN;
        bigPInput.value = Math.min(+bigPInput.value || Math.ceil(bigN/2), bigN);
      }
      if(bigN>1){
        warningEl.style.display = 'block';
        warningEl.textContent = `N=${bigN} runs ${bigN} subsample iterations per pipeline in your browser -- `+
          (bigN>=500 ? 'this can take up to several seconds to tens of seconds per pipeline for large habitats (e.g. human gut).'
                     : 'this can take a few seconds per pipeline for large habitats.');
      } else {
        warningEl.style.display = 'none';
      }
    });

  function drawBars(elId, rows){
    plot(elId, [{
      type:'bar', orientation:'h',
      y: rows.map(r=>TOOL_LABEL[r.tool]||r.tool), x: rows.map(r=>r.count),
      marker:{color: rows.map(r=>DB_COLOR[TOOL_DB[r.tool]]||'#1d3557'), line:{color:'#ffffff', width:1}},
      hovertemplate:'%{y}: %{x:,}<extra></extra>'
    }], {...PLOTLY_LAYOUT_BASE, height: Math.max(160, rows.length*36),
      meta:{tsv:{y:'Tool'}},
      margin:{t:8,l:20,r:8,b:40},
      xaxis:{title:'Number of genes', gridcolor:'#dde2de', rangemode:'nonnegative'},
      yaxis:{automargin:true, autorange:'reversed'}}, PLOTLY_CONFIG);
  }

  document.getElementById('pc-run-btn').addEventListener('click', async ()=>{
    const btn = document.getElementById('pc-run-btn');
    const originalLabel = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Calculating…';

    const tools = toolSet();
    if(tools.length===0){
      btn.disabled = false;
      btn.innerHTML = originalLabel;
      return;
    }

    try{
      const manifest = await fetchCorePanManifest(habitat);
      const numSamples = manifest.samples.length;
      const pFrac = p/100;
      const results = [];

      for(let ti=0; ti<tools.length; ti++){
        const tool = tools[ti];
        const geneCount = manifest.tool_gene_counts[tool] || 0;
        if(geneCount === 0){
          results.push({tool, panCount: 0, coreCount: 0});
          continue;
        }

        const toolData = await fetchCorePanToolData(habitat, tool);
        const geneList = toolData.genes;
        const sampleToGenes = getTransposed(habitat, tool, numSamples, toolData);

        const result = await new Promise((resolve)=>{
          runCorePanAsync(
            {sampleToGenes, numGenes: geneList.length, numSamples, n, p: pFrac, N: bigN, P: bigPInput.value ? +bigPInput.value : 1},
            ()=>{},
            resolve
          );
        });

        results.push({tool, panCount: Math.round(result.panMean), coreCount: result.coreGeneIndices.length});
      }

      const nEff = Math.min(n, numSamples);

      drawBars('pc-pan-chart', results.map(r=>({tool:r.tool, count:r.panCount})));
      drawBars('pc-core-chart', results.map(r=>({tool:r.tool, count:r.coreCount})));

      document.getElementById('pc-pan-desc').textContent =
        `Mean number of distinct genes present, averaged across ${bigN} subsample${bigN>1?'s':''} of ${nEff} samples each.`;
      document.getElementById('pc-core-desc').textContent = bigN===1
        ? `Genes present in ≥${p}% of the ${nEff} subsampled samples.`
        : `Genes present in ≥${p}% of a subsample's ${nEff} samples, in at least ${bigPInput.value}/${bigN} subsamples.`;

      btn.disabled = false;
      btn.innerHTML = originalLabel;
    } catch(err){
      btn.disabled = false;
      btn.innerHTML = originalLabel;
    }
  });
}

// ---------------------------------------------------------------------------
// CLASS-SPECIFIC OVERLAP (CSC) TAB
// ---------------------------------------------------------------------------
function renderOverlap(el){
  const basicTools = DATA.tool_meta.basic_tools;
  const topClasses = ["van","efflux pump","tet RPG","class A beta-lactamase","class B beta-lactamase",
                       "class C beta-lactamase","class D beta-lactamase","aph","erm","aac"]
                       .filter(c=>DATA.gene_class_order.all.includes(c));

  el.innerHTML = `
    <h2>Class-specific Coverage (CSC)</h2>
    <p class="sub">For a given ARG class, the CSC of reference pipeline A vs. pipeline B is the proportion of ARGs reported by B that A also reports. We call it "coverage" rather than recall, since no pipeline is a ground truth.</p>

    <div class="controls">
      <div class="control" style="flex:1;min-width:260px;">
        <label>Reference pipelines (rows)</label>
        <div id="ov-ref-chips"></div>
      </div>
      <div class="control" style="min-width:220px;">
        <label>Gene classes (max 15)</label>
        <div id="ov-class-select"></div>
      </div>
    </div>

    <div class="grid2">
      <div class="card">
        <h3>Mean CSC by class × reference pipeline</h3>
        <p class="desc">Click a cell to see the breakdown against each comparison pipeline.</p>
        <div id="ov-heatmap" class="plotwrap"></div>
      </div>
      <div class="card">
        <h3 id="ov-detail-title">Breakdown</h3>
        <p class="desc">Select a cell in the heatmap.</p>
        <div id="ov-detail" class="plotwrap"></div>
      </div>
    </div>
  `;

  let selectedRef = basicTools.slice(0,5);
  let selectedClasses = topClasses.length ? topClasses : DATA.gene_class_order.all.slice(0,10);

  function drawHeatmap(){
    const refs = selectedRef, classes = selectedClasses;
    const z = classes.map(cl => refs.map(ref=>{
      const rows = DATA.csc.filter(d=>d.tool_ref===ref && d.new_level===cl);
      if(rows.length===0) return null;
      return rows.reduce((a,d)=>a+d.csc,0)/rows.length;
    }));
    const plotEl = document.getElementById('ov-heatmap');
    plot(plotEl, [{
      type:'heatmap', z, x: refs.map(t=>TOOL_LABEL[t]||t), y: classes.map(cleanLevel),
      colorscale:[[0,'#eef0ee'],[1,'#1d3557']], zmin:0, zmax:1,
      hovertemplate:'%{y} — %{x}: %{z:.0%}<extra></extra>',
      colorbar:{tickformat:'.0%', thickness:14}
    }], {...PLOTLY_LAYOUT_BASE, height: Math.max(360, classes.length*30), meta:{tsv:{x:'Tool', y:'Gene class', z:'CSC'}}, xaxis:{tickangle:-45}, yaxis:{automargin:true}}, PLOTLY_CONFIG);

    if(plotEl.removeAllListeners) plotEl.removeAllListeners('plotly_click');
    plotEl.on('plotly_click', function(evt){
      const pt = evt.points[0];
      const ref = refs[refs.map(t=>TOOL_LABEL[t]||t).indexOf(pt.x)];
      const cls = classes[classes.map(cleanLevel).indexOf(pt.y)];
      drawDetail(ref, cls);
    });
  }

  function drawDetail(ref, cls){
    document.getElementById('ov-detail-title').textContent = `${TOOL_LABEL[ref]||ref} — ${cleanLevel(cls)}`;
    const rows = DATA.csc.filter(d=>d.tool_ref===ref && d.new_level===cls).sort((a,b)=>b.csc-a.csc);
    plotNew('ov-detail', [{
      type:'bar', orientation:'h',
      y: rows.map(d=>TOOL_LABEL[d.tool_comp]||d.tool_comp),
      x: rows.map(d=>d.csc),
      marker:{color:'#2a9d8f'},
      hovertemplate:'vs %{y}: %{x:.0%}<extra></extra>'
    }], {...PLOTLY_LAYOUT_BASE, height: Math.max(260, rows.length*24),
      meta:{tsv:{y:'Tool'}},
      xaxis:{title:'CSC', tickformat:'.0%', range:[0,1], gridcolor:'#dde2de', rangemode:'nonnegative'}, yaxis:{automargin:true}}, PLOTLY_CONFIG);
  }

  chipToggle(document.getElementById('ov-ref-chips'),
    basicTools.map(t=>({value:t,label:TOOL_LABEL[t]||t})), selectedRef,
    (vals)=>{selectedRef=vals; drawHeatmap();});
  makeSelect(document.getElementById('ov-class-select'),
    DATA.gene_class_order.all.map(c=>({value:c,label:c})), selectedClasses, true,
    (vals)=>{selectedClasses=vals.slice(0,15); drawHeatmap();}, 8);

  drawHeatmap();
  document.getElementById('ov-detail').innerHTML = '<p class="footnote">Click a cell in the heatmap to see per-pipeline coverage.</p>';
}

// ---------------------------------------------------------------------------
// SUPPLEMENTARY TABLES TAB
// ---------------------------------------------------------------------------
function renderTables(el){
  el.innerHTML = `
    <h2>Supplementary Tables</h2>
    <p class="sub">Raw reference tables behind the charts above.</p>

    <div class="card">
      <h3>Metagenomic samples per habitat</h3>
      <div class="table-toolbar">
        <input type="text" id="ts-search" placeholder="Search sample or habitat…">
      </div>
      <div id="ts-table"></div>
      <div class="pager" id="ts-pager"></div>
    </div>

    <div class="card">
      <h3>ARGs identified per pipeline (full list)</h3>
      <p class="desc">239,762 rows across the 10 core pipelines — too large to browse comfortably in-page, so it's provided as a direct download instead.</p>
      <a href="data/table_s3_full.csv.gz" download>Download table_s3_full.csv.gz (~1.5&nbsp;MB)</a>
    </div>
  `;

  const rows = DATA.table_s1_samples;
  let filtered = rows;
  let page = 0;
  const pageSize = 20;

  function draw(){
    const start = page*pageSize;
    const pageRows = filtered.slice(start, start+pageSize);
    const table = document.createElement('table');
    table.className = 'datatable';
    table.innerHTML = `<thead><tr><th>Sample</th><th>Habitat</th></tr></thead>
      <tbody>${pageRows.map(r=>`<tr><td>${r.Sample}</td><td>${r.Habitat}</td></tr>`).join('')}</tbody>`;
    const container = document.getElementById('ts-table');
    container.innerHTML=''; container.appendChild(table);

    const totalPages = Math.max(1, Math.ceil(filtered.length/pageSize));
    document.getElementById('ts-pager').innerHTML = `
      <button id="ts-prev" ${page===0?'disabled':''}>← Prev</button>
      <span>Page ${page+1} of ${totalPages} (${filtered.length.toLocaleString()} rows)</span>
      <button id="ts-next" ${page>=totalPages-1?'disabled':''}>Next →</button>`;
    document.getElementById('ts-prev')?.addEventListener('click', ()=>{page--; draw();});
    document.getElementById('ts-next')?.addEventListener('click', ()=>{page++; draw();});
  }

  document.getElementById('ts-search').addEventListener('input', function(){
    const q = this.value.toLowerCase();
    filtered = rows.filter(r=>r.Sample.toLowerCase().includes(q) || r.Habitat.toLowerCase().includes(q));
    page = 0; draw();
  });

  draw();
}

// ---------------------------------------------------------------------------
// ABOUT & CONTACTS
// ---------------------------------------------------------------------------
function renderAboutSection(el){
  el.innerHTML = `
    <h2>About &amp; Contacts</h2>
    <p class="sub">What this explorer is, where the data and code live, and who to reach.</p>

    <div class="card">
      <h3>About this explorer</h3>
      <p class="desc">The <strong>ARG Pipeline Explorer</strong> is an interactive companion to the study
        <em><a href="https://www.biorxiv.org/content/10.64898/2026.05.11.724158v1" target="_blank" rel="noopener">"The elusive resistome: a global comparison reveals large discrepancies among detection pipelines"</a></em>
        (Inda-Díaz et al., bioRxiv 2026). It lets you interactively compare ten antibiotic-resistance-gene (ARG)
        detection pipelines &mdash; DeepARG, RGI, ResFinder, five ABRicate databases, AMRFinderPlus and fARGene &mdash;
        run on the same 278.8M unigenes of the
        <a href="https://gmgc.embl.de/" target="_blank" rel="noopener">Global Microbial Gene Catalog (GMGC v1.0)</a>,
        across 13 habitats and 11,519 metagenomic samples. All charts are computed client-side from the published data.</p>
    </div>

    <div class="card">
      <h3>Publication</h3>
      <p class="desc">Inda-Díaz <em>et al.</em> (2026). <em>The elusive resistome: a global comparison reveals
        large discrepancies among detection pipelines.</em> bioRxiv.</p>
      <ul class="plain">
        <li>Preprint: <a href="https://www.biorxiv.org/content/10.64898/2026.05.11.724158v1" target="_blank" rel="noopener">biorxiv.org/content/10.64898/2026.05.11.724158v1</a></li>
      </ul>
      <p class="footnote">The full author list and corresponding-author details are given in the preprint.</p>
    </div>

    <div class="card">
      <h3>Data &amp; code availability</h3>
      <ul class="plain">
        <li><strong>Data:</strong> <a href="https://doi.org/10.5281/zenodo.19702877" target="_blank" rel="noopener">Zenodo record 19702877</a> (https://doi.org/10.5281/zenodo.19702877)</li>
        <li><strong>This explorer &amp; data pipeline:</strong> <a href="https://github.com/indajuan/Elusive-Resistome-Interactome" target="_blank" rel="noopener">github.com/indajuan/Elusive-Resistome-Interactome</a></li>
        <li><strong>ARG-tool clustering:</strong> <a href="https://github.com/BigDataBiology/IndaDiaz2026__ARGTools" target="_blank" rel="noopener">github.com/BigDataBiology/IndaDiaz2026__ARGTools</a></li>
      </ul>
    </div>

    <div class="card">
      <h3>Contacts</h3>
      <ul class="plain">
        <li><strong>Juan Inda Diaz</strong>: <a href="mailto:juan.inda@qut.edu.au">juan.inda@qut.edu.au</a></li>
        <li><strong>Luis Pedro Coelho</strong>: <a href="mailto:luis@luispedro.org">luis@luispedro.org</a></li>
      </ul>
    </div>
  `;
}
