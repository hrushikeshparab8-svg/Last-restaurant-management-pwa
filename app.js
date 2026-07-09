
const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG;
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = id => document.getElementById(id);
const money = v => `₹${Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const todayISO = () => new Date().toISOString().slice(0,10);
const monthStartISO = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10);
const toast = msg => { $("toast").textContent = msg; $("toast").style.display="block"; setTimeout(()=> $("toast").style.display="none", 2500); };

let menuItems = [];
let currentRole = "staff";

document.querySelectorAll('input[type="date"]').forEach(i => i.value = todayISO());

function row(title, meta){ return `<div class="item"><strong>${title}</strong><div class="meta">${meta}</div></div>`; }
function sum(rows, key){ return (rows || []).reduce((a,r)=>a+Number(r[key]||0),0); }
function formObj(form){ const obj = Object.fromEntries(new FormData(form).entries()); Object.keys(obj).forEach(k=>{ if(obj[k]==="") obj[k]=null; }); return obj; }

async function getUser(){
  const { data, error } = await db.auth.getUser();
  if(error) throw error;
  return data.user;
}

async function ensureProfile(){
  const user = await getUser();
  let { data, error } = await db.from("profiles").select("*").eq("id", user.id).maybeSingle();

  if(!data){
    await db.from("profiles").insert({ id:user.id, full_name:user.email, role:"staff" });
    data = { role:"staff", full_name:user.email };
  }

  currentRole = data.role || "staff";
  $("roleBox").innerHTML = `Email: <b>${user.email}</b><br>Role: <b>${currentRole}</b>`;

  document.querySelectorAll("[data-admin='true']").forEach(el => {
    el.classList.toggle("hidden", currentRole !== "admin");
  });

  if(currentRole !== "admin" && document.querySelector(".tabs button.active")?.dataset.tab !== "sales" && document.querySelector(".tabs button.active")?.dataset.tab !== "expenses"){
    activateTab("sales");
  }
}

async function checkSession(){
  const { data } = await db.auth.getSession();
  if(!data.session){
    $("authView").classList.remove("hidden");
    $("appView").classList.add("hidden");
    $("logoutBtn").classList.add("hidden");
    return;
  }
  $("authView").classList.add("hidden");
  $("appView").classList.remove("hidden");
  $("logoutBtn").classList.remove("hidden");
  await ensureProfile();
  await loadAll();
}

$("loginBtn").onclick = async () => {
  const { error } = await db.auth.signInWithPassword({ email:$("email").value.trim(), password:$("password").value });
  if(error) return $("authMsg").textContent = error.message;
  $("authMsg").textContent = "";
  await checkSession();
};

$("signupBtn").onclick = async () => {
  const { error } = await db.auth.signUp({ email:$("email").value.trim(), password:$("password").value });
  $("authMsg").textContent = error ? error.message : "Account created. Confirm email if required, then login.";
};

$("logoutBtn").onclick = async () => { await db.auth.signOut(); await checkSession(); };

function activateTab(tab){
  document.querySelectorAll(".tabs button").forEach(b=>b.classList.toggle("active", b.dataset.tab===tab));
  document.querySelectorAll(".panel").forEach(p=>p.classList.toggle("active", p.id===tab));
}

document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => activateTab(b.dataset.tab));

async function loadMenu(){
  const fallback = [
    ["Chicken Biryani",120,0],["Veg Biryani",100,0],["Veg Thali",120,0],["Bangda Thali",150,0],
    ["Fish Thali",150,0],["Prawns Thali",180,0],["King Fish Thali",220,0],["Ros Omelette",80,0],["Tea",20,0],["Cold Drink",40,0]
  ].map(([name, default_selling_price, default_plate_cost]) => ({name, default_selling_price, default_plate_cost}));

  const { data, error } = await db.from("menu_items").select("*").eq("active", true).order("name");
  menuItems = error || !data?.length ? fallback : data;

  const options = `<option value="">Select menu item</option>` + menuItems.map(i => `<option value="${i.name}">${i.name}</option>`).join("");
  $("saleItem").innerHTML = options;
  $("sopItem").innerHTML = options;
}

function menu(name){ return menuItems.find(i => i.name === name) || {}; }

$("saleItem").addEventListener("change", () => {
  const item = menu($("saleItem").value);
  $("salePrice").value = item.default_selling_price || "";
  updateSalePreview();
});
$("saleQty").addEventListener("input", updateSalePreview);
$("salePrice").addEventListener("input", updateSalePreview);

function updateSalePreview(){
  const item = menu($("saleItem").value);
  const qty = Number($("saleQty").value || 0);
  const price = Number($("salePrice").value || 0);
  const cost = Number(item.default_plate_cost || 0);
  $("saleTotalPreview").textContent = money(qty * price);
  $("saleCostPreview").textContent = money(cost);
  $("saleProfitPreview").textContent = money((qty * price) - (qty * cost));
}

$("expenseQty").addEventListener("input", updateRate);
$("buyPrice").addEventListener("input", updateRate);
function updateRate(){
  const qty = Number($("expenseQty").value || 0);
  const price = Number($("buyPrice").value || 0);
  $("ratePreview").textContent = qty ? money(price / qty) : money(0);
}

$("salesForm").onsubmit = async e => {
  e.preventDefault();
  const user = await getUser();
  const obj = formObj(e.target);
  const item = menu(obj.item_name);
  obj.user_id = user.id;
  obj.quantity = Number(obj.quantity || 0);
  obj.selling_price = Number(obj.selling_price || 0);
  obj.plate_cost = Number(item.default_plate_cost || 0);
  obj.total_food_cost = obj.quantity * obj.plate_cost;
  obj.gross_profit = (obj.quantity * obj.selling_price) - obj.total_food_cost;

  const { error } = await db.from("sales").insert(obj);
  if(error) return alert(error.message);

  e.target.reset();
  document.querySelector('#salesForm input[type="date"]').value = todayISO();
  updateSalePreview();
  await loadAll();
  toast("Sale saved");
};

$("expenseForm").onsubmit = async e => {
  e.preventDefault();
  const user = await getUser();
  const obj = formObj(e.target);
  obj.user_id = user.id;
  obj.quantity = Number(obj.quantity || 0);
  obj.total_price = Number(obj.total_price || 0);
  obj.buying_price = obj.total_price;

  const { error } = await db.from("expenses").insert(obj);
  if(error) return alert(error.message);

  e.target.reset();
  document.querySelector('#expenseForm input[type="date"]').value = todayISO();
  updateRate();
  await loadAll();
  toast("Expense saved and inventory updated");
};

function parseIngredients(text){
  return (text || "").split("\n").map(l=>l.trim()).filter(Boolean).map(line => {
    const p = line.split("|").map(x=>x.trim());
    return { ingredient_name:p[0], quantity_required:Number(p[1]||0), unit:p[2]||"kg", ingredient_price:Number(p[3]||0) };
  }).filter(i => i.ingredient_name && i.quantity_required > 0);
}

$("sopForm").onsubmit = async e => {
  e.preventDefault();
  const obj = formObj(e.target);
  const ingredients = parseIngredients(obj.ingredients_text);
  const total = ingredients.reduce((a,i)=>a + i.quantity_required * i.ingredient_price,0);
  const plates = Number(obj.plates_produced || 0);
  const selling = Number(obj.selling_price || 0);
  const costPlate = plates ? total / plates : 0;
  const profitPlate = selling - costPlate;

  const payload = {
    menu_item_name: obj.menu_item_name,
    selling_price: selling,
    quantity_prepared: Number(obj.quantity_prepared || 0),
    plates_produced: plates,
    total_recipe_cost: total,
    cost_per_plate: costPlate,
    profit_per_plate: profitPlate,
    preparation_steps: obj.preparation_steps,
    hygiene_instructions: obj.hygiene_instructions,
    portion_size: obj.portion_size,
    plating_instructions: obj.plating_instructions,
    storage_instructions: obj.storage_instructions
  };

  const { data: recipe, error } = await db.from("sop_recipes").insert(payload).select().single();
  if(error) return alert(error.message);

  if(ingredients.length){
    const { error: ingErr } = await db.from("sop_ingredients").insert(ingredients.map(i => ({...i, recipe_id:recipe.id})));
    if(ingErr) return alert(ingErr.message);
  }

  await db.from("recipe_preparations").insert({ recipe_id: recipe.id, menu_item_name: obj.menu_item_name, plates_prepared: plates, total_cost: total, cost_per_plate: costPlate });

  for(const ing of ingredients) await reduceInventory(ing.ingredient_name, ing.quantity_required, ing.unit, recipe.id);

  await db.from("menu_items").upsert({ name: obj.menu_item_name, default_selling_price: selling, default_plate_cost: costPlate, active:true }, { onConflict:"name" });

  e.target.reset();
  await loadAll();
  toast("SOP saved, costing updated, inventory reduced");
};

async function reduceInventory(itemName, qty, unit, recipeId){
  const { data } = await db.from("inventory").select("*").ilike("raw_material_name", itemName).limit(1).maybeSingle();
  if(data){
    await db.from("inventory").update({ stock_used: Number(data.stock_used || 0) + qty }).eq("id", data.id);
  }else{
    await db.from("inventory").insert({ raw_material_name:itemName, category:"Raw Material", unit, opening_stock:0, stock_added:0, stock_used:qty, minimum_stock_level:0 });
  }

  await db.from("inventory_transactions").insert({
    item_name:itemName, category:"Raw Material", unit, transaction_type:"recipe_use",
    quantity:qty, amount:0, reference_table:"sop_recipes", reference_id:recipeId
  });
}

$("refreshBtn").onclick = () => loadAll();

async function loadAll(){
  await loadMenu();
  await Promise.all([loadDashboard(), loadSales(), loadExpenses(), loadInventory(), loadSOP(), loadReports()]);
}

async function loadDashboard(){
  const today = todayISO(), start = monthStartISO();
  const [sT,eT,sM,eM,inv,rec] = await Promise.all([
    db.from("sales").select("*").eq("sale_date", today),
    db.from("expenses").select("*").eq("expense_date", today),
    db.from("sales").select("*").gte("sale_date", start),
    db.from("expenses").select("*").gte("expense_date", start),
    db.from("inventory").select("*").order("raw_material_name"),
    db.from("sop_recipes").select("*").order("created_at", {ascending:false})
  ]);

  const salesT = sum(sT.data,"total_amount"), expT = sum(eT.data,"total_price"), foodT = sum(sT.data,"total_food_cost");
  const salesM = sum(sM.data,"total_amount"), expM = sum(eM.data,"total_price"), foodM = sum(sM.data,"total_food_cost");
  const low = (inv.data || []).filter(i => Number(i.closing_stock || 0) <= Number(i.minimum_stock_level || 0));

  $("todaySales").textContent = money(salesT);
  $("todayExpenses").textContent = money(expT);
  $("todayFoodCost").textContent = money(foodT);
  $("todayNetProfit").textContent = money(salesT - foodT - expT);
  $("monthSales").textContent = money(salesM);
  $("monthExpenses").textContent = money(expM);
  $("monthProfit").textContent = money(salesM - foodM - expM);
  $("lowStockCount").textContent = low.length;

  renderTopSelling(sT.data || []);
  $("lowStockList").innerHTML = low.length ? low.map(i => row(i.raw_material_name, `<span class="pill red">LOW</span> Closing ${i.closing_stock} ${i.unit||""} | Minimum ${i.minimum_stock_level}`)).join("") : row("No low-stock items", "Inventory is above minimum level.");
  renderCosting(rec.data || []);
  renderExpensive(eT.data || []);
}

function renderTopSelling(rows){
  const map = {};
  rows.forEach(r => {
    map[r.item_name] ||= {qty:0, sales:0, cost:0, profit:0};
    map[r.item_name].qty += Number(r.quantity||0);
    map[r.item_name].sales += Number(r.total_amount||0);
    map[r.item_name].cost += Number(r.total_food_cost||0);
    map[r.item_name].profit += Number(r.gross_profit||0);
  });
  const list = Object.entries(map).sort((a,b)=>b[1].qty-a[1].qty);
  $("topSellingList").innerHTML = list.length ? list.map(([n,v])=>row(n, `Qty ${v.qty} | Sales ${money(v.sales)} | Plate cost ${money(v.cost)} | Profit ${money(v.profit)}`)).join("") : row("No sales today", "Add sales to see top-selling items.");
}

function renderCosting(rows){
  const latest = {};
  rows.forEach(r => { latest[r.menu_item_name] ||= r; });
  const list = Object.values(latest);
  $("costingList").innerHTML = list.length ? list.map(r => row(r.menu_item_name, `<span class="pill orange">Cost ${money(r.cost_per_plate)}</span><span class="pill">Sell ${money(r.selling_price)}</span> Profit/plate ${money(r.profit_per_plate)}`)).join("") : row("No SOP costing yet", "Add SOP recipe to calculate cost per plate.");
}

function renderExpensive(rows){
  const list = [...rows].sort((a,b)=>Number(b.total_price||0)-Number(a.total_price||0)).slice(0,8);
  $("expensiveList").innerHTML = list.length ? list.map(r => row(`${r.item_name} - ${money(r.total_price)}`, `${r.category||""} | Qty ${r.quantity||"-"} ${r.unit||""} | Supplier ${r.supplier||"-"}`)).join("") : row("No purchases today", "Add expenses to see expensive purchases.");
}

async function loadSales(){
  const {data,error} = await db.from("sales").select("*").order("sale_date",{ascending:false}).order("id",{ascending:false}).limit(20);
  $("salesList").innerHTML = error ? row("Error", error.message) : data.length ? data.map(r => row(`${r.item_name} - ${money(r.total_amount)}`, `${r.sale_date} | Qty ${r.quantity} | ${r.payment_mode} | Plate cost ${money(r.total_food_cost)} | Profit ${money(r.gross_profit)}`)).join("") : row("No sales", "Use fast sales entry above.");
}

async function loadExpenses(){
  const {data,error} = await db.from("expenses").select("*").order("expense_date",{ascending:false}).order("id",{ascending:false}).limit(20);
  $("expensesList").innerHTML = error ? row("Error", error.message) : data.length ? data.map(r => row(`${r.item_name} - ${money(r.total_price)}`, `${r.expense_date} | ${r.category} | Qty ${r.quantity||"-"} ${r.unit||""} | Rate ${r.price_per_unit ? money(r.price_per_unit) : "-"} | Supplier ${r.supplier||"-"}`)).join("") : row("No expenses", "Add purchase/expense above.");
}

async function loadInventory(){
  const {data,error} = await db.from("inventory").select("*").order("raw_material_name");
  $("inventoryList").innerHTML = error ? row("Error", error.message) : data.length ? data.map(r => row(r.raw_material_name, `<span class="pill">${r.category||"-"}</span> Unit ${r.unit||"-"} | Opening ${r.opening_stock} | Added ${r.stock_added} | Used ${r.stock_used} | Closing <b>${r.closing_stock}</b> | Min ${r.minimum_stock_level} | Last ${money(r.last_purchase_price)} | Avg ${money(r.average_purchase_price)}`)).join("") : row("No inventory", "Add expenses first. Inventory will update automatically.");
}

async function loadSOP(){
  const {data,error} = await db.from("sop_recipes").select("*").order("created_at",{ascending:false}).limit(30);
  $("sopList").innerHTML = error ? row("Error", error.message) : data.length ? data.map(r => row(r.menu_item_name, `Prepared ${r.quantity_prepared} | Plates ${r.plates_produced} | Total cost ${money(r.total_recipe_cost)} | Cost/plate ${money(r.cost_per_plate)} | Sell ${money(r.selling_price)} | Profit/plate ${money(r.profit_per_plate)}`)).join("") : row("No SOP recipes", "Add a recipe above.");
}

async function loadReports(){
  const today = todayISO(), start = monthStartISO();
  const [sT,eT,sM,eM] = await Promise.all([
    db.from("sales").select("*").eq("sale_date",today),
    db.from("expenses").select("*").eq("expense_date",today),
    db.from("sales").select("*").gte("sale_date",start),
    db.from("expenses").select("*").gte("expense_date",start)
  ]);
  const dSales=sum(sT.data,"total_amount"), dExp=sum(eT.data,"total_price"), dCost=sum(sT.data,"total_food_cost");
  const mSales=sum(sM.data,"total_amount"), mExp=sum(eM.data,"total_price"), mCost=sum(sM.data,"total_food_cost");

  $("rDailySales").textContent=money(dSales); $("rDailyExpenses").textContent=money(dExp); $("rDailyProfit").textContent=money(dSales-dCost-dExp);
  $("rMonthSales").textContent=money(mSales); $("rMonthExpenses").textContent=money(mExp); $("rMonthProfit").textContent=money(mSales-mCost-mExp);

  renderItemReport(sM.data||[]);
  renderPaymentReport(sM.data||[]);
}

function renderItemReport(rows){
  const map = {};
  rows.forEach(r => {
    map[r.item_name] ||= {qty:0,sales:0,cost:0,profit:0};
    map[r.item_name].qty += Number(r.quantity||0);
    map[r.item_name].sales += Number(r.total_amount||0);
    map[r.item_name].cost += Number(r.total_food_cost||0);
    map[r.item_name].profit += Number(r.gross_profit||0);
  });
  const list = Object.entries(map).sort((a,b)=>b[1].sales-a[1].sales);
  $("itemReport").innerHTML = list.length ? list.map(([n,v]) => row(n, `Qty ${v.qty} | Sales ${money(v.sales)} | Plate cost ${money(v.cost)} | Gross profit ${money(v.profit)}`)).join("") : row("No item-wise sales", "Sales will appear here.");
}

function renderPaymentReport(rows){
  const map = {};
  rows.forEach(r => {
    map[r.payment_mode] ||= {count:0, amount:0};
    map[r.payment_mode].count += 1;
    map[r.payment_mode].amount += Number(r.total_amount||0);
  });
  const list = Object.entries(map).sort((a,b)=>b[1].amount-a[1].amount);
  $("paymentReport").innerHTML = list.length ? list.map(([n,v]) => row(n, `Entries ${v.count} | Amount ${money(v.amount)}`)).join("") : row("No payment data", "Payment mode report will appear here.");
}

if("serviceWorker" in navigator){
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js?v=3").catch(()=>{}));
}
checkSession();
