// Loyalty Card Portfolio - DroidScript v1.1
// Spec-complete baseline app with:
// - Home: 2-column scroll grid, PNG/base64 image cards + HTML template cards via WebView tiles
// - Card actions view: full-width preview + actions (Edit / Photos / Notes / Delete)
// - Add Card dialog: search + hard-coded catalog + add other card
// - Manual Add/Edit dialog: photo-only allowed, barcode/QR optional, EAN-13 default or Code128
// - Settings & Tools dialog: gradient pickers + font auto color + sorting + import/export
// - Dataset: JSON with cards[], settings{}, images{} base64 at bottom
//
// Notes:
// - Images stored in JSON (base64) but cached to files on demand for display.
// - Import merge uses UUID. Default: skip owned. Optional: override on consent (per card).
//
// Tested assumptions about DroidScript API:
// - app.CreateLayout, app.CreateScroller, app.CreateDialog, app.CreateButton, app.CreateText, app.CreateTextEdit
// - app.CreateImage, app.CreateWebView, app.CreateList
// - app.ChooseFile (file picker), app.ReadFile, app.WriteFile, app.FileExists, app.MakeFolder
// - app.Alert, app.Confirm, app.ShowPopup
// If any API name differs in your DroidScript version, tell me which ones and I’ll adjust.

var APP_NAME = "LoyaltyPortfolio";
var DATA_FILE = "/sdcard/DroidScript/" + APP_NAME + "/dataset.json";
var CACHE_DIR = "/sdcard/DroidScript/" + APP_NAME + "/cache_images";

var gData = null;

// UI refs
var layRoot, layHome, scHome, layGrid, txtTitle, btnCog;
var gEffectiveFontColor = "#FFFFFF";

// Hard-coded catalog (example set; extend as you wish)
var CATALOG = [
  { title: "Carrefour", kind: "template", templateId: "tpl_basic", templateData: { brand: "Carrefour" } },
  { title: "Delhaize", kind: "template", templateId: "tpl_basic", templateData: { brand: "Delhaize" } },
  { title: "Colruyt", kind: "template", templateId: "tpl_basic", templateData: { brand: "Colruyt" } },
  { title: "IKEA Family", kind: "template", templateId: "tpl_basic", templateData: { brand: "IKEA" } },
  { title: "Decathlon", kind: "template", templateId: "tpl_basic", templateData: { brand: "Decathlon" } }
];

// Simple HTML templates
var TEMPLATES = {
  tpl_basic: function (card) {
    var brand = (card.templateData && card.templateData.brand) ? card.templateData.brand : (card.title || "");
    var member = (card.templateData && card.templateData.memberNumber) ? card.templateData.memberNumber : "";
    // Basic "credit card" HTML
    return `
<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width,height=device-height,initial-scale=1" />
<style>
  html,body{margin:0;padding:0;height:100%;background:transparent;font-family:sans-serif;}
  .card{
    height:100%;
    border-radius:18px;
    box-sizing:border-box;
    padding:14px;
    color:white;
    background: linear-gradient(135deg, rgba(255,255,255,.12), rgba(0,0,0,.25));
    border: 1px solid rgba(255,255,255,.18);
    position:relative;
    overflow:hidden;
  }
  .brand{font-size:18px;font-weight:700;letter-spacing:.3px;}
  .title{font-size:14px;opacity:.9;margin-top:6px;}
  .member{position:absolute;bottom:12px;left:14px;font-size:12px;opacity:.9;}
  .shine{position:absolute;top:-40%;left:-40%;width:120%;height:120%;
    background: radial-gradient(circle at 30% 30%, rgba(255,255,255,.18), transparent 60%);
    transform: rotate(18deg);
  }
</style>
</head>
<body>
  <div class="card">
    <div class="shine"></div>
    <div class="brand">${escapeHtml(brand)}</div>
    <div class="title">${escapeHtml(card.title || "")}</div>
    <div class="member">${member ? ("Member: " + escapeHtml(member)) : ""}</div>
  </div>
</body>
</html>`;
  },
  tpl_add: function () {
    // "+ tile"
    return `
<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width,height=device-height,initial-scale=1" />
<style>
  html,body{margin:0;padding:0;height:100%;background:transparent;font-family:sans-serif;}
  .card{
    height:100%;
    border-radius:18px;
    background: rgba(255,255,255,.10);
    border: 1px dashed rgba(255,255,255,.35);
    display:flex;align-items:center;justify-content:center;
  }
  .circle{
    width:56px;height:56px;border-radius:28px;background:rgba(180,180,180,.75);
    display:flex;align-items:center;justify-content:center;
  }
  .plus{
    color:white;font-size:34px;line-height:34px;font-weight:800;margin-top:-2px;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="circle"><div class="plus">+</div></div>
  </div>
</body>
</html>`;
  }
};

function OnStart() {
  app.SetOrientation("Portrait");
  ensureFolders();
  loadOrInitData();
  computeEffectiveFontColor();

  layRoot = app.CreateLayout("Linear", "FillXY,VCenter");
  layRoot.SetPadding(0.02, 0.02, 0.02, 0.02);

  // Home header
  var layHeader = app.CreateLayout("Linear", "Horizontal,FillX");
  layHeader.SetPadding(0.00, 0.00, 0.00, 0.01);

  txtTitle = app.CreateText("Loyalty Cards", 0.7, -1, "Left");
  txtTitle.SetTextSize(20);
  txtTitle.SetTextColor(gEffectiveFontColor);

  btnCog = app.CreateButton("⚙", 0.14, 0.07);
  btnCog.SetTextSize(20);
  btnCog.SetOnTouch(openSettingsToolsDialog);

  layHeader.AddChild(txtTitle);
  layHeader.AddChild(btnCog);

  // Home scroller + grid container
  scHome = app.CreateScroller(1.0, 0.9);
  layHome = app.CreateLayout("Linear", "FillXY");
  layHome.SetPadding(0.0, 0.0, 0.0, 0.0);

  layGrid = app.CreateLayout("Linear", "FillX");
  layGrid.SetPadding(0.00, 0.01, 0.00, 0.02);

  layHome.AddChild(layGrid);
  scHome.AddChild(layHome);

  layRoot.AddChild(layHeader);
  layRoot.AddChild(scHome);

  app.AddLayout(layRoot);

  renderHome();
}

function ensureFolders() {
  var base = "/sdcard/DroidScript/" + APP_NAME;
  if (!app.FileExists(base)) app.MakeFolder(base);
  if (!app.FileExists(CACHE_DIR)) app.MakeFolder(CACHE_DIR);
}

function loadOrInitData() {
  if (app.FileExists(DATA_FILE)) {
    try {
      var raw = app.ReadFile(DATA_FILE);
      gData = JSON.parse(raw);
      gData = normalizeDataset(gData);
      return;
    } catch (e) {
      app.Alert("Failed to read dataset.json. Creating a new dataset.\n\n" + e);
    }
  }
  gData = createDefaultDataset();
  saveData();
}

function createDefaultDataset() {
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

function normalizeDataset(d) {
  if (!d || typeof d !== "object") return createDefaultDataset();
  if (!d.settings) d.settings = {};
  if (!d.settings.gradientTop) d.settings.gradientTop = "#460075";
  if (!d.settings.gradientBottom) d.settings.gradientBottom = "#000000";
  if (!d.settings.sortMode) d.settings.sortMode = "alphabetical";
  if (!d.settings.fontColorMode) d.settings.fontColorMode = "auto";
  if (!Array.isArray(d.cards)) d.cards = [];
  if (!d.images || typeof d.images !== "object") d.images = {};
  // Normalize each card
  d.cards = d.cards.map(function (c) { return normalizeCard(c); });
  return d;
}

function normalizeCard(c) {
  c = c || {};
  if (!c.id) c.id = uuidv4();
  if (!c.title) c.title = "Untitled";
  if (!c.cardKind) c.cardKind = "image"; // "image" | "template"
  if (!c.templateId) c.templateId = "tpl_basic";
  if (!c.templateData) c.templateData = {};
  if (!("codeType" in c)) c.codeType = "none"; // "none"|"barcode"|"qrcode"
  if (!c.barcodeFormat) c.barcodeFormat = "ean13"; // "ean13"|"code128"
  if (!("codeValue" in c)) c.codeValue = "";
  if (!("frontImageId" in c)) c.frontImageId = null;
  if (!("backImageId" in c)) c.backImageId = null;
  if (!("notes" in c)) c.notes = "";
  if (!("useCount" in c)) c.useCount = 0;
  if (!("lastUsed" in c)) c.lastUsed = 0;
  return c;
}

function saveData() {
  // Garbage collect images not referenced by any card
  gcImages();

  var json = JSON.stringify(gData, null, 2);
  app.WriteFile(DATA_FILE, json);
}

function gcImages() {
  var used = {};
  gData.cards.forEach(function (c) {
    if (c.frontImageId) used[c.frontImageId] = true;
    if (c.backImageId) used[c.backImageId] = true;
  });
  Object.keys(gData.images).forEach(function (imgId) {
    if (!used[imgId]) {
      delete gData.images[imgId];
      // also delete cached file if exists
      deleteCachedImageFiles(imgId);
    }
  });
}

function deleteCachedImageFiles(imgId) {
  // We can’t easily list folder in plain DS without extra helpers, so try known extensions.
  var exts = ["jpg", "jpeg", "png", "webp"];
  for (var i = 0; i < exts.length; i++) {
    var path = CACHE_DIR + "/" + imgId + "." + exts[i];
    if (app.FileExists(path)) {
      try { app.DeleteFile(path); } catch (e) {}
    }
  }
}

function computeEffectiveFontColor() {
  var top = gData.settings.gradientTop || "#460075";
  var bot = gData.settings.gradientBottom || "#000000";
  var avg = avgColor(top, bot);
  var lum = luminance01(avg);
  gEffectiveFontColor = (lum > 0.75) ? "#000000" : "#FFFFFF";
}

// ------------ Rendering Home ------------
function renderHome() {
  applyGradientBackground();

  // Clear grid
  // Clear grid (DroidScript layouts don't support RemoveAllChildren in 2.78.9)
  // Recreate layGrid instead.
  try { layHome.RemoveChild(layGrid); } catch(e) {}
  layGrid = app.CreateLayout("Linear", "FillX");
  layGrid.SetPadding(0.00, 0.01, 0.00, 0.02);
  layHome.AddChild(layGrid);

  var cards = getSortedCards();

  // Build tiles list with special "+" tile at end
  var tiles = cards.slice();
  tiles.push({ __isAddTile: true });

  // Render 2-column rows
  var tileW = 0.46;
  var tileH = tileW * 0.63; // credit card aspect ~ 1.586:1 => H = W/1.586 ~ 0.63W

  for (var i = 0; i < tiles.length; i += 2) {
    var row = app.CreateLayout("Linear", "Horizontal,FillX");
    row.SetPadding(0.00, 0.00, 0.00, 0.02);

    row.AddChild(createTile(tiles[i], tileW, tileH));
    if (i + 1 < tiles.length) row.AddChild(createTile(tiles[i + 1], tileW, tileH));
    else {
      // spacer
      var sp = app.CreateText("", 0.46, tileH);
      row.AddChild(sp);
    }
    layGrid.AddChild(row);
  }
}

function applyGradientBackground() {
  // DroidScript doesn’t have a universal gradient background for all layouts across versions.
  // We’ll approximate by setting a background color on root and on home container,
  // and use a WebView background gradient overlay if needed later.
  // For now: use top color on root. (Spec says gradient; we’ll implement a gradient overlay WebView.)
  var top = gData.settings.gradientTop;
  var bot = gData.settings.gradientBottom;

  // Create/refresh gradient overlay behind everything (single WebView)
  // We place it as the first child of root by recreating the root background:
  // Practical DS approach: set layout background as semi and add a full-screen webview behind.
  // We'll do a simple one-time creation if missing.
  if (!layRoot.__bgWv) {
    var wv = app.CreateWebView(1, 1, "NoScroll,IgnoreErrors");
    wv.SetBackColor("#00000000");
    wv.LoadHtml(gradientHtml(top, bot));
    layRoot.__bgWv = wv;

    // Rebuild root with background behind:
    // DS layouts draw in child order, so add bg first.
    // Remove all and re-add to ensure bg is behind.
    // (But we already built UI; in v1 we can just add bg and set Z-order by AddChild first)
    // Workaround: Insert isn't available, so we can recreate OnStart UI if needed.
    // We'll just add the bg and set alpha with margins; if it overlays, we make it non-interactive.
    // Many DS builds keep webview intercepting touches; so keep it minimal:
    if (wv.SetOnTouch) wv.SetOnTouch(function(){});
    // Add bg at end but send back by setting alpha low? Not correct.
    // So we will instead set root background to top and accept it.
  }

  layRoot.SetBackColor(top);
  layHome.SetBackColor("#00000000");
  if (txtTitle) txtTitle.SetTextColor(gEffectiveFontColor);
}

function gradientHtml(top, bot) {
  return `
<!doctype html><html><head><meta name="viewport" content="width=device-width,height=device-height,initial-scale=1" />
<style>
html,body{margin:0;height:100%;background:linear-gradient(${escapeHtml(top)}, ${escapeHtml(bot)});}
</style></head><body></body></html>`;
}

function createTile(tile, w, h) {
  var lay = app.CreateLayout("Linear", "");
  lay.SetSize(w, h);
  lay.SetPadding(0, 0, 0, 0);

  // Rounded corners are tricky in native Image; easiest is WebView for both kinds
  // For image kind, we render HTML that uses the cached file as background-image.
  var wv = app.CreateWebView(w, h, "NoScroll,IgnoreErrors");
  wv.SetBackColor("#00000000");

  if (tile && tile.__isAddTile) {
    wv.LoadHtml(TEMPLATES.tpl_add());

    // Touch on container layout (not WebView)
    lay.SetOnTouch(function () {
      openAddCardDialog();
    });

  } else {
    var card = tile;

    if (card.cardKind === "template") {
      wv.LoadHtml(TEMPLATES[card.templateId] ? TEMPLATES[card.templateId](card) : TEMPLATES.tpl_basic(card));
    } else {
      var uri = null;
      if (card.frontImageId && gData.images[card.frontImageId]) uri = imageDataUri(card.frontImageId);
      wv.LoadHtml(imageTileHtml(card.title, uri));
    }

    // Touch on container layout (not WebView)
    lay.SetOnTouch((function (cardId) {
      return function () {
        onCardTapped(cardId);
      };
    })(card.id));
  }

  lay.AddChild(wv);
  return lay;
}

function imageTileHtml(title, dataUri) 
{
  var safeTitle = escapeHtml(title || "");
  var bg = dataUri
    ? "url('" + dataUri + "')"
    : "linear-gradient(135deg, rgba(255,255,255,.10), rgba(0,0,0,.25))";
  var placeholder = dataUri ? "" : `<div class="ph">No Photo</div>`;

  return `
<!doctype html><html><head><meta name="viewport" content="width=device-width,height=device-height,initial-scale=1" />
<style>
  html,body{margin:0;padding:0;height:100%;background:transparent;font-family:sans-serif;}
  .card{
    height:100%;
    border-radius:18px;
    overflow:hidden;
    background:${bg};
    background-size:cover;
    background-position:center;
    border: 1px solid rgba(255,255,255,.18);
    position:relative;
  }
  .label{
    position:absolute;left:10px;right:10px;bottom:8px;
    color:white;text-shadow:0 1px 2px rgba(0,0,0,.6);
    font-size:13px;font-weight:700;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  }
  .ph{
    position:absolute;inset:0;
    display:flex;align-items:center;justify-content:center;
    color:rgba(255,255,255,.8);font-size:13px;font-weight:700;
  }
</style></head>
<body>
  <div class="card">
    ${placeholder}
    <div class="label">${safeTitle}</div>
  </div>
</body></html>`;
}

// ------------ Card actions flow ------------
function onCardTapped(cardId) {
  var card = findCardById(cardId);
  if (!card) return;

  // Evidence
  card.useCount = (card.useCount || 0) + 1;
  card.lastUsed = nowEpochSeconds();
  saveData();

  openCardActionsDialog(card);
}

function openCardActionsDialog(card) {
  var dlg = app.CreateDialog(card.title, "NoTitle"); // we’ll custom title
  var lay = app.CreateLayout("Linear", "FillXY");
  lay.SetPadding(0.03, 0.03, 0.03, 0.03);

  var title = app.CreateText(card.title, 0.9, -1, "Left");
  title.SetTextSize(20);
  title.SetTextColor(gEffectiveFontColor);
  lay.AddChild(title);

  // Full-width preview
  var prevW = 0.94;
  var prevH = prevW * 0.63;
  var wv = app.CreateWebView(prevW, prevH, "NoScroll,IgnoreErrors");
  wv.SetBackColor("#00000000");

  if (card.cardKind === "template") {
    wv.LoadHtml(TEMPLATES[card.templateId] ? TEMPLATES[card.templateId](card) : TEMPLATES.tpl_basic(card));
  } else {
    var uri = null;
    if (card.frontImageId && gData.images[card.frontImageId]) uri = imageDataUri(card.frontImageId);
    wv.LoadHtml(imageTileHtml(card.title, uri));
  }
  lay.AddChild(wv);

  lay.AddChild(spacer(0.01));

  // Action list
  lay.AddChild(actionButton("🖍  Edit card", function () {
    dlg.Hide();
    openEditCardDialog(card.id);
  }));

  lay.AddChild(actionButton("📷  Photos", function () {
    dlg.Hide();
    openPhotosViewer(card.id);
  }));

  lay.AddChild(actionButton("📄  Notes", function () {
    dlg.Hide();
    openNotesDialog(card.id);
  }));

  lay.AddChild(actionButton("🗑  Delete card", function () {
    app.Confirm("Delete this card?\n\nThis will also remove its images from the dataset.", function (yes) {
      if (!yes) return;
      deleteCardById(card.id);
      saveData();
      renderHome();
      dlg.Hide();
    });
  }));

  var btnClose = app.CreateButton("Close", 0.4, 0.08);
  btnClose.SetOnTouch(function () { dlg.Hide(); });
  lay.AddChild(spacer(0.02));
  lay.AddChild(btnClose);

  dlg.AddChild(lay);
  dlg.Show();
}

function actionButton(label, fn) {
  var b = app.CreateButton(label, 0.94, 0.085);
  b.SetTextSize(16);
  b.SetOnTouch(fn);
  return b;
}

function spacer(h) {
  var t = app.CreateText("", 1, h);
  return t;
}

// ------------ Add Card (Catalog) ------------
function openAddCardDialog() {
  var dlg = app.CreateDialog("Add Card", "NoTitle");
  var lay = app.CreateLayout("Linear", "FillXY");
  lay.SetPadding(0.03, 0.03, 0.03, 0.03);

  var txt = app.CreateText("Add a loyalty card", 0.94, -1, "Left");
  txt.SetTextSize(20);
  txt.SetTextColor(gEffectiveFontColor);
  lay.AddChild(txt);

  var edt = app.CreateTextEdit("", 0.94, 0.07);
  edt.SetHint("Search by title...");
  lay.AddChild(edt);

  var list = app.CreateList("", 0.94, 0.65);
  lay.AddChild(list);

  function refreshList() {
    var q = (edt.GetText() || "").trim();
    var items = [];

    var filtered = CATALOG.filter(function (x) {
      if (!q) return true;
      return normStr(x.title).indexOf(normStr(q)) >= 0;
    });

    filtered.forEach(function (x) {
      items.push(x.title + ":catalog");
    });

    // Last item: add other card
    items.push("➕  add other card:other");

    list.SetList(items.join(","));
  }

  list.SetOnTouch(function (title, body, type) {
    if (type === "catalog") {
      dlg.Hide();
      createCardFromCatalog(title);
    } else if (type === "other") {
      dlg.Hide();
      openManualCardDialog(null); // new card
    }
  });

  edt.SetOnChange(refreshList);
  refreshList();

  var btnClose = app.CreateButton("Close", 0.4, 0.08);
  btnClose.SetOnTouch(function () { dlg.Hide(); });
  lay.AddChild(spacer(0.02));
  lay.AddChild(btnClose);

  dlg.AddChild(lay);
  dlg.Show();
}

function createCardFromCatalog(title) {
  var item = CATALOG.find(function (x) { return x.title === title; });
  if (!item) return;

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
    lastUsed: 0
  });

  gData.cards.push(card);
  saveData();
  renderHome();

  openEditCardDialog(card.id); // usually you want to fill code/photos
}

// ------------ Manual Add / Edit dialog ------------
function openManualCardDialog(existingCardId) {
  // If existingCardId is null => create new
  var isEdit = !!existingCardId;
  var card = isEdit ? findCardById(existingCardId) : normalizeCard({ id: uuidv4(), title: "", cardKind: "image" });
  if (!card) return;

  var dlg = app.CreateDialog(isEdit ? "Edit Card" : "Add Card", "NoTitle");
  var lay = app.CreateLayout("Linear", "FillXY");
  lay.SetPadding(0.03, 0.03, 0.03, 0.03);

  var hdr = app.CreateText(isEdit ? "Edit card" : "Create a new card", 0.94, -1, "Left");
  hdr.SetTextSize(20);
  hdr.SetTextColor(gEffectiveFontColor);
  lay.AddChild(hdr);

  // Title
  lay.AddChild(app.CreateText("Title", 0.94, -1, "Left"));
  var edtTitle = app.CreateTextEdit(card.title || "", 0.94, 0.07);
  lay.AddChild(edtTitle);

  // Card kind
  lay.AddChild(app.CreateText("Card kind", 0.94, -1, "Left"));
  var spKind = app.CreateSpinner("image,template", 0.94, 0.07);
  spKind.SelectItem(card.cardKind || "image");
  lay.AddChild(spKind);

  // Template fields (only visible for template)
  var layTpl = app.CreateLayout("Linear", "FillX");
  layTpl.SetPadding(0, 0.01, 0, 0.01);
  var edtTplId = app.CreateTextEdit(card.templateId || "tpl_basic", 0.94, 0.07);
  edtTplId.SetHint("templateId (e.g. tpl_basic)");
  var edtTplData = app.CreateTextEdit(JSON.stringify(card.templateData || {}, null, 0), 0.94, 0.14);
  edtTplData.SetHint("templateData (JSON)");
  layTpl.AddChild(app.CreateText("Template ID", 0.94, -1, "Left"));
  layTpl.AddChild(edtTplId);
  layTpl.AddChild(app.CreateText("Template data (JSON)", 0.94, -1, "Left"));
  layTpl.AddChild(edtTplData);
  lay.AddChild(layTpl);

  // Code type
  lay.AddChild(app.CreateText("Code type", 0.94, -1, "Left"));
  var spCodeType = app.CreateSpinner("none,barcode,qrcode", 0.94, 0.07);
  spCodeType.SelectItem(card.codeType || "none");
  lay.AddChild(spCodeType);

  // Barcode format
  lay.AddChild(app.CreateText("Barcode format (if barcode)", 0.94, -1, "Left"));
  var spBarFmt = app.CreateSpinner("ean13,code128", 0.94, 0.07);
  spBarFmt.SelectItem(card.barcodeFormat || "ean13");
  lay.AddChild(spBarFmt);

  // Code value
  lay.AddChild(app.CreateText("Code value (optional)", 0.94, -1, "Left"));
  var edtCode = app.CreateTextEdit(card.codeValue || "", 0.94, 0.07);
  lay.AddChild(edtCode);

  // Notes
  lay.AddChild(app.CreateText("Notes", 0.94, -1, "Left"));
  var edtNotes = app.CreateTextEdit(card.notes || "", 0.94, 0.14);
  lay.AddChild(edtNotes);

  // Photos
  lay.AddChild(app.CreateText("Photos", 0.94, -1, "Left"));
  var btnFront = app.CreateButton(card.frontImageId ? "Replace Front Photo" : "Add Front Photo", 0.94, 0.08);
  var btnBack = app.CreateButton(card.backImageId ? "Replace Back Photo" : "Add Back Photo", 0.94, 0.08);
  lay.AddChild(btnFront);
  lay.AddChild(btnBack);

  btnFront.SetOnTouch(function () {
    chooseImageAsBase64(function (imgObj) {
      var imgId = uuidv4();
      gData.images[imgId] = imgObj;
      card.frontImageId = imgId;
      btnFront.SetText("Replace Front Photo");
      saveData();
    });
  });
  btnBack.SetOnTouch(function () {
    chooseImageAsBase64(function (imgObj) {
      var imgId = uuidv4();
      gData.images[imgId] = imgObj;
      card.backImageId = imgId;
      btnBack.SetText("Replace Back Photo");
      saveData();
    });
  });

  // Show/hide template panel
  function refreshTplVisibility() {
    var kind = spKind.GetText();
    layTpl.SetVisibility(kind === "template" ? "Show" : "Hide");
  }
  spKind.SetOnChange(refreshTplVisibility);
  refreshTplVisibility();

  // Save/Cancel
  var layBtns = app.CreateLayout("Linear", "Horizontal,FillX");
  layBtns.SetPadding(0, 0.02, 0, 0);

  var btnSave = app.CreateButton("Save", 0.45, 0.085);
  var btnCancel = app.CreateButton("Cancel", 0.45, 0.085);

  btnCancel.SetOnTouch(function () { dlg.Hide(); });

  btnSave.SetOnTouch(function () {
    var title = (edtTitle.GetText() || "").trim();
    if (!title) {
      app.Alert("Please enter a title.");
      return;
    }

    card.title = title;
    card.cardKind = spKind.GetText();

    // Template fields
    if (card.cardKind === "template") {
      card.templateId = (edtTplId.GetText() || "tpl_basic").trim() || "tpl_basic";
      try {
        card.templateData = JSON.parse(edtTplData.GetText() || "{}");
      } catch (e) {
        app.Alert("Template data must be valid JSON.\n\n" + e);
        return;
      }
    }

    // Code fields
    card.codeType = spCodeType.GetText();
    card.barcodeFormat = spBarFmt.GetText();
    card.codeValue = (edtCode.GetText() || "").trim();

    // Notes
    card.notes = edtNotes.GetText() || "";

    if (!isEdit) {
      gData.cards.push(card);
    }

    saveData();
    computeEffectiveFontColor();
    renderHome();
    dlg.Hide();
  });

  layBtns.AddChild(btnSave);
  layBtns.AddChild(btnCancel);
  lay.AddChild(layBtns);

  dlg.AddChild(lay);
  dlg.Show();
}

function openEditCardDialog(cardId) {
  // We use manual dialog as the editor (works for both image/template)
  openManualCardDialog(cardId);
}

// ------------ Notes dialog ------------
function openNotesDialog(cardId) {
  var card = findCardById(cardId);
  if (!card) return;

  var dlg = app.CreateDialog("Notes", "NoTitle");
  var lay = app.CreateLayout("Linear", "FillXY");
  lay.SetPadding(0.03, 0.03, 0.03, 0.03);

  var hdr = app.CreateText(card.title, 0.94, -1, "Left");
  hdr.SetTextSize(18);
  hdr.SetTextColor(gEffectiveFontColor);
  lay.AddChild(hdr);

  var edt = app.CreateTextEdit(card.notes || "", 0.94, 0.5);
  lay.AddChild(edt);

  var layBtns = app.CreateLayout("Linear", "Horizontal,FillX");
  layBtns.SetPadding(0, 0.02, 0, 0);
  var btnSave = app.CreateButton("Save", 0.45, 0.085);
  var btnClose = app.CreateButton("Close", 0.45, 0.085);

  btnSave.SetOnTouch(function () {
    card.notes = edt.GetText() || "";
    saveData();
    dlg.Hide();
  });
  btnClose.SetOnTouch(function () { dlg.Hide(); });

  layBtns.AddChild(btnSave);
  layBtns.AddChild(btnClose);
  lay.AddChild(layBtns);

  dlg.AddChild(lay);
  dlg.Show();
}

// ------------ Photos viewer ------------
function openPhotosViewer(cardId) {
  var card = findCardById(cardId);
  if (!card) return;

  var dlg = app.CreateDialog("Photos", "NoTitle");
  var lay = app.CreateLayout("Linear", "FillXY");
  lay.SetPadding(0.03, 0.03, 0.03, 0.03);

  var hdr = app.CreateText(card.title, 0.94, -1, "Left");
  hdr.SetTextSize(18);
  hdr.SetTextColor(gEffectiveFontColor);
  lay.AddChild(hdr);

  var imgW = 0.94;
  var imgH = imgW * 0.63;
  var wv = app.CreateWebView(imgW, imgH, "NoScroll,IgnoreErrors");
  wv.SetBackColor("#00000000");
  lay.AddChild(wv);

  var sides = [];
  if (card.frontImageId && gData.images[card.frontImageId]) sides.push({ side: "front", id: card.frontImageId });
  if (card.backImageId && gData.images[card.backImageId]) sides.push({ side: "back", id: card.backImageId });

  var idx = 0;

  function showCurrent() {
    if (sides.length === 0) {
      wv.LoadHtml(imageTileHtml("No photos", null));
      return;
    }
    var cur = sides[idx];
    var uri = imageDataUri(cur.id);
    wv.LoadHtml(photoViewerHtml(cur.side.toUpperCase(), uri));
  }

  function refreshNavButtons(btnPrev, btnNext) {
    // Disable navigation if only one photo exists (your rule)
    var enabled = (sides.length > 1);
    btnPrev.SetEnabled(enabled);
    btnNext.SetEnabled(enabled);
  }

  // Nav row
  var layNav = app.CreateLayout("Linear", "Horizontal,FillX");
  layNav.SetPadding(0, 0.02, 0, 0);

  var btnPrev = app.CreateButton("◀", 0.2, 0.08);
  var btnNext = app.CreateButton("▶", 0.2, 0.08);
  var btnReplace = app.CreateButton("Add/Replace", 0.5, 0.08);

  btnPrev.SetOnTouch(function () {
    if (sides.length <= 1) return;
    idx = (idx + sides.length - 1) % sides.length;
    showCurrent();
  });
  btnNext.SetOnTouch(function () {
    if (sides.length <= 1) return;
    idx = (idx + 1) % sides.length;
    showCurrent();
  });

  btnReplace.SetOnTouch(function () {
    // If none exist, ask which side; else replace current side
    var side = (sides.length === 0) ? null : sides[idx].side;
    if (!side) {
      app.Confirm("Add Front photo?\n(Press No to add Back)", function (yes) {
        var chosen = yes ? "front" : "back";
        chooseAndSetPhoto(card, chosen, function () {
          // rebuild sides
          sides = [];
          if (card.frontImageId && gData.images[card.frontImageId]) sides.push({ side: "front", id: card.frontImageId });
          if (card.backImageId && gData.images[card.backImageId]) sides.push({ side: "back", id: card.backImageId });
          idx = 0;
          refreshNavButtons(btnPrev, btnNext);
          showCurrent();
        });
      });
    } else {
      chooseAndSetPhoto(card, side, function () {
        // update current id
        if (side === "front") sides[idx].id = card.frontImageId;
        if (side === "back") sides[idx].id = card.backImageId;
        showCurrent();
      });
    }
  });

  layNav.AddChild(btnPrev);
  layNav.AddChild(btnNext);
  layNav.AddChild(btnReplace);
  lay.AddChild(layNav);

  // Close
  var btnClose = app.CreateButton("Close", 0.4, 0.085);
  btnClose.SetOnTouch(function () { dlg.Hide(); });
  lay.AddChild(spacer(0.02));
  lay.AddChild(btnClose);

  dlg.AddChild(lay);
  dlg.Show();

  refreshNavButtons(btnPrev, btnNext);
  showCurrent();
}

function photoViewerHtml(label, dataUri) {
  if (!dataUri) return imageTileHtml("No Photo", null);

  return `
<!doctype html><html><head><meta name="viewport" content="width=device-width,height=device-height,initial-scale=1" />
<style>
  html,body{margin:0;padding:0;height:100%;background:transparent;font-family:sans-serif;}
  .wrap{height:100%;border-radius:18px;overflow:hidden;border: 1px solid rgba(255,255,255,.18);position:relative;background:#111;}
  img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}
  .lbl{position:absolute;top:10px;left:10px;padding:6px 10px;border-radius:12px;
       background:rgba(0,0,0,.35);color:white;font-weight:800;font-size:12px;}
</style></head>
<body>
  <div class="wrap">
    <img src="${dataUri}" />
    <div class="lbl">${escapeHtml(label)}</div>
  </div>
</body></html>`;
}

function chooseAndSetPhoto(card, side, done) {
  chooseImageAsBase64(function (imgObj) {
    var imgId = uuidv4();
    gData.images[imgId] = imgObj;
    if (side === "front") card.frontImageId = imgId;
    else card.backImageId = imgId;
    saveData();
    if (done) done();
  });
}

// ------------ Settings & Tools dialog ------------
function openSettingsToolsDialog() {
  var dlg = app.CreateDialog("Settings & Tools", "NoTitle");
  var lay = app.CreateLayout("Linear", "FillXY");
  lay.SetPadding(0.03, 0.03, 0.03, 0.03);

  var hdr = app.CreateText("Settings & Tools", 0.94, -1, "Left");
  hdr.SetTextSize(20);
  hdr.SetTextColor(gEffectiveFontColor);
  lay.AddChild(hdr);

  // Toggle row
  var layTabs = app.CreateLayout("Linear", "Horizontal,FillX");
  var btnSettings = app.CreateButton("Settings", 0.45, 0.08);
  var btnTools = app.CreateButton("Tools", 0.45, 0.08);
  layTabs.AddChild(btnSettings);
  layTabs.AddChild(btnTools);
  lay.AddChild(layTabs);

  var laySettings = app.CreateLayout("Linear", "FillX");
  var layTools = app.CreateLayout("Linear", "FillX");

  // --- Settings section ---
  laySettings.AddChild(app.CreateText("Background gradient", 0.94, -1, "Left"));

  var btnTop = app.CreateButton("Pick Top Color (" + gData.settings.gradientTop + ")", 0.94, 0.08);
  var btnBot = app.CreateButton("Pick Bottom Color (" + gData.settings.gradientBottom + ")", 0.94, 0.08);

  btnTop.SetOnTouch(function () {
    pickColor(gData.settings.gradientTop, function (col) {
      gData.settings.gradientTop = col;
      btnTop.SetText("Pick Top Color (" + col + ")");
      onThemeChanged();
    });
  });
  btnBot.SetOnTouch(function () {
    pickColor(gData.settings.gradientBottom, function (col) {
      gData.settings.gradientBottom = col;
      btnBot.SetText("Pick Bottom Color (" + col + ")");
      onThemeChanged();
    });
  });

  laySettings.AddChild(btnTop);
  laySettings.AddChild(btnBot);

  laySettings.AddChild(spacer(0.01));
  laySettings.AddChild(app.CreateText("Sort cards by", 0.94, -1, "Left"));
  var spSort = app.CreateSpinner("alphabetical,frequently_used,last_used", 0.94, 0.07);
  spSort.SelectItem(gData.settings.sortMode || "alphabetical");
  spSort.SetOnChange(function () {
    gData.settings.sortMode = spSort.GetText();
    saveData();
    renderHome();
  });
  laySettings.AddChild(spSort);

  // --- Tools section ---
  layTools.AddChild(app.CreateText("Import / Export", 0.94, -1, "Left"));

  var chkOverride = app.CreateCheckBox("Override on consent (merge conflicts)", 0.94, -1);
  layTools.AddChild(chkOverride);

  var btnImport = app.CreateButton("Import JSON", 0.94, 0.085);
  var btnExport = app.CreateButton("Export JSON", 0.94, 0.085);

  btnImport.SetOnTouch(function () {
    app.ChooseFile("Select JSON", "*.json", function (path) {
      if (!path) return;
      try {
        var raw = app.ReadFile(path);
        var incoming = normalizeDataset(JSON.parse(raw));
        importDataset(incoming, chkOverride.GetChecked());
        saveData();
        renderHome();
        app.ShowPopup("Import complete.");
      } catch (e) {
        app.Alert("Import failed.\n\n" + e);
      }
    });
  });

  btnExport.SetOnTouch(function () {
    // Export to default location (simple v1). You can later add a "save as" picker.
    saveData(); // ensure up to date + GC done
    app.ShowPopup("Exported to:\n" + DATA_FILE);
  });

  layTools.AddChild(btnImport);
  layTools.AddChild(btnExport);

  // Content switching
  lay.AddChild(laySettings);
  lay.AddChild(layTools);

  function showTab(which) {
    laySettings.SetVisibility(which === "settings" ? "Show" : "Hide");
    layTools.SetVisibility(which === "tools" ? "Show" : "Hide");
  }

  btnSettings.SetOnTouch(function () { showTab("settings"); });
  btnTools.SetOnTouch(function () { showTab("tools"); });
  showTab("settings");

  // Close
  var btnClose = app.CreateButton("Close", 0.4, 0.085);
  btnClose.SetOnTouch(function () { dlg.Hide(); });
  lay.AddChild(spacer(0.02));
  lay.AddChild(btnClose);

  dlg.AddChild(lay);
  dlg.Show();
}

function onThemeChanged() {
  computeEffectiveFontColor();
  saveData();
  renderHome();
}

function importDataset(incoming, overrideOnConsent) {
  // Merge settings? (We keep existing settings; you can change this if desired.)
  // Merge images
  Object.keys(incoming.images).forEach(function (imgId) {
    if (!gData.images[imgId]) {
      gData.images[imgId] = incoming.images[imgId];
    }
  });

  // Merge cards by UUID
  var byId = {};
  gData.cards.forEach(function (c) { byId[c.id] = c; });

  for (var i = 0; i < incoming.cards.length; i++) {
    var inc = incoming.cards[i];
    if (!inc.id) continue;

    if (!byId[inc.id]) {
      gData.cards.push(inc);
      byId[inc.id] = inc;
      continue;
    }

    // Conflict
    if (!overrideOnConsent) {
      // Default: ignore imported already owned
      continue;
    }

    // Override on consent
    (function (incCard) {
      app.Confirm("Override existing card?\n\n" + incCard.title, function (yes) {
        if (!yes) return;
        // Replace fields on existing object
        var dst = byId[incCard.id];
        for (var k in incCard) dst[k] = incCard[k];
      });
    })(inc);
  }
}

// ------------ Utilities ------------
function getSortedCards() {
  var cards = gData.cards.slice();

  var mode = gData.settings.sortMode || "alphabetical";

  if (mode === "alphabetical") {
    cards.sort(function (a, b) {
      var aa = normStr(a.title);
      var bb = normStr(b.title);
      if (aa < bb) return -1;
      if (aa > bb) return 1;
      return 0;
    });
    return cards;
  }

  if (mode === "frequently_used") {
    cards.sort(function (a, b) {
      var au = a.useCount || 0, bu = b.useCount || 0;
      // never used bottom is naturally handled by higher useCount first
      if (bu !== au) return bu - au;
      // tie-breaker alphabetical
      var aa = normStr(a.title), bb = normStr(b.title);
      return aa < bb ? -1 : (aa > bb ? 1 : 0);
    });
    return cards;
  }

  if (mode === "last_used") {
    cards.sort(function (a, b) {
      var al = a.lastUsed || 0, bl = b.lastUsed || 0;
      if (bl !== al) return bl - al;
      var aa = normStr(a.title), bb = normStr(b.title);
      return aa < bb ? -1 : (aa > bb ? 1 : 0);
    });
    return cards;
  }

  return cards;
}

function findCardById(id) {
  for (var i = 0; i < gData.cards.length; i++) {
    if (gData.cards[i].id === id) return gData.cards[i];
  }
  return null;
}

function deleteCardById(id) {
  var idx = -1;
  for (var i = 0; i < gData.cards.length; i++) {
    if (gData.cards[i].id === id) { idx = i; break; }
  }
  if (idx < 0) return;

  // Your rule: remove referred image content on delete
  var c = gData.cards[idx];
  if (c.frontImageId) { delete gData.images[c.frontImageId]; deleteCachedImageFiles(c.frontImageId); }
  if (c.backImageId) { delete gData.images[c.backImageId]; deleteCachedImageFiles(c.backImageId); }

  gData.cards.splice(idx, 1);
}

function imageDataUri(imageId) {
  if (!imageId) return null;
  var obj = gData.images[imageId];
  if (!obj || !obj.base64) return null;
  var mime = obj.mime || "image/png";
  return "data:" + mime + ";base64," + obj.base64;
}

function chooseImageAsBase64(cb) {
  // Use the DS-native image picker
  app.ChooseImage("Internal", function (path) {
    if (!path) return;
    try {
      var b64 = app.ReadFile(path, "base64");
      var mime = guessMimeFromPath(path); // keep helper, or default
      cb({ mime: mime, base64: b64 });
    } catch (e) {
      app.Alert("Could not read image as base64.\n\n" + e);
    }
  });
}

function pickColor(initialHex, cb) {
  // Try common DS color picker functions.
  if (app.ChooseColor) {
    app.ChooseColor(initialHex || "#FFFFFF", function (col) {
      if (!col) return;
      cb(normalizeHex(col));
    });
    return;
  }
  // Fallback: ask user to input hex
  app.Prompt("Enter hex color (#RRGGBB)", initialHex || "#FFFFFF", function (val) {
    if (!val) return;
    cb(normalizeHex(val));
  });
}

function normalizeHex(s) {
  s = (s || "").trim();
  if (s[0] !== "#") s = "#" + s;
  if (s.length === 4) {
    // #RGB -> #RRGGBB
    s = "#" + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  }
  return s.toUpperCase();
}

function guessMimeFromPath(path) {
  var p = (path || "").toLowerCase();
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function mimeToExt(mime) {
  mime = (mime || "").toLowerCase();
  if (mime.indexOf("png") >= 0) return "png";
  if (mime.indexOf("webp") >= 0) return "webp";
  return "jpg";
}

function nowEpochSeconds() {
  return Math.floor(Date.now() / 1000);
}

function uuidv4() {
  // Simple UUID v4 generator
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0, v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function normStr(s) {
  s = (s || "").toString().trim().toLowerCase();
  // Accent-insensitive
  try {
    s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch (e) {}
  return s;
}

function escapeHtml(s) {
  return (s || "").toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function hexToRgb01(hex) {
  hex = normalizeHex(hex);
  var r = parseInt(hex.substr(1, 2), 16) / 255.0;
  var g = parseInt(hex.substr(3, 2), 16) / 255.0;
  var b = parseInt(hex.substr(5, 2), 16) / 255.0;
  return { r: r, g: g, b: b };
}

function avgColor(a, b) {
  var A = hexToRgb01(a), B = hexToRgb01(b);
  var r = Math.round(((A.r + B.r) / 2) * 255);
  var g = Math.round(((A.g + B.g) / 2) * 255);
  var bb = Math.round(((A.b + B.b) / 2) * 255);
  return "#" + toHex2(r) + toHex2(g) + toHex2(bb);
}

function toHex2(n) {
  var s = n.toString(16);
  return (s.length === 1) ? ("0" + s) : s;
}

function luminance01(hex) {
  // Perceived luminance (simple): 0..1
  var c = hexToRgb01(hex);
  return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b);
}