// LoyaltyCard.js
// DroidScript 2.78.9
// ------------------------------------------------------------
// v0.7
// - Home: 2-col grid, correct real aspect ratio W/H=1.6
// - Home tiles: Title + Notes only (NO barcode)
// - Detail view: headerColor + optional logo + offline barcode (EAN-13 + Code128-B)
// - Barcodes always black on white; rendered only in detail view
// - Fully offline: no jQuery, no network
// - No app.Confirm / app.Prompt usage (custom dialogs)
// - Images stored as base64 by UUID in dataset.json
// - Deleting a card deletes its referenced images
// ------------------------------------------------------------

app.Script("Helpers.js");

var APP_NAME = "LoyaltyPortfolio";
var BASE_DIR = "/sdcard/DroidScript/" + APP_NAME;
var DATA_FILE = BASE_DIR + "/dataset.json";

var gData = null;
var gEffectiveFontColor = "#FFFFFF";

// UI refs
var layRoot, wvBg, layUi, layHome, scHome, layGrid;
var txtHdr, btnCog, btnExit;

// Barcode tuning (CSS pixels)
var BAR_EAN13_HEIGHT = 65;
var BAR_EAN13_MODULE_W = 15;
var BAR_C128_HEIGHT = 50;
var BAR_C128_MODULE_W = 15;

// Hard-coded catalog (Add card list)
var CATALOG = [
  { title: "Carrefour", kind: "template", templateId: "tpl_basic", templateData: { brand: "Carrefour" } },
  { title: "Delhaize", kind: "template", templateId: "tpl_basic", templateData: { brand: "Delhaize" } },
  { title: "Colruyt", kind: "template", templateId: "tpl_basic", templateData: { brand: "Colruyt" } },
  { title: "IKEA Family", kind: "template", templateId: "tpl_basic", templateData: { brand: "IKEA" } },
  { title: "Decathlon", kind: "template", templateId: "tpl_basic", templateData: { brand: "Decathlon" } }
];

// ------------------------------------------------------------
// Templates
// ------------------------------------------------------------
var TEMPLATES = {
  tpl_add: function () {
    return `
<!doctype html><html><head>
<meta name="viewport" content="width=device-width,height=device-height,initial-scale=1,user-scalable=no" />
<style>
  html,body{margin:0;padding:0;height:100%;background:transparent;font-family:sans-serif;}
  .card{height:100%;border-radius:18px;background:rgba(255,255,255,.10);
    border:1px dashed rgba(255,255,255,.35);display:flex;align-items:center;justify-content:center;}
  .circle{width:56px;height:56px;border-radius:28px;background:rgba(180,180,180,.75);
    display:flex;align-items:center;justify-content:center;}
  .plus{color:white;font-size:34px;line-height:34px;font-weight:800;margin-top:-2px;}
</style></head>
<body><div class="card"><div class="circle"><div class="plus">+</div></div></div></body></html>`;
  },

  // Home tile (NO barcode, NO header bar)
  tpl_basic_tile: function (card) {
    var title = escapeHtml(card.title || "");
    var subtitle = escapeHtml((card.notes || "").trim());
    return `
<!doctype html><html><head>
<meta name="viewport" content="width=device-width,height=device-height,initial-scale=1,user-scalable=no" />
<style>
  html,body{margin:0;padding:0;height:100%;background:transparent;font-family:sans-serif;}
  .card{height:100%;border-radius:18px;box-sizing:border-box;padding:14px;color:white;
    background:linear-gradient(135deg, rgba(255,255,255,.12), rgba(0,0,0,.25));
    border:1px solid rgba(255,255,255,.18);position:relative;overflow:hidden;}
  .title{font-size:18px;font-weight:800;letter-spacing:.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .sub{margin-top:10px;font-size:13px;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .shine{position:absolute;top:-40%;left:-40%;width:120%;height:120%;
    background:radial-gradient(circle at 30% 30%, rgba(255,255,255,.18), transparent 60%);
    transform:rotate(18deg);}
</style></head>
<body><div class="card"><div class="shine"></div>
  <div class="title">${title}</div>
  <div class="sub">${subtitle}</div>
</div></body></html>`;
  },

  // Detail view (header + logo + barcode panel)
  tpl_basic_full: function (card) {
    var title = escapeHtml(card.title || "");
    var subtitle = escapeHtml((card.notes || "").trim());
    var headerColor = escapeHtml(card.headerColor || "#2B2B2B");
    var logoUri = card.logoImageId ? imageDataUri(card.logoImageId) : null;
    var logoHtml = logoUri ? `<img class="logo" src="${logoUri}">` : `<div class="logoPh"></div>`;

    var showBarcode = (card.codeType === "barcode" && (card.codeValue || "").trim().length > 0);
    var showQr = (card.codeType === "qrcode" && (card.codeValue || "").trim().length > 0);
    var fmt = (card.barcodeFormat || "ean13").toLowerCase();
    var codeVal = (card.codeValue || "").trim();

    var contentBlock = "";
    if (showBarcode) {
      contentBlock = `
        <div class="barcodePanel">
          <div id="barcodeArea"></div>
          <div class="codeText" id="codeText"></div>
        </div>`;
    } else if (showQr) {
      // QR offline not implemented (spec says QR allowed; we show the value clearly)
      contentBlock = `
        <div class="barcodePanel">
          <div style="text-align:center;font:14px sans-serif;color:#111;">QR value</div>
          <div class="codeText" style="word-break:break-all">${escapeHtml(codeVal)}</div>
        </div>`;
    } else {
      contentBlock = `<div style="opacity:.85;font-size:13px;">No code</div>`;
    }

    // Inline offline barcode engines:
    // - EAN-13 (Notionovus snippet adapted)
    // - Code128-B (minimal implementation, pure JS)
    // Both produce the same "bitstring" -> rendered by genBarcode()
    return `
<!doctype html><html><head>
<meta name="viewport" content="width=device-width,height=device-height,initial-scale=1,user-scalable=no" />
<style>
  html,body{margin:0;padding:0;height:100%;background:transparent;font-family:sans-serif;}
  .card{height:100%;border-radius:18px;overflow:hidden;
    background:linear-gradient(135deg, rgba(255,255,255,.12), rgba(0,0,0,.25));
    border:1px solid rgba(255,255,255,.18);color:white;box-sizing:border-box;}
  .header{height:64px;background:${headerColor};display:flex;align-items:center;padding:10px 12px;box-sizing:border-box;}
  .logo{max-width:44px;max-height:44px;width:auto;height:auto;border-radius:10px;background:rgba(255,255,255,.10);}
  .logoPh{width:44px;height:44px;border-radius:10px;background:rgba(255,255,255,.12);}
  .hText{margin-left:10px;overflow:hidden;}
  .hTitle{font-size:18px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .hSub{font-size:12px;opacity:.9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .content{padding:12px;box-sizing:border-box;}
  /* Barcode must be black on white */
  .barcodePanel{margin-top:12px;background:#fff;border-radius:12px;padding:10px;border:1px solid rgba(0,0,0,.15);}
  #barcodeArea{display:flex;justify-content:center;align-items:center;flex-wrap:nowrap;}
  #barcodeArea img{image-rendering:pixelated;}
  .codeText{margin-top:6px;text-align:center;font:14px sans-serif;color:#111;letter-spacing:1px;}
  .noteHint{opacity:.9;font-size:12px;margin-top:8px;}
</style>
</head><body>
<div class="card">
  <div class="header">
    ${logoHtml}
    <div class="hText">
      <div class="hTitle">${title}</div>
      <div class="hSub">${subtitle}</div>
    </div>
  </div>
  <div class="content">
    ${contentBlock}
    <div class="noteHint">${showBarcode ? "Barcode is rendered fully offline." : ""}</div>
  </div>
</div>

<script>
`
+
barcode_render_scripts
+
`
/* ---------------- Init ---------------- */
(function(){
  var showBarcode = ${showBarcode ? "true":"false"};
  if(!showBarcode) return;

  var fmt = "${escapeJs(fmt)}";
  var val = "${escapeJs(codeVal)}";

  if(fmt === "ean13"){
    var r = renderEAN13("barcodeArea", val, ${BAR_EAN13_HEIGHT}, ${BAR_EAN13_MODULE_W});
    document.getElementById("codeText").textContent = r.ok ? r.digits13 : val;
  } else if(fmt === "code128"){
    renderCode128B("barcodeArea", val, ${BAR_C128_HEIGHT}, ${BAR_C128_MODULE_W});
    document.getElementById("codeText").textContent = val;
  } else {
    document.getElementById("barcodeArea").innerHTML = "<div style='font:14px sans-serif;color:#111;'>Unsupported format</div>";
    document.getElementById("codeText").textContent = val;
  }
})();
</script>
</body></html>`;
  }
};

// ------------------------------------------------------------
// DroidScript entry
// ------------------------------------------------------------
function OnStart() {
  app.SetOrientation("Portrait");
  ensureFolders();
  loadOrInitData();
  computeEffectiveFontColor();

  layRoot = app.CreateLayout("Frame", "FillXY");

  // Gradient background as WebView
  wvBg = app.CreateWebView(1, 1, "NoScroll,IgnoreErrors");
  wvBg.SetBackColor("#00000000");
  wvBg.LoadHtml(gradientHtml(gData.settings.gradientTop, gData.settings.gradientBottom));
  layRoot.AddChild(wvBg);

  // UI overlay
  layUi = app.CreateLayout("Linear", "FillXY");
  layUi.SetPadding(0.02, 0.02, 0.02, 0.02);

  var layHeader = app.CreateLayout("Linear", "Horizontal,FillX");
  layHeader.SetPadding(0, 0, 0, 0.01);

  txtHdr = app.CreateText("Loyalty Cards", 0.66, -1, "Left");
  txtHdr.SetTextSize(20);
  txtHdr.SetTextColor(gEffectiveFontColor);

  btnCog = app.CreateButton("⚙", 0.14, 0.07);
  btnCog.SetTextSize(20);
  btnCog.SetOnTouch(openSettingsToolsDialog);

  btnExit = app.CreateButton("✕", 0.14, 0.07);
  btnExit.SetTextSize(20);
  btnExit.SetOnTouch(function(){ app.Exit(); });

  layHeader.AddChild(txtHdr);
  layHeader.AddChild(btnCog);
  layHeader.AddChild(btnExit);

  scHome = app.CreateScroller(1, 0.9);
  layHome = app.CreateLayout("Linear", "FillXY");
  layHome.SetPadding(0,0,0,0);

  layGrid = app.CreateLayout("Linear", "FillX");
  layGrid.SetPadding(0,0.01,0,0.02);
  layHome.AddChild(layGrid);
  scHome.AddChild(layHome);

  layUi.AddChild(layHeader);
  layUi.AddChild(scHome);

  layRoot.AddChild(layUi);
  app.AddLayout(layRoot);

  renderHome();
}


// ------------------------------------------------------------
// Home render (2-col)
// ------------------------------------------------------------
function renderHome() {
  applyGradientBackground();

  // Recreate layGrid (no RemoveAllChildren in DS 2.78.9 reliably)
  try { layHome.RemoveChild(layGrid); } catch(e){}
  layGrid = app.CreateLayout("Linear", "FillX");
  layGrid.SetPadding(0,0.01,0,0.02);
  layHome.AddChild(layGrid);

  var cards = getSortedCards();
  var tiles = cards.slice();
  tiles.push({ __isAddTile: true });

  // Correct real aspect ratio: W/H = 1.6
  var asp = GetDisplayAspectSafe();
  var tileW = 0.46;
  var tileH = tileW / 1.6 / asp;

  for (var i = 0; i < tiles.length; i += 2) {
    var row = app.CreateLayout("Linear", "Horizontal,FillX");
    row.SetPadding(0, 0, 0, 0.02);
    row.SetSize(1.0, tileH);

    row.AddChild(createTile(tiles[i], tileW, tileH));
    if (i+1 < tiles.length) row.AddChild(createTile(tiles[i+1], tileW, tileH));
    else row.AddChild(app.CreateText("", tileW, tileH));

    layGrid.AddChild(row);
  }
}

function createTile(tile, w, h) {
  var lay = app.CreateLayout("Frame");
  lay.SetSize(w, h);

  var wv = app.CreateWebView(w, h, "NoScroll,IgnoreErrors");
  wv.SetBackColor("#00000000");

  // WebView may eat touches; overlay transparent button
  var hit = app.CreateButton("", w, h);
  hit.SetStyle("#00000000", "#00000000", 0, "#00000000", 0);

  if (tile && tile.__isAddTile) {
    wv.LoadHtml(TEMPLATES.tpl_add());
    hit.SetOnTouch(openAddCardDialog);
  } else {
    var card = tile;
    if (card.cardKind === "template") wv.LoadHtml(TEMPLATES.tpl_basic_tile(card));
    else wv.LoadHtml(imageTileHtml(card.title, card.notes, imageDataUri(card.frontImageId)));
    hit.SetOnTouch((function(id){ return function(){ onCardTapped(id); }; })(card.id));
  }

  lay.AddChild(wv);
  lay.AddChild(hit);
  return lay;
}

// ------------------------------------------------------------
// Card tap -> detail actions
// ------------------------------------------------------------
function onCardTapped(cardId) {
  var card = findCardById(cardId);
  if (!card) return;

  card.useCount = (card.useCount || 0) + 1;
  card.lastUsed = nowEpochSeconds();
  saveData();

  openCardActionsDialog(card);
}

function openCardActionsDialog(card) {
  var dlg = app.CreateDialog("", "NoTitle");
  var lay = app.CreateLayout("Linear", "FillXY");
  lay.SetPadding(0.03,0.03,0.03,0.03);

  // Full-width preview
  var asp = GetDisplayAspectSafe();
  var prevW = 0.94;
  var prevH = prevW / 1.6 / asp;

  var wv = app.CreateWebView(prevW, prevH, "NoScroll,IgnoreErrors");
  wv.SetBackColor("#00000000");

  if (card.cardKind === "template") wv.LoadHtml(TEMPLATES.tpl_basic_full(card));
  else wv.LoadHtml(imageTileHtml(card.title, card.notes, imageDataUri(card.frontImageId)));

  lay.AddChild(wv);
  lay.AddChild(spacer(0.015));

  lay.AddChild(actionButton("🖍  Edit card", function(){ dlg.Hide(); openManualCardDialog(card.id); }));
  lay.AddChild(actionButton("📷  Photos", function(){ dlg.Hide(); openPhotosViewer(card.id); }));
  lay.AddChild(actionButton("📄  Notes", function(){ dlg.Hide(); openNotesDialog(card.id); }));
  lay.AddChild(actionButton("🗑  Delete card", function(){
    confirmDialog("Delete this card?\n\nThis will also remove its images.", function(yes){
      if(!yes) return;
      deleteCardById(card.id);
      saveData();
      renderHome();
      dlg.Hide();
    });
  }));

  var btnClose = app.CreateButton("Close", 0.4, 0.085);
  btnClose.SetOnTouch(function(){ dlg.Hide(); });
  lay.AddChild(spacer(0.02));
  lay.AddChild(btnClose);

  dlg.AddLayout(lay);
  dlg.Show();
}

function actionButton(label, fn){
  var b = app.CreateButton(label, 0.94, 0.085);
  b.SetTextSize(16);
  b.SetOnTouch(fn);
  return b;
}




function GetDisplayAspectSafe() {
    // returns height/width
    try {
        if (app.GetDisplayAspect) return app.GetDisplayAspect();
    } catch(e) {}

    // Fallback: compute from display size
    // Works across older DroidScript versions
    var w = 0, h = 0;

    try {
        w = app.GetScreenWidth();
        h = app.GetScreenHeight();
    } catch(e) {}

    // Final fallback if those aren’t available either
    if (!w || !h) {
        w = 1080;  // conservative defaults
        h = 1920;
    }
    return h / w;
}




function spacer(h){ return app.CreateText("", 1, h); }

// ------------------------------------------------------------
// Add card dialog (catalog + other)
// ------------------------------------------------------------
function openAddCardDialog(){
  var dlg = app.CreateDialog("", "NoTitle");
  var lay = app.CreateLayout("Linear", "FillXY");
  lay.SetPadding(0.03,0.03,0.03,0.03);

  var hdr = app.CreateText("Add a loyalty card", 0.94, -1, "Left");
  hdr.SetTextSize(20);
  hdr.SetTextColor(gEffectiveFontColor);
  lay.AddChild(hdr);

  var edt = app.CreateTextEdit("", 0.94, 0.07);
  edt.SetHint("Search by title...");
  lay.AddChild(edt);

  var list = app.CreateList("", 0.94, 0.65);
  lay.AddChild(list);

  function refresh(){
    var q = (edt.GetText() || "").trim();
    var items = [];
    var filtered = CATALOG.filter(function(x){
      if(!q) return true;
      return normStr(x.title).indexOf(normStr(q)) >= 0;
    });
    filtered.forEach(function(x){ items.push(x.title + ":catalog"); });
    items.push("➕  add other card:other");
    list.SetList(items.join(","));
  }

  list.SetOnTouch(function(title, body, type){
    if(type === "catalog"){
      dlg.Hide();
      createCardFromCatalog(title);
    } else if(type === "other"){
      dlg.Hide();
      openManualCardDialog(null);
    }
  });

  edt.SetOnChange(refresh);
  refresh();

  var btnClose = app.CreateButton("Close", 0.4, 0.085);
  btnClose.SetOnTouch(function(){ dlg.Hide(); });
  lay.AddChild(spacer(0.02));
  lay.AddChild(btnClose);

  dlg.AddLayout(lay);
  dlg.Show();
}

function createCardFromCatalog(title){
  var item = CATALOG.find(function(x){ return x.title === title; });
  if(!item) return;

  var card = normalizeCard({
    id: uuidv4(),
    title: item.title,
    cardKind: item.kind,
    templateId: item.templateId || "tpl_basic",
    templateData: item.templateData || {},
    codeType: "none",
    barcodeFormat: "ean13",
    codeValue: "",
    frontImageId: null,
    backImageId: null,
    notes: "",
    useCount: 0,
    lastUsed: 0,
    headerColor: "#2B2B2B",
    logoImageId: null
  });

  gData.cards.push(card);
  saveData();
  renderHome();
  openManualCardDialog(card.id);
}

// ------------------------------------------------------------
// Manual/Edit dialog (Save + Close always visible)
// ------------------------------------------------------------
function openManualCardDialog(existingCardId){
  var isEdit = !!existingCardId;
  var card = isEdit ? findCardById(existingCardId) : normalizeCard({ id: uuidv4(), title: "", cardKind: "image" });
  if(!card) return;

  var dlg = app.CreateDialog("", "NoTitle");
  var layOuter = app.CreateLayout("Linear", "FillXY");
  layOuter.SetPadding(0.03,0.03,0.03,0.03);

  var hdr = app.CreateText(isEdit ? "Edit card" : "Create a new card", 0.94, -1, "Left");
  hdr.SetTextSize(20);
  hdr.SetTextColor(gEffectiveFontColor);
  layOuter.AddChild(hdr);

  var sc = app.CreateScroller(0.94, 0.68);
  var lay = app.CreateLayout("Linear", "FillX");
  lay.SetPadding(0,0.01,0,0.02);

  lay.AddChild(app.CreateText("Title", 0.94, -1, "Left"));
  var edtTitle = app.CreateTextEdit(card.title || "", 0.94, 0.07);
  lay.AddChild(edtTitle);

  lay.AddChild(app.CreateText("Card kind", 0.94, -1, "Left"));
  var spKind = app.CreateSpinner("image,template", 0.94, 0.07);
  spKind.SelectItem(card.cardKind || "image");
  lay.AddChild(spKind);

  lay.AddChild(app.CreateText("Detail header color", 0.94, -1, "Left"));
  var btnHeaderCol = app.CreateButton("Pick Header Color (" + (card.headerColor || "#2B2B2B") + ")", 0.94, 0.08);
  lay.AddChild(btnHeaderCol);
  btnHeaderCol.SetOnTouch(function(){
    pickColor(card.headerColor || "#2B2B2B", function(col){
      card.headerColor = col;
      btnHeaderCol.SetText("Pick Header Color (" + col + ")");
    });
  });

  lay.AddChild(app.CreateText("Logo (base64, max 256×256 recommended)", 0.94, -1, "Left"));
  var btnLogo = app.CreateButton(card.logoImageId ? "Replace Logo" : "Add Logo", 0.94, 0.08);
  lay.AddChild(btnLogo);
  btnLogo.SetOnTouch(function(){
    chooseImageAsBase64(function(imgObj){
      var imgId = uuidv4();
      gData.images[imgId] = imgObj;
      card.logoImageId = imgId;
      btnLogo.SetText("Replace Logo");
    });
  });

  // Template fields (only visible when template)
  var layTpl = app.CreateLayout("Linear", "FillX");
  layTpl.SetPadding(0,0.01,0,0.01);

  layTpl.AddChild(app.CreateText("Template ID", 0.94, -1, "Left"));
  var edtTplId = app.CreateTextEdit(card.templateId || "tpl_basic", 0.94, 0.07);
  layTpl.AddChild(edtTplId);

  layTpl.AddChild(app.CreateText("Template data (JSON)", 0.94, -1, "Left"));
  var edtTplData = app.CreateTextEdit(JSON.stringify(card.templateData || {}, null, 0), 0.94, 0.14);
  layTpl.AddChild(edtTplData);

  lay.AddChild(layTpl);

  lay.AddChild(app.CreateText("Code type", 0.94, -1, "Left"));
  var spCodeType = app.CreateSpinner("none,barcode,qrcode", 0.94, 0.07);
  spCodeType.SelectItem(card.codeType || "none");
  lay.AddChild(spCodeType);

  lay.AddChild(app.CreateText("Barcode format (if barcode)", 0.94, -1, "Left"));
  var spBarFmt = app.CreateSpinner("ean13,code128", 0.94, 0.07);
  spBarFmt.SelectItem((card.barcodeFormat || "ean13").toLowerCase());
  lay.AddChild(spBarFmt);

  lay.AddChild(app.CreateText("Code value (EAN-13: 12 or 13 digits)", 0.94, -1, "Left"));
  var edtCode = app.CreateTextEdit(card.codeValue || "", 0.94, 0.07);
  lay.AddChild(edtCode);

  lay.AddChild(app.CreateText("Notes", 0.94, -1, "Left"));
  var edtNotes = app.CreateTextEdit(card.notes || "", 0.94, 0.14);
  lay.AddChild(edtNotes);

  // Photos
  lay.AddChild(app.CreateText("Photos", 0.94, -1, "Left"));
  var btnFront = app.CreateButton(card.frontImageId ? "Replace Front Photo" : "Add Front Photo", 0.94, 0.08);
  var btnBack  = app.CreateButton(card.backImageId ? "Replace Back Photo" : "Add Back Photo", 0.94, 0.08);
  lay.AddChild(btnFront);
  lay.AddChild(btnBack);

  btnFront.SetOnTouch(function(){
    chooseImageAsBase64(function(imgObj){
      var imgId = uuidv4();
      gData.images[imgId] = imgObj;
      card.frontImageId = imgId;
      btnFront.SetText("Replace Front Photo");
    });
  });
  btnBack.SetOnTouch(function(){
    chooseImageAsBase64(function(imgObj){
      var imgId = uuidv4();
      gData.images[imgId] = imgObj;
      card.backImageId = imgId;
      btnBack.SetText("Replace Back Photo");
    });
  });

  sc.AddChild(lay);
  layOuter.AddChild(sc);

  function refreshTplVisibility(){
    layTpl.SetVisibility(spKind.GetText() === "template" ? "Show" : "Hide");
  }
  spKind.SetOnChange(refreshTplVisibility);
  refreshTplVisibility();

  var layBtns = app.CreateLayout("Linear", "Horizontal,FillX");
  layBtns.SetPadding(0, 0.02, 0, 0);

  var btnSave = app.CreateButton("Save", 0.45, 0.085);
  var btnClose = app.CreateButton("Close", 0.45, 0.085);

  btnClose.SetOnTouch(function(){ dlg.Hide(); });

  btnSave.SetOnTouch(function(){
    var title = (edtTitle.GetText() || "").trim();
    if(!title){ app.Alert("Please enter a title."); return; }

    card.title = title;
    card.cardKind = spKind.GetText();

    if(card.cardKind === "template"){
      card.templateId = (edtTplId.GetText() || "tpl_basic").trim() || "tpl_basic";
      try { card.templateData = JSON.parse(edtTplData.GetText() || "{}"); }
      catch(e){ app.Alert("Template data must be valid JSON.\n\n" + e); return; }
    }

    card.codeType = spCodeType.GetText();
    card.barcodeFormat = spBarFmt.GetText();
    card.codeValue = (edtCode.GetText() || "").trim();
    card.notes = edtNotes.GetText() || "";

    if(!isEdit) gData.cards.push(card);

    saveData();
    renderHome();
    dlg.Hide();
  });

  layBtns.AddChild(btnSave);
  layBtns.AddChild(btnClose);
  layOuter.AddChild(layBtns);

  dlg.AddLayout(layOuter);
  dlg.Show();
}

// ------------------------------------------------------------
// Notes dialog
// ------------------------------------------------------------
function openNotesDialog(cardId){
  var card = findCardById(cardId);
  if(!card) return;

  var dlg = app.CreateDialog("", "NoTitle");
  var lay = app.CreateLayout("Linear", "FillXY");
  lay.SetPadding(0.03,0.03,0.03,0.03);

  var hdr = app.CreateText(card.title, 0.94, -1, "Left");
  hdr.SetTextSize(18);
  hdr.SetTextColor(gEffectiveFontColor);
  lay.AddChild(hdr);

  var edt = app.CreateTextEdit(card.notes || "", 0.94, 0.5);
  lay.AddChild(edt);

  var row = app.CreateLayout("Linear", "Horizontal,FillX");
  row.SetPadding(0, 0.02, 0, 0);
  var btnSave = app.CreateButton("Save", 0.45, 0.085);
  var btnClose = app.CreateButton("Close", 0.45, 0.085);

  btnSave.SetOnTouch(function(){
    card.notes = edt.GetText() || "";
    saveData();
    renderHome();
    dlg.Hide();
  });
  btnClose.SetOnTouch(function(){ dlg.Hide(); });

  row.AddChild(btnSave);
  row.AddChild(btnClose);
  lay.AddChild(row);

  dlg.AddLayout(lay);
  dlg.Show();
}

// ------------------------------------------------------------
// Photos viewer
// ------------------------------------------------------------
function openPhotosViewer(cardId){
  var card = findCardById(cardId);
  if(!card) return;

  var dlg = app.CreateDialog("", "NoTitle");
  var lay = app.CreateLayout("Linear", "FillXY");
  lay.SetPadding(0.03,0.03,0.03,0.03);

  var hdr = app.CreateText(card.title, 0.94, -1, "Left");
  hdr.SetTextSize(18);
  hdr.SetTextColor(gEffectiveFontColor);
  lay.AddChild(hdr);

  var asp = GetDisplayAspectSafe();
  var w = 0.94, h = w / 1.6 / asp;

  var wv = app.CreateWebView(w, h, "NoScroll,IgnoreErrors");
  wv.SetBackColor("#00000000");
  lay.AddChild(wv);

  var sides = [];
  if(card.frontImageId && gData.images[card.frontImageId]) sides.push({side:"front", id:card.frontImageId});
  if(card.backImageId && gData.images[card.backImageId]) sides.push({side:"back", id:card.backImageId});
  var idx = 0;

  function show(){
    if(sides.length === 0){ wv.LoadHtml(imageTileHtml("No photos", "", null)); return; }
    var cur = sides[idx];
    wv.LoadHtml(photoViewerHtml(cur.side.toUpperCase(), imageDataUri(cur.id)));
  }

  var nav = app.CreateLayout("Linear", "Horizontal,FillX");
  nav.SetPadding(0, 0.02, 0, 0);
  var btnPrev = app.CreateButton("◀", 0.2, 0.08);
  var btnNext = app.CreateButton("▶", 0.2, 0.08);
  var btnAR = app.CreateButton("Add/Replace", 0.5, 0.08);

  function refreshNav(){
    var en = (sides.length > 1);
    btnPrev.SetEnabled(en);
    btnNext.SetEnabled(en);
  }

  btnPrev.SetOnTouch(function(){
    if(sides.length <= 1) return;
    idx = (idx + sides.length - 1) % sides.length;
    show();
  });
  btnNext.SetOnTouch(function(){
    if(sides.length <= 1) return;
    idx = (idx + 1) % sides.length;
    show();
  });

  btnAR.SetOnTouch(function(){
    if(sides.length === 0){
      confirmDialog("Add Front photo?\n\nPress No to add Back.", function(yes){
        var side = yes ? "front" : "back";
        chooseAndSetPhoto(card, side, function(){
          sides = [];
          if(card.frontImageId && gData.images[card.frontImageId]) sides.push({side:"front", id:card.frontImageId});
          if(card.backImageId && gData.images[card.backImageId]) sides.push({side:"back", id:card.backImageId});
          idx = 0;
          refreshNav();
          show();
        });
      });
    } else {
      var sideNow = sides[idx].side;
      chooseAndSetPhoto(card, sideNow, function(){
        // update id in sides
        if(sideNow === "front") sides[idx].id = card.frontImageId;
        else sides[idx].id = card.backImageId;
        show();
      });
    }
  });

  nav.AddChild(btnPrev);
  nav.AddChild(btnNext);
  nav.AddChild(btnAR);
  lay.AddChild(nav);

  var btnClose = app.CreateButton("Close", 0.4, 0.085);
  btnClose.SetOnTouch(function(){ dlg.Hide(); });
  lay.AddChild(spacer(0.02));
  lay.AddChild(btnClose);

  dlg.AddLayout(lay);
  dlg.Show();

  refreshNav();
  show();
}

function photoViewerHtml(label, dataUri){
  if(!dataUri) return imageTileHtml("No Photo", "", null);
  return `
<!doctype html><html><head><meta name="viewport" content="width=device-width,height=device-height,initial-scale=1,user-scalable=no" />
<style>
  html,body{margin:0;padding:0;height:100%;background:transparent;font-family:sans-serif;}
  .wrap{height:100%;border-radius:18px;overflow:hidden;border:1px solid rgba(255,255,255,.18);position:relative;background:#111;}
  img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}
  .lbl{position:absolute;top:10px;left:10px;padding:6px 10px;border-radius:12px;
       background:rgba(0,0,0,.35);color:white;font-weight:800;font-size:12px;}
</style></head><body>
  <div class="wrap"><img src="${dataUri}" /><div class="lbl">${escapeHtml(label)}</div></div>
</body></html>`;
}

function chooseAndSetPhoto(card, side, done){
  chooseImageAsBase64(function(imgObj){
    var id = uuidv4();
    gData.images[id] = imgObj;
    if(side === "front") card.frontImageId = id;
    else card.backImageId = id;
    saveData();
    if(done) done();
  });
}

// ------------------------------------------------------------
// Settings & Tools dialog
// ------------------------------------------------------------
function openSettingsToolsDialog(){
  var dlg = app.CreateDialog("", "NoTitle");
  var lay = app.CreateLayout("Linear", "FillXY");
  lay.SetPadding(0.03,0.03,0.03,0.03);

  var hdr = app.CreateText("Settings & Tools", 0.94, -1, "Left");
  hdr.SetTextSize(20);
  hdr.SetTextColor(gEffectiveFontColor);
  lay.AddChild(hdr);

  var tabs = app.CreateLayout("Linear", "Horizontal,FillX");
  var btnSettings = app.CreateButton("Settings", 0.45, 0.08);
  var btnTools = app.CreateButton("Tools", 0.45, 0.08);
  tabs.AddChild(btnSettings);
  tabs.AddChild(btnTools);
  lay.AddChild(tabs);

  var laySettings = app.CreateLayout("Linear", "FillX");
  var layTools = app.CreateLayout("Linear", "FillX");

  // Settings: gradient colors + sort mode
  laySettings.AddChild(app.CreateText("Background gradient", 0.94, -1, "Left"));
  var btnTop = app.CreateButton("Pick Top Color (" + gData.settings.gradientTop + ")", 0.94, 0.08);
  var btnBot = app.CreateButton("Pick Bottom Color (" + gData.settings.gradientBottom + ")", 0.94, 0.08);

  btnTop.SetOnTouch(function(){
    pickColor(gData.settings.gradientTop, function(col){
      gData.settings.gradientTop = col;
      btnTop.SetText("Pick Top Color (" + col + ")");
      saveData(); renderHome();
    });
  });
  btnBot.SetOnTouch(function(){
    pickColor(gData.settings.gradientBottom, function(col){
      gData.settings.gradientBottom = col;
      btnBot.SetText("Pick Bottom Color (" + col + ")");
      saveData(); renderHome();
    });
  });

  laySettings.AddChild(btnTop);
  laySettings.AddChild(btnBot);

  laySettings.AddChild(spacer(0.01));
  laySettings.AddChild(app.CreateText("Sort cards by", 0.94, -1, "Left"));
  var spSort = app.CreateSpinner("alphabetical,frequently_used,last_used", 0.94, 0.07);
  spSort.SelectItem(gData.settings.sortMode || "alphabetical");
  spSort.SetOnChange(function(){
    gData.settings.sortMode = spSort.GetText();
    saveData(); renderHome();
  });
  laySettings.AddChild(spSort);

  // Tools: import/export + override consent checkbox
  layTools.AddChild(app.CreateText("Import / Export", 0.94, -1, "Left")); // (typo guard; will be corrected below)
  // Fix above line: recreate as normal text
  layTools = app.CreateLayout("Linear", "FillX");
  layTools.AddChild(app.CreateText("Import / Export", 0.94, -1, "Left"));

  var chkOverride = app.CreateCheckBox("Override on consent (merge conflicts)", 0.94, -1);
  layTools.AddChild(chkOverride);

  var btnImport = app.CreateButton("Import JSON", 0.94, 0.085);
  var btnExport = app.CreateButton("Export JSON", 0.94, 0.085);

  btnImport.SetOnTouch(function(){
    app.ChooseFile("Select JSON", "*.json", function(path){
      if(!path) return;
      try {
        var incoming = normalizeDataset(JSON.parse(app.ReadFile(path)));
        importDataset(incoming, chkOverride.GetChecked(), function(){
          saveData();
          renderHome();
          app.ShowPopup("Import complete.");
        });
      } catch(e) {
        app.Alert("Import failed.\n\n" + e);
      }
    });
  });

  btnExport.SetOnTouch(function(){
    saveData();
    app.ShowPopup("Exported to:\n" + DATA_FILE);
  });

  layTools.AddChild(btnImport);
  layTools.AddChild(btnExport);

  lay.AddChild(laySettings);
  lay.AddChild(layTools);

  function show(which){
    laySettings.SetVisibility(which === "settings" ? "Show" : "Hide");
    layTools.SetVisibility(which === "tools" ? "Show" : "Hide");
  }
  btnSettings.SetOnTouch(function(){ show("settings"); });
  btnTools.SetOnTouch(function(){ show("tools"); });
  show("settings");

  var btnClose = app.CreateButton("Close", 0.4, 0.085);
  btnClose.SetOnTouch(function(){ dlg.Hide(); });
  lay.AddChild(spacer(0.02));
  lay.AddChild(btnClose);

  dlg.AddLayout(lay);
  dlg.Show();
}

// ------------------------------------------------------------
// Import merge (by UUID; default ignore existing; optional override w/ consent)
// ------------------------------------------------------------
function importDataset(incoming, overrideOnConsent, done){
  // Merge images first
  Object.keys(incoming.images).forEach(function(imgId){
    if(!gData.images[imgId]) gData.images[imgId] = incoming.images[imgId];
  });

  var byId = {};
  gData.cards.forEach(function(c){ byId[c.id] = c; });

  var conflicts = [];
  incoming.cards.forEach(function(inc){
    if(!inc.id) return;
    if(!byId[inc.id]) {
      gData.cards.push(inc);
      byId[inc.id] = inc;
    } else {
      // default ignore unless overrideOnConsent checked
      if(overrideOnConsent) conflicts.push(inc);
    }
  });

  function next(){
    if(conflicts.length === 0){ if(done) done(); return; }
    var incCard = conflicts.shift();
    confirmDialog("Override existing card?\n\n" + incCard.title, function(yes){
      if(yes){
        var dst = byId[incCard.id];
        for(var k in incCard) dst[k] = incCard[k];
      }
      next();
    });
  }
  next();
}

// ------------------------------------------------------------
// Custom dialogs (Confirm / Input)
// ------------------------------------------------------------
function confirmDialog(message, cb){
  var dlg = app.CreateDialog("", "NoTitle");
  var lay = app.CreateLayout("Linear", "FillXY");
  lay.SetPadding(0.04,0.04,0.04,0.04);

  var txt = app.CreateText(message, 0.92, -1, "Left,Multiline");
  txt.SetTextColor(gEffectiveFontColor);
  txt.SetTextSize(16);
  lay.AddChild(txt);

  var row = app.CreateLayout("Linear", "Horizontal,FillX");
  row.SetPadding(0,0.03,0,0);

  var yes = app.CreateButton("Yes", 0.44, 0.085);
  var no = app.CreateButton("No", 0.44, 0.085);

  yes.SetOnTouch(function(){ dlg.Hide(); cb(true); });
  no.SetOnTouch(function(){ dlg.Hide(); cb(false); });

  row.AddChild(yes); row.AddChild(no);
  lay.AddChild(row);

  dlg.AddLayout(lay);
  dlg.Show();
}

function inputDialog(title, initial, cb){
  var dlg = app.CreateDialog("", "NoTitle");
  var lay = app.CreateLayout("Linear", "FillXY");
  lay.SetPadding(0.04,0.04,0.04,0.04);

  var hdr = app.CreateText(title, 0.92, -1, "Left");
  hdr.SetTextColor(gEffectiveFontColor);
  hdr.SetTextSize(18);
  lay.AddChild(hdr);

  var edt = app.CreateTextEdit(initial || "", 0.92, 0.08);
  lay.AddChild(edt);

  var row = app.CreateLayout("Linear", "Horizontal,FillX");
  row.SetPadding(0,0.03,0,0);

  var ok = app.CreateButton("OK", 0.44, 0.085);
  var cancel = app.CreateButton("Cancel", 0.44, 0.085);

  ok.SetOnTouch(function(){ var v = edt.GetText(); dlg.Hide(); cb(v); });
  cancel.SetOnTouch(function(){ dlg.Hide(); cb(null); });

  row.AddChild(ok); row.AddChild(cancel);
  lay.AddChild(row);

  dlg.AddLayout(lay);
  dlg.Show();
}

// ------------------------------------------------------------
// Image picker -> base64 (your proven approach)
// ------------------------------------------------------------
function chooseImageAsBase64(cb){
  app.ChooseImage("Internal", function(path){
    if(!path) return;
    try {
      var b64 = app.ReadFile(path, "base64");
      var mime = guessMimeFromPath(path);
      cb({ mime: mime, base64: b64 });
    } catch(e){
      app.Alert("Could not read image as base64.\n\n" + e);
    }
  });
}

function imageDataUri(imageId){
  if(!imageId) return null;
  var obj = gData.images[imageId];
  if(!obj || !obj.base64) return null;
  var mime = obj.mime || "image/png";
  return "data:" + mime + ";base64," + obj.base64;
}

// ------------------------------------------------------------
// Tile HTML for image cards (Home + used for preview too)
// ------------------------------------------------------------
function imageTileHtml(title, notes, dataUri){
  var safeTitle = escapeHtml(title || "");
  var safeSub = escapeHtml((notes || "").trim());
  var bg = dataUri
    ? "url('" + dataUri + "')"
    : "linear-gradient(135deg, rgba(255,255,255,.10), rgba(0,0,0,.25))";
  var placeholder = dataUri ? "" : `<div class="ph">No Photo</div>`;

  return `
<!doctype html><html><head>
<meta name="viewport" content="width=device-width,height=device-height,initial-scale=1,user-scalable=no" />
<style>
  html,body{margin:0;padding:0;height:100%;background:transparent;font-family:sans-serif;}
  .card{height:100%;border-radius:18px;overflow:hidden;background:${bg};
    background-size:cover;background-position:center;border:1px solid rgba(255,255,255,.18);position:relative;}
  .title{position:absolute;left:10px;right:10px;top:10px;color:white;text-shadow:0 1px 2px rgba(0,0,0,.6);
    font-size:16px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .sub{position:absolute;left:10px;right:10px;top:34px;color:rgba(255,255,255,.85);text-shadow:0 1px 2px rgba(0,0,0,.6);
    font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.8);
    font-size:13px;font-weight:700;}
</style></head>
<body><div class="card">${placeholder}<div class="title">${safeTitle}</div><div class="sub">${safeSub}</div></div></body></html>`;
}

// ------------------------------------------------------------
// Gradient background + luminance font color
// ------------------------------------------------------------
function applyGradientBackground(){
  if(wvBg) wvBg.LoadHtml(gradientHtml(gData.settings.gradientTop, gData.settings.gradientBottom));
  computeEffectiveFontColor();
  if(txtHdr) txtHdr.SetTextColor(gEffectiveFontColor);
}

function gradientHtml(top, bot){
  return `
<!doctype html><html><head>
<meta name="viewport" content="width=device-width,height=device-height,initial-scale=1,user-scalable=no" />
<style>html,body{margin:0;height:100%;background:linear-gradient(${escapeHtml(top)}, ${escapeHtml(bot)});}</style>
</head><body></body></html>`;
}

function pickColor(initialHex, cb){
  if(app.ChooseColor){
    app.ChooseColor(initialHex || "#FFFFFF", function(col){
      if(!col) return;
      cb(normalizeHex(col));
    });
  } else {
    inputDialog("Enter hex color (#RRGGBB)", initialHex || "#FFFFFF", function(val){
      if(!val) return;
      cb(normalizeHex(val));
    });
  }
}

// ------------------------------------------------------------
// Data model
// ------------------------------------------------------------
function ensureFolders(){
  if(!app.FileExists(BASE_DIR)) app.MakeFolder(BASE_DIR);
}

function createDefaultDataset(){
  return {
    version: 1,
    settings: {
      gradientTop: "#460075",
      gradientBottom: "#000000",
      sortMode: "alphabetical",
      fontColorMode: "auto"
    },
    cards: [],
    images: {}
  };
}

function loadOrInitData(){
  if(app.FileExists(DATA_FILE)){
    try {
      var raw = app.ReadFile(DATA_FILE);
      gData = normalizeDataset(JSON.parse(raw));
      return;
    } catch(e){
      app.Alert("Failed to read dataset.json. Creating a new dataset.\n\n" + e);
    }
  }
  gData = createDefaultDataset();
  saveData();
}

function normalizeDataset(d){
  if(!d || typeof d !== "object") return createDefaultDataset();
  if(!d.settings) d.settings = {};
  if(!d.settings.gradientTop) d.settings.gradientTop = "#460075";
  if(!d.settings.gradientBottom) d.settings.gradientBottom = "#000000";
  if(!d.settings.sortMode) d.settings.sortMode = "alphabetical";
  if(!d.settings.fontColorMode) d.settings.fontColorMode = "auto";
  if(!Array.isArray(d.cards)) d.cards = [];
  if(!d.images || typeof d.images !== "object") d.images = {};
  d.cards = d.cards.map(function(c){ return normalizeCard(c); });
  return d;
}

function normalizeCard(c){
  c = c || {};
  if(!c.id) c.id = uuidv4();
  if(!c.title) c.title = "Untitled";
  if(!c.cardKind) c.cardKind = "image"; // image|template
  if(!c.templateId) c.templateId = "tpl_basic";
  if(!c.templateData) c.templateData = {};
  if(!("codeType" in c)) c.codeType = "none"; // none|barcode|qrcode
  if(!c.barcodeFormat) c.barcodeFormat = "ean13"; // ean13|code128
  if(!("codeValue" in c)) c.codeValue = "";
  if(!("frontImageId" in c)) c.frontImageId = null;
  if(!("backImageId" in c)) c.backImageId = null;
  if(!("notes" in c)) c.notes = "";
  if(!("useCount" in c)) c.useCount = 0;
  if(!("lastUsed" in c)) c.lastUsed = 0;

  // Detail header fields
  if(!("headerColor" in c)) c.headerColor = "#2B2B2B";
  if(!("logoImageId" in c)) c.logoImageId = null;

  return c;
}

function saveData(){
  gcImages();
  app.WriteFile(DATA_FILE, JSON.stringify(gData, null, 2));
}

function gcImages(){
  var used = {};
  gData.cards.forEach(function(c){
    if(c.frontImageId) used[c.frontImageId]=true;
    if(c.backImageId) used[c.backImageId]=true;
    if(c.logoImageId) used[c.logoImageId]=true;
  });
  Object.keys(gData.images).forEach(function(id){
    if(!used[id]) delete gData.images[id];
  });
}

// Delete card + delete referenced images immediately (per spec)
function deleteCardById(id){
  var idx=-1;
  for(var i=0;i<gData.cards.length;i++){
    if(gData.cards[i].id === id){ idx=i; break; }
  }
  if(idx<0) return;
  var c = gData.cards[idx];
  if(c.frontImageId) delete gData.images[c.frontImageId];
  if(c.backImageId) delete gData.images[c.backImageId];
  if(c.logoImageId) delete gData.images[c.logoImageId];
  gData.cards.splice(idx,1);
}

function findCardById(id){
  for(var i=0;i<gData.cards.length;i++){
    if(gData.cards[i].id === id) return gData.cards[i];
  }
  return null;
}

// ------------------------------------------------------------
// Sorting
// ------------------------------------------------------------
function getSortedCards(){
  var cards = gData.cards.slice();
  var mode = gData.settings.sortMode || "alphabetical";

  if(mode === "alphabetical"){
    cards.sort(function(a,b){
      var aa=normStr(a.title), bb=normStr(b.title);
      return aa<bb?-1:aa>bb?1:0;
    });
    return cards;
  }

  if(mode === "frequently_used"){
    cards.sort(function(a,b){
      var au=a.useCount||0, bu=b.useCount||0;
      if(bu!==au) return bu-au;
      var aa=normStr(a.title), bb=normStr(b.title);
      return aa<bb?-1:aa>bb?1:0;
    });
    return cards;
  }

  if(mode === "last_used"){
    cards.sort(function(a,b){
      var al=a.lastUsed||0, bl=b.lastUsed||0;
      if(bl!==al) return bl-al;
      var aa=normStr(a.title), bb=normStr(b.title);
      return aa<bb?-1:aa>bb?1:0;
    });
    return cards;
  }

  return cards;
}

// ------------------------------------------------------------
// Font color: luminance of avg(top,bottom) > 0.75 -> black else white
// ------------------------------------------------------------
function computeEffectiveFontColor(){
  var top = gData.settings.gradientTop || "#460075";
  var bot = gData.settings.gradientBottom || "#000000";
  var avg = avgColor(top, bot);
  var lum = luminance01(avg);
  gEffectiveFontColor = (lum > 0.75) ? "#000000" : "#FFFFFF";
}

// ------------------------------------------------------------
// Small utilities
// ------------------------------------------------------------
function nowEpochSeconds(){ return Math.floor(Date.now()/1000); }

function uuidv4(){
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,function(c){
    var r=(Math.random()*16)|0, v=c==="x"?r:(r&0x3)|0x8;
    return v.toString(16);
  });
}

function normStr(s){
  s=(s||"").toString().trim().toLowerCase();
  try { s=s.normalize("NFD").replace(/[\u0300-\u036f]/g,""); } catch(e){}
  return s;
}

function escapeHtml(s){
  return (s||"").toString()
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

function escapeJs(s){
  return (s||"").toString()
    .replace(/\\/g,"\\\\").replace(/`/g,"\\`").replace(/\$/g,"\\$")
    .replace(/\r/g,"\\r").replace(/\n/g,"\\n").replace(/"/g,'\\"');
}

function normalizeHex(s){
  s=(s||"").trim();
  if(s[0] !== "#") s="#" + s;
  if(s.length === 4) s="#" + s[1]+s[1]+s[2]+s[2]+s[3]+s[3];
  return s.toUpperCase();
}

function guessMimeFromPath(path){
  var p=(path||"").toLowerCase();
  if(p.endsWith(".png")) return "image/png";
  if(p.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function hexToRgb01(hex){
  hex = normalizeHex(hex);
  return {
    r: parseInt(hex.substr(1,2),16)/255.0,
    g: parseInt(hex.substr(3,2),16)/255.0,
    b: parseInt(hex.substr(5,2),16)/255.0
  };
}

function avgColor(a,b){
  var A=hexToRgb01(a), B=hexToRgb01(b);
  var r=Math.round(((A.r+B.r)/2)*255);
  var g=Math.round(((A.g+B.g)/2)*255);
  var bb=Math.round(((A.b+B.b)/2)*255);
  return "#" + toHex2(r) + toHex2(g) + toHex2(bb);
}

function toHex2(n){
  var s=n.toString(16);
  return s.length===1 ? ("0"+s) : s;
}

function luminance01(hex){
  var c=hexToRgb01(hex);
  return 0.2126*c.r + 0.7152*c.g + 0.0722*c.b;
}
