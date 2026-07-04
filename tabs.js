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
const PLOTLY_CONFIG = {displaylogo:false, responsive:true, modeBarButtonsToRemove:['lasso2d','select2d']};

function cleanLevel(s){
  if(!s) return s;
  return s.replace(' beta-lactamase','').replace('rifampin inactivation enzyme','RIF-inact. enz.')
          .replace('MFS efflux pump','MFS efflux').replace('efflux pump','efflux')
          .replace('beta-lactam modulation resistance','beta-lactam mod.')
          .replace('target-modifying enzyme','target-modif. enzyme');
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
// GUIDED FLOW: intro -> choice -> analysis (continuous scroll, not separate screens)
// ---------------------------------------------------------------------------
function renderIntroSection(el){
  el.innerHTML = `
    <h2>Antibiotic Resistance Gene Detection<br>on the Global Microbial Gene Catalog</h2>
    <p class="sub">Ten ARG-detection pipelines, run on the same underlying gene catalogue, disagree far more than you'd expect. This explorer lets you interact with the dataset behind
      <em>"The elusive resistome: a global comparison reveals large discrepancies among detection pipelines"</em> (Inda-Díaz et al., bioRxiv 2026).</p>

    <div class="stat-row">
      <div class="stat"><div class="n">278.8M</div><div class="l">unigenes screened (GMGC v1.0)</div></div>
      <div class="stat"><div class="n teal">11,519</div><div class="l">metagenomic samples used for abundance &amp; richness</div></div>
      <div class="stat"><div class="n amber">13</div><div class="l">distinct habitats represented</div></div>
      <div class="stat"><div class="n">178,107</div><div class="l">unigenes flagged as ARG by ≥1 pipeline</div></div>
    </div>

    <div class="card">
      <h3>Detection pipelines</h3>
      <p class="desc">Six core tools, each with its own reference database and calling logic.</p>
      <ul class="plain">
        <li>fARGene v0.1</li>
        <li>DeepARG v2</li>
        <li>AMRFinderPlus v4.0.15</li>
        <li>RGI v6.0.3 (CARD v4.0.0)</li>
        <li>ResFinder v2.4.0</li>
        <li>ABRicate v1.0.1 (run against ARGANNOT, MEGARes, CARD, NCBI, ResFinder)</li>
      </ul>
    </div>

    <p class="footnote">Data: <a href="https://www.biorxiv.org/content/10.64898/2026.05.11.724158v1" target="_blank">bioRxiv preprint</a> ·
    <a href="https://zenodo.org/records/19702877" target="_blank">Zenodo data records</a>. Independent, unofficial rebuild of the companion Shiny app — not affiliated with the authors.</p>

    <div class="wizard-actions">
      <button class="btn-primary" id="intro-continue-btn">Continue to analysis →</button>
    </div>
  `;
  document.getElementById('intro-continue-btn').addEventListener('click', ()=>{
    const choiceEl = getOrCreateSection('sec-choice');
    renderChoiceSection(choiceEl);
    scrollToSection('sec-choice');
  });
}

function renderChoiceSection(el){
  const habitats = getHabitats();
  let mode = ANALYSIS_MODE || 'general';
  let habitat = CHOSEN_HABITAT || (habitats.includes('human gut') ? 'human gut' : habitats[0]);

  el.innerHTML = `
    <button class="flow-back" id="choice-back-btn">← Back to introduction</button>
    <h2>What kind of analysis?</h2>
    <p class="sub">Choose how you want to start. You can always dig into a specific habitat later from any section.</p>

    <div class="choice-cards">
      <div class="choice-card" id="choice-general">
        <h3>General analysis</h3>
        <p>Compare pipelines across the whole dataset — ARG counts, agreement between pipelines, and how identity thresholds affect what gets called.</p>
      </div>
      <div class="choice-card" id="choice-habitat">
        <h3>Explore a habitat</h3>
        <p>Start from one habitat (e.g. human gut, soil, wastewater) and see abundance, richness, and resistome size specific to it.</p>
        <div class="habitat-picker" id="habitat-picker" style="display:none;"></div>
      </div>
    </div>

    <div class="wizard-actions">
      <button class="btn-primary" id="choice-start-btn">Start analysis →</button>
    </div>
  `;

  const generalCard = document.getElementById('choice-general');
  const habitatCard = document.getElementById('choice-habitat');
  const picker = document.getElementById('habitat-picker');

  function selectMode(m){
    mode = m;
    generalCard.classList.toggle('selected', m==='general');
    habitatCard.classList.toggle('selected', m==='habitat');
    picker.style.display = m==='habitat' ? 'block' : 'none';
  }
  selectMode(mode);
  generalCard.addEventListener('click', ()=>selectMode('general'));
  habitatCard.addEventListener('click', ()=>selectMode('habitat'));

  makeSelect(picker, habitats.map(h=>({value:h,label:h})), habitat, false, (v)=>{habitat=v;});

  document.getElementById('choice-back-btn').addEventListener('click', ()=>scrollToSection('sec-intro'));
  document.getElementById('choice-start-btn').addEventListener('click', ()=>{
    ANALYSIS_MODE = mode;
    CHOSEN_HABITAT = mode==='habitat' ? habitat : null;
    if(mode==='habitat'){
      const habAnalysisEl = getOrCreateSection('sec-hab-analysis');
      renderAnalysisSection(habAnalysisEl, habitat);
      scrollToSection('sec-hab-analysis');
    } else {
      const analysisEl = getOrCreateSection('sec-analysis');
      renderAnalysisSection(analysisEl);
      scrollToSection('sec-analysis');
    }
  });
}

// ---------------------------------------------------------------------------
// ANALYSIS SECTION 1: ARG counts, Jaccard index, identity distribution
// ---------------------------------------------------------------------------
function renderAnalysisSection(el, habitat){
  const basicTools = DATA.tool_meta.basic_tools; // fixed 10-pipeline set, no user toggle here
  const P = habitat ? 'hab-' : '';
  const modeLabel = habitat ? `Habitat: ${habitat}` :
    (ANALYSIS_MODE==='habitat' ? `Habitat: ${CHOSEN_HABITAT}` : 'General analysis');
  const backTarget = 'sec-choice';
  const nextSectionId = habitat ? 'sec-hab-abundance' : 'sec-geneclasses';

  el.innerHTML = `
    <button class="flow-back" id="${P}analysis-back-btn">← Back</button>
    <h2>ARGs by Pipeline</h2>
    <p class="sub">${habitat
      ? 'How many ARGs each pipeline calls, how much they agree, and the identity of their matches — scoped to this habitat.'
      : `<span style="color:var(--teal);font-family:'JetBrains Mono',monospace;font-size:12px;">${modeLabel}</span><br>
    A total of 178,107 unigenes from GMGCv1 were reported as an ARG by at least one pipeline. The largest difference — 45-fold — was observed between ABRicate-ResFinder and DeepARG.`}</p>

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
    </div>

    <div class="grid3">
      <div class="card" id="${P}card-argcount">
        <h3>Number of ARGs</h3>
        <p class="desc">Total distinct unigenes called as an ARG by each pipeline. Choosing a stricter identity threshold above swaps that pipeline's bar for the filtered version.</p>
        <div id="${P}args-bar" class="plotwrap"></div>
      </div>

      <div class="card" id="${P}card-identity">
        <h3>Identity Distribution</h3>
        <p class="desc">This is the identity level distribution for the ARGs reported by each tool against the reference gene. fARGene and most of AMRFinder ARGs are based on HMM models, not alignment.</p>
        <div id="${P}args-identity" class="plotwrap"></div>
      </div>

      <div class="card" id="${P}card-jaccard">
        <h3>Jaccard Index</h3>
        <p class="desc">This heatmap shows how much pipelines agree on which genes are ARGs. Brighter means higher agreement.</p>
        <div id="${P}args-jaccard" class="plotwrap"></div>
      </div>
    </div>

    <div class="wizard-actions" style="justify-content:space-between;">
      <button class="btn-secondary" id="${P}analysis-back-btn-2">← Back</button>
      <button class="btn-primary" id="${P}analysis-continue-btn">${habitat ? 'Continue to Abundance & Richness →' : 'Continue to gene classes →'}</button>
    </div>
  `;

  document.getElementById(`${P}analysis-back-btn`).addEventListener('click', ()=>scrollToSection(backTarget));
  document.getElementById(`${P}analysis-back-btn-2`).addEventListener('click', ()=>scrollToSection(backTarget));
  document.getElementById(`${P}analysis-continue-btn`).addEventListener('click', ()=>{
    const nextEl = getOrCreateSection(nextSectionId);
    if(habitat) renderAbundance(nextEl, habitat);
    else renderGeneClassesSection(nextEl, habitat);
    scrollToSection(nextSectionId);
  });

  let deepargLevel = 'DeepARG';   // DeepARG | DeepARG70 | DeepARG80 | DeepARG90
  let rgiLevel = 'RGI-DIAMOND';   // RGI-DIAMOND | RGI-DIAMOND70/80/90

  function barToolSet(){
    // swap: the chosen identity level REPLACES the base pipeline
    return basicTools.map(t=>{
      if(t==='DeepARG') return deepargLevel;
      if(t==='RGI-DIAMOND') return rgiLevel;
      return t;
    });
  }

  function jaccardToolSet(){
    // add-alongside, positioned right next to its base pipeline (not appended at the end)
    const set = [];
    basicTools.forEach(t=>{
      set.push(t);
      if(t==='DeepARG' && deepargLevel!=='DeepARG') set.push(deepargLevel);
      if(t==='RGI-DIAMOND' && rgiLevel!=='RGI-DIAMOND') set.push(rgiLevel);
    });
    return set;
  }

  function drawBar(){
    const tools = barToolSet();
    const argCounts = habitat ? habArgCounts(habitat) : DATA.arg_counts;
    const rows = tools.map(t=>argCounts.find(d=>d.tool===t)).filter(Boolean)
      .sort((a,b)=>b.n-a.n);
    Plotly.react(`${P}args-bar`, [{
      type:'bar', orientation:'h',
      y: rows.map(d=>TOOL_LABEL[d.tool]||d.tool),
      x: rows.map(d=>d.n),
      marker:{color: rows.map(d=>DB_COLOR[d.tools_db]||'#1d3557'), line:{color:'#ffffff', width:1}},
      hovertemplate: '%{y}: %{x:,}<extra></extra>'
    }], {...PLOTLY_LAYOUT_BASE, height: Math.max(320, rows.length*26),
         xaxis:{title:'Number of ARGs', gridcolor:'#dde2de'},
         yaxis:{automargin:true, autorange:'reversed'}}, PLOTLY_CONFIG);
  }

  function drawJaccard(){
    const tools = jaccardToolSet();
    const labels = tools.map(t=>TOOL_LABEL[t]||t);
    const jaccardData = habitat ? habJaccardFull(habitat) : DATA.jaccard_full;
    const jmap = new Map(jaccardData.map(d=>[d.tool_ref+'|'+d.tool_comp, d.jaccard]));
    const z = tools.map(tr => tools.map(tc=>{
      if(tr===tc) return null;
      const v = jmap.get(tr+'|'+tc);
      return v===undefined ? null : v;
    }));
    const side = Math.max(440, tools.length*44);
    Plotly.react(`${P}args-jaccard`, [{
      type:'heatmap', z, x:labels, y:labels,
      colorscale:[[0,'#eef0ee'],[1,'#2a9d8f']], zmin:0, zmax:1,
      hovertemplate:'%{y} vs %{x}: %{z:.0%}<extra></extra>',
      colorbar:{tickformat:'.0%', thickness:14}
    }], {...PLOTLY_LAYOUT_BASE, height:side,
         margin:{t:20,l:150,r:20,b:150},
         xaxis:{tickangle:-45, automargin:true, tickfont:{size:11}},
         yaxis:{autorange:'reversed', automargin:true, tickfont:{size:11}}}, PLOTLY_CONFIG);
  }

  function drawIdentityDistribution(){
    const idist = habitat ? habIdentityDistribution(habitat) : DATA.identity_distribution;
    const x = idist.bin_centers;
    const traces = idist.tools.map(t=>({
      type:'scatter', mode:'lines', name: TOOL_LABEL[t.tool]||t.tool,
      x, y: t.density,
      line:{width:2.5, color: DB_COLOR[TOOL_DB[t.tool]]||'#1d3557',
            dash: t.tool.startsWith('ABRicate') ? 'dash' : 'solid'},
      hovertemplate: (TOOL_LABEL[t.tool]||t.tool)+' — %{x:.0f}% identity: %{y:.1%}<extra></extra>'
    }));
    Plotly.react(`${P}args-identity`, traces, {...PLOTLY_LAYOUT_BASE, height:420,
      xaxis:{title:'Percent identity to reference', gridcolor:'#dde2de'},
      yaxis:{title:'Density', gridcolor:'#dde2de'},
      legend:{orientation:'h', y:-0.3}}, PLOTLY_CONFIG);
  }

  if(habitat){
    makeSelect(document.getElementById(`${P}habitat-select`),
      getHabitats().map(h=>({value:h,label:h})), habitat, false,
      (v)=>{habitat=v; CHOSEN_HABITAT=v; drawBar(); drawJaccard(); drawIdentityDistribution();});
  }

  makeSelect(document.getElementById(`${P}args-deeparg-identity`),
    [{value:'DeepARG',label:'No threshold'},{value:'DeepARG70',label:'≥70%'},
     {value:'DeepARG80',label:'≥80%'},{value:'DeepARG90',label:'≥90%'}],
    deepargLevel, false, (v)=>{deepargLevel=v; drawBar(); drawJaccard();});

  makeSelect(document.getElementById(`${P}args-rgi-identity`),
    [{value:'RGI-DIAMOND',label:'No threshold'},{value:'RGI-DIAMOND70',label:'≥70%'},
     {value:'RGI-DIAMOND80',label:'≥80%'},{value:'RGI-DIAMOND90',label:'≥90%'}],
    rgiLevel, false, (v)=>{rgiLevel=v; drawBar(); drawJaccard();});

  drawBar(); drawJaccard(); drawIdentityDistribution();

  {
    const shownFlag = habitat ? TUTORIAL_HAB_SHOWN : TUTORIAL_SHOWN;
    if(!shownFlag){
      if(habitat) TUTORIAL_HAB_SHOWN = true; else TUTORIAL_SHOWN = true;
      setTimeout(()=>{
        // Instance 1: walk through the three outputs
        runSpotlightTour([
          {el: document.getElementById(`${P}card-argcount`),
           text: "This shows how many ARGs each pipeline calls — hover any bar for the exact count."},
          {el: document.getElementById(`${P}card-identity`),
           text: "This is the identity level distribution for the ARGs reported by each tool against the reference gene. fARGene and most of AMRFinder ARGs are based on HMM models, not alignment."},
          {el: document.getElementById(`${P}card-jaccard`),
           text: "This heatmap shows how much pipelines agree on which genes are ARGs. Brighter means higher agreement."}
        ], ()=>{
          // Instance 2: point out the interactive controls
          runSpotlightTour([
            {el: document.getElementById(`${P}identity-controls`),
             text: "You can control the identity thresholds here. As a hint, only 15% and 10% of the ARGs reported by DeepARG and RGI have ≥80% identity level to the reference gene."}
          ]);
        });
      }, 500);
    }
  }
}

// ---------------------------------------------------------------------------
// GENE CLASSES SECTION: ARG counts (carried over), counts-by-class heatmap,
// and proportion-by-class heatmap, sharing one gene-class selection.
// ---------------------------------------------------------------------------
function renderGeneClassesSection(el, habitat){
  const basicTools = DATA.tool_meta.basic_tools;
  const defaultClasses = DATA.gene_class_order.default_20;
  const P = habitat ? 'hab-gc-' : 'gc-';
  const backTarget = habitat ? 'sec-hab-abundance' : 'sec-analysis';
  const nextSectionId = habitat ? 'sec-hab-csc' : 'sec-csc';

  el.innerHTML = `
    <button class="flow-back" id="${P}back-btn">${habitat ? '← Back to Abundance & Richness' : '← Back to ARGs'}</button>
    <h2>Gene Classes</h2>
    <p class="sub">Same pipelines, broken down by ARG class.</p>

    <div class="controls" id="${P}pipeline-controls">
      ${habitat ? `<div class="control">
        <label>Habitat</label>
        <div id="${P}habitat-select"></div>
      </div>` : ''}
      <div class="control" style="flex:1;min-width:320px;">
        <label>Pipelines</label>
        <div id="${P}pipeline-chips"></div>
      </div>
    </div>

    <div class="controls" id="${P}filter-controls">
      <div class="control">
        <label>DeepARG identity threshold</label>
        <div id="${P}deeparg-identity"></div>
      </div>
      <div class="control">
        <label>RGI identity threshold</label>
        <div id="${P}rgi-identity"></div>
      </div>
      <div class="control" style="flex:1;min-width:280px;" id="${P}class-control">
        <label>Gene classes shown (default ${defaultClasses.length})</label>
        <div id="${P}class-select"></div>
      </div>
    </div>

    <div class="grid3">
      <div class="card" id="${P}card-identity">
        <h3>Identity Distribution by Gene Class</h3>
        <p class="desc">DeepARG vs. RGI-DIAMOND only. Box = spread of percent identity for that pipeline's calls in that class.</p>
        <div id="${P}identity-by-class" class="plotwrap"></div>
      </div>

      <div class="card" id="${P}card-classbar">
        <h3>Number of Genes per Gene Class</h3>
        <p class="desc">Total distinct unigenes called in each ARG class. Each gene class is a row; bars within a row compare pipelines.</p>
        <div id="${P}class-bar" class="plotwrap"></div>
      </div>

      <div class="card" id="${P}card-prop">
        <h3>Gene Class Proportion</h3>
        <p class="desc">Same classes, as a proportion of each pipeline's total calls — shows how the resistome "mix" shifts by pipeline.</p>
        <div id="${P}prop-heatmap" class="plotwrap"></div>
      </div>
    </div>

    <div class="wizard-actions" style="justify-content:space-between;">
      <button class="btn-secondary" id="${P}back-btn-2">← Back</button>
      <button class="btn-primary" id="${P}continue-btn">Continue to Class-specific Coverage →</button>
    </div>
  `;

  document.getElementById(`${P}back-btn`).addEventListener('click', ()=>scrollToSection(backTarget));
  document.getElementById(`${P}back-btn-2`).addEventListener('click', ()=>scrollToSection(backTarget));
  document.getElementById(`${P}continue-btn`).addEventListener('click', ()=>{
    const cscEl = getOrCreateSection(nextSectionId);
    renderCSCSection(cscEl, habitat);
    scrollToSection(nextSectionId);
  });

  let deepargLevel = 'DeepARG';
  let rgiLevel = 'RGI-DIAMOND';
  let selectedClasses = [...defaultClasses];
  let selectedPipelines = [...basicTools];

  function barToolSet(){
    return selectedPipelines.map(t=>{
      if(t==='DeepARG') return deepargLevel;
      if(t==='RGI-DIAMOND') return rgiLevel;
      return t;
    });
  }

  function geneClassProp(){ return habitat ? habGeneClassProportion(habitat) : DATA.gene_class_proportion; }
  function identityByClass(){ return habitat ? habIdentityByClass(habitat) : DATA.identity_by_class; }

  function drawIdentityByClass(){
    const classes = selectedClasses;
    const classLabels = classes.map(cleanLevel);
    const ibc = identityByClass();
    const traces = ['DeepARG','RGI-DIAMOND'].map(t=>{
      const rows = classes.map(cl=>ibc.find(d=>d.tool===t && d.new_level===cl));
      const color = DB_COLOR[TOOL_DB[t]] || '#1B9E77';
      return {
        type:'box', orientation:'h', name: TOOL_LABEL[t]||t, y: classLabels,
        q1: rows.map(r=>r?r.q25:null), median: rows.map(r=>r?r.median:null),
        q3: rows.map(r=>r?r.q75:null), lowerfence: rows.map(r=>r?r.w1:null),
        upperfence: rows.map(r=>r?r.w2:null),
        marker:{color}, line:{color}
      };
    });
    Plotly.react(`${P}identity-by-class`, traces, {...PLOTLY_LAYOUT_BASE, boxmode:'group',
      height: Math.max(460, classes.length*42), margin:{t:20,l:170,r:20,b:60},
      xaxis:{title:'Percent identity', range:[0,102], gridcolor:'#dde2de'},
      yaxis:{automargin:true, autorange:'reversed', categoryorder:'array', categoryarray:classLabels},
      legend:{orientation:'h', y:-0.12}}, PLOTLY_CONFIG);
  }

  function drawClassBar(){
    const tools = barToolSet();
    const classes = selectedClasses;
    const classLabels = classes.map(cleanLevel);
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

    Plotly.react(`${P}class-bar`, traces, {...PLOTLY_LAYOUT_BASE, barmode:'group',
      height: Math.max(500, classes.length*70),
      margin:{t:50,l:170,r:20,b:60},
      shapes: dividers,
      xaxis:{title:'Number of ARGs', gridcolor:'#dde2de'},
      xaxis2:{title:'Number of ARGs', overlaying:'x', side:'top', matches:'x', gridcolor:'#dde2de'},
      yaxis:{automargin:true, autorange:'reversed', categoryorder:'array', categoryarray:classLabels},
      legend:{orientation:'h', y:-0.12}}, PLOTLY_CONFIG);
  }

  function drawPropHeatmap(){
    const tools = barToolSet();
    const classes = selectedClasses;
    const gcp = geneClassProp();
    const z = classes.map(cl => tools.map(t=>{
      const row = gcp.find(d=>d.tool===t && d.new_level===cl);
      return row ? row.p : 0;
    }));
    Plotly.react(`${P}prop-heatmap`, [{
      type:'heatmap', z, x: tools.map(t=>TOOL_LABEL[t]||t), y: classes.map(cleanLevel),
      colorscale:[[0,'#eef0ee'],[1,'#2a9d8f']],
      hovertemplate:'%{y} — %{x}: %{z:.1%}<extra></extra>',
      colorbar:{tickformat:'.0%', thickness:14}
    }], {...PLOTLY_LAYOUT_BASE, height: Math.max(400, classes.length*30),
         margin:{t:20,l:170,r:20,b:130},
         xaxis:{tickangle:-45, automargin:true, tickfont:{size:11}},
         yaxis:{automargin:true, tickfont:{size:11}, autorange:'reversed'}}, PLOTLY_CONFIG);
  }

  makeSelect(document.getElementById(`${P}deeparg-identity`),
    [{value:'DeepARG',label:'No threshold'},{value:'DeepARG70',label:'≥70%'},
     {value:'DeepARG80',label:'≥80%'},{value:'DeepARG90',label:'≥90%'}],
    deepargLevel, false, (v)=>{deepargLevel=v; drawClassBar(); drawPropHeatmap();});

  makeSelect(document.getElementById(`${P}rgi-identity`),
    [{value:'RGI-DIAMOND',label:'No threshold'},{value:'RGI-DIAMOND70',label:'≥70%'},
     {value:'RGI-DIAMOND80',label:'≥80%'},{value:'RGI-DIAMOND90',label:'≥90%'}],
    rgiLevel, false, (v)=>{rgiLevel=v; drawClassBar(); drawPropHeatmap();});

  makeCheckList(document.getElementById(`${P}class-select`),
    DATA.gene_class_order.all.map(c=>({value:c,label:cleanLevel(c)})), selectedClasses,
    (vals)=>{selectedClasses = vals; drawIdentityByClass(); drawClassBar(); drawPropHeatmap();}, {min:1});

  chipToggle(document.getElementById(`${P}pipeline-chips`),
    basicTools.map(t=>({value:t,label:TOOL_LABEL[t]||t})), selectedPipelines,
    (vals)=>{selectedPipelines = vals; drawClassBar(); drawPropHeatmap();});

  if(habitat){
    makeSelect(document.getElementById(`${P}habitat-select`),
      getHabitats().map(h=>({value:h,label:h})), habitat, false,
      (v)=>{habitat=v; CHOSEN_HABITAT=v; drawIdentityByClass(); drawClassBar(); drawPropHeatmap();});
  }

  drawIdentityByClass(); drawClassBar(); drawPropHeatmap();

  {
    const shownFlag = habitat ? TUTORIAL_HAB_GC_SHOWN : TUTORIAL_GC_SHOWN;
    if(!shownFlag){
      if(habitat) TUTORIAL_HAB_GC_SHOWN = true; else TUTORIAL_GC_SHOWN = true;
      setTimeout(()=>{
        runSpotlightTour([
          {el: document.getElementById(`${P}pipeline-controls`),
           text: "Choose which pipelines to compare here."},
          {el: document.getElementById(`${P}filter-controls`),
           text: "Set identity thresholds for DeepARG and RGI, and add or remove gene classes here. Try removing \"efflux pump\", \"van\", \"cell wall charge\", and \"rpoB\" — their counts are so much higher than every other class that they can make the rest hard to compare."},
          {el: document.getElementById(`${P}card-identity`),
           text: "Identity level per gene class for DeepARG and RGI"},
          {el: document.getElementById(`${P}card-identity`),
           text: "rpob genes are point mutations, reflect on ID thresholds for point mutations (i will add citation)."},
          {el: document.getElementById(`${P}card-classbar`),
           text: "Each gene class is a row here, with one bar per pipeline so you can compare them directly."},
          {el: document.getElementById(`${P}card-classbar`),
           text: habitat
             ? "<ul><li>DeepARG classifies a large share of efflux pumps as 'multidrug' — a category the tool's own authors flag as a technical challenge requiring manual curation.</li><li>DeepARG classifies a large share of efflux pumps as \u201cunclassified\u201d.</li><li>There are significant difficulties in distinguishing between resistance-conferring pumps and those involved in general physiological transport (I will add citation).</li></ul>"
             : "<ul><li>DeepARG – 23,784 (58%) of the efflux pumps classified by the tool as 'multidrug', a category highlighted by the authors of the tool as an important technical challenge requiring manual curation.</li><li>DeepARG – 5,290 (13%) were labeled as \u201cunclassified\u201d.</li><li>There are significant difficulties in distinguishing between resistance-conferring pumps and those involved in general physiological transport (I will add citation).</li></ul>"},
          {el: document.getElementById(`${P}card-prop`),
           text: "Same classes, but as a share of each pipeline's total calls — shows how the resistome \"mix\" shifts by pipeline."}
        ]);
      }, 500);
    }
  }
}

// ---------------------------------------------------------------------------
// CLASS-SPECIFIC COVERAGE (CSC) BY GENE CLASS
// ---------------------------------------------------------------------------
function renderCSCSection(el, habitat){
  const basicTools = DATA.tool_meta.basic_tools;
  const defaultClasses = DATA.gene_class_order.default_20;
  const P = habitat ? 'hab-csc-' : 'csc-';
  const backTarget = habitat ? 'sec-hab-geneclasses' : 'sec-geneclasses';

  el.innerHTML = `
    <button class="flow-back" id="${P}back-btn">← Back to gene classes</button>
    <h2>Class-specific Coverage (CSC) by Gene Class</h2>
    <p class="sub">For each reference pipeline, CSC asks: of the ARGs a comparison pipeline reports in a given class, what proportion does the reference also report? Each box summarizes CSC across the 10 core pipelines for that class; each dot is one comparison pipeline — hover to see which. Choose 1–6 reference pipelines to compare together.</p>

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
      <div class="control" style="flex:1;min-width:280px;">
        <label>Gene classes shown (default ${defaultClasses.length})</label>
        <div id="${P}class-select"></div>
      </div>
    </div>

    <div class="controls">
      <div class="control" style="flex:1;min-width:320px;">
        <label>Reference pipelines (1–6)</label>
        <div id="${P}ref-chips"></div>
      </div>
    </div>

    <div class="card" id="${P}card-box">
      <h3>Class-specific Coverage</h3>
      <p class="desc">Box = spread of CSC across comparison pipelines for that class; dots are the individual comparison pipelines. Choosing an identity threshold above swaps that pipeline out entirely — it can't be selected alongside its own filtered version.</p>
      <div id="${P}box" class="plotwrap"></div>
    </div>

    <div class="wizard-actions" style="justify-content:space-between;">
      <button class="btn-secondary" id="${P}back-btn-2">← Back</button>
      <button class="btn-primary" id="${P}continue-btn">${habitat ? 'Continue to Pan-/Core-resistome →' : 'Continue to Explore Habitat →'}</button>
    </div>
  `;

  document.getElementById(`${P}back-btn`).addEventListener('click', ()=>scrollToSection(backTarget));
  document.getElementById(`${P}back-btn-2`).addEventListener('click', ()=>scrollToSection(backTarget));
  document.getElementById(`${P}continue-btn`).addEventListener('click', ()=>{
    if(habitat){
      const pcEl = getOrCreateSection('sec-hab-pancore');
      renderPanCore(pcEl, habitat);
      scrollToSection('sec-hab-pancore');
    } else {
      const habEl = getOrCreateSection('sec-habitat');
      renderHabitatSection(habEl);
      scrollToSection('sec-habitat');
    }
  });

  let deepargLevel = 'DeepARG';
  let rgiLevel = 'RGI-DIAMOND';
  let selectedClasses = [...defaultClasses];

  // indices into basicTools; stable across identity-threshold swaps
  const defaultRefNames = ['DeepARG','fARGene','ABRicate-MEGARes','RGI-DIAMOND','AMRFinderPlus','ResFinder'];
  let selectedRefIndices = defaultRefNames.map(n=>basicTools.indexOf(n));

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
      {min:1, max:6});
  }

  function draw(){
    const ts = toolSet();
    const classLabels = selectedClasses.map(cleanLevel);
    const refs = selectedRefIndices.map(i=>ts[i]);
    const n = refs.length;
    const gap = 0.035;
    const width = (1 - gap*(n-1)) / n;
    const csc = cscData();

    const traces = [];
    const dividers = [];
    const layout = {...PLOTLY_LAYOUT_BASE,
      height: Math.max(480, classLabels.length*46),
      margin:{t:40,l:170,r:20,b:60},
      showlegend:false,
      yaxis:{automargin:true, autorange:'reversed', categoryorder:'array', categoryarray:classLabels},
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

      const rows = csc.filter(d=>d.tool_ref===refTool && ts.includes(d.tool_comp)
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
        y: rows.map(d=>cleanLevel(d.new_level)),
        x: rows.map(d=>d.csc),
        text: rows.map(d=>TOOL_LABEL[d.tool_comp]||d.tool_comp),
        boxpoints:'all', jitter:0.6, pointpos:0,
        marker:{color: dotColors, size:6, opacity:0.9, line:{color:'#ffffff', width:0.5}},
        line:{color: refColor, width:1.5},
        fillcolor:'rgba(0,0,0,0.03)',
        hovertemplate: (TOOL_LABEL[refTool]||refTool)+' — %{y}, vs %{text}: %{x:.0%}<extra></extra>'
      });

      layout[axisKey] = {
        domain:[d0, d1], anchor:'y',
        range:[0,1.02], tickformat:'.0%', gridcolor:'#dde2de'
      };

      layout.annotations.push({
        xref:'paper', yref:'paper', x:(d0+d1)/2, y:1.03,
        xanchor:'center', yanchor:'bottom',
        text: TOOL_LABEL[refTool]||refTool, showarrow:false,
        font:{size:11, color:'#1a2b28'}
      });
    });

    layout.shapes = dividers;
    Plotly.react(`${P}box`, traces, layout, PLOTLY_CONFIG);
  }

  makeSelect(document.getElementById(`${P}deeparg-identity`),
    [{value:'DeepARG',label:'No threshold'},{value:'DeepARG70',label:'≥70%'},
     {value:'DeepARG80',label:'≥80%'},{value:'DeepARG90',label:'≥90%'}],
    deepargLevel, false, (v)=>{deepargLevel=v; refreshRefChips(); draw();});

  makeSelect(document.getElementById(`${P}rgi-identity`),
    [{value:'RGI-DIAMOND',label:'No threshold'},{value:'RGI-DIAMOND70',label:'≥70%'},
     {value:'RGI-DIAMOND80',label:'≥80%'},{value:'RGI-DIAMOND90',label:'≥90%'}],
    rgiLevel, false, (v)=>{rgiLevel=v; refreshRefChips(); draw();});

  refreshRefChips();

  if(habitat){
    makeSelect(document.getElementById(`${P}habitat-select`),
      getHabitats().map(h=>({value:h,label:h})), habitat, false,
      (v)=>{habitat=v; CHOSEN_HABITAT=v; draw();});
  }

  makeCheckList(document.getElementById(`${P}class-select`),
    DATA.gene_class_order.all.map(c=>({value:c,label:cleanLevel(c)})), selectedClasses,
    (vals)=>{selectedClasses=vals; draw();}, {min:1});

  draw();

  {
    const shownFlag = habitat ? TUTORIAL_HAB_CSC_SHOWN : TUTORIAL_CSC_SHOWN;
    if(!shownFlag){
      if(habitat) TUTORIAL_HAB_CSC_SHOWN = true; else TUTORIAL_CSC_SHOWN = true;
      setTimeout(()=>{
        runSpotlightTour([
          {el: document.getElementById(`${P}card-box`),
           text: "<ul><li>A high CSC means that pipeline reports the genes other pipelines also report.</li><li>Despite the large number of efflux pump and van genes, and the low identity level for those classes (and others), RGI and DeepARG did not extrapolate to report the genes that other pipelines reported.</li><li>fARGene, for the gene classes it's trained for, is very good at reporting the genes other pipelines report.</li></ul>"}
        ]);
      }, 500);
    }
  }
}

// ---------------------------------------------------------------------------
// EXPLORE HABITAT
// ---------------------------------------------------------------------------
function renderHabitatSection(el){
  const habitats = getHabitats();
  let habitat = CHOSEN_HABITAT || (habitats.includes('human gut') ? 'human gut' : habitats[0]);

  el.innerHTML = `
    <button class="flow-back" id="hab-back-btn">← Back to Class-specific Coverage</button>
    <h2>Explore Habitat</h2>
    <p class="sub">Pick a habitat, then repeat the same ARGs → Gene Classes → Class-specific Coverage analysis, scoped to just that habitat.</p>

    <div class="controls">
      <div class="control">
        <label>Habitat</label>
        <div id="hab-habitat-select"></div>
      </div>
    </div>

    <div class="wizard-actions">
      <button class="btn-primary" id="hab-start-btn">Start habitat analysis →</button>
    </div>
  `;

  document.getElementById('hab-back-btn').addEventListener('click', ()=>scrollToSection('sec-csc'));

  makeSelect(document.getElementById('hab-habitat-select'),
    habitats.map(h=>({value:h,label:h})), habitat, false,
    (v)=>{habitat=v; CHOSEN_HABITAT=v;});

  document.getElementById('hab-start-btn').addEventListener('click', ()=>{
    const habAnalysisEl = getOrCreateSection('sec-hab-analysis');
    renderAnalysisSection(habAnalysisEl, habitat);
    scrollToSection('sec-hab-analysis');
  });
}


// ---------------------------------------------------------------------------
// ABUNDANCE & RICHNESS TAB
// ---------------------------------------------------------------------------
function renderAbundance(el, habitat){
  const basicTools = DATA.tool_meta.basic_tools;
  el.innerHTML = `
    <button class="flow-back" id="ab-back-btn">← Back to ARGs by Pipeline</button>
    <h2>Abundance &amp; Richness</h2>
    <p class="sub">Per-sample distributions of ARG abundance (aligned reads per million) and richness, by pipeline.</p>

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

    <div class="card" id="ab-card-abundance">
      <h3>Relative abundance per sample</h3>
      <p class="desc">Box = interquartile range, whiskers extend to 1.5×IQR. Points are a random sample of individual metagenomes.</p>
      <div id="ab-abundance-box" class="plotwrap"></div>
    </div>

    <div class="card" id="ab-card-richness">
      <h3>Richness per sample</h3>
      <div id="ab-richness-box" class="plotwrap"></div>
    </div>

    <div class="card" id="ab-card-classfacet">
      <h3>Relative abundance per gene class</h3>
      <div class="controls" style="margin-bottom:10px;">
        <div class="control" style="min-width:260px;">
          <label>Gene classes (max 15)</label>
          <div id="ab-gene-select"></div>
        </div>
      </div>
      <div id="ab-class-facet" class="plotwrap"></div>
    </div>

    <div class="wizard-actions" style="justify-content:space-between;">
      <button class="btn-secondary" id="ab-back-btn-2">← Back</button>
      <button class="btn-primary" id="ab-continue-btn">Continue to Gene Classes →</button>
    </div>
  `;

  document.getElementById('ab-back-btn').addEventListener('click', ()=>scrollToSection('sec-hab-analysis'));
  document.getElementById('ab-back-btn-2').addEventListener('click', ()=>scrollToSection('sec-hab-analysis'));
  document.getElementById('ab-continue-btn').addEventListener('click', ()=>{
    const gcEl = getOrCreateSection('sec-hab-geneclasses');
    renderGeneClassesSection(gcEl, habitat);
    scrollToSection('sec-hab-geneclasses');
  });

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
        marker:{color}, line:{color}, boxpoints:false
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

  function percentile(arr, p){
    if(!arr.length) return 0;
    const sorted = [...arr].sort((a,b)=>a-b);
    const idx = (p/100)*(sorted.length-1);
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    if(lo===hi) return sorted[lo];
    return sorted[lo] + (sorted[hi]-sorted[lo])*(idx-lo);
  }
  function zoomRange(jitter, tools, key){
    const p90s = tools.map(t=>percentile(jitter.filter(d=>d.tool===t).map(d=>d[key]), 90)).filter(v=>v>0);
    return p90s.length ? [0, Math.max(...p90s)*1.05] : undefined;
  }

  function drawAbundance(){
    const summary = DATA.abundance_summary.filter(d=>d.habitat===habitat);
    const jitter = DATA.abundance_jitter_sample.filter(d=>d.habitat===habitat);
    Plotly.react('ab-abundance-box', boxTrace(summary, jitter, 'abundance'),
      {...PLOTLY_LAYOUT_BASE, height:420, showlegend:false,
       yaxis:{title:'Relative abundance (reads/million)', gridcolor:'#dde2de',
              range: zoomRange(jitter, barToolSet(), 'abundance')},
       xaxis:{tickangle:-45}}, PLOTLY_CONFIG);
  }
  function drawRichness(){
    const summary = DATA.richness_summary.filter(d=>d.habitat===habitat);
    const jitter = DATA.abundance_jitter_sample.filter(d=>d.habitat===habitat);
    Plotly.react('ab-richness-box', boxTrace(summary, jitter, 'richness'),
      {...PLOTLY_LAYOUT_BASE, height:420, showlegend:false,
       yaxis:{title:'Richness', gridcolor:'#dde2de',
              range: zoomRange(jitter, barToolSet(), 'richness')},
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
      height: Math.max(320, tools.length*40),
      margin:{t:40,l:170,r:20,b:60},
      showlegend:false,
      yaxis:{automargin:true, autorange:'reversed', categoryorder:'array', categoryarray:toolLabels},
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
          marker:{color}, line:{color},
          hovertemplate: (TOOL_LABEL[t]||t)+': %{x:,.2f}<extra></extra>'
        });
      });

      layout[axisKey] = {domain:[d0,d1], anchor:'y', gridcolor:'#dde2de'};
      layout.annotations.push({
        xref:'paper', yref:'paper', x:(d0+d1)/2, y:1.04,
        xanchor:'center', yanchor:'bottom',
        text: cleanLevel(gene), showarrow:false,
        font:{size:11, color:'#1a2b28'}
      });
    });

    layout.shapes = dividers;
    Plotly.react('ab-class-facet', traces, layout, PLOTLY_CONFIG);
  }
  function drawAll(){ drawAbundance(); drawRichness(); drawClassAbundance(); }

  chipToggle(document.getElementById('ab-pipeline-chips'),
    basicTools.map(t=>({value:t,label:TOOL_LABEL[t]||t})), selectedTools,
    (vals)=>{selectedTools=vals; drawAll();});
  makeSelect(document.getElementById('ab-deeparg-identity'),
    [{value:'DeepARG',label:'No threshold'},{value:'DeepARG70',label:'≥70%'},
     {value:'DeepARG80',label:'≥80%'},{value:'DeepARG90',label:'≥90%'}],
    deepargLevel, false, (v)=>{deepargLevel=v; drawAll();});
  makeSelect(document.getElementById('ab-rgi-identity'),
    [{value:'RGI-DIAMOND',label:'No threshold'},{value:'RGI-DIAMOND70',label:'≥70%'},
     {value:'RGI-DIAMOND80',label:'≥80%'},{value:'RGI-DIAMOND90',label:'≥90%'}],
    rgiLevel, false, (v)=>{rgiLevel=v; drawAll();});
  makeSelect(document.getElementById('ab-habitat-select'),
    getHabitats().map(h=>({value:h,label:h})), habitat, false,
    (v)=>{habitat=v; CHOSEN_HABITAT=v; drawAll();});
  makeCheckList(document.getElementById('ab-gene-select'),
    DATA.gene_class_order.all.map(c=>({value:c,label:cleanLevel(c)})), selectedGenes,
    (vals)=>{selectedGenes=vals.slice(0,15); drawClassAbundance();}, {min:1, max:15});

  drawAll();

  if(!TUTORIAL_AB_SHOWN){
    TUTORIAL_AB_SHOWN = true;
    setTimeout(()=>{
      runSpotlightTour([
        {el: document.getElementById('ab-card-abundance'),
         text: "Zoomed in by default, from 0 up to the highest 90th-percentile value across pipelines, so a few extreme outliers don't flatten the whole chart. Use the toolbar to zoom back out if you want the full range."},
        {el: document.getElementById('ab-card-richness'),
         text: "Same zoom logic applied here, scoped to richness instead of abundance."},
        {el: document.getElementById('ab-card-classfacet'),
         text: "Same pipelines and habitat, broken down by gene class — one column per class, sharing the pipeline axis on the left."}
      ]);
    }, 500);
  }
}

// ---------------------------------------------------------------------------
// PAN-/CORE-RESISTOME TAB
// ---------------------------------------------------------------------------
function renderPanCore(el, habitat){
  const basicTools = DATA.tool_meta.basic_tools;
  const cnts = [200,250,300,350,400,450];
  const cuts = [0.3,0.4,0.5,0.6,0.7,0.8,0.9];

  el.innerHTML = `
    <button class="flow-back" id="pc-back-btn">← Back to Class-specific Coverage</button>
    <h2>Pan- and Core-resistome</h2>
    <p class="sub">The core-resistome was estimated from 500 random subsamples of 100 metagenomic samples. A gene class counts toward a subsample's core if detected in ≥p of that subsample's samples; it belongs to the overall core-resistome if it's in the core of ≥n of the 500 subsamples.</p>

    <div class="controls">
      <div class="control">
        <label>Habitat</label>
        <div id="pc-habitat-select"></div>
      </div>
      <div class="control" style="flex:1;min-width:280px;">
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
        <label id="pc-cnt-label">n (subsamples): 450</label>
        <input type="range" id="pc-cnt" min="0" max="${cnts.length-1}" step="1" value="${cnts.length-1}">
      </div>
      <div class="control">
        <label id="pc-cut-label">p (proportion): 50%</label>
        <input type="range" id="pc-cut" min="0" max="${cuts.length-1}" step="1" value="2">
      </div>
    </div>

    <div class="grid2">
      <div class="card">
        <h3>Pan-resistome size</h3>
        <p class="desc">Mean richness (number of ARG classes) across the 500 subsamples.</p>
        <div id="pc-pan-chart" class="plotwrap"></div>
      </div>
      <div class="card">
        <h3>Core-resistome size</h3>
        <p class="desc">Number of ARG classes in the core at your chosen thresholds.</p>
        <div id="pc-core-chart" class="plotwrap"></div>
      </div>
    </div>

    <div class="wizard-actions">
      <button class="btn-secondary" id="pc-back-btn-2">← Back</button>
    </div>
  `;

  document.getElementById('pc-back-btn').addEventListener('click', ()=>scrollToSection('sec-hab-csc'));
  document.getElementById('pc-back-btn-2').addEventListener('click', ()=>scrollToSection('sec-hab-csc'));

  let selectedTools = [...basicTools];
  let cnt = cnts[cnts.length-1];
  let cut = cuts[2];
  let deepargLevel = 'DeepARG';
  let rgiLevel = 'RGI-DIAMOND';

  function barToolSet(){
    return selectedTools.map(t=>{
      if(t==='DeepARG') return deepargLevel;
      if(t==='RGI-DIAMOND') return rgiLevel;
      return t;
    });
  }

  function draw(){
    const tools = barToolSet();
    const pan = DATA.pan_resistome.filter(d=>d.habitat===habitat && tools.includes(d.tool));
    const coreRows = DATA.core_resistome.filter(d=>d.habitat===habitat && d.cnt===cnt && d.cut===cut && tools.includes(d.tool));
    // sum core across gene classes per tool
    const coreByTool = {};
    coreRows.forEach(r=>{ coreByTool[r.tool] = (coreByTool[r.tool]||0) + r.unigenes; });

    const rows = tools.map(t=>{
      const p = pan.find(d=>d.tool===t);
      return {tool:t, pan: p?p.mn:0, core: coreByTool[t]||0};
    }).filter(r=>r.pan>0 || r.core>0);

    function colorFor(t){
      const meta = DATA.tool_meta.tools.find(m=>m.tool===t);
      return DB_COLOR[meta?meta.tools_db:''] || '#1d3557';
    }

    const panRows = [...rows].sort((a,b)=>b.pan-a.pan);
    Plotly.react('pc-pan-chart', [{
      type:'bar', orientation:'h',
      y: panRows.map(r=>TOOL_LABEL[r.tool]||r.tool),
      x: panRows.map(r=>r.pan),
      marker:{color: panRows.map(r=>colorFor(r.tool)), line:{color:'#ffffff', width:1}},
      hovertemplate:'%{y}: %{x:,.0f}<extra></extra>'
    }], {...PLOTLY_LAYOUT_BASE, height: Math.max(320, panRows.length*30),
      xaxis:{title:'Number of ARG classes', gridcolor:'#dde2de'},
      yaxis:{automargin:true, autorange:'reversed'}}, PLOTLY_CONFIG);

    const coreRowsSorted = [...rows].sort((a,b)=>b.core-a.core);
    Plotly.react('pc-core-chart', [{
      type:'bar', orientation:'h',
      y: coreRowsSorted.map(r=>TOOL_LABEL[r.tool]||r.tool),
      x: coreRowsSorted.map(r=>r.core),
      marker:{color: coreRowsSorted.map(r=>colorFor(r.tool)), line:{color:'#ffffff', width:1}},
      hovertemplate:'%{y}: %{x:,.0f}<extra></extra>'
    }], {...PLOTLY_LAYOUT_BASE, height: Math.max(320, coreRowsSorted.length*30),
      xaxis:{title:'Number of ARG classes', gridcolor:'#dde2de'},
      yaxis:{automargin:true, autorange:'reversed'}}, PLOTLY_CONFIG);
  }

  chipToggle(document.getElementById('pc-pipeline-chips'),
    basicTools.map(t=>({value:t,label:TOOL_LABEL[t]||t})), selectedTools,
    (vals)=>{selectedTools=vals; draw();});

  makeSelect(document.getElementById('pc-deeparg-identity'),
    [{value:'DeepARG',label:'No threshold'},{value:'DeepARG70',label:'≥70%'},
     {value:'DeepARG80',label:'≥80%'},{value:'DeepARG90',label:'≥90%'}],
    deepargLevel, false, (v)=>{deepargLevel=v; draw();});

  makeSelect(document.getElementById('pc-rgi-identity'),
    [{value:'RGI-DIAMOND',label:'No threshold'},{value:'RGI-DIAMOND70',label:'≥70%'},
     {value:'RGI-DIAMOND80',label:'≥80%'},{value:'RGI-DIAMOND90',label:'≥90%'}],
    rgiLevel, false, (v)=>{rgiLevel=v; draw();});

  makeSelect(document.getElementById('pc-habitat-select'),
    getHabitats().map(h=>({value:h,label:h})), habitat, false,
    (v)=>{habitat=v; CHOSEN_HABITAT=v; draw();});

  document.getElementById('pc-cnt').addEventListener('input', function(){
    cnt = cnts[+this.value];
    document.getElementById('pc-cnt-label').textContent = 'n (subsamples): '+cnt;
    draw();
  });
  document.getElementById('pc-cut').addEventListener('input', function(){
    cut = cuts[+this.value];
    document.getElementById('pc-cut-label').textContent = 'p (proportion): '+Math.round(cut*100)+'%';
    draw();
  });

  draw();

  if(!TUTORIAL_PC_SHOWN){
    TUTORIAL_PC_SHOWN = true;
    setTimeout(()=>{
      runSpotlightTour([
        {el: document.getElementById('pc-pan-chart').closest('.card'),
         text: "Pan-resistome size: how many distinct ARG classes each pipeline finds across many random subsamples of this habitat's data."},
        {el: document.getElementById('pc-core-chart').closest('.card'),
         text: "Core-resistome size: of those classes, how many show up consistently enough (at your chosen thresholds) to count as core."}
      ]);
    }, 500);
  }
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
    Plotly.react(plotEl, [{
      type:'heatmap', z, x: refs.map(t=>TOOL_LABEL[t]||t), y: classes.map(cleanLevel),
      colorscale:[[0,'#eef0ee'],[1,'#1d3557']], zmin:0, zmax:1,
      hovertemplate:'%{y} — %{x}: %{z:.0%}<extra></extra>',
      colorbar:{tickformat:'.0%', thickness:14}
    }], {...PLOTLY_LAYOUT_BASE, height: Math.max(360, classes.length*30), xaxis:{tickangle:-45}, yaxis:{automargin:true}}, PLOTLY_CONFIG);

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
    Plotly.newPlot('ov-detail', [{
      type:'bar', orientation:'h',
      y: rows.map(d=>TOOL_LABEL[d.tool_comp]||d.tool_comp),
      x: rows.map(d=>d.csc),
      marker:{color:'#2a9d8f'},
      hovertemplate:'vs %{y}: %{x:.0%}<extra></extra>'
    }], {...PLOTLY_LAYOUT_BASE, height: Math.max(260, rows.length*24),
      xaxis:{title:'CSC', tickformat:'.0%', range:[0,1], gridcolor:'#dde2de'}, yaxis:{automargin:true}}, PLOTLY_CONFIG);
  }

  chipToggle(document.getElementById('ov-ref-chips'),
    basicTools.map(t=>({value:t,label:TOOL_LABEL[t]||t})), selectedRef,
    (vals)=>{selectedRef=vals; drawHeatmap();});
  makeSelect(document.getElementById('ov-class-select'),
    DATA.gene_class_order.all.map(c=>({value:c,label:cleanLevel(c)})), selectedClasses, true,
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
