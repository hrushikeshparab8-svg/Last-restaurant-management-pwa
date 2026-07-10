const App = (() => {
  const cfg = window.ORDERFLOW_CONFIG || {};
  const hasConfig = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_URL.includes("PASTE_") &&
    !cfg.SUPABASE_ANON_KEY.includes("PASTE_");

  let db = null;
  let currentUser = null;
  let currentPermissions = {};
  let menuItems = [];
  let sops = [];
  let realtimeSub = null;

  const $ = id => document.getElementById(id);
  const money = v => `₹${Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const uid = () => Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  const unitToBase = (q, u) => {
    u = String(u || "").toLowerCase();
    const n = Number(q || 0);
    if (u === "kg" || u === "litre" || u === "liter") return n * 1000;
    return n;
  };
  const toast = msg => {
    $("toast").textContent = msg;
    $("toast").style.display = "block";
    setTimeout(() => $("toast").style.display = "none", 2500);
  };
  const row = (title, meta) => `<div class="item"><strong>${title}</strong><div class="meta">${meta}</div></div>`;
  const sum = (rows, key) => (rows || []).reduce((a, r) => a + Number(r[key] || 0), 0);
  const formObj = form => Object.fromEntries(new FormData(form).entries());
  const hasPerm = p => currentPermissions && currentPermissions[p] === true;

  const permissionFields = [
    "can_view_dashboard","can_view_sales","can_add_sales","can_edit_sales","can_delete_sales",
    "can_view_expenses","can_add_expenses","can_edit_expenses","can_delete_expenses",
    "can_view_inventory","can_add_inventory","can_edit_inventory","can_delete_inventory",
    "can_view_sop","can_add_sop","can_edit_sop","can_delete_sop",
    "can_view_daily_production","can_add_production","can_edit_draft_production","can_confirm_production",
    "can_cancel_production","can_delete_production","can_view_production_cost","can_view_prepared_food_stock",
    "can_record_wastage","can_view_profit_reports","can_view_reports","can_manage_settings"
  ];
  const roleNames = ["admin", "manager", "staff", "inventory_user"];

  function setDefaultDates() {
    document.querySelectorAll('input[type="date"]').forEach(i => {
      if (!i.value) i.value = todayISO();
    });
  }

  function filterDates(filterId, startId, endId) {
    const v = $(filterId).value;
    let d = new Date();
    let s = todayISO();
    let e = todayISO();

    if (v === "yesterday") {
      d.setDate(d.getDate() - 1);
      s = e = d.toISOString().slice(0, 10);
    }
    if (v === "week") {
      const x = new Date();
      x.setDate(x.getDate() - 6);
      s = x.toISOString().slice(0, 10);
    }
    if (v === "month") {
      s = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    }
    if (v === "custom") {
      s = e = $(startId).value || todayISO();
    }
    if (v === "range") {
      s = $(startId).value || todayISO();
      e = $(endId).value || s;
    }
    return { s, e };
  }

  function saveSession() {
    localStorage.setItem("of_user", JSON.stringify(currentUser));
    localStorage.setItem("of_perms", JSON.stringify(currentPermissions));
  }

  function readSession() {
    try {
      currentUser = JSON.parse(localStorage.getItem("of_user") || "null");
      currentPermissions = JSON.parse(localStorage.getItem("of_perms") || "null");
      return !!currentUser && !!currentPermissions;
    } catch {
      return false;
    }
  }

  function clearSession() {
    localStorage.removeItem("of_user");
    localStorage.removeItem("of_perms");
  }

  async function loadRolePermissions(role) {
    const { data, error } = await db.from("role_permissions").select("*").eq("role", role).maybeSingle();
    if (error || !data) {
      console.warn(error);
      return { role: "staff", can_view_sales: true, can_add_sales: true, can_view_expenses: true, can_add_expenses: true };
    }
    return data;
  }

  function activateTab(tab) {
    document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    document.querySelectorAll(".panel").forEach(p => p.classList.toggle("active", p.id === tab));
  }

  function applyPermissions() {
    document.querySelectorAll("[data-permission]").forEach(el => {
      el.classList.toggle("hidden", !hasPerm(el.dataset.permission));
    });

    const map = {
      saveSaleBtn: "can_add_sales",
      saveExpenseBtn: "can_add_expenses",
      confirmProductionBtn: "can_confirm_production",
      recordWastageBtn: "can_record_wastage",
      saveSopBtn: "can_add_sop"
    };
    Object.entries(map).forEach(([id, perm]) => {
      const el = $(id);
      if (el) el.classList.toggle("hidden", !hasPerm(perm));
    });

    const firstVisible = [...document.querySelectorAll(".tabs button")].find(b => !b.classList.contains("hidden"));
    if (firstVisible) activateTab(firstVisible.dataset.tab);
  }

  async function login() {
    const username = $("username").value.trim();
    const password = $("password").value;
    $("authMsg").textContent = "Checking login...";
    const { data, error } = await db.rpc("app_login", { p_username: username, p_password: password });
    if (error) {
      $("authMsg").textContent = error.message;
      return;
    }
    if (!data || !data.length) {
      $("authMsg").textContent = "Invalid username or password";
      return;
    }
    currentUser = data[0];
    currentPermissions = await loadRolePermissions(currentUser.role);
    saveSession();
    $("authMsg").textContent = "";
    await showApp();
  }

  async function checkSession() {
    if (!hasConfig) {
      $("setupView").classList.remove("hidden");
      return;
    }

    db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

    if (readSession()) {
      currentPermissions = await loadRolePermissions(currentUser.role);
      saveSession();
      await showApp();
    } else {
      $("authView").classList.remove("hidden");
    }
  }

  async function showApp() {
    $("setupView").classList.add("hidden");
    $("authView").classList.add("hidden");
    $("appView").classList.remove("hidden");
    $("logoutBtn").classList.remove("hidden");
    applyPermissions();
    await loadAll();
    subscribeRealtime();
  }

  async function loadMenu() {
    const { data } = await db.from("menu_items").select("*").eq("active", true).order("name");
    menuItems = data || [];
    $("saleItem").innerHTML = '<option value="">Select menu item</option>' + menuItems.map(i => `<option value="${escapeHtml(i.name)}">${escapeHtml(i.name)}</option>`).join("");
  }

  async function loadSops() {
    const { data } = await db.from("sop_recipes").select("*").eq("active", true).order("menu_item_name");
    sops = data || [];
    $("sopListData").innerHTML = sops.map(s => `<option value="${escapeHtml(s.menu_item_name)}"></option>`).join("");
  }

  function selectedSop() {
    const name = $("prodDish").value.trim().toLowerCase();
    return sops.find(s => String(s.menu_item_name).toLowerCase() === name);
  }

  async function previewProduction() {
    const s = selectedSop();
    const q = Number($("prodQty").value || 0);
    const u = $("prodUnit").value;
    if (!s || !q) {
      $("prodPreview").innerHTML = row("Select an active SOP", "Enter production quantity to preview ingredients.");
      return;
    }

    $("stdQty").value = `${s.standard_quantity} ${s.standard_unit}`;
    $("prodMultiplier").value = (unitToBase(q, u) / unitToBase(s.standard_quantity, s.standard_unit)).toFixed(3);

    const { data, error } = await db.rpc("app_preview_production", { p_sop_id: s.id, p_quantity: q, p_unit: u });
    if (error) {
      $("prodPreview").innerHTML = row("Preview error", escapeHtml(error.message));
      return;
    }

    const ingredientCost = sum(data, "ingredient_cost");
    const total = ingredientCost + Number($("addCost").value || 0);
    $("ingredientCost").value = money(ingredientCost);
    $("totalProdCost").value = money(total);
    $("expectedServings").value = s.serving_size ? Math.floor(unitToBase(q, u) / unitToBase(s.serving_size, s.serving_unit)) : Number(s.expected_servings || 0);

    $("prodPreview").innerHTML = (data || []).map(x => row(
      escapeHtml(x.ingredient_name),
      `Required ${Number(x.required_quantity || 0).toFixed(2)} ${escapeHtml(x.normalized_unit)} | Available ${Number(x.available_quantity || 0).toFixed(2)} | Remaining ${Number(x.remaining_quantity || 0).toFixed(2)} | Shortage <b>${Number(x.shortage_quantity || 0).toFixed(2)}</b> | Cost ${money(x.ingredient_cost)}`
    )).join("") || row("No ingredients found", "Add SOP ingredients before confirming production.");
  }

  async function confirmProduction(e) {
    e.preventDefault();
    if (!hasPerm("can_confirm_production")) return alert("No permission to confirm production.");
    const o = formObj(e.target);
    const s = selectedSop();
    if (!s) return alert("Select an active SOP first.");
    if (s.is_composite) return alert("Composite thalis cannot be produced directly. Prepare Rice, Dal, Sabji, Curry etc separately.");

    $("confirmProductionBtn").disabled = true;
    const { error } = await db.rpc("app_confirm_production", {
      p_idempotency_key: uid(),
      p_production_date: o.production_date,
      p_sop_id: s.id,
      p_quantity: Number(o.quantity_prepared),
      p_unit: o.production_unit,
      p_additional_cost: Number(o.additional_cost || 0),
      p_actual_servings: o.actual_servings ? Number(o.actual_servings) : null,
      p_prepared_by: o.prepared_by || currentUser.username,
      p_notes: o.notes || ""
    });
    $("confirmProductionBtn").disabled = false;

    if (error) return alert(error.message);
    e.target.reset();
    document.querySelector('#productionForm input[type="date"]').value = todayISO();
    await loadAll();
    toast("Production confirmed. Raw inventory deducted and prepared stock added.");
  }

  async function cancelProduction(id) {
    if (!hasPerm("can_cancel_production")) return alert("No permission to cancel production.");
    if (!confirm("Cancel this production entry and restore the deducted ingredients?")) return;
    const { error } = await db.rpc("app_cancel_production", { p_production_id: id, p_username: currentUser.username });
    if (error) return alert(error.message);
    await loadAll();
    toast("Production cancelled and stock restored.");
  }

  async function createSale(e) {
    e.preventDefault();
    if (!hasPerm("can_add_sales")) return alert("No permission to add sales.");
    const o = formObj(e.target);
    const { error } = await db.rpc("app_create_sale", {
      p_username: currentUser.username,
      p_sale_date: o.sale_date,
      p_item_name: o.item_name,
      p_quantity: Number(o.quantity),
      p_selling_price: Number(o.selling_price),
      p_payment_mode: o.payment_mode,
      p_notes: o.notes || ""
    });
    if (error) return alert(error.message);
    e.target.reset();
    document.querySelector('#salesForm input[type="date"]').value = todayISO();
    await loadAll();
    toast("Sale saved and prepared stock deducted.");
  }

  async function createExpense(e) {
    e.preventDefault();
    if (!hasPerm("can_add_expenses")) return alert("No permission to add expenses.");
    const o = formObj(e.target);
    o.username = currentUser.username;
    o.quantity = o.quantity ? Number(o.quantity) : null;
    o.total_price = Number(o.total_price || 0);
    o.buying_price = o.total_price;
    const { error } = await db.from("expenses").insert(o);
    if (error) return alert(error.message);
    e.target.reset();
    document.querySelector('#expenseForm input[type="date"]').value = todayISO();
    updateExpensePreview();
    await loadAll();
    toast("Expense saved.");
  }

  async function recordWastage(e) {
    e.preventDefault();
    if (!hasPerm("can_record_wastage")) return alert("No permission to record wastage.");
    const o = formObj(e.target);
    const { error } = await db.rpc("app_record_wastage", {
      p_wastage_date: o.wastage_date,
      p_dish_name: o.dish_name,
      p_quantity: Number(o.quantity),
      p_unit: o.unit,
      p_reason: o.reason || "",
      p_recorded_by: currentUser.username
    });
    if (error) return alert(error.message);
    e.target.reset();
    document.querySelector('#wastageForm input[type="date"]').value = todayISO();
    await loadAll();
    toast("Wastage recorded.");
  }

  async function saveSop(e) {
    e.preventDefault();
    if (!hasPerm("can_add_sop")) return alert("No permission to add SOP.");
    const o = formObj(e.target);
    const isComposite = o.preparation_type === "plate";

    const { data, error } = await db.from("sop_recipes").insert({
      menu_item_name: o.menu_item_name,
      selling_price: Number(o.selling_price || 0),
      preparation_type: o.preparation_type,
      standard_quantity: Number(o.standard_quantity || 1),
      standard_unit: o.standard_unit,
      serving_size: Number(o.serving_size || 1),
      serving_unit: o.serving_unit,
      expected_servings: 0,
      active: true,
      is_composite: isComposite
    }).select().single();

    if (error) return alert(error.message);

    const lines = (isComposite ? o.components_text : o.ingredients_text || "").split("\\n").map(x => x.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      const p = lines[i].split("|").map(x => x.trim());
      if (!p[0]) continue;
      if (isComposite) {
        await db.from("thali_components").insert({
          thali_sop_id: data.id,
          component_name: p[0],
          quantity_per_plate: Number(p[1] || 0),
          unit: p[2] || "g",
          sort_order: i + 1
        });
      } else {
        await db.from("sop_ingredients").insert({
          recipe_id: data.id,
          ingredient_name: p[0],
          quantity_required: Number(p[1] || 0),
          unit: p[2] || "g",
          ingredient_price: 0
        });
      }
    }

    e.target.reset();
    await loadAll();
    toast("SOP saved.");
  }

  async function loadDashboard() {
    const d = filterDates("dashFilter", "dashStart", "dashEnd");
    const { data, error } = await db.rpc("app_daily_report", { p_start: d.s, p_end: d.e });
    if (error) return console.error(error);

    const r = data || {};
    $("kSales").textContent = money(r.sales_revenue);
    $("kPurchases").textContent = money(r.purchase_expense);
    $("kProduction").textContent = money(r.production_cost);
    $("kOperating").textContent = money(r.operating_expense);
    $("kGross").textContent = money(r.gross_profit);
    $("kNet").textContent = money(r.net_operating_profit);
    $("kCashBalance").textContent = money(r.sales_minus_todays_expenses);
    $("kWastage").textContent = money(r.wastage_cost);
    $("kPortions").textContent = Number(r.portions_sold || 0).toFixed(1);
    $("kPrepared").textContent = Number(r.prepared_quantity || 0).toFixed(1);
    $("kPreparedClosing").textContent = Number(r.prepared_food_closing_balance || 0).toFixed(1);
    $("kPayments").textContent = `Cash ${money(r.cash_sales)} / UPI ${money(r.upi_sales)} / Card ${money(r.card_sales)}`;

    simpleBars("chartSalesFood", [["Sales", r.sales_revenue], ["Food cost", r.food_cost], ["Purchases", r.purchase_expense]]);
    simpleBars("chartProfit", [["Gross profit", r.gross_profit], ["Net profit", r.net_operating_profit], ["Sales minus expenses", r.sales_minus_todays_expenses]]);

    await renderTopSelling(d.s, d.e);
    await renderHighestCost(d.s, d.e);
  }

  function simpleBars(id, arr) {
    const max = Math.max(1, ...arr.map(x => Math.abs(Number(x[1] || 0))));
    $(id).innerHTML = arr.map(x => row(escapeHtml(x[0]), `<div class="bar"><i style="width:${Math.min(100, Math.abs(x[1]) / max * 100)}%"></i></div>${money(x[1])}`)).join("");
  }

  async function renderTopSelling(s, e) {
    const { data } = await db.from("sales").select("*").gte("sale_date", s).lte("sale_date", e);
    const map = {};
    (data || []).forEach(r => {
      map[r.item_name] ||= { qty: 0, sales: 0, food: 0, profit: 0 };
      map[r.item_name].qty += Number(r.quantity || 0);
      map[r.item_name].sales += Number(r.total_amount || 0);
      map[r.item_name].food += Number(r.total_food_cost || 0);
      map[r.item_name].profit += Number(r.gross_profit || 0);
    });
    const rows = Object.entries(map).sort((a, b) => b[1].qty - a[1].qty);
    $("topSellingList").innerHTML = rows.length ? rows.map(([name, v]) => row(escapeHtml(name), `Qty ${v.qty} | Sales ${money(v.sales)} | Food cost ${money(v.food)} | Profit ${money(v.profit)}`)).join("") : row("No sales", "Sales will appear here.");
  }

  async function renderHighestCost(s, e) {
    const { data } = await db.from("daily_production").select("*").gte("production_date", s).lte("production_date", e).eq("status", "Confirmed").order("total_production_cost", { ascending: false }).limit(8);
    $("highestCostList").innerHTML = (data || []).length ? data.map(p => row(escapeHtml(p.dish_name), `${p.quantity_prepared} ${p.production_unit} | Cost ${money(p.total_production_cost)} | Cost/plate ${money(p.cost_per_plate)}`)).join("") : row("No production", "Production costs will appear here.");
  }

  async function loadProduction() {
    const { data } = await db.from("daily_production").select("*").order("production_date", { ascending: false }).order("id", { ascending: false }).limit(60);
    $("productionList").innerHTML = (data || []).map(p => row(
      `${escapeHtml(p.dish_name)} — ${p.quantity_prepared} ${p.production_unit}`,
      `${p.production_date} | <span class="pill ${p.status === "Cancelled" ? "red" : "green"}">${p.status}</span> Multiplier ${Number(p.production_multiplier || 0).toFixed(2)} | Ingredient ${hasPerm("can_view_production_cost") ? money(p.ingredient_cost) : "Hidden"} | Total ${hasPerm("can_view_production_cost") ? money(p.total_production_cost) : "Hidden"} | Expected ${Number(p.expected_servings || 0).toFixed(1)}<br>${p.status === "Confirmed" && hasPerm("can_cancel_production") ? `<button class="small danger" onclick="App.cancelProduction(${p.id})">Cancel and Restore Stock</button>` : ""}`
    )).join("") || row("No production", "Confirm production to see records.");
  }

  async function loadPreparedStock() {
    const { data } = await db.from("prepared_food_stock").select("*").order("production_date", { ascending: false }).limit(100);
    $("preparedStockList").innerHTML = (data || []).map(s => row(
      `${escapeHtml(s.dish_name)} — Closing ${Number(s.closing_quantity || 0).toFixed(2)} ${escapeHtml(s.unit)}`,
      `${s.production_date} | Prepared ${s.quantity_prepared} | Sold ${s.quantity_sold} | Wastage ${s.quantity_wasted} | Complimentary ${s.complimentary_quantity}`
    )).join("") || row("No prepared stock", "Production adds prepared-food stock separately from raw inventory.");

    $("preparedFoodData").innerHTML = [...new Set((data || []).map(x => x.dish_name))].map(x => `<option value="${escapeHtml(x)}"></option>`).join("");
  }

  async function loadCapacity() {
    const { data, error } = await db.rpc("app_thali_capacity", { p_thali_name: $("capacityThali").value, p_date: $("capacityDate").value || todayISO() });
    if (error) {
      $("capacityList").innerHTML = row("Error", escapeHtml(error.message));
      return;
    }
    const capacities = (data || []).map(x => Number(x.plate_capacity || 0));
    const min = capacities.length ? Math.min(...capacities) : 0;
    $("capacityList").innerHTML = row("Maximum thali capacity", `${min} plates`) + (data || []).map(x => row(escapeHtml(x.component_name), `Available ${x.available_quantity} ${escapeHtml(x.unit)} | Required/plate ${x.required_per_plate} | Capacity ${x.plate_capacity} plates`)).join("");
  }

  async function loadSales() {
    const { data } = await db.from("sales").select("*").order("sale_date", { ascending: false }).order("id", { ascending: false }).limit(40);
    $("salesList").innerHTML = (data || []).map(s => row(
      `${escapeHtml(s.item_name)} — ${money(s.total_amount)}`,
      `${s.sale_date} | Qty ${s.quantity} | ${escapeHtml(s.payment_mode)} | Food cost ${money(s.total_food_cost)} | Profit ${money(s.gross_profit)}`
    )).join("") || row("No sales", "Add sales above.");
  }

  async function loadExpenses() {
    const { data } = await db.from("expenses").select("*").order("expense_date", { ascending: false }).order("id", { ascending: false }).limit(40);
    $("expensesList").innerHTML = (data || []).map(e => row(
      `${escapeHtml(e.item_name)} — ${money(e.total_price)}`,
      `${e.expense_date} | ${escapeHtml(e.category)} | Qty ${e.quantity || "-"} ${escapeHtml(e.unit || "")} | Supplier ${escapeHtml(e.supplier || "-")}`
    )).join("") || row("No expenses", "Add expenses above.");
  }

  async function loadInventory() {
    const { data } = await db.from("inventory").select("*").order("raw_material_name");
    $("inventoryList").innerHTML = (data || []).map(i => row(
      escapeHtml(i.raw_material_name),
      `Unit ${escapeHtml(i.unit)} | Opening ${i.opening_stock} | Added ${i.stock_added} | Used ${i.stock_used} | Closing <b>${i.closing_stock}</b> | Avg ${money(i.average_purchase_price)}`
    )).join("") || row("No inventory", "Purchases add raw material inventory.");
  }

  async function loadSopTables() {
    const { data } = await db.from("sop_recipes").select("*").order("menu_item_name");
    $("sopRows").innerHTML = (data || []).map(s => row(
      escapeHtml(s.menu_item_name),
      `${s.is_composite ? "Composite thali" : "Direct dish"} | Standard ${s.standard_quantity} ${escapeHtml(s.standard_unit)} | Serving ${s.serving_size} ${escapeHtml(s.serving_unit)} | Active ${s.active}`
    )).join("") || row("No SOP", "Create SOP records.");

    const { data: tc } = await db.from("thali_components").select("*, sop_recipes!thali_components_thali_sop_id_fkey(menu_item_name)").order("thali_sop_id").order("sort_order");
    $("thaliRows").innerHTML = (tc || []).map(c => row(
      escapeHtml(c.component_name),
      `Thali ${escapeHtml(c.sop_recipes?.menu_item_name || "")} | Qty/plate ${c.quantity_per_plate} ${escapeHtml(c.unit)} | Snapshot ${money(c.cost_per_plate_snapshot)}`
    )).join("") || row("No thali components", "Create thali SOPs with component rows.");
  }

  async function loadReports() {
    const d = filterDates("reportFilter", "reportStart", "reportEnd");
    const { data } = await db.rpc("app_daily_report", { p_start: d.s, p_end: d.e });
    const r = data || {};
    const entries = [
      ["Sales revenue", money(r.sales_revenue)],
      ["Food cost of items sold", money(r.food_cost)],
      ["Gross profit", money(r.gross_profit)],
      ["Operating expenses", money(r.operating_expense)],
      ["Wastage cost", money(r.wastage_cost)],
      ["Net operating profit", money(r.net_operating_profit)],
      ["Purchase expenses", money(r.purchase_expense)],
      ["Sales minus today’s expenses", money(r.sales_minus_todays_expenses)],
      ["Profit margin percentage", `${Number(r.profit_margin_pct || 0)}%`],
      ["Portions sold", Number(r.portions_sold || 0).toFixed(1)],
      ["Prepared quantity", Number(r.prepared_quantity || 0).toFixed(1)],
      ["Prepared closing balance", Number(r.prepared_food_closing_balance || 0).toFixed(1)]
    ];
    $("dailyReport").innerHTML = entries.map(x => row(x[0], x[1])).join("");
  }

  async function loadUsersEditor() {
    if (!hasPerm("can_manage_settings")) return;
    const { data, error } = await db.rpc("app_list_users");
    if (error) {
      $("usersList").innerHTML = row("Error loading users", escapeHtml(error.message));
      return;
    }
    $("usersList").innerHTML = (data || []).map(u => `
      <div class="item">
        <div class="user-row">
          <input data-u-name="${u.id}" value="${escapeAttr(u.display_name || "")}">
          <select data-u-role="${u.id}">
            ${roleNames.map(r => `<option value="${r}" ${u.role === r ? "selected" : ""}>${r}</option>`).join("")}
          </select>
          <select data-u-active="${u.id}">
            <option value="true" ${u.active ? "selected" : ""}>active</option>
            <option value="false" ${!u.active ? "selected" : ""}>inactive</option>
          </select>
          <button class="small" onclick="App.saveUser(${u.id})">Save</button>
        </div>
        <div class="meta"><b>User ID:</b> ${escapeHtml(u.username)} | System ID ${u.id}</div>
        <div class="user-row" style="margin-top:10px">
          <input data-u-pass="${u.id}" type="password" placeholder="New password">
          <button class="small" onclick="App.changePassword(${u.id})">Change Password</button>
        </div>
      </div>
    `).join("") || row("No users", "Default admin should exist after SQL setup.");
  }

  async function createUser(e) {
    e.preventDefault();
    const o = formObj(e.target);
    const { error } = await db.rpc("app_create_user", {
      p_username: o.username,
      p_password: o.password,
      p_display_name: o.display_name || o.username,
      p_role: o.role
    });
    if (error) return alert(error.message);
    e.target.reset();
    await loadUsersEditor();
    toast("User created.");
  }

  async function saveUser(id) {
    const { error } = await db.rpc("app_update_user", {
      p_id: id,
      p_display_name: document.querySelector(`[data-u-name="${id}"]`).value,
      p_role: document.querySelector(`[data-u-role="${id}"]`).value,
      p_active: document.querySelector(`[data-u-active="${id}"]`).value === "true"
    });
    if (error) return alert(error.message);
    toast("User updated.");
    await loadUsersEditor();
  }

  async function changePassword(id) {
    const password = document.querySelector(`[data-u-pass="${id}"]`).value;
    if (!password) return alert("Enter new password.");
    const { error } = await db.rpc("app_change_password", { p_id: id, p_new_password: password });
    if (error) return alert(error.message);
    toast("Password changed.");
    await loadUsersEditor();
  }

  async function loadPermissionsEditor() {
    if (!hasPerm("can_manage_settings")) return;
    const { data } = await db.from("role_permissions").select("*").order("role");
    $("permissionsEditor").innerHTML = (data || []).map(r => `
      <div class="role-card">
        <h3>${escapeHtml(r.role)}</h3>
        <div class="perm-grid">
          ${permissionFields.map(f => `<label class="perm-row"><span>${f.replaceAll("_", " ")}</span><input type="checkbox" data-role="${escapeAttr(r.role)}" data-field="${f}" ${r[f] ? "checked" : ""}></label>`).join("")}
        </div>
        <br>
        <button class="small" onclick="App.saveRolePermissions('${escapeAttr(r.role)}')">Save ${escapeHtml(r.role)}</button>
      </div>
    `).join("");
  }

  async function saveRolePermissions(role) {
    const payload = {};
    permissionFields.forEach(f => {
      const el = document.querySelector(`[data-role="${role}"][data-field="${f}"]`);
      payload[f] = !!el?.checked;
    });
    const { error } = await db.from("role_permissions").update(payload).eq("role", role);
    if (error) return alert(error.message);
    toast("Privileges updated. Login again to refresh that user.");
  }

  async function loadAll() {
    await Promise.all([loadMenu(), loadSops()]);
    await Promise.all([
      loadDashboard(),
      loadProduction(),
      loadPreparedStock(),
      loadCapacity(),
      loadSales(),
      loadExpenses(),
      loadInventory(),
      loadSopTables(),
      loadReports(),
      loadUsersEditor(),
      loadPermissionsEditor()
    ]);
  }

  function subscribeRealtime() {
    if (realtimeSub || !db) return;
    realtimeSub = db.channel("orderflow-v4")
      .on("postgres_changes", { event: "*", schema: "public" }, () => loadAll())
      .subscribe();
  }

  function updateSalePreview() {
    const m = menuItems.find(x => x.name === $("saleItem").value);
    const qty = Number($("saleQty").value || 0);
    const price = Number($("salePrice").value || m?.default_selling_price || 0);
    $("salePreview").innerHTML = `Estimated total: <b>${money(qty * price)}</b>. Prepared stock deduction will happen after save.`;
  }

  function updateExpensePreview() {
    const qty = Number($("expenseQty").value || 0);
    const total = Number($("buyPrice").value || 0);
    $("expensePreview").textContent = `Rate per unit: ${qty ? money(total / qty) : money(0)}`;
  }

  function escapeHtml(x) {
    return String(x ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
  }
  function escapeAttr(x) { return escapeHtml(x).replace(/"/g, "&quot;"); }

  function bindEvents() {
    $("loginBtn").addEventListener("click", login);
    $("logoutBtn").addEventListener("click", () => { clearSession(); location.reload(); });

    document.querySelectorAll(".tabs button").forEach(b => b.addEventListener("click", () => activateTab(b.dataset.tab)));

    $("productionForm").addEventListener("submit", confirmProduction);
    ["prodDish", "prodQty", "prodUnit", "addCost"].forEach(id => $(id)?.addEventListener("input", previewProduction));
    $("salesForm").addEventListener("submit", createSale);
    $("expenseForm").addEventListener("submit", createExpense);
    $("wastageForm").addEventListener("submit", recordWastage);
    $("sopForm").addEventListener("submit", saveSop);
    $("createUserForm").addEventListener("submit", createUser);
    $("applyDashFilter").addEventListener("click", loadAll);
    $("applyReportFilter").addEventListener("click", loadReports);
    $("checkCapacityBtn").addEventListener("click", loadCapacity);

    $("saleItem").addEventListener("change", () => {
      const m = menuItems.find(x => x.name === $("saleItem").value);
      $("salePrice").value = m?.default_selling_price || "";
      updateSalePreview();
    });
    $("saleQty").addEventListener("input", updateSalePreview);
    $("salePrice").addEventListener("input", updateSalePreview);
    $("expenseQty").addEventListener("input", updateExpensePreview);
    $("buyPrice").addEventListener("input", updateExpensePreview);
  }

  function init() {
    setDefaultDates();
    bindEvents();
    checkSession();
  }

  return { init, cancelProduction, saveUser, changePassword, saveRolePermissions };
})();

document.addEventListener("DOMContentLoaded", App.init);
