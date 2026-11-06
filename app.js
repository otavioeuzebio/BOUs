/* Descritivo BOU v2 — app com login, permissões e conteúdo protegido no Firebase */
(() => {
'use strict';

const VERSAO = '2.0.0';
const $ = s => document.querySelector(s);
const app = $('#app'), top = $('#top');
const PH_A = '⟦', PH_B = '⟧';
const CFG = window.FIREBASE_CONFIG || {};
const ADMIN_EMAIL = (window.ADMIN_EMAIL || '').toLowerCase();
const TEM_FIREBASE = !!(CFG.apiKey && window.firebase);
const ARQS_CONTEUDO = ['base', 'ocorr', 'patrimonio', 'custodia', 'crise', 'gestao'];
const NOMES_CAT = { ocorr: 'Ocorrências (Série 100)', patrimonio: 'Furto e roubo', custodia: 'Cadeia de custódia', crise: 'Primeira intervenção (Série 200)', gestao: 'Despacho' };
const PERMS_PADRAO = { cats: ['ocorr', 'patrimonio', 'custodia', 'crise', 'gestao'], gerar: true, dicas: true, admin: false };

let CATEGORIAS = [], MODULOS = {}, TIPOS = [];
let auth = null, db = null, usuario = null, perfil = null;

/* ------------------------- armazenamento local ------------------------- */
const LS = {
  get(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};
const uidKey = k => `bou.${usuario ? usuario.uid : 'local'}.${k}`;
const cfg = () => LS.get(uidKey('config'), { expira: 7, estilo: 'cron' });
const turno = () => LS.get(uidKey('equipe'), { equipe: '', vtr: '', opm: '', municipio: '' });
const frases = () => LS.get(uidKey('frases'), []);
function rascunhos() {
  let r = LS.get(uidKey('rascunhos'), []);
  const dias = Number(cfg().expira) || 0;
  if (dias > 0) { const lim = Date.now() - dias * 864e5; const f = r.filter(x => x.atualizado >= lim); if (f.length !== r.length) { r = f; LS.set(uidKey('rascunhos'), r); } }
  return r;
}
function salvarRascunho(rd) { const r = rascunhos().filter(x => x.id !== rd.id); rd.atualizado = Date.now(); r.unshift(rd); LS.set(uidKey('rascunhos'), r.slice(0, 60)); }
function apagarRascunho(id) { LS.set(uidKey('rascunhos'), rascunhos().filter(x => x.id !== id)); }

/* ------------------------- utilidades ------------------------- */
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tipoPorId = id => TIPOS.find(t => t.id === id);
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const filled = v => Array.isArray(v) ? v.length > 0 : (v !== undefined && v !== null && String(v).trim() !== '' && v !== false);
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2400); }
function hoje() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function agora() { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function fmtData(iso) { if (!iso) return ''; const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}`; }
function fmtQuando(ts) { const d = new Date(ts); return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
function confirmar(msg, ok = 'Confirmar', html = false) {
  return new Promise(res => {
    const w = document.createElement('div'); w.className = 'dlg';
    w.innerHTML = `<div class="dlgbox" role="dialog" aria-modal="true"><div class="dlgmsg">${html ? msg : esc(msg)}</div><div class="actions"><button class="btn" data-r="0">Cancelar</button><button class="btn pri" data-r="1">${esc(ok)}</button></div></div>`;
    w.onclick = e => { const r = e.target.dataset && e.target.dataset.r; if (r === undefined && e.target !== w) return; w.remove(); res(r === '1'); };
    document.body.appendChild(w); w.querySelector('[data-r="1"]').focus();
  });
}
const pode = p => !!(perfil && perfil.perms && perfil.perms[p]);
const ehAdmin = () => !!(perfil && ((perfil.perms && perfil.perms.admin) || (usuario && (usuario.email || '').toLowerCase() === ADMIN_EMAIL)));

/* ------------------------- conteúdo (protegido) ------------------------- */
function montarConteudo(fontes) {
  const code = 'var CATEGORIAS=[],MODULOS={},TIPOS=[];\n' + fontes.map(f => `/* ${f.id} */\n${f.js}`).join('\n;\n') + '\n;return {CATEGORIAS:CATEGORIAS,MODULOS:MODULOS,TIPOS:TIPOS};';
  // eslint-disable-next-line no-new-func
  return new Function(code)();
}
function aplicarConteudo(fontes) {
  const c = montarConteudo(fontes);
  const cats = new Set(perfil.perms.cats || []);
  CATEGORIAS = c.CATEGORIAS.filter(x => cats.has(x.id) || ehAdmin());
  MODULOS = c.MODULOS;
  TIPOS = c.TIPOS.filter(t => cats.has(t.cat) || ehAdmin());
}
async function carregarConteudo(forcar) {
  const ids = ['base', ...(ehAdmin() ? ARQS_CONTEUDO.slice(1) : (perfil.perms.cats || []))];
  const cache = LS.get(uidKey('conteudo'), {});
  const fontes = [];
  if (!TEM_FIREBASE) {
    for (const id of ids) { try { const r = await fetch(`conteudo/${id}.js`, { cache: 'no-store' }); if (r.ok) fontes.push({ id, js: await r.text() }); } catch {} }
  } else {
    for (const id of ids) {
      try {
        const snap = await db.collection('conteudo').doc(id).get({ source: forcar ? 'server' : 'default' });
        if (snap.exists) { const x = snap.data(); fontes.push({ id, js: x.js }); cache[id] = { js: x.js, versao: x.versao || 0 }; }
        else delete cache[id];
      } catch (e) { if (cache[id]) fontes.push({ id, js: cache[id].js }); }
    }
    LS.set(uidKey('conteudo'), cache);
  }
  if (!fontes.find(f => f.id === 'base')) throw new Error('sem-conteudo');
  aplicarConteudo(fontes);
}

/* ------------------------- campos gerais ------------------------- */
const GERAIS = [
  { id: 'acionamento', l: 'Forma de acionamento', t: 'chips1', o: ['COPOM (190)', 'APP 190', 'Deparou-se em patrulhamento', 'Solicitação direta à equipe', 'Designação do Oficial CPU'] },
  { id: 'solicitante', l: 'Solicitante', p: 1, show: d => d.acionamento === 'Solicitação direta à equipe' },
  { id: 'natIni', l: 'Natureza inicial (como veio)', x: 1 },
  { id: 'data', l: 'Data', t: 'date', half: 1 },
  { id: 'hora', l: 'Hora do acionamento', t: 'time', half: 1, agora: 1 },
  { id: 'horaChegada', l: 'Hora da chegada', t: 'time', half: 1, agora: 1 },
  { id: 'vtr', l: 'Viatura (prefixo)', half: 1 },
  { id: 'equipe', l: 'Equipe', ph: 'Sd. QPM 1-0 Fulano e Cb. QPM 1-0 Beltrano' }
];
const ENDERECO = ['cep', 'logradouro', 'numero', 'bairro', 'municipio', 'referencia'];
const CHECK_GERAIS = [
  { t: 'Data, hora e endereço da ocorrência', f: d => filled(d.data) && filled(d.hora) && filled(d.logradouro) && filled(d.municipio) },
  { t: 'Equipe e viatura identificadas', f: d => filled(d.equipe) && filled(d.vtr) }
];
const SUG_PADRAO = {
  delegacia: ['Delegacia de Polícia de {municipio}', 'Central de Flagrantes', 'Delegacia da Mulher de {municipio}'],
  consulta: ['nada consta', 'consta mandado de prisão em aberto'],
  cpu: [], destino: []
};
const ESTILOS = [
  { id: 'cron', nome: 'Cronológico', d: 'Narrativa completa, do acionamento ao desfecho' },
  { id: 'obj', nome: 'Objetivo', d: 'Frases curtas, só o essencial' },
  { id: 'circ', nome: 'Circunstanciado', d: 'Mais completo, com enquadramento — flagrante/TCIP' },
  { id: 'top', nome: 'Por tópicos', d: 'Blocos: acionamento, constatação, providências...' }
];

function enderecoTexto(d, ph) {
  if (!filled(d.logradouro) && !filled(d.municipio)) return ph('endereço');
  let t = filled(d.logradouro) ? d.logradouro.trim() : ph('logradouro');
  t += filled(d.numero) ? `, nº ${d.numero.trim()}` : ', s/nº';
  if (filled(d.bairro)) t += `, bairro ${d.bairro.trim()}`;
  t += `, ${filled(d.municipio) ? d.municipio.trim() : ph('município')}/PR`;
  if (filled(d.referencia)) t += ` (${d.referencia.trim()})`;
  return t;
}

/* ------------------------- gerador de texto ------------------------- */
function visiveis(obj, campos) { const o = { ...obj }; for (let k = 0; k < 2; k++) campos.forEach(c => { if (c.show && !c.show(o)) delete o[c.id]; }); return o; }
const dadosVisiveis = (tipo, R) => visiveis(R.d, [...GERAIS, ...(tipo.campos || [])]);
const SEC = { acionamento: 'ACIONAMENTO', constatacao: 'CONSTATAÇÃO', apreensoes: 'APREENSÕES', providencias: 'PROVIDÊNCIAS', encaminhamento: 'ENCAMINHAMENTO', obs: 'INFORMAÇÕES COMPLEMENTARES' };
function classificar(t) {
  if (/voz de prisão|foi(ram)? conduzid|foram conduzid|encaminhad[oa] à|apresentad[oa] à|foi entregue|liberad[oa]/i.test(t)) return 'encaminhamento';
  if (/apreendid|lacre|acionad|orientad|solicitad|preenchid|lavrad|registrad|fotograf|isolad|preservad|guincho|baixa do alerta|determinad/i.test(t)) return 'providencias';
  return 'constatacao';
}
function gerarItens(tipo, R0) {
  const R = { ...R0, d: dadosVisiveis(tipo, R0), mods: (R0.mods || []).map(x => ({ tipo: x.tipo, m: visiveis(x.m, (MODULOS[x.tipo] || { campos: [] }).campos) })).filter(x => MODULOS[x.tipo]) };
  const d = R.d;
  const ph = p => PH_A + p + PH_B;
  const val = (o, id, p) => filled(o[id]) ? String(o[id]).trim().replace(/[.;\s]+$/, '') : ph(p);
  let aprUsada = false;
  const aprItens = () => R.mods.map(x => ({ t: MODULOS[x.tipo].gerar(x.m, h), s: 'apreensoes' }));
  const h = {
    v: (id, p) => val(d, id, p),
    m: (o, id, p) => val(o, id, p),
    p: (t, o = {}) => ({ t, ...o }),
    lista: arr => arr.length < 2 ? arr.join('') : arr.slice(0, -1).join(', ') + ' e ' + arr[arr.length - 1],
    intro() {
      const nat = filled(d.natIni) ? d.natIni.trim() : (tipo.natInicial || ph('natureza'));
      const data = filled(d.data) ? fmtData(d.data) : ph('data');
      const hora = val(d, 'hora', 'hora');
      const eq = val(d, 'equipe', 'equipe'), vtr = val(d, 'vtr', 'prefixo');
      const end = enderecoTexto(d, ph);
      const ac = d.acionamento;
      const como = { 'COPOM (190)': 'foi acionada via COPOM (190)', 'APP 190': 'foi acionada via APP 190', 'Solicitação direta à equipe': `foi solicitada diretamente por ${val(d, 'solicitante', 'solicitante')}`, 'Designação do Oficial CPU': 'foi designada pelo Oficial CPU' }[ac] || 'foi acionada';
      let t, c;
      if (ac === 'Deparou-se em patrulhamento') {
        t = `Na data de ${data}, por volta das ${hora}, a equipe policial militar composta por ${eq}, na viatura ${vtr}, durante patrulhamento, deparou-se com ocorrência de ${nat}, no endereço ${end}.`;
        c = `${data}, ${hora}, ${end}. Equipe da VTR ${vtr} (${eq}), em patrulhamento, deparou-se com ${nat}.`;
      } else {
        t = `Na data de ${data}, por volta das ${hora}, a equipe policial militar composta por ${eq}, na viatura ${vtr}, ${como} para atendimento de ocorrência de ${nat}, no endereço ${end}.`;
        c = `${data}, ${hora}, ${end}. Equipe da VTR ${vtr} (${eq}) ${como.replace('foi ', '')} para ${nat}.`;
      }
      if (filled(d.horaChegada)) { t += ` A equipe chegou ao local às ${d.horaChegada}.`; c += ` Chegada: ${d.horaChegada}.`; }
      return { t, c, s: 'acionamento', intro: true };
    },
    socorro(quem) {
      const s = d.socorro;
      if (!s || s === 'Não foi necessário') return '';
      if (s === 'Recusou atendimento') return `A ${quem} recusou atendimento médico.`;
      if (s.startsWith('Conduzida')) return { t: `A ${quem} foi conduzida pela equipe ao atendimento médico.`, s: 'providencias' };
      return { t: `Foi acionado o ${s.replace(' acionado', '')} para atendimento à ${quem}.`, s: 'providencias' };
    },
    get APREENSOES() { aprUsada = true; return aprItens(); },
    fecho() {
      const p = [];
      if (!aprUsada) p.push(...aprItens());
      if (filled(d.obs)) p.push({ t: d.obs.trim(), s: 'obs' });
      return p;
    }
  };
  let itens = [tipo.gerar(d, h)].flat(3).filter(x => x && (typeof x === 'string' ? filled(x) : filled(x.t)));
  return itens.map(x => typeof x === 'string' ? { t: x } : x).map(x => ({ ...x, t: String(x.t).trim(), s: x.s || (x.intro ? 'acionamento' : classificar(x.t)) }));
}
function limpar(txt) { return txt.replace(/[ \t]+/g, ' ').replace(/ \./g, '.').replace(/\.\.(?!\.)/g, '.').replace(/ ,/g, ','); }
function semCitacoes(t) { return t.replace(/\s?\((?:art\.|arts\.|Lei|Súmula|RE |conforme|Dec|Resolução|Instru)[^()]*\)/g, ''); }
function gerarTexto(tipo, R, estilo) {
  estilo = estilo || R.estilo || 'cron';
  const itens = gerarItens(tipo, R);
  const cen = tipo.cenarios ? tipo.cenarios.find(c => c.id === R.d.cenario) : null;
  let partes;
  if (estilo === 'obj') {
    partes = itens.filter(x => !x.det).map(x => semCitacoes(x.c || x.t));
  } else if (estilo === 'top') {
    const ordem = ['acionamento', 'constatacao', 'apreensoes', 'providencias', 'encaminhamento', 'obs'];
    partes = ordem.map(s => { const g = itens.filter(x => x.s === s); return g.length ? `${SEC[s]}:\n${g.map(x => (s === 'acionamento' ? x.c || x.t : x.t)).join('\n')}` : ''; }).filter(Boolean);
  } else if (estilo === 'circ') {
    partes = [];
    itens.forEach((x, i) => {
      partes.push(x.t);
      if (i === 0 && x.intro && !tipo.semIntro) partes.push('A equipe aproximou-se do local adotando as cautelas de segurança necessárias, procurando confirmar a ocorrência e identificar todos os envolvidos.');
    });
    const fund = tipo.fund ? (tipo.fund[R.d.cenario] || tipo.fund._) : null;
    if (fund) partes.push(fund);
    else if (cen) partes.push(`Os fatos se enquadram, em tese, como ${cen.nat}, cabendo à autoridade competente a análise definitiva.`);
    if (!tipo.semIntro) partes.push('Todos os envolvidos foram devidamente qualificados no campo de Identificação de Envolvidos (I.E.) deste BOU. Nada mais havendo a consignar, encerra-se o presente registro.');
  } else partes = itens.map(x => x.t);
  return limpar(partes.join('\n\n'));
}

function checklist(tipo, R) {
  const d = dadosVisiveis(tipo, R);
  const itens = [...(tipo.semIntro ? [] : CHECK_GERAIS), ...(tipo.check || [])].filter(c => !c.only || c.only(d));
  (R.mods || []).forEach(x => { const M = MODULOS[x.tipo]; if (M) M.check.forEach(t => itens.push({ t: `${M.icone} ${t}`, mod: true })); });
  return itens.map(c => {
    let auto = null;
    if (c.f) auto = typeof c.f === 'function' ? !!c.f(d) : filled(d[c.f]);
    return { ...c, auto, feito: auto !== null ? auto : !!(R.checks || {})[c.t] };
  });
}

/* ------------------------- estado ------------------------- */
let R = null, T = null, aba = 'modelo', geraisOpen = null, abrirRid = null, abrirCen = null;
const extrasAbertos = new Set();
function novoRascunho(tipo) {
  const eq = turno();
  const d = { data: hoje(), hora: agora(), equipe: eq.equipe, vtr: eq.vtr, municipio: eq.municipio || '', acionamento: 'COPOM (190)' };
  if (tipo.cenarios) d.cenario = tipo.cenarios[0].id;
  return { id: 'r' + Date.now().toString(36), tipo: tipo.id, d, mods: (tipo.modulosPadrao || []).map(m => ({ tipo: m, m: {} })), checks: {}, editado: null, estilo: cfg().estilo || 'cron', criado: Date.now(), atualizado: Date.now() };
}
let tSalvar;
function agendarSalvar() { const alvo = R; clearTimeout(tSalvar); tSalvar = setTimeout(() => { salvarRascunho(alvo); if (R === alvo) { try { sessionStorage.setItem('bou.atual', alvo.id); } catch {} } }, 400); }

/* ------------------------- campos ------------------------- */
function nomesPessoas() {
  if (!R) return [];
  const s = new Set();
  const add = (lista, o) => lista.forEach(c => { if (c.p && filled(o[c.id])) s.add(String(o[c.id]).trim()); });
  add([...GERAIS, ...(T.campos || [])], R.d);
  (R.mods || []).forEach(x => MODULOS[x.tipo] && add(MODULOS[x.tipo].campos, x.m));
  return [...s].filter(n => n.length > 1).slice(0, 8);
}
function sugestoes(c, obj) {
  const muni = (R && R.d.municipio) || turno().municipio || '';
  let lista = c.sug || SUG_PADRAO[c.id] || [];
  lista = lista.map(x => x.replace('{municipio}', muni || 'município')).filter(Boolean);
  if (c.p) lista = [...lista, ...nomesPessoas().filter(n => n !== obj[c.id])];
  return [...new Set(lista)];
}
const temVoz = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
function campoHTML(c, obj, scope) {
  const v = obj[c.id];
  const k = `data-s="${scope}" data-k="${c.id}"`;
  const help = c.help ? `<div class="help">${esc(c.help)}</div>` : '';
  if (c.t === 'chk') return `<div class="f"><label class="chk"><input type="checkbox" ${k} ${v ? 'checked' : ''}><span>${esc(c.l)}</span></label>${help}</div>`;
  if (c.t === 'multi') {
    const arr = Array.isArray(v) ? v : [];
    return `<div class="f"><label>${esc(c.l)}</label><div class="chips">${c.o.map(o => `<button type="button" class="${arr.includes(o) ? 'on' : ''}" data-multi="${esc(o)}" ${k}>${esc(o)}</button>`).join('')}</div>${help}</div>`;
  }
  if (c.t === 'sel' || c.t === 'chips1') {
    // opções curtas viram botões (1 toque); listas longas ficam como seleção
    if (c.o.length <= 6 || c.t === 'chips1') return `<div class="f"><label>${esc(c.l)}</label><div class="chips">${c.o.map(o => `<button type="button" class="${o === v ? 'on' : ''}" data-one="${esc(o)}" ${k}>${esc(o)}</button>`).join('')}</div>${help}</div>`;
    return `<div class="f"><label>${esc(c.l)}</label><select ${k}><option value="">— selecione —</option>${c.o.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>${help}</div>`;
  }
  let inp;
  const mic = temVoz && (c.t === 'area') ? `<button type="button" class="mic" data-mic="${c.id}" data-ms="${scope}" title="Ditar">🎤</button>` : '';
  if (c.t === 'area') inp = `<textarea ${k} placeholder="${esc(c.ph || (temVoz ? 'Digite ou toque em 🎤 para ditar' : ''))}">${esc(v || '')}</textarea>`;
  else {
    const ty = { num: 'number', date: 'date', time: 'time' }[c.t] || 'text';
    inp = `<input type="${ty}" ${ty === 'number' ? 'inputmode="decimal"' : ''} ${k} value="${esc(v || '')}" placeholder="${esc(c.ph || '')}">`;
  }
  const ag = c.agora ? `<button type="button" class="mini" data-agora="${c.id}" data-ms="${scope}">agora</button>` : '';
  const sug = !filled(v) && c.t !== 'date' && c.t !== 'time' ? sugestoes(c, obj) : [];
  const sugHTML = sug.length ? `<div class="sug">${sug.map(x => `<button type="button" data-sug="${esc(x)}" data-ms="${scope}" data-sk="${c.id}">${esc(x)}</button>`).join('')}</div>` : '';
  return `<div class="f"><label>${esc(c.l)}${mic}${ag}</label>${inp}${sugHTML}${help}</div>`;
}
function camposHTML(lista, obj, scope, chave) {
  const vis = lista.filter(c => !c.show || c.show(obj));
  const essenciais = vis.filter(c => !c.x), extras = vis.filter(c => c.x);
  const bloco = arr => { let html = '', i = 0; while (i < arr.length) { const c = arr[i]; if (c.half && arr[i + 1] && arr[i + 1].half) { html += `<div class="row2">${campoHTML(c, obj, scope)}${campoHTML(arr[i + 1], obj, scope)}</div>`; i += 2; } else { html += campoHTML(c, obj, scope); i++; } } return html; };
  let html = bloco(essenciais);
  if (extras.length) {
    const n = extras.filter(c => filled(obj[c.id])).length;
    html += `<details class="extras" data-ext="${chave}" ${extrasAbertos.has(chave) ? 'open' : ''}><summary>Mais detalhes (${extras.length})${n ? ` • ${n} preenchido(s)` : ''}</summary>${bloco(extras)}</details>`;
  }
  return html;
}
function assinaturaVisivel() {
  const s = [GERAIS, T.campos || []].map(l => l.filter(c => !c.show || c.show(R.d)).map(c => c.id + (filled(R.d[c.id]) ? '1' : '0')).join(','));
  (R.mods || []).forEach(x => MODULOS[x.tipo] && s.push(MODULOS[x.tipo].campos.filter(c => !c.show || c.show(x.m)).map(c => c.id + (filled(x.m[c.id]) ? '1' : '0')).join(',')));
  return s.join('|');
}
function enderecoHTML(d) {
  const f = (id, l, ph, extra = '') => `<div class="f"><label>${l}</label><input type="text" data-s="d" data-k="${id}" value="${esc(d[id] || '')}" placeholder="${esc(ph)}" ${extra}></div>`;
  return `<div class="endbox"><div class="row-cep"><div class="f"><label>CEP</label><input type="text" inputmode="numeric" maxlength="9" data-s="d" data-k="cep" value="${esc(d.cep || '')}" placeholder="00000-000"></div><button type="button" class="btn sm" id="buscaCep">Buscar CEP</button><button type="button" class="btn sm gold" id="gps">📍 Estou no local</button></div>
    <div class="row2">${f('logradouro', 'Logradouro', 'Rua, avenida...')}${f('numero', 'Número', 's/nº', 'inputmode="numeric"')}</div>
    <div class="row2">${f('bairro', 'Bairro', '')}${f('municipio', 'Município', 'digite para buscar', 'list="munis" autocomplete="off"')}</div>
    ${f('referencia', 'Referência / complemento', 'em frente ao mercado...')}</div>`;
}

/* ------------------------- telas ------------------------- */
function setTop(titulo, sub, voltar, pop) {
  top.innerHTML = `${voltar ? '<button class="back" aria-label="Voltar" onclick="location.hash=\'#inicio\'">‹</button>' : ''}<h1>${esc(titulo)}${sub ? `<small>${esc(sub)}</small>` : ''}</h1>${pop ? `<span class="pop">${esc(pop)}</span>` : ''}`;
  requestAnimationFrame(() => document.documentElement.style.setProperty('--toph', top.offsetHeight + 'px'));
}
window.addEventListener('resize', () => document.documentElement.style.setProperty('--toph', top.offsetHeight + 'px'));
function setNav(n) {
  const nav = $('#nav'); nav.hidden = false;
  nav.innerHTML = `<a href="#inicio" data-n="home"><span>📋</span>Ocorrências</a><a href="#rascunhos" data-n="rasc"><span>📝</span>Rascunhos</a><a href="#equipe" data-n="equipe"><span>👮</span>Turno</a>${ehAdmin() ? '<a href="#admin" data-n="admin"><span>🛡️</span>Admin</a>' : ''}`;
  nav.querySelectorAll('a').forEach(a => a.classList.toggle('on', a.dataset.n === n));
}
function semNav() { $('#nav').hidden = true; document.querySelectorAll('.fab').forEach(f => f.remove()); }

function telaHome() {
  setTop('Descritivo BOU', 'Modelos, indispensáveis e dicas — POPs PMPR');
  setNav('home');
  const q = sessionStorage.getItem('bou.q') || '';
  const eq = turno();
  const turnoHTML = eq.equipe && eq.vtr
    ? `<a class="turno" href="#equipe"><span>👮 <b>VTR ${esc(eq.vtr)}</b> • ${esc(eq.equipe)}${eq.municipio ? ' • ' + esc(eq.municipio) : ''}</span><span class="mut">alterar</span></a>`
    : `<a class="turno vazio" href="#equipe"><span>👮 <b>Assuma o turno:</b> informe equipe e viatura uma vez e elas entram em todos os BOs.</span><span>›</span></a>`;
  app.innerHTML = `${turnoHTML}<div class="search"><span>🔎</span><input id="q" type="search" placeholder="Buscar ocorrência, natureza ou POP..." value="${esc(q)}"></div><div id="lista"></div>
  <p class="aviso">Ferramenta de apoio. Não substitui os POPs, diretrizes e o julgamento do policial. Confira tudo antes de lançar no BOU.</p>`;
  const lista = $('#lista');
  function desenhar() {
    const termo = norm($('#q').value.trim());
    sessionStorage.setItem('bou.q', $('#q').value);
    let html = '';
    if (termo.length >= 3) {
      const nats = [];
      TIPOS.forEach(t => (t.cenarios || []).forEach(c => { if (norm(c.nat + ' ' + c.nome).includes(termo)) nats.push({ t, c }); }));
      if (nats.length) html += `<h2 class="cat">Naturezas</h2><div class="card natlist">${nats.slice(0, 12).map(({ t, c }) => `<a href="#t-${t.id}" data-cen="${c.id}" class="natlink"><b>${esc(c.nat)}</b><br><span>${t.icone} ${esc(t.nome)} › ${esc(c.nome)}</span></a>`).join('')}</div>`;
    }
    const cats = [...CATEGORIAS];
    cats.forEach(cat => {
      const ts = TIPOS.filter(t => t.cat === cat.id && !t.soDicas && (!termo || norm(`${t.nome} ${t.resumo} ${t.pop} ${(t.cenarios || []).map(c => c.nome).join(' ')}`).includes(termo)));
      if (!ts.length) return;
      html += `<h2 class="cat">${esc(cat.nome)}</h2><div class="grid">${ts.map(t => `<a class="tcard" href="#t-${t.id}"><div class="ic">${t.icone}</div><div><b>${esc(t.nome)}</b><small>${esc(t.resumo)}</small></div><span class="pop">${esc(t.pop)}</span></a>`).join('')}</div>`;
    });
    lista.innerHTML = html || '<div class="empty">Nada encontrado.</div>';
    lista.querySelectorAll('[data-cen]').forEach(a => a.addEventListener('click', () => { abrirCen = a.dataset.cen; }));
  }
  $('#q').addEventListener('input', desenhar);
  desenhar();
}

function telaTipo(id, rid) {
  T = tipoPorId(id);
  if (!T) { location.hash = '#inicio'; return; }
  if (rid) { const x = rascunhos().find(y => y.id === rid) || (R && R.id === rid ? R : null); R = x && x.tipo === T.id ? x : (R && R.tipo === T.id ? R : null); }
  else if (R && R.tipo !== T.id) R = null;
  if (!R || abrirCen) { R = R && !abrirCen ? R : novoRascunho(T); }
  if (abrirCen) { R.d.cenario = abrirCen; abrirCen = null; }
  if (!R.estilo) R.estilo = cfg().estilo || 'cron';
  geraisOpen = null; extrasAbertos.clear();
  const abas = abasDisponiveis();
  if (!abas.find(a => a[0] === aba)) aba = abas[0][0];
  setTop(T.nome, T.resumo, true, T.pop);
  setNav('');
  desenharTipo();
}
function abasDisponiveis() {
  const a = [];
  if (pode('gerar') && !T.soDicas) a.push(['modelo', 'Modelo']);
  a.push(['check', 'Indispensáveis']);
  if (pode('dicas')) a.push(['dicas', 'Dicas']);
  return a;
}
function desenharTipo() {
  const lst = checklist(T, R);
  const pend = lst.filter(c => !c.feito).length;
  const tabs = abasDisponiveis().map(([k, l]) => [k, k === 'check' ? `${l} <span class="badge ${pend ? '' : 'ok'}">${pend || '✓'}</span>` : l]);
  app.innerHTML = `${T.aviso ? `<div class="aviso2">${esc(T.aviso)}</div>` : ''}<div class="tabs">${tabs.map(([k, l]) => `<button data-aba="${k}" class="${aba === k ? 'on' : ''}">${l}</button>`).join('')}</div><div id="conteudo"></div>`;
  app.querySelectorAll('[data-aba]').forEach(b => b.onclick = () => { aba = b.dataset.aba; desenharTipo(); window.scrollTo(0, 0); });
  document.querySelectorAll('.fab').forEach(f => f.remove());
  const c = $('#conteudo');
  if (aba === 'modelo') abaModelo(c); else if (aba === 'check') abaCheck(c, lst); else abaDicas(c);
}

function abaModelo(c0) {
  const c = c0.cloneNode(false); c0.replaceWith(c);
  const d = R.d;
  const cen = T.cenarios ? T.cenarios.find(x => x.id === d.cenario) : null;
  const geraisPreench = ['data', 'hora', 'logradouro', 'municipio', 'equipe', 'vtr'].every(k => filled(d[k]));
  if (geraisOpen === null) geraisOpen = !geraisPreench;
  let html = '';
  if (T.cenarios) html += `<div class="card"><h3>Qual a situação?</h3><div class="chips">${T.cenarios.map(x => `<button data-cenario="${x.id}" class="${x.id === d.cenario ? 'on' : ''}">${esc(x.nome)}</button>`).join('')}</div>${cen ? `<div class="nat">Natureza sugerida: <b>${esc(cen.nat)}</b></div>` : ''}</div>`;
  if (!T.semIntro) html += `<details class="card" id="gerais" ${geraisOpen ? 'open' : ''}><summary>📍 Local, data e equipe <span class="sumhint">${geraisPreench ? esc([d.logradouro, d.municipio].filter(Boolean).join(', ').slice(0, 38)) : 'preencha'}</span></summary>${enderecoHTML(d)}${camposHTML(GERAIS, d, 'd', 'gerais')}</details>`;
  if (T.campos && T.campos.length) html += `<div class="card"><h3>${T.icone} Detalhes da ocorrência</h3>${camposHTML(T.campos, d, 'd', 'tipo')}</div>`;
  (R.mods || []).forEach((x, i) => {
    const M = MODULOS[x.tipo]; if (!M) return;
    html += `<div class="card"><h3>${M.icone} ${esc(M.nome)} <span class="pop">POP ${esc(M.pop)}</span><button class="x" data-rm="${i}">remover</button></h3>${camposHTML(M.campos, x.m, 'm' + i, 'm' + i)}</div>`;
  });
  if (!T.semIntro) {
    const fr = frases();
    html += `<div class="card"><h3>📦 Apreensões (cadeia de custódia)</h3><div class="addmods">${Object.entries(MODULOS).map(([k, M]) => `<button data-add="${k}">+ ${M.icone} ${esc(M.nome)}</button>`).join('')}</div></div>
    <div class="card"><h3>➕ Informações complementares</h3>${campoHTML({ id: 'obs', l: 'Texto livre (entra no final)', t: 'area' }, d, 'd')}
      <div class="frases"><div class="sumhint" style="margin-bottom:6px">Frases prontas — toque para inserir:</div><div class="sug">${fr.map((f, i) => `<span class="fr"><button type="button" data-frase="${i}">${esc(f.length > 60 ? f.slice(0, 58) + '…' : f)}</button><button type="button" class="frx" data-frx="${i}" aria-label="apagar">×</button></span>`).join('') || '<span class="sumhint">nenhuma ainda</span>'}</div>
      <button type="button" class="btn sm" id="salvaFrase" style="margin-top:8px">＋ Salvar o texto livre como frase pronta</button></div></div>`;
  }
  html += `<div class="card" id="saida"><h3>📄 Descrição sumária</h3>
    <div class="estilos">${ESTILOS.map(e => `<button data-estilo="${e.id}" class="${(R.estilo || 'cron') === e.id ? 'on' : ''}" title="${esc(e.d)}">${esc(e.nome)}</button>`).join('')}</div>
    <div class="sumhint" id="estiloDesc" style="margin:6px 0 8px">${esc((ESTILOS.find(e => e.id === (R.estilo || 'cron')) || ESTILOS[0]).d)}</div>
    <div class="out" id="out"></div><div class="pend" id="pend"></div>
    <div class="actions"><button class="btn pri" id="copiar">Copiar texto</button>${navigator.share && window.top === window ? '<button class="btn" id="compart">Compartilhar</button>' : ''}<button class="btn" id="editar">${R.editado != null ? 'Voltar ao automático' : 'Editar à mão'}</button><button class="btn red" id="limpar">Novo BO</button></div></div>`;
  c.innerHTML = html;
  document.querySelectorAll('.fab').forEach(f => f.remove());
  const fab = document.createElement('button'); fab.className = 'fab'; fab.textContent = '📄 Ver texto';
  fab.onclick = () => $('#saida').scrollIntoView({ behavior: 'smooth' });
  document.body.appendChild(fab);
  ligarModelo(c);
  const g = c.querySelector('#gerais'); if (g) g.addEventListener('toggle', () => { geraisOpen = g.open; });
  c.querySelectorAll('details[data-ext]').forEach(x => x.addEventListener('toggle', () => { x.open ? extrasAbertos.add(x.dataset.ext) : extrasAbertos.delete(x.dataset.ext); }));
  atualizarSaida();
}

function atualizarSaida() {
  const out = $('#out'); if (!out) return;
  if (R.editado != null) {
    out.innerHTML = `<textarea id="manual">${esc(R.editado)}</textarea>`;
    $('#manual').oninput = e => { R.editado = e.target.value; agendarSalvar(); };
    $('#pend').className = 'pend'; $('#pend').textContent = 'Edição manual: alterações nos campos não atualizam este texto.';
  } else {
    const txt = gerarTexto(T, R);
    out.innerHTML = esc(txt).replace(/⟦([^⟧]*)⟧/g, '<mark>[$1]</mark>');
    const n = (txt.match(/⟦/g) || []).length;
    const p = $('#pend'); p.className = 'pend' + (n ? '' : ' ok');
    p.textContent = n ? `⚠ ${n} informação(ões) pendente(s) destacada(s) no texto.` : '✓ Sem lacunas no texto. Revise antes de lançar.';
  }
  const lst = checklist(T, R), pend = lst.filter(x => !x.feito).length;
  const b = document.querySelector('[data-aba="check"] .badge'); if (b) { b.textContent = pend || '✓'; b.className = 'badge' + (pend ? '' : ' ok'); }
}
const textoFinal = () => R.editado != null ? R.editado : gerarTexto(T, R).replace(/⟦([^⟧]*)⟧/g, '[$1]');

function rerender() {
  const foco = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.k ? [document.activeElement.dataset.s, document.activeElement.dataset.k, document.activeElement.selectionStart, document.activeElement.tagName] : null;
  const y = window.scrollY;
  abaModelo($('#conteudo'));
  window.scrollTo(0, y);
  if (foco && foco[3] !== 'BUTTON') { const f = document.querySelector(`[data-s="${foco[0]}"][data-k="${foco[1]}"]`); if (f && f.type !== 'checkbox') { f.focus({ preventScroll: true }); try { f.setSelectionRange(foco[2], foco[2]); } catch {} } }
}
function ligarModelo(c) {
  const objDe = s => s === 'd' ? R.d : R.mods[Number(s.slice(1))].m;
  const mudou = (forcar) => {
    agendarSalvar();
    const depois = assinaturaVisivel();
    if (forcar || c._sig !== depois) rerender(); else atualizarSaida();
  };
  c._sig = assinaturaVisivel();
  c.addEventListener('input', e => {
    const el = e.target; if (!el.dataset || !el.dataset.k || el.type === 'checkbox' || el.tagName === 'SELECT') return;
    let v = el.value;
    if (el.dataset.k === 'cep') { v = v.replace(/\D/g, '').slice(0, 8); if (v.length > 5) v = v.slice(0, 5) + '-' + v.slice(5); el.value = v; }
    objDe(el.dataset.s)[el.dataset.k] = v;
    if (el.dataset.k === 'cep' && v.length === 9) buscarCep();
    mudou(false);
  });
  c.addEventListener('change', e => {
    const el = e.target; if (!el.dataset || !el.dataset.k) return;
    if (el.type === 'checkbox') { objDe(el.dataset.s)[el.dataset.k] = el.checked; mudou(true); }
    else if (el.tagName === 'SELECT') { objDe(el.dataset.s)[el.dataset.k] = el.value; mudou(true); }
    else if (el.dataset.k === 'municipio') { const t = turno(); if (filled(el.value) && !t.municipio) { t.municipio = el.value; LS.set(uidKey('equipe'), t); } }
  });
  c.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.one !== undefined) { const o = objDe(b.dataset.s); o[b.dataset.k] = o[b.dataset.k] === b.dataset.one ? '' : b.dataset.one; mudou(true); return; }
    if (b.dataset.multi !== undefined) { const o = objDe(b.dataset.s); const arr = Array.isArray(o[b.dataset.k]) ? o[b.dataset.k] : []; o[b.dataset.k] = arr.includes(b.dataset.multi) ? arr.filter(x => x !== b.dataset.multi) : [...arr, b.dataset.multi]; mudou(true); return; }
    if (b.dataset.sug !== undefined) { objDe(b.dataset.ms)[b.dataset.sk] = b.dataset.sug; mudou(true); return; }
    if (b.dataset.agora) { objDe(b.dataset.ms)[b.dataset.agora] = agora(); mudou(true); return; }
    if (b.dataset.mic) { ditar(b); return; }
    if (b.dataset.cenario) { R.d.cenario = b.dataset.cenario; mudou(true); return; }
    if (b.dataset.estilo) { R.estilo = b.dataset.estilo; const cf = cfg(); cf.estilo = R.estilo; LS.set(uidKey('config'), cf); agendarSalvar(); c.querySelectorAll('[data-estilo]').forEach(x => x.classList.toggle('on', x === b)); $('#estiloDesc').textContent = ESTILOS.find(x => x.id === R.estilo).d; atualizarSaida(); return; }
    if (b.dataset.add) { R.mods.push({ tipo: b.dataset.add, m: {} }); toast(`${MODULOS[b.dataset.add].nome} adicionado`); mudou(true); return; }
    if (b.dataset.rm !== undefined) { if (!await confirmar('Remover esta apreensão?', 'Remover')) return; R.mods.splice(Number(b.dataset.rm), 1); mudou(true); return; }
    if (b.dataset.frase !== undefined) { const f = frases()[Number(b.dataset.frase)]; R.d.obs = (filled(R.d.obs) ? R.d.obs.trim() + ' ' : '') + f; mudou(true); return; }
    if (b.dataset.frx !== undefined) { if (!await confirmar('Apagar esta frase pronta?', 'Apagar')) return; const fr = frases(); fr.splice(Number(b.dataset.frx), 1); LS.set(uidKey('frases'), fr); rerender(); return; }
    if (b.id === 'salvaFrase') { if (!filled(R.d.obs)) { toast('Escreva o texto livre primeiro'); return; } const fr = frases(); fr.unshift(R.d.obs.trim()); LS.set(uidKey('frases'), [...new Set(fr)].slice(0, 30)); toast('Frase salva'); rerender(); return; }
    if (b.id === 'buscaCep') { buscarCep(true); return; }
    if (b.id === 'gps') { usarGPS(b); return; }
  });
  $('#copiar').onclick = async () => {
    const txt = textoFinal();
    const n = (txt.match(/\[[^\]]+\]/g) || []).length;
    const falt = checklist(T, R).filter(x => !x.feito && x.auto === false).map(x => x.t);
    if ((R.editado == null && n) || falt.length) {
      const msg = `${R.editado == null && n ? `<p>Há <b>${n}</b> lacuna(s) [entre colchetes] no texto.</p>` : ''}${falt.length ? `<p>Itens indispensáveis não preenchidos:</p><ul>${falt.slice(0, 6).map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}<p>Copiar mesmo assim?</p>`;
      if (!await confirmar(msg, 'Copiar', true)) return;
    }
    try { await navigator.clipboard.writeText(txt); toast('Texto copiado ✓'); }
    catch { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('Texto copiado ✓'); }
    salvarRascunho(R);
  };
  if ($('#compart')) $('#compart').onclick = () => navigator.share({ text: textoFinal() }).catch(() => {});
  $('#editar').onclick = async () => {
    if (R.editado != null) { if (!await confirmar('Descartar a edição manual e voltar ao texto automático?', 'Descartar')) return; R.editado = null; }
    else R.editado = textoFinal();
    agendarSalvar(); rerender(); if (R.editado != null) $('#saida').scrollIntoView();
  };
  $('#limpar').onclick = async () => { if (!await confirmar('Começar um novo BO deste tipo? O atual fica salvo em Rascunhos.', 'Novo BO')) return; salvarRascunho(R); R = novoRascunho(T); geraisOpen = null; try { sessionStorage.removeItem('bou.atual'); } catch {} desenharTipo(); window.scrollTo(0, 0); };
}

/* CEP, GPS e voz */
async function buscarCep(manual) {
  const cep = String(R.d.cep || '').replace(/\D/g, '');
  if (cep.length !== 8) { if (manual) toast('Digite os 8 números do CEP'); return; }
  try {
    const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    const j = await r.json();
    if (j.erro) { toast('CEP não encontrado'); return; }
    if (j.logradouro) R.d.logradouro = j.logradouro;
    if (j.bairro) R.d.bairro = j.bairro;
    if (j.localidade) R.d.municipio = j.localidade;
    if (j.uf && j.uf !== 'PR') toast(`Atenção: CEP de ${j.localidade}/${j.uf}`); else toast('Endereço preenchido — complete o número');
    agendarSalvar(); rerender();
    const n = document.querySelector('[data-k="numero"]'); if (n && !filled(R.d.numero)) n.focus();
  } catch { toast('Sem conexão para buscar o CEP — preencha à mão'); }
}
function usarGPS(btn) {
  if (!navigator.geolocation) { toast('GPS indisponível neste aparelho'); return; }
  btn.disabled = true; btn.textContent = '📍 Localizando...';
  navigator.geolocation.getCurrentPosition(async pos => {
    const { latitude: la, longitude: lo } = pos.coords;
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${la}&lon=${lo}&accept-language=pt-BR&addressdetails=1`);
      const j = await r.json(); const a = j.address || {};
      R.d.logradouro = a.road || a.pedestrian || a.footway || R.d.logradouro || '';
      if (a.house_number) R.d.numero = a.house_number;
      R.d.bairro = a.suburb || a.neighbourhood || a.quarter || a.city_district || R.d.bairro || '';
      R.d.municipio = a.city || a.town || a.village || a.municipality || R.d.municipio || '';
      if (a.postcode) R.d.cep = a.postcode;
      R.d.coords = `${la.toFixed(6)}, ${lo.toFixed(6)}`;
      toast('Endereço aproximado preenchido — confira o número');
    } catch { R.d.referencia = `coordenadas ${la.toFixed(6)}, ${lo.toFixed(6)}`; toast('Sem conexão: coordenadas registradas na referência'); }
    agendarSalvar(); rerender();
  }, () => { toast('Não foi possível obter a localização (permita o GPS)'); btn.disabled = false; btn.textContent = '📍 Estou no local'; }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
}
function ditar(btn) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return;
  const rec = new SR(); rec.lang = 'pt-BR'; rec.interimResults = false; rec.continuous = false;
  const o = btn.dataset.ms === 'd' ? R.d : R.mods[Number(btn.dataset.ms.slice(1))].m;
  btn.classList.add('rec'); btn.textContent = '⏺';
  rec.onresult = ev => { const t = Array.from(ev.results).map(r => r[0].transcript).join(' '); o[btn.dataset.mic] = (filled(o[btn.dataset.mic]) ? o[btn.dataset.mic].trim() + ' ' : '') + t; agendarSalvar(); rerender(); };
  rec.onerror = () => toast('Não entendi — tente de novo');
  rec.onend = () => { btn.classList.remove('rec'); btn.textContent = '🎤'; };
  rec.start();
}

function abaCheck(c, lst) {
  const pend = lst.filter(x => !x.feito).length;
  c.innerHTML = `<div class="card"><h3>✅ Itens indispensáveis <span class="sumhint">${lst.length - pend}/${lst.length}</span></h3>
  <ul class="cl">${lst.map(i => i.auto !== null
    ? `<li><span class="st ${i.feito ? 'ok' : 'no'}">${i.feito ? '✓' : '!'}</span><div class="${i.feito ? 'done' : ''}">${esc(i.t)}<small>${i.feito ? 'preenchido no modelo' : (pode('gerar') ? 'preencha na aba Modelo' : 'pendente')}</small></div></li>`
    : `<li><input type="checkbox" data-ck="${esc(i.t)}" ${i.feito ? 'checked' : ''}><div class="${i.feito ? 'done' : ''}">${esc(i.t)}</div></li>`).join('')}</ul></div>
  <p class="aviso">Itens com ✓/! são conferidos pelo que você preencheu. Os demais, marque ao cumprir.</p>`;
  c.querySelectorAll('[data-ck]').forEach(b => b.onchange = () => { R.checks = R.checks || {}; R.checks[b.dataset.ck] = b.checked; agendarSalvar(); desenharTipo(); });
}
function abaDicas(c) {
  const D = T.dicas || {};
  let html = '';
  if (D.alerta) html += `<div class="alerta"><b>⚠ Atenção</b>${esc(D.alerta)}</div>`;
  (D.secoes || []).forEach(s => { html += `<div class="card"><h3>${esc(s.t)}</h3><ul class="dl">${s.i.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`; });
  if (T.cenarios) html += `<div class="card"><h3>📑 Naturezas por situação</h3><div class="natlist">${T.cenarios.map(x => `<div><b>${esc(x.nome)}</b><br><span>${esc(x.nat)}</span></div>`).join('')}</div></div>`;
  if (D.erros) html += `<div class="card"><h3>🚫 Erros a evitar</h3><ul class="dl erros">${D.erros.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
  if (D.contatos) html += `<div class="card"><h3>📞 Contatos</h3><ul class="dl">${D.contatos.map(x => `<li>${esc(x).replace(/(\(?\d{2}\)?\s?\d{4}-\d{4}|0800[\s-]?\d{3}[\s-]?\d{4}|\b1[89]\d\b)/g, m => `<a href="tel:${m.replace(/\D/g, '')}">${m}</a>`)}</li>`).join('')}</ul></div>`;
  html += `<p class="aviso">Resumo de ${esc(T.pop)}. Em caso de dúvida, consulte o documento original e o Oficial CPU.</p>`;
  c.innerHTML = html;
}

function telaRascunhos() {
  setTop('Rascunhos', `Só neste aparelho • apagados após ${cfg().expira || '∞'} dia(s)`);
  setNav('rasc');
  const r = rascunhos().filter(x => tipoPorId(x.tipo));
  if (!r.length) { app.innerHTML = '<div class="empty">Nenhum rascunho.<br><br>Os BOs que você preencher ficam salvos aqui automaticamente.</div>'; return; }
  app.innerHTML = `<div class="grid rlist">${r.map(x => { const t = tipoPorId(x.tipo); const cen = t.cenarios ? (t.cenarios.find(c => c.id === x.d.cenario) || {}).nome : ''; return `<div class="tcard" data-open="${x.id}"><div class="ic">${t.icone}</div><div style="min-width:0"><b>${esc(t.nome)}</b><small>${esc([cen, x.d.logradouro, x.d.municipio].filter(Boolean).join(' • ') || 'sem endereço')}</small><small>${fmtQuando(x.atualizado)}</small></div><button class="btn red sm" data-del="${x.id}" style="margin-left:auto">Apagar</button></div>`; }).join('')}</div>
  <div class="actions" style="justify-content:center;margin-top:18px"><button class="btn red" id="apagarTodos">Apagar todos</button></div>`;
  app.querySelectorAll('[data-open]').forEach(el => el.onclick = e => { if (e.target.dataset.del) return; const x = r.find(y => y.id === el.dataset.open); abrirRid = x.id; aba = 'modelo'; if (location.hash === '#t-' + x.tipo) rota(); else location.hash = '#t-' + x.tipo; });
  app.querySelectorAll('[data-del]').forEach(b => b.onclick = async e => { e.stopPropagation(); if (await confirmar('Apagar este rascunho?', 'Apagar')) { apagarRascunho(b.dataset.del); telaRascunhos(); } });
  $('#apagarTodos').onclick = async () => { if (await confirmar('Apagar TODOS os rascunhos deste aparelho?', 'Apagar todos')) { LS.set(uidKey('rascunhos'), []); telaRascunhos(); } };
}

let promptInstalar = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); promptInstalar = e; });
function telaEquipe() {
  setTop('Turno e ajustes', 'Preenchidos automaticamente em cada BO novo');
  setNav('equipe');
  const eq = turno(), cf = cfg();
  app.innerHTML = `<div class="card"><h3>👮 Turno de serviço</h3>
    ${campoHTML({ id: 'equipe', l: 'Composição da equipe', ph: 'Sd. QPM 1-0 Fulano e Cb. QPM 1-0 Beltrano' }, eq, 'eq')}
    <div class="row2">${campoHTML({ id: 'vtr', l: 'Viatura (prefixo)' }, eq, 'eq')}${campoHTML({ id: 'opm', l: 'OPM' }, eq, 'eq')}</div>
    <div class="f"><label>Município de atuação</label><input type="text" list="munis" data-s="eq" data-k="municipio" value="${esc(eq.municipio || '')}" placeholder="digite para buscar"></div>
    <div class="sumhint">Salvo automaticamente.</div></div>
  <div class="card"><h3>📝 Estilo de texto padrão</h3><div class="chips">${ESTILOS.map(e => `<button data-est="${e.id}" class="${cf.estilo === e.id ? 'on' : ''}">${esc(e.nome)}</button>`).join('')}</div></div>
  <div class="card"><h3>🔒 Privacidade</h3>
    <div class="f"><label>Apagar rascunhos automaticamente após</label><select id="expira">${[['1', '1 dia'], ['3', '3 dias'], ['7', '7 dias'], ['15', '15 dias'], ['30', '30 dias'], ['0', 'nunca']].map(([v, l]) => `<option value="${v}" ${String(cf.expira) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="sumhint">Rascunhos e frases ficam apenas neste aparelho. Evite manter nomes de vítimas por muito tempo.</div></div>
  <div class="card"><h3>👤 Conta</h3><p style="margin:0 0 10px;font-size:14px">${esc(perfil ? perfil.nome || '' : '')}<br><span class="sumhint">${esc(usuario ? usuario.email : 'modo local (sem Firebase)')}</span></p>
    <div class="actions"><button class="btn" id="recarregar">Atualizar modelos</button>${usuario ? '<button class="btn red" id="sair">Sair</button>' : ''}</div></div>
  <div class="card"><h3>📲 Instalar</h3><p style="margin:0 0 10px;font-size:14px">Android: menu ⋮ → "Instalar app". iPhone: Safari → Compartilhar → "Adicionar à Tela de Início".</p><button class="btn gold" id="instalar">Instalar na tela inicial</button></div>
  <p class="aviso">Descritivo BOU v${VERSAO} • ${TIPOS.length} fichas disponíveis para você.</p>`;
  app.oninput = e => { const el = e.target; if (el.dataset.s === 'eq') { const x = turno(); x[el.dataset.k] = el.value; LS.set(uidKey('equipe'), x); } };
  app.querySelectorAll('[data-est]').forEach(b => b.onclick = () => { const x = cfg(); x.estilo = b.dataset.est; LS.set(uidKey('config'), x); telaEquipe(); toast('Estilo padrão salvo'); });
  $('#expira').onchange = e => { const x = cfg(); x.expira = Number(e.target.value); LS.set(uidKey('config'), x); toast('Ajuste salvo'); };
  $('#instalar').onclick = () => { if (promptInstalar) { promptInstalar.prompt(); promptInstalar = null; } else toast('Use o menu do navegador para instalar.'); };
  $('#recarregar').onclick = async () => { try { await carregarConteudo(true); toast('Modelos atualizados'); telaEquipe(); } catch { toast('Não foi possível atualizar agora'); } };
  if ($('#sair')) $('#sair').onclick = async () => { if (await confirmar('Sair da conta neste aparelho?', 'Sair')) { await auth.signOut(); } };
}

/* ------------------------- administrador ------------------------- */
async function telaAdmin() {
  if (!ehAdmin()) { location.hash = '#inicio'; return; }
  setTop('Administração', 'Usuários, permissões e conteúdo');
  setNav('admin');
  if (!TEM_FIREBASE) { app.innerHTML = '<div class="empty">Firebase não configurado.</div>'; return; }
  app.innerHTML = '<div class="empty">Carregando usuários...</div>';
  let users = [], cont = {};
  try {
    const snap = await db.collection('usuarios').get();
    users = snap.docs.map(x => ({ uid: x.id, ...x.data() }));
    const cs = await db.collection('conteudo').get();
    cs.docs.forEach(x => { cont[x.id] = x.data(); });
  } catch (e) { app.innerHTML = `<div class="empty">Erro ao carregar: ${esc(e.message)}</div>`; return; }
  const ordem = { pendente: 0, ativo: 1, bloqueado: 2 };
  users.sort((a, b) => (ordem[a.status] ?? 3) - (ordem[b.status] ?? 3) || (a.nome || '').localeCompare(b.nome || ''));
  const pend = users.filter(u => u.status === 'pendente').length;
  const cats = Object.keys(NOMES_CAT);
  const cardU = u => {
    const p = { ...PERMS_PADRAO, ...(u.perms || {}) };
    const eu = usuario && u.uid === usuario.uid;
    return `<div class="card ucard st-${esc(u.status)}" data-uid="${u.uid}">
      <div class="uhead"><div><b>${esc(u.nome || '(sem nome)')}</b><br><span class="sumhint">${esc(u.email || '')}${u.opm ? ' • ' + esc(u.opm) : ''}${u.rg ? ' • RG ' + esc(u.rg) : ''}</span></div><span class="stag">${esc(u.status)}</span></div>
      <div class="chips" style="margin:10px 0">${['ativo', 'pendente', 'bloqueado'].map(s => `<button data-st="${s}" class="${u.status === s ? 'on' : ''}" ${eu ? 'disabled' : ''}>${{ ativo: '✓ Aprovado', pendente: '⏳ Pendente', bloqueado: '⛔ Bloqueado' }[s]}</button>`).join('')}</div>
      <details ${u.status === 'pendente' ? 'open' : ''}><summary class="sumhint">Permissões</summary>
        <div class="perms">${cats.map(cid => `<label class="chk"><input type="checkbox" data-cat="${cid}" ${p.cats.includes(cid) ? 'checked' : ''}><span>${esc(NOMES_CAT[cid])}</span></label>`).join('')}
        <label class="chk"><input type="checkbox" data-perm="gerar" ${p.gerar ? 'checked' : ''}><span>Gerar texto (aba Modelo)</span></label>
        <label class="chk"><input type="checkbox" data-perm="dicas" ${p.dicas ? 'checked' : ''}><span>Ver dicas</span></label>
        <label class="chk"><input type="checkbox" data-perm="admin" ${p.admin ? 'checked' : ''} ${eu ? 'disabled' : ''}><span>Administrador</span></label></div>
      </details>
      ${eu ? '' : `<div class="actions"><button class="btn red sm" data-excluir>Excluir cadastro</button></div>`}
    </div>`;
  };
  app.innerHTML = `<div class="card"><h3>👥 Usuários <span class="sumhint">${users.length} cadastrado(s)${pend ? ` • <b style="color:var(--red)">${pend} aguardando</b>` : ''}</span></h3>
      <div class="search" style="margin:0"><span>🔎</span><input id="qu" type="search" placeholder="Buscar nome, e-mail, OPM..."></div></div>
    <div id="ulist">${users.map(cardU).join('')}</div>
    <div class="card"><h3>📚 Conteúdo (modelos protegidos)</h3>
      <div class="natlist">${ARQS_CONTEUDO.map(id => `<div><b>${id}.js</b> <span>${cont[id] ? `versão ${cont[id].versao || '?'} • ${cont[id].atualizado ? fmtQuando(cont[id].atualizado) : ''} • ${Math.round((cont[id].js || '').length / 1024)} KB` : '— não enviado'}</span></div>`).join('')}</div>
      <p class="sumhint">Para atualizar os modelos, envie os arquivos <b>.js</b> da pasta "conteudo" (pode selecionar vários). Os usuários recebem a atualização automaticamente.</p>
      <input type="file" id="arqs" accept=".js,text/javascript" multiple hidden><button class="btn gold" id="enviar">Enviar arquivos de conteúdo</button></div>`;
  $('#qu').oninput = e => { const t = norm(e.target.value); app.querySelectorAll('.ucard').forEach(el => { const u = users.find(x => x.uid === el.dataset.uid); el.hidden = t && !norm(`${u.nome} ${u.email} ${u.opm} ${u.rg}`).includes(t); }); };
  const salvarU = async (uid, dados, msg) => { try { await db.collection('usuarios').doc(uid).update(dados); toast(msg || 'Salvo'); } catch (e) { toast('Erro: ' + e.message); } };
  app.querySelectorAll('.ucard').forEach(el => {
    const uid = el.dataset.uid, u = users.find(x => x.uid === uid);
    u.perms = { ...PERMS_PADRAO, ...(u.perms || {}) };
    el.querySelectorAll('[data-st]').forEach(b => b.onclick = async () => { u.status = b.dataset.st; await salvarU(uid, { status: u.status, perms: u.perms }, { ativo: 'Usuário aprovado', bloqueado: 'Usuário bloqueado', pendente: 'Marcado como pendente' }[u.status]); telaAdmin(); });
    el.querySelectorAll('[data-cat]').forEach(b => b.onchange = () => { const s = new Set(u.perms.cats); b.checked ? s.add(b.dataset.cat) : s.delete(b.dataset.cat); u.perms.cats = [...s]; salvarU(uid, { 'perms.cats': u.perms.cats }); });
    el.querySelectorAll('[data-perm]').forEach(b => b.onchange = () => { u.perms[b.dataset.perm] = b.checked; salvarU(uid, { [`perms.${b.dataset.perm}`]: b.checked }); });
    const ex = el.querySelector('[data-excluir]');
    if (ex) ex.onclick = async () => { if (!await confirmar(`Excluir o cadastro de ${u.nome || u.email}? A pessoa perde o acesso; se entrar de novo, volta como pendente.`, 'Excluir')) return; try { await db.collection('usuarios').doc(uid).delete(); toast('Cadastro excluído'); telaAdmin(); } catch (e) { toast('Erro: ' + e.message); } };
  });
  $('#enviar').onclick = () => $('#arqs').click();
  $('#arqs').onchange = async e => {
    const files = [...e.target.files]; if (!files.length) return;
    const lidos = [];
    for (const f of files) {
      const id = f.name.replace(/\.js$/i, '').toLowerCase();
      if (!ARQS_CONTEUDO.includes(id)) { toast(`Arquivo ignorado: ${f.name}`); continue; }
      lidos.push({ id, js: await f.text() });
    }
    if (!lidos.length) return;
    // valida montando com o que já existe
    const todos = ARQS_CONTEUDO.map(id => lidos.find(x => x.id === id) || (cont[id] ? { id, js: cont[id].js } : null)).filter(Boolean);
    try { const t = montarConteudo(todos); if (!t.TIPOS.length && !lidos.find(x => x.id === 'base')) throw new Error('nenhuma ficha'); }
    catch (err) { toast('Arquivo com erro: ' + err.message); return; }
    if (!await confirmar(`Publicar ${lidos.map(x => x.id + '.js').join(', ')} para todos os usuários?`, 'Publicar')) return;
    try {
      const batch = db.batch();
      lidos.forEach(x => batch.set(db.collection('conteudo').doc(x.id), { js: x.js, versao: ((cont[x.id] && cont[x.id].versao) || 0) + 1, atualizado: Date.now(), por: usuario.email }));
      await batch.commit();
      toast('Conteúdo publicado ✓');
      await carregarConteudo(true); telaAdmin();
    } catch (err) { toast('Erro ao publicar: ' + err.message); }
  };
}

/* ------------------------- acesso ------------------------- */
function telaLogin(modo = 'entrar', msg = '') {
  semNav();
  setTop('Descritivo BOU', 'Acesso restrito a usuários autorizados');
  const cad = modo === 'cadastro';
  app.innerHTML = `<div class="login card">
    <img src="icons/icon-192.png" alt="" width="72" height="72" style="display:block;margin:4px auto 10px;border-radius:16px">
    <h3 style="justify-content:center">${cad ? 'Solicitar acesso' : 'Entrar'}</h3>
    ${msg ? `<div class="aviso2">${esc(msg)}</div>` : ''}
    <form id="flog">
      ${cad ? `<div class="f"><label>Nome completo e graduação</label><input type="text" id="lnome" required placeholder="Cad. PM Fulano de Tal"></div>
      <div class="row2"><div class="f"><label>RG</label><input type="text" id="lrg" inputmode="numeric"></div><div class="f"><label>OPM / Unidade</label><input type="text" id="lopm" placeholder="APMG, 12º BPM..."></div></div>` : ''}
      <div class="f"><label>E-mail</label><input type="email" id="lemail" required autocomplete="email"></div>
      <div class="f"><label>Senha</label><input type="password" id="lsenha" required minlength="6" autocomplete="${cad ? 'new-password' : 'current-password'}"></div>
      <button class="btn pri" style="width:100%" type="submit">${cad ? 'Enviar solicitação' : 'Entrar'}</button>
    </form>
    <div class="actions" style="justify-content:space-between">
      <button class="btn sm" id="ltroca">${cad ? 'Já tenho acesso' : 'Solicitar acesso'}</button>
      ${cad ? '' : '<button class="btn sm" id="lesq">Esqueci a senha</button>'}</div>
    <p class="aviso">Após a solicitação, o administrador precisa aprovar seu acesso.</p></div>`;
  $('#ltroca').onclick = () => telaLogin(cad ? 'entrar' : 'cadastro');
  if ($('#lesq')) $('#lesq').onclick = async () => { const em = $('#lemail').value.trim(); if (!em) { toast('Digite seu e-mail acima'); return; } try { await auth.sendPasswordResetEmail(em); toast('E-mail de redefinição enviado'); } catch (e) { toast(erroAuth(e)); } };
  $('#flog').onsubmit = async e => {
    e.preventDefault();
    const em = $('#lemail').value.trim(), se = $('#lsenha').value;
    const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      if (cad) { sessionStorage.setItem('bou.cad', JSON.stringify({ nome: $('#lnome').value.trim(), rg: $('#lrg').value.trim(), opm: $('#lopm').value.trim() })); await auth.createUserWithEmailAndPassword(em, se); }
      else await auth.signInWithEmailAndPassword(em, se);
    } catch (err) { toast(erroAuth(err)); btn.disabled = false; }
  };
}
function erroAuth(e) {
  const c = (e && e.code) || '';
  return ({ 'auth/invalid-credential': 'E-mail ou senha incorretos', 'auth/wrong-password': 'Senha incorreta', 'auth/user-not-found': 'E-mail não cadastrado', 'auth/email-already-in-use': 'E-mail já cadastrado — use "Já tenho acesso"', 'auth/weak-password': 'Senha fraca (mínimo 6 caracteres)', 'auth/invalid-email': 'E-mail inválido', 'auth/network-request-failed': 'Sem conexão', 'auth/too-many-requests': 'Muitas tentativas — aguarde alguns minutos' })[c] || ('Erro: ' + (e.message || c));
}
function telaEspera(tipo) {
  semNav();
  setTop('Descritivo BOU', usuario.email);
  const msgs = {
    pendente: ['⏳', 'Aguardando aprovação', 'Sua solicitação foi enviada. Assim que o administrador aprovar, você poderá usar o app.'],
    bloqueado: ['⛔', 'Acesso bloqueado', 'Seu acesso foi retirado pelo administrador. Em caso de dúvida, procure-o.'],
    semconteudo: ['📚', 'Modelos ainda não publicados', ehAdmin() ? 'Você é o administrador: abra o painel e envie os arquivos da pasta "conteudo".' : 'O administrador ainda não publicou os modelos. Tente mais tarde.'],
    offline: ['📡', 'Sem conexão', 'É preciso estar online no primeiro acesso para baixar os modelos.']
  }[tipo];
  app.innerHTML = `<div class="card login" style="text-align:center"><div style="font-size:46px">${msgs[0]}</div><h3 style="justify-content:center">${msgs[1]}</h3><p>${msgs[2]}</p>
    <div class="actions" style="justify-content:center">${tipo === 'semconteudo' && ehAdmin() ? '<button class="btn gold" id="irAdmin">Abrir painel</button>' : '<button class="btn pri" id="recheck">Verificar novamente</button>'}<button class="btn" id="sair2">Sair</button></div></div>`;
  if ($('#recheck')) $('#recheck').onclick = () => iniciarSessao(usuario);
  if ($('#irAdmin')) $('#irAdmin').onclick = () => { setNav('admin'); telaAdmin(); };
  $('#sair2').onclick = () => auth.signOut();
}
async function obterPerfil(user) {
  const ref = db.collection('usuarios').doc(user.uid);
  const cacheK = `bou.${user.uid}.perfil`;
  let snap;
  try { snap = await ref.get(); }
  catch (e) { const c = LS.get(cacheK, null); if (c) return c; throw e; }
  if (!snap.exists) {
    const extra = JSON.parse(sessionStorage.getItem('bou.cad') || '{}');
    const souAdmin = (user.email || '').toLowerCase() === ADMIN_EMAIL;
    const novo = { email: user.email, nome: extra.nome || '', rg: extra.rg || '', opm: extra.opm || '', criado: Date.now(), status: souAdmin ? 'ativo' : 'pendente', perms: { ...PERMS_PADRAO, admin: souAdmin } };
    await ref.set(novo);
    sessionStorage.removeItem('bou.cad');
    LS.set(cacheK, novo);
    return novo;
  }
  const p = snap.data(); LS.set(cacheK, p); return p;
}
async function iniciarSessao(user) {
  usuario = user;
  semNav();
  app.innerHTML = '<div class="empty">Verificando acesso...</div>';
  try { perfil = await obterPerfil(user); }
  catch (e) { telaEspera('offline'); return; }
  perfil.perms = { ...PERMS_PADRAO, ...(perfil.perms || {}) };
  if (perfil.status === 'bloqueado') { LS.del(uidKey('conteudo')); telaEspera('bloqueado'); return; }
  if (perfil.status !== 'ativo') { telaEspera('pendente'); return; }
  try { await carregarConteudo(); }
  catch (e) { telaEspera(navigator.onLine ? 'semconteudo' : 'offline'); return; }
  rota();
}

/* ------------------------- roteador ------------------------- */
function rota() {
  if (!perfil) return;
  document.querySelectorAll('.fab').forEach(f => f.remove());
  app.oninput = app.onchange = null;
  const h = location.hash.replace(/^#/, '');
  window.scrollTo(0, 0);
  if (h.startsWith('t-')) {
    let rid = abrirRid; abrirRid = null;
    if (!rid && !R) { try { rid = sessionStorage.getItem('bou.atual'); } catch {} }
    if (!rid) aba = R && R.tipo === h.slice(2) ? aba : 'modelo';
    telaTipo(h.slice(2), rid);
  }
  else if (h === 'rascunhos') telaRascunhos();
  else if (h === 'equipe') telaEquipe();
  else if (h === 'admin') telaAdmin();
  else { R = null; try { sessionStorage.removeItem('bou.atual'); } catch {} telaHome(); }
}
window.addEventListener('hashchange', rota);

/* lista de municípios para o campo de busca */
(function () { const dl = document.createElement('datalist'); dl.id = 'munis'; dl.innerHTML = (window.MUNICIPIOS_PR || []).map(m => `<option value="${esc(m)}">`).join(''); document.body.appendChild(dl); })();

/* ------------------------- início ------------------------- */
if (TEM_FIREBASE) {
  firebase.initializeApp(CFG);
  auth = firebase.auth(); db = firebase.firestore();
  try { db.enablePersistence({ synchronizeTabs: true }).catch(() => {}); } catch {}
  auth.onAuthStateChanged(u => { if (u) iniciarSessao(u); else { usuario = null; perfil = null; TIPOS = []; telaLogin(); } });
} else {
  // modo local de testes: sem Firebase configurado, lê ./conteudo/*.js se existir
  perfil = { nome: 'Modo local', status: 'ativo', perms: { ...PERMS_PADRAO } };
  carregarConteudo().then(rota).catch(() => {
    semNav(); setTop('Descritivo BOU', 'Configuração pendente');
    app.innerHTML = '<div class="card"><h3>⚙️ Firebase não configurado</h3><p>Preencha o arquivo <b>firebase-config.js</b> com os dados do seu projeto Firebase (veja o README).</p></div>';
  });
}

if ('serviceWorker' in navigator && location.protocol.startsWith('http') && window.top === window) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
})();
