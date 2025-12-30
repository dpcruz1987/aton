/**
 * ATON • Cadastro de Produtos (Frontend)
 * Ajuste os endpoints conforme o Postman do ATON.
 * Recomendado: usar proxy (server.js) pra evitar CORS e proteger token.
 */

const $ = (sel) => document.querySelector(sel);
const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

// ---------- CONFIG DEFAULT ----------
const DEFAULTS = {
  mode: "proxy",                 // "proxy" (recomendado) ou "direct"
  baseUrl: "",                   // ex: https://api.aton.com (somente direct)
  proxyUrl: "http://localhost:3000", // ex: seu backend
  tokenHeader: "Authorization",  // ou X-Token, Token, etc
  tokenPrefix: "Bearer ",        // se não usar prefixo, deixe ""
  token: "",                     // EVITE em produção no browser
  epProducts: "/produtos",       // ajuste: ex /api/Products
  epProductById: "/produtos/{id}",
  searchParam: "q"               // ajuste se a API suportar busca por querystring
};

function loadCfg(){
  const raw = localStorage.getItem("aton_cfg");
  return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
}
function saveCfg(cfg){
  localStorage.setItem("aton_cfg", JSON.stringify(cfg));
}

let cfg = loadCfg();
let productsCache = []; // lista atual

// ---------- UI ----------
const tbody = $("#tbody");
const chipCount = $("#chipCount");
const chipStatus = $("#chipStatus");

function setStatus(text, kind="ok"){
  chipStatus.textContent = text;
  chipStatus.classList.remove("ok");
  if(kind === "ok") chipStatus.classList.add("ok");
}

function renderTable(rows){
  productsCache = rows || [];
  chipCount.textContent = `${productsCache.length} itens`;

  if(!rows || rows.length === 0){
    tbody.innerHTML = `<tr><td colspan="7" class="muted center">Nenhum produto encontrado.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(p => {
    const id = safe(p.id ?? p.ID ?? p.codigo ?? "");
    const name = safe(p.nome ?? p.name ?? p.descricao ?? "");
    const sku = safe(p.sku ?? p.SKU ?? p.referencia ?? "");
    const ean = safe(p.ean ?? p.EAN ?? p.codigoBarras ?? "");
    const price = num(p.preco ?? p.price ?? p.valor ?? null);
    const stock = num(p.estoque ?? p.stock ?? p.saldo ?? null);

    return `
      <tr>
        <td>${id}</td>
        <td>
          <div class="strong">${name}</div>
          <div class="muted" style="font-size:12px;">${sku ? `SKU: ${sku}` : ""} ${ean ? ` • EAN: ${ean}` : ""}</div>
        </td>
        <td>${sku}</td>
        <td>${ean}</td>
        <td class="right">${price === null ? "-" : fmtBRL.format(price)}</td>
        <td class="right">${stock === null ? "-" : stock}</td>
        <td>
          <button class="btn" data-act="edit" data-id="${id}">Editar</button>
          <button class="btn ghost" data-act="copy" data-id="${id}">Copiar JSON</button>
        </td>
      </tr>
    `;
  }).join("");
}

function safe(v){
  return (v === undefined || v === null) ? "" : String(v);
}
function num(v){
  if(v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------- API LAYER ----------
function buildUrl(path){
  if(cfg.mode === "proxy"){
    // Proxy expõe rotas /api/* (ver server.js)
    return `${cfg.proxyUrl}/api${path}`;
  }
  // direct
  return `${cfg.baseUrl}${path}`;
}

function headers(){
  const h = { "Content-Type": "application/json" };
  // Se estiver em proxy, você pode optar por NÃO mandar token do front e deixar no backend.
  if(cfg.token){
    h[cfg.tokenHeader] = `${cfg.tokenPrefix || ""}${cfg.token}`;
  }
  return h;
}

function epById(id){
  return cfg.epProductById.replace("{id}", encodeURIComponent(id));
}

async function apiFetch(path, opts={}){
  const url = buildUrl(path);
  const res = await fetch(url, {
    ...opts,
    headers: { ...headers(), ...(opts.headers || {}) }
  });

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if(!res.ok){
    const msg = (data && data.message) ? data.message : (typeof data === "string" ? data : JSON.stringify(data));
    throw new Error(`HTTP ${res.status} • ${msg || "Erro na API"}`);
  }
  return data;
}

// Ajuste aqui caso a API retorne {data:[...]} ou {items:[...]}
function normalizeList(payload){
  if(Array.isArray(payload)) return payload;
  if(payload?.data && Array.isArray(payload.data)) return payload.data;
  if(payload?.items && Array.isArray(payload.items)) return payload.items;
  if(payload?.result && Array.isArray(payload.result)) return payload.result;
  return [];
}

// ---------- CRUD ----------
async function listProducts(){
  setStatus("Carregando...", "ok");
  const payload = await apiFetch(cfg.epProducts, { method: "GET" });
  const list = normalizeList(payload);
  renderTable(list);
  setStatus("OK", "ok");
}

async function searchProducts(query){
  const q = (query || "").trim();
  if(!q){
    await listProducts();
    return;
  }

  // 1) Tentativa: endpoint com querystring (se API suportar)
  // ex: GET /produtos?q=xxx
  const path = `${cfg.epProducts}?${encodeURIComponent(cfg.searchParam)}=${encodeURIComponent(q)}`;

  try{
    setStatus("Buscando...", "ok");
    const payload = await apiFetch(path, { method: "GET" });
    renderTable(normalizeList(payload));
    setStatus("OK", "ok");
  }catch(err){
    // 2) fallback: filtra no cache local (se já carregou listagem)
    const filtered = (productsCache || []).filter(p => {
      const blob = JSON.stringify(p).toLowerCase();
      return blob.includes(q.toLowerCase());
    });
    renderTable(filtered);
    setStatus("Filtro local (API sem busca)", "ok");
  }
}

async function createProduct(dto){
  // ajuste: talvez a API exija um wrapper {produto:{...}}
  return apiFetch(cfg.epProducts, { method: "POST", body: JSON.stringify(dto) });
}

async function updateProduct(id, dto){
  return apiFetch(epById(id), { method: "PUT", body: JSON.stringify(dto) });
}

async function deleteProduct(id){
  return apiFetch(epById(id), { method: "DELETE" });
}

async function getProduct(id){
  return apiFetch(epById(id), { method: "GET" });
}

// ---------- MODAL PRODUTO ----------
const dlgProduct = $("#dlgProduct");
const formProduct = $("#formProduct");
const dlgTitle = $("#dlgTitle");
const btnDelete = $("#btnDelete");

const p_id = $("#p_id");
const p_name = $("#p_name");
const p_sku = $("#p_sku");
const p_ean = $("#p_ean");
const p_price = $("#p_price");
const p_stock = $("#p_stock");
const p_notes = $("#p_notes");

let editingId = null;

function openNew(){
  editingId = null;
  dlgTitle.textContent = "Novo produto";
  btnDelete.style.display = "none";
  p_id.value = "";
  p_name.value = "";
  p_sku.value = "";
  p_ean.value = "";
  p_price.value = "";
  p_stock.value = "";
  p_notes.value = "";
  dlgProduct.showModal();
}

async function openEdit(id){
  editingId = id;
  dlgTitle.textContent = `Editar produto #${id}`;
  btnDelete.style.display = "inline-flex";

  setStatus("Abrindo produto...", "ok");
  const p = await getProduct(id);

  // ajuste os mapeamentos conforme o retorno real
  p_id.value = safe(p.id ?? p.ID ?? id);
  p_name.value = safe(p.nome ?? p.name ?? p.descricao ?? "");
  p_sku.value = safe(p.sku ?? p.SKU ?? p.referencia ?? "");
  p_ean.value = safe(p.ean ?? p.EAN ?? p.codigoBarras ?? "");
  p_price.value = safe(p.preco ?? p.price ?? p.valor ?? "");
  p_stock.value = safe(p.estoque ?? p.stock ?? p.saldo ?? "");
  p_notes.value = safe(p.obs ?? p.observacao ?? p.notes ?? "");

  dlgProduct.showModal();
  setStatus("OK", "ok");
}

function buildDTO(){
  // DTO genérico — ajuste conforme o schema do ATON
  const dto = {
    nome: p_name.value.trim(),
    sku: p_sku.value.trim() || null,
    ean: p_ean.value.trim() || null,
    preco: p_price.value === "" ? null : Number(p_price.value),
    estoque: p_stock.value === "" ? null : Number(p_stock.value),
    obs: p_notes.value.trim() || null
  };

  // remove nulls
  Object.keys(dto).forEach(k => (dto[k] === null || dto[k] === "") && delete dto[k]);
  return dto;
}

formProduct.addEventListener("submit", async (e) => {
  e.preventDefault();
  const dto = buildDTO();
  if(!dto.nome){
    alert("Nome é obrigatório.");
    return;
  }

  try{
    if(editingId){
      setStatus("Salvando...", "ok");
      await updateProduct(editingId, dto);
    }else{
      setStatus("Criando...", "ok");
      await createProduct(dto);
    }
    dlgProduct.close();
    await listProducts();
  }catch(err){
    console.error(err);
    alert(err.message);
    setStatus("Erro", "ok");
  }
});

btnDelete.addEventListener("click", async () => {
  if(!editingId) return;
  if(!confirm(`Excluir o produto #${editingId}?`)) return;

  try{
    setStatus("Excluindo...", "ok");
    await deleteProduct(editingId);
    dlgProduct.close();
    await listProducts();
  }catch(err){
    console.error(err);
    alert(err.message);
    setStatus("Erro", "ok");
  }
});

// ---------- SETTINGS ----------
const dlgSettings = $("#dlgSettings");
$("#btnOpenSettings").addEventListener("click", () => {
  $("#mode").value = cfg.mode;
  $("#baseUrl").value = cfg.baseUrl;
  $("#proxyUrl").value = cfg.proxyUrl;
  $("#tokenHeader").value = cfg.tokenHeader;
  $("#tokenPrefix").value = cfg.tokenPrefix;
  $("#token").value = cfg.token;
  $("#epProducts").value = cfg.epProducts;
  $("#epProductById").value = cfg.epProductById;
  $("#searchParam").value = cfg.searchParam;
  dlgSettings.showModal();
});

$("#formSettings").addEventListener("submit", async (e) => {
  e.preventDefault();
  cfg = {
    ...cfg,
    mode: $("#mode").value,
    baseUrl: $("#baseUrl").value.trim(),
    proxyUrl: $("#proxyUrl").value.trim(),
    tokenHeader: $("#tokenHeader").value.trim() || "Authorization",
    tokenPrefix: $("#tokenPrefix").value ?? "",
    token: $("#token").value.trim(),
    epProducts: $("#epProducts").value.trim() || "/produtos",
    epProductById: $("#epProductById").value.trim() || "/produtos/{id}",
    searchParam: $("#searchParam").value.trim() || "q"
  };
  saveCfg(cfg);
  dlgSettings.close();
  try{ await listProducts(); } catch(e2){ /* ignora */ }
});

// ---------- EVENTS ----------
$("#btnNew").addEventListener("click", openNew);
$("#btnReload").addEventListener("click", () => listProducts().catch(err => alert(err.message)));
$("#btnSearch").addEventListener("click", () => searchProducts($("#q").value).catch(err => alert(err.message)));
$("#btnClear").addEventListener("click", () => { $("#q").value=""; listProducts().catch(err => alert(err.message)); });

tbody.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if(!btn) return;
  const act = btn.dataset.act;
  const id = btn.dataset.id;
  if(!id) return;

  if(act === "edit"){
    try{ await openEdit(id); } catch(err){ alert(err.message); }
  }
  if(act === "copy"){
    const row = productsCache.find(p => String(p.id ?? p.ID ?? p.codigo ?? "") === String(id));
    await navigator.clipboard.writeText(JSON.stringify(row || {}, null, 2));
    setStatus("JSON copiado ✅", "ok");
    setTimeout(()=>setStatus("OK","ok"), 900);
  }
});

// ---------- INIT ----------
(async function init(){
  // Se você quiser “forçar” seu token no browser (não recomendo), você pode pré-preencher aqui:
  // cfg.token = "SEU_TOKEN";
  saveCfg(cfg);
  try{
    await listProducts();
  }catch(err){
    console.error(err);
    renderTable([]);
    setStatus("Configure a conexão (⚙️)", "ok");
  }
})();
