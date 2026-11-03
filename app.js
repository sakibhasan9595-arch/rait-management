
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  deleteUser
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  runTransaction,
  enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";


// FIREBASE CONFIG

const firebaseConfig = {
  apiKey: "AIzaSyDGV8Hcmj8bFheKxSUeTctDASR78-SBeLA",
  authDomain: "rait-management-b9280.firebaseapp.com",
  projectId: "rait-management-b9280",
  storageBucket: "rait-management-b9280.firebasestorage.app",
  messagingSenderId: "53990533251",
  appId: "1:53990533251:web:0f546f678df127397b13b6"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

enableIndexedDbPersistence(db).catch(() => {});


// HELPERS

const $ = id => document.getElementById(id);

const show = id => $(id)?.classList.remove("hidden");
const hide = id => $(id)?.classList.add("hidden");

function notice(msg, kind = "") {
  if (!$("notice")) {
    console.log(msg);
    return;
  }

  $("notice").textContent = msg;
  $("notice").className = "status " + kind;
  show("notice");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function val(id) {
  return $(id)?.value ?? "";
}

function num(id) {
  return Number(val(id) || 0);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}

function money(n) {
  return "৳" + Number(n || 0).toLocaleString("en-BD");
}

function today() {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000)
    .toISOString()
    .slice(0, 10);
}

function friendly(e) {
  return ({
    "auth/invalid-credential":
      "ইমেইল বা পাসওয়ার্ড সঠিক নয়।",
    "auth/email-already-in-use":
      "এই ইমেইলে অ্যাকাউন্ট আগে থেকেই আছে।",
    "auth/weak-password":
      "পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।",
    "permission-denied":
      "Firestore Rules অনুমতি দেয়নি।",
    "unavailable":
      "ইন্টারনেট সংযোগ পরীক্ষা করো।"
  })[e.code] || e.message || String(e);
}


// GLOBAL DATA

let currentUser = null;
let profile = null;

let products = [];
let sales = [];
let restocks = [];

let saleDraftItems = [];

const perms = p =>
  profile?.role === "owner" ||
  profile?.permissions?.[p] === true;


// DEFAULT DATES

if ($("sDate")) $("sDate").value = today();
if ($("rDate")) $("rDate").value = today();


// LOGIN

$("loginBtn")?.addEventListener("click", async () => {
  try {
    await signInWithEmailAndPassword(
      auth,
      val("loginEmail").trim(),
      val("loginPass")
    );
  } catch (e) {
    notice(friendly(e), "bad");
  }
});


// REGISTRATION

$("registerBtn")?.addEventListener("click", async () => {
  const name = val("regName").trim();
  const username = val("regUsername").trim().toLowerCase();
  const email = val("regEmail").trim();
  const pass = val("regPass");

  if (!name || !username || !email || pass.length < 6) {
    return notice(
      "নাম, Username, Email ও কমপক্ষে ৬ অক্ষরের Password দাও।",
      "bad"
    );
  }

  if (!/^[a-z0-9_]{3,30}$/.test(username)) {
    return notice(
      "Username ৩-৩০ অক্ষরের হতে হবে। শুধু ইংরেজি ছোট হাতের অক্ষর, সংখ্যা ও underscore (_) ব্যবহার করো।",
      "bad"
    );
  }

  let newUser = null;

  try {
    const cred = await createUserWithEmailAndPassword(
      auth,
      email,
      pass
    );

    newUser = cred.user;

    const usernameRef = doc(db, "usernameClaims", username);

    const requestRef = doc(
      db,
      "registrationRequests",
      cred.user.uid
    );

    await runTransaction(db, async transaction => {
      const usernameSnap = await transaction.get(usernameRef);

      if (usernameSnap.exists()) {
        throw new Error(
          "এই Username ইতিমধ্যে ব্যবহৃত হচ্ছে। অন্য Username দাও।"
        );
      }

      transaction.set(usernameRef, {
        uid: cred.user.uid,
        username,
        createdAt: serverTimestamp()
      });

      transaction.set(requestRef, {
        uid: cred.user.uid,
        name,
        username,
        email,
        status: "pending",
        createdAt: serverTimestamp()
      });
    });

    newUser = null;

    notice(
      "Registration request পাঠানো হয়েছে। Admin Approval-এর জন্য অপেক্ষা করো।",
      "good"
    );

  } catch (e) {
    console.error("Registration failed:", e);

    if (newUser) {
      try {
        await deleteUser(newUser);
      } catch (deleteError) {
        console.error(
          "Temporary account cleanup failed:",
          deleteError
        );
      }
    }

    notice(
  `Error Code: ${e.code || "unknown"} | ${e.message || e}`,
  "bad"
);
  }
});

// LOGOUT

$("logoutBtn")?.addEventListener("click", () => signOut(auth));
$("pendingLogout")?.addEventListener("click", () => signOut(auth));


// OWNER PROFILE / AUTH STATE


onAuthStateChanged(auth, async user => {
  currentUser = user;
  profile = null;

  hide("authView");
  hide("pendingView");
  hide("appView");

  if (!user) {
    show("authView");
    return;
  }

  try {
    const userRef = doc(db, "users", user.uid);
    const requestRef = doc(
      db,
      "registrationRequests",
      user.uid
    );

    const snap = await getDoc(userRef);

    const diagnostic = {
      signedInUid: user.uid,
      email: user.email,
      profileDocumentExists: snap.exists(),
      profileDocumentId: user.uid
    };

    console.info("Rait profile check:", diagnostic);

    // PROFILE NOT FOUND
    if (!snap.exists()) {

      let requestSnap = null;

      // Registration transaction may still be processing.
      for (let attempt = 0; attempt < 5; attempt++) {
        requestSnap = await getDoc(requestRef);

        if (requestSnap.exists()) {
          break;
        }

        await new Promise(resolve =>
          setTimeout(resolve, 700)
        );
      }

      if (requestSnap && requestSnap.exists()) {
        const request = requestSnap.data();

        console.info(
          "Rait registration status:",
          request.status
        );

        show("pendingView");

        if (request.status === "rejected") {
          notice(
            "তোমার Registration Request প্রত্যাখ্যান করা হয়েছে। Owner-এর সঙ্গে যোগাযোগ করো।",
            "bad"
          );
        }

        return;
      }

      console.error(
        "Profile and registration request both missing:",
        diagnostic
      );

      show("pendingView");

      notice(
        "Profile ও Registration Request পাওয়া যায়নি। UID: " + user.uid,
        "bad"
      );

      return;
    }

    // PROFILE FOUND
    profile = snap.data();
  
    // LOAD MY PROFILE DATA

$("profileName").value = profile.name || "";

$("profileUsername").value =
  profile.username || "";

$("profileEmail").value =
  profile.email || user.email || "";

$("profilePhone").value =
  profile.phone || "";

$("profilePosition").value =
  profile.position || "";

$("profileRole").value =
  profile.role === "owner"
    ? "Owner / Super Admin"
    : "Approved Staff";

// MY PROFILE PHOTO

if (profile.photoURL) {
  $("myProfilePhoto").src = profile.photoURL;
  $("myProfilePhoto").classList.remove("hidden");
  $("myProfilePhotoFallback").classList.add("hidden");
} else {
  $("myProfilePhoto").classList.add("hidden");
  $("myProfilePhotoFallback").classList.remove("hidden");
}

    diagnostic.role = profile.role;
    diagnostic.active = profile.active;
    diagnostic.activeType = typeof profile.active;
    diagnostic.permissionsExists = !!profile.permissions;

    console.info("Rait profile values:", diagnostic);

    if (profile.active !== true) {
      show("pendingView");

      notice(
        `Approval সমস্যা: active=${String(profile.active)}, role=${String(profile.role)}, UID: ${user.uid}`,
        "bad"
      );

      return;
    }

    if (!$("welcome") || !$("roleText")) {
      throw new Error(
        "index.html-এ welcome অথবা roleText পাওয়া যায়নি।"
      );
    }

$("welcome").textContent = profile.name || user.email;

$("headerUsername").textContent =
  "@" + (profile.username || "Username not set");

$("roleText").textContent =
  profile.role === "owner" ? "Owner / Super Admin" : "Approved Staff";

if (profile.photoURL) {
  $("headerPhoto").src = profile.photoURL;
  $("headerPhoto").classList.remove("hidden");
  $("headerPhotoFallback").classList.add("hidden");
} else {
  $("headerPhoto").classList.add("hidden");
  $("headerPhotoFallback").classList.remove("hidden");
}

    show("appView");

    if (profile.role === "owner") {
  show("usersTab");
  show("usersPanel");
} else {
  hide("usersTab");
  hide("usersPanel");
    }

    await refreshAll();

  } catch (e) {
    console.error("Profile load failed:", e);

    show("pendingView");

    notice(
      `Profile Error: ${e.code || "unknown"} | ${e.message || e}`,
      "bad"
    );
  }
});



// ==========================================
// MY PROFILE: SAVE NAME AND PHONE
// ==========================================

$("saveProfileBtn").addEventListener("click", async () => {

  if (!currentUser || !profile) return;

  const name = $("profileName").value.trim();
  const phone = $("profilePhone").value.trim();

  if (!name) {
    return notice("নাম লিখুন।", "bad");
  }

  try {

    await updateDoc(
      doc(db, "users", currentUser.uid),
      {
        name: name,
        phone: phone,
        updatedAt: serverTimestamp()
      }
    );

    profile.name = name;
    profile.phone = phone;

    $("welcome").textContent = name;

    notice("Profile সফলভাবে Update হয়েছে।", "good");

  } catch (e) {
    console.error("Profile update failed:", e);
    notice(friendly(e), "bad");
  }

});


// ==========================================
// MY PROFILE: CLOUDINARY PHOTO UPLOAD
// ==========================================

$("profilePhotoInput").addEventListener("change", async () => {

  if (!currentUser || !profile) return;

  const file = $("profilePhotoInput").files[0];

  if (!file) return;

  if (!file.type.startsWith("image/")) {
    return notice("শুধু Image Upload করা যাবে।", "bad");
  }

  if (file.size > 5 * 1024 * 1024) {
    return notice("ছবির সাইজ 5 MB-এর কম হতে হবে।", "bad");
  }

  try {

    notice("ছবি Upload হচ্ছে...", "good");

    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", "rait_profile_photos");

    const response = await fetch(
      "https://api.cloudinary.com/v1_1/ijf3buns/image/upload",
      {
        method: "POST",
        body: formData
      }
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error?.message || "Cloudinary Upload failed");
    }

    const photoURL = result.secure_url;

    await updateDoc(
      doc(db, "users", currentUser.uid),
      {
        photoURL: photoURL,
        updatedAt: serverTimestamp()
      }
    );

    profile.photoURL = photoURL;

    $("myProfilePhoto").src = photoURL;
    $("myProfilePhoto").classList.remove("hidden");
    $("myProfilePhotoFallback").classList.add("hidden");

    $("headerPhoto").src = photoURL;
    $("headerPhoto").classList.remove("hidden");
    $("headerPhotoFallback").classList.add("hidden");

    notice("Profile Photo সফলভাবে Update হয়েছে।", "good");

  } catch (e) {
    console.error("Profile photo upload failed:", e);
    notice("Photo Upload Error: " + e.message, "bad");
  }

  $("profilePhotoInput").value = "";

});
    


// TAB NAVIGATION

document.querySelectorAll("[data-tab]").forEach(b => {
  b.addEventListener("click", () => {

    // Only Owner can access User Approval
    if (
      b.dataset.tab === "usersPanel" &&
      profile?.role !== "owner"
    ) {
      hide("usersPanel");
      return;
    }

    [
  "salesPanel",
  "stockPanel",
  "reportsPanel",
  "myProfilePanel",
  "membersPanel",
  "usersPanel"
].forEach(hide);

    show(b.dataset.tab);
  });
});



// DATABASE READ

async function readCol(name) {
  const s = await getDocs(collection(db, name));

  return s.docs.map(d => ({
    id: d.id,
    ...d.data()
  }));
}


// REFRESH ALL DATA

async function refreshAll() {

  if (perms("salesRead")) {
    sales = await readCol("sales");
    renderSales();
    renderReports();
  }

  if (perms("stockRead")) {
    products = await readCol("products");
    restocks = await readCol("restocks");

    renderProducts();
    renderSaleProductPicker();
  }

  if (profile?.role === "owner") {
    await renderRequests();
  }

  await renderMembers();
}


// ==========================================
// MEMBERS DIRECTORY
// ==========================================

async function renderMembers() {

  const membersList = $("membersList");
  const memberSearch = $("memberSearch");

  if (!membersList || !memberSearch) return;

  membersList.textContent = "Members Loading...";

  try {

    const users = await readCol("users");

    const activeMembers = users.filter(
      u => u.active === true
    );

    function displayMembers(searchText = "") {

      const query = String(searchText).toLowerCase().trim();

      const filtered = activeMembers.filter(u => {

        const name = String(u.name || "").toLowerCase();
        const username = String(u.username || "").toLowerCase();

        return (
          name.includes(query) ||
          username.includes(query)
        );

      });

      membersList.innerHTML = filtered.map(u => {

        const photoURL =
          typeof u.photoURL === "string" &&
          /^https:\/\/res\.cloudinary\.com\/[a-zA-Z0-9_-]+\/image\/upload\//.test(u.photoURL)
            ? u.photoURL
            : "";

        return `
  <div class="item" style="
    background:#ffffff;
    border:1px solid #e2e6e9;
    border-radius:16px;
    padding:16px;
    margin-bottom:14px;
    box-shadow:0 3px 12px rgba(0,0,0,0.045);
  ">

    <div style="
      display:flex;
      align-items:center;
      gap:13px;
    ">

      <div style="
        width:62px;
        height:62px;
        min-width:62px;
        border-radius:50%;
        overflow:hidden;
        background:#edf1f4;
        display:flex;
        align-items:center;
        justify-content:center;
        border:2px solid #e2e6e9;
      ">
        ${
          photoURL
            ? `<img src="${esc(photoURL)}" alt="Profile" style="width:100%;height:100%;object-fit:cover;">`
            : `<span style="font-size:27px;">👤</span>`
        }
      </div>

      <div style="flex:1;min-width:0;">

        <div style="
          font-size:16px;
          font-weight:700;
          color:#171717;
          overflow-wrap:anywhere;
        ">
          ${esc(u.name || "Name not set")}
        </div>

        <div style="
          font-size:13px;
          color:#737373;
          margin-top:3px;
        ">
          @${esc(u.username || "No username")}
        </div>

        <span style="
          display:inline-block;
          margin-top:7px;
          padding:4px 10px;
          border-radius:20px;
          background:#e8f5ec;
          color:#24743b;
          font-size:11px;
          font-weight:700;
        ">
                    ● Active
        </span>

      </div>

    </div>

    <div style="
      height:1px;
      background:#eeeeee;
      margin:15px 0;
    "></div>

    <div style="
      display:grid;
      grid-template-columns:1fr 1fr;
      gap:14px 10px;
    ">

      <div style="min-width:0;">
        <div style="font-size:10px;color:#888;font-weight:700;">POSITION</div>
        <div style="font-size:12px;color:#222;margin-top:4px;">
          ${esc(u.position || "—")}
        </div>
      </div>

      <div style="min-width:0;">
        <div style="font-size:10px;color:#888;font-weight:700;">PHONE</div>
        <div style="font-size:12px;color:#222;margin-top:4px;overflow-wrap:anywhere;">
          ${esc(u.phone || "—")}
        </div>
      </div>

    </div>

    <div style="
      margin-top:14px;
      padding-top:12px;
      border-top:1px solid #eeeeee;
    ">
      <div style="font-size:10px;color:#888;font-weight:700;">EMAIL</div>
      <div style="font-size:12px;color:#222;margin-top:4px;overflow-wrap:anywhere;">
        ${esc(u.email || "—")}
      </div>
    </div>

  </div>
`;

      }).join("") || "কোনো Member পাওয়া যায়নি।";

    }

    memberSearch.oninput = () => {
      displayMembers(memberSearch.value);
    };

    displayMembers(memberSearch.value);

  } catch (e) {

    console.error("Members load failed:", e);

    membersList.textContent = "Members Load করা যায়নি।";

    notice(friendly(e), "bad");

  }

}

// ==========================================
// PRODUCT SELECTOR IN SALES ENTRY
// ==========================================

function setupSaleProductPicker() {
  const oldInput = $("sProducts");

  if (!oldInput || $("saleProductPicker")) return;

  const wrapper = document.createElement("div");

  wrapper.id = "saleProductPicker";

  wrapper.innerHTML = `
    <h3>Products Sold</h3>

    <div style="
      display:flex;
      gap:8px;
      flex-wrap:wrap;
      margin-bottom:12px;
    ">
      <select
        id="saleProductSelect"
        style="flex:2;min-width:160px"
      ></select>

      <input
        id="saleProductQty"
        type="number"
        min="1"
        step="1"
        placeholder="Quantity"
        style="flex:1;min-width:100px"
      >

      <button
        type="button"
        id="addSaleProduct"
      >Add Product</button>
    </div>

    <div id="saleProductRows"></div>
  `;

  oldInput.parentNode.insertBefore(wrapper, oldInput);

  oldInput.style.display = "none";

  if (
    oldInput.previousElementSibling &&
    oldInput.previousElementSibling.tagName === "LABEL"
  ) {
    oldInput.previousElementSibling.style.display = "none";
  }

  $("addSaleProduct").addEventListener("click", () => {

    const productId = val("saleProductSelect");
    const quantity = Number(val("saleProductQty"));

    const product = products.find(p => p.id === productId);

    if (!product) {
      return notice(
        "আগে Stock থেকে Product যোগ করো।",
        "bad"
      );
    }

    if (!Number.isInteger(quantity) || quantity < 1) {
      return notice("সঠিক Quantity দাও।", "bad");
    }

    const existing = saleDraftItems.find(
      x => x.productId === productId
    );

    const alreadyAdded = existing?.quantity || 0;
    const available = remaining(product);

    if (alreadyAdded + quantity > available) {
      return notice(
        `Available stock ${available}। এই পণ্যের জন্য মোট ${alreadyAdded + quantity} দিতে চেয়েছ।`,
        "bad"
      );
    }

    if (existing) {
      existing.quantity += quantity;
    } else {
      saleDraftItems.push({
        productId: product.id,
        name: product.name,
        variant: product.variant,
        quantity
      });
    }

    $("saleProductQty").value = "";

    renderSaleDraftItems();
  });

  renderSaleProductPicker();
  renderSaleDraftItems();
  }
    
// UPDATE PRODUCT DROPDOWN

function renderSaleProductPicker() {
  const select = $("saleProductSelect");

  if (!select) return;

  select.innerHTML = products.map(p => `
    <option value="${esc(p.id)}">
      ${esc(p.name)} — ${esc(p.variant)}
      (Stock: ${remaining(p)})
    </option>
  `).join("");

  if (!products.length) {
    select.innerHTML = `
      <option value="">No products available</option>
    `;
  }
}


// SELECTED PRODUCT LIST

function renderSaleDraftItems() {
  const box = $("saleProductRows");

  if (!box) return;

  box.innerHTML = saleDraftItems.map((item, index) => `
    <div class="item">
      <b>${esc(item.name)} — ${esc(item.variant)}</b>
      · Quantity: ${item.quantity}

      <button
        type="button"
        class="secondary"
        data-remove-sale-product="${index}"
      >Remove</button>
    </div>
  `).join("") || "এখনো কোনো Product নির্বাচন করা হয়নি।";

  box.querySelectorAll("[data-remove-sale-product]").forEach(button => {

    button.addEventListener("click", () => {

      saleDraftItems.splice(
        Number(button.dataset.removeSaleProduct),
        1
      );

      renderSaleDraftItems();
    });
  });
}


// ==========================================
// SALES ENTRY
// ==========================================

$("saveSale")?.addEventListener("click", async () => {

  if (!perms("salesCreate")) {
    return notice("Sales entry permission নেই।", "bad");
  }

  try {

    if (!val("sDate")) {
      return notice("Sales date নির্বাচন করো।", "bad");
    }
const hasAmount = [
  "sOrder",
  "sB2C",
  "sDelivery",
  "sCash",
  "sCredit",
  "sDue",
  "sTotal",
  "sCancel"
].some(id => num(id) > 0);

if (!saleDraftItems.length && !hasAmount) {
  return notice(
    "কমপক্ষে একটি Amount অথবা Product Entry দিতে হবে।",
    "bad"
  );
}

    // CHECK STOCK

    for (const item of saleDraftItems) {

      const product = products.find(
        p => p.id === item.productId
      );

      if (!product) {
        return notice(
          "একটি Product Stock-এ পাওয়া যাচ্ছে না।",
          "bad"
        );
      }

      if (item.quantity > remaining(product)) {
        return notice(
          `${product.name} — ${product.variant}: Stock আছে ${remaining(product)}, বিক্রি দিতে চেয়েছ ${item.quantity}`,
          "bad"
        );
      }
    }

    const structuredItems = saleDraftItems.map(item => ({
      productId: item.productId,
      name: item.name,
      variant: item.variant,
      quantity: item.quantity
    }));

    const data = {
      date: val("sDate"),

      order: num("sOrder"),
      b2c: num("sB2C"),
      shopCount: num("sShop"),
      delivery: num("sDelivery"),

      cash: num("sCash"),
      credit: num("sCredit"),
      dueCollection: num("sDue"),
      totalCollection: num("sTotal"),

      cancelled: num("sCancel"),

      // STRUCTURED PRODUCT DATA
      productItems: structuredItems,

      // OLD TEXT FIELD FOR COMPATIBILITY
      productsText: structuredItems.map(item =>
        `${item.name} ${item.variant}: ${item.quantity}`
      ).join(", "),

      createdBy: currentUser.uid,
      createdAt: serverTimestamp()
    };

    await addDoc(collection(db, "sales"), data);

    saleDraftItems = [];

    renderSaleDraftItems();

    if ($("sProducts")) {
      $("sProducts").value = "";
    }

    notice("Sales entry সংরক্ষিত হয়েছে।", "good");

    await refreshAll();

  } catch (e) {
    console.error(e);
    notice(friendly(e), "bad");
  }
});


// ==========================================
// GET PRODUCT ITEMS FROM SALES
// ==========================================

function getSaleItems(sale) {

  // NEW STRUCTURED SALES

  if (Array.isArray(sale.productItems)) {
    return sale.productItems;
  }

  // OLD TEXT-BASED SALES

  const text = String(sale.productsText || "");

  const items = [];

  text.split(",").forEach(part => {

    const match = part.match(/^(.*?):\s*(\d+)\s*$/);

    if (!match) return;

    const label = match[1].trim();
    const quantity = Number(match[2]);

    const product = products.find(p => {

      const fullName =
        `${p.name} ${p.variant}`.toLowerCase();

      const alternateName =
        `${p.name} — ${p.variant}`.toLowerCase();

      return (
        fullName === label.toLowerCase() ||
        alternateName === label.toLowerCase()
      );
    });

    if (product && quantity > 0) {

      items.push({
        productId: product.id,
        name: product.name,
        variant: product.variant,
        quantity
      });
    }
  });

  return items;
}


// ==========================================
// SALES LIST
// ==========================================

function renderSales() {

  if (!$("salesList")) return;

  $("salesList").innerHTML =
    "<h3>Recent Entries</h3>" +

    sales
      .slice()
      .sort((a, b) =>
        (b.date || "").localeCompare(a.date || "")
      )
      .slice(0, 15)
      .map(s => {

        const items = getSaleItems(s);

        const itemText = items.map(item =>
          `${esc(item.name)} ${esc(item.variant)}: ${Number(item.quantity)}`
        ).join(", ");

        return `
          <div class="item">

            <b>${esc(s.date || "")}</b>

            · Order ${money(s.order)}
            · Collection ${money(s.totalCollection)}

            ${
              itemText
                ? `<div style="margin-top:6px">${itemText}</div>`
                : ""
            }

            ${
              perms("salesDelete")
                ? `
                  <button
                    class="secondary"
                    data-del-sale="${esc(s.id)}"
                  >Delete</button>
                `
                : ""
            }

          </div>
        `;
      })
      .join("");

  document.querySelectorAll("[data-del-sale]").forEach(b => {

    b.addEventListener("click", async () => {

      if (!perms("salesDelete")) {
        return notice("Delete permission নেই।", "bad");
      }

      if (!confirm("এই entry delete করবে?")) return;

      try {

        await deleteDoc(
          doc(db, "sales", b.dataset.delSale)
        );

        notice("Sales entry delete হয়েছে।", "good");

        await refreshAll();

      } catch (e) {
        notice(friendly(e), "bad");
      }
    });
  });
}


// ==========================================
// ADD PRODUCT
// ==========================================

$("addProduct")?.addEventListener("click", async () => {

  if (!perms("stockCreate")) {
    return notice("Stock create permission নেই।", "bad");
  }

  const name = val("pName").trim();
  const variant = val("pVariant").trim();

  const opening = num("pOpening");

  if (!name || !variant) {
    return notice(
      "Product name ও variant দাও।",
      "bad"
    );
  }

  if (opening < 0) {
    return notice(
      "Opening stock ঋণাত্মক হতে পারে না।",
      "bad"
    );
  }

  try {

    await addDoc(collection(db, "products"), {
      name,
      variant,
      opening,
      createdAt: serverTimestamp()
    });

    $("pName").value = "";
    $("pVariant").value = "";
    $("pOpening").value = "";

    notice("Product যোগ হয়েছে।", "good");

    await refreshAll();

  } catch (e) {
    notice(friendly(e), "bad");
  }
});


// ==========================================
// ADD RESTOCK
// ==========================================

$("addRestock")?.addEventListener("click", async () => {

  if (!perms("stockCreate")) {
    return notice("Restock permission নেই।", "bad");
  }

  if (!val("rProduct") || num("rQty") < 1) {
    return notice(
      "Product ও Quantity নির্বাচন করো।",
      "bad"
    );
  }

  try {

    await addDoc(collection(db, "restocks"), {
      productId: val("rProduct"),
      quantity: num("rQty"),
      date: val("rDate"),
      createdBy: currentUser.uid,
      createdAt: serverTimestamp()
    });

    notice("Restock সংরক্ষিত হয়েছে।", "good");

    await refreshAll();

  } catch (e) {
    notice(friendly(e), "bad");
  }
});


// ==========================================
// REMAINING STOCK
// ==========================================

function remaining(p) {

  const restocked = restocks
    .filter(r => r.productId === p.id)
    .reduce(
      (sum, r) => sum + Number(r.quantity || 0),
      0
    );

  const sold = sales.reduce((sum, sale) => {

    const productQuantity = getSaleItems(sale)
      .filter(item => item.productId === p.id)
      .reduce(
        (total, item) =>
          total + Number(item.quantity || 0),
        0
      );

    return sum + productQuantity;

  }, 0);

  return (
    Number(p.opening || 0) +
    restocked -
    sold
  );
}


// ==========================================
// PRODUCT LIST
// ==========================================


function renderProducts() {

  if ($("rProduct")) {
    $("rProduct").innerHTML = products.map(p => `
      <option value="${esc(p.id)}">
        ${esc(p.name)} — ${esc(p.variant)}
      </option>
    `).join("");
  }

  if ($("productsList")) {
    const stockSummary = `
  <div class="item">
    <h3>Current Stock Summary</h3>

    ${
      products.length
        ? products.map(p => `
            <div style="
              display:flex;
              justify-content:space-between;
              gap:10px;
              padding:8px 0;
              border-bottom:1px solid #ddd;
            ">
              <div>
                <b>${esc(p.name)}</b>
                <div class="muted">${esc(p.variant)}</div>
              </div>

              <b>${remaining(p)}</b>
            </div>
          `).join("")
        : `<div class="muted">কোনো Product নেই।</div>`
    }
  </div>
`;

    $("productsList").innerHTML =
  stockSummary +
  products.map(p => {

        const productRestocks = restocks
          .filter(r => r.productId === p.id)
          .sort((a, b) =>
            (b.date || "").localeCompare(a.date || "")
          );

        return `
          <div class="item">

            <b>${esc(p.name)}</b>
            · ${esc(p.variant)}

            <div style="margin:8px 0">
              Opening Stock: ${Number(p.opening || 0)}
              <br>
              <b>Remaining: ${remaining(p)}</b>
            </div>

            ${
              perms("stockEdit")
                ? `
                  <button
                    class="secondary"
                    data-edit-opening="${esc(p.id)}"
                  >Edit Opening Stock</button>
                `
                : ""
            }

            ${
              productRestocks.length
                ? `
                  <div style="margin-top:12px">
                    <b>Restock History</b>
                    ${productRestocks.map(r => `
                      <div class="item">

                        Date: ${esc(r.date || "")}
                        <br>
                        Quantity: ${Number(r.quantity || 0)}

                        ${
                          perms("stockEdit")
                            ? `
                              <button
                                class="secondary"
                                data-edit-restock="${esc(r.id)}"
                              >Edit Restock</button>
                            `
                            : ""
                        }

                        ${
                          perms("stockDelete")
                            ? `
                              <button
                                class="danger"
                                data-delete-restock="${esc(r.id)}"
                              >Delete Restock</button>
                            `
                            : ""
                        }

                      </div>
                    `).join("")}
                  </div>
                `
                : `<div class="muted">কোনো Restock Entry নেই।</div>`
            }

          </div>
        `;
      }).join("") ||
      "এখনো কোনো product যোগ করা হয়নি।";
  }

  // EDIT OPENING STOCK

  document.querySelectorAll("[data-edit-opening]").forEach(b => {

    b.addEventListener("click", async () => {

      if (!perms("stockEdit")) {
        return notice("Stock edit permission নেই।", "bad");
      }

      const product = products.find(
        p => p.id === b.dataset.editOpening
      );

      if (!product) return;

      const value = prompt(
        "নতুন Opening Stock দাও:",
        product.opening || 0
      );

      if (value === null) return;

      const opening = Number(value);

      if (!Number.isFinite(opening) || opening < 0) {
        return notice("সঠিক Quantity দাও।", "bad");
      }

      try {

        await updateDoc(
          doc(db, "products", product.id),
          { opening }
        );

        notice("Opening Stock আপডেট হয়েছে।", "good");

        await refreshAll();

      } catch (e) {
        notice(friendly(e), "bad");
      }
    });
  });


  // EDIT RESTOCK

  document.querySelectorAll("[data-edit-restock]").forEach(b => {

    b.addEventListener("click", async () => {

      if (!perms("stockEdit")) {
        return notice("Stock edit permission নেই।", "bad");
      }

      const restock = restocks.find(
        r => r.id === b.dataset.editRestock
      );

      if (!restock) return;

      const quantityText = prompt(
        "নতুন Restock Quantity:",
        restock.quantity
      );

      if (quantityText === null) return;

      const quantity = Number(quantityText);

      if (!Number.isFinite(quantity) || quantity < 1) {
        return notice("সঠিক Quantity দাও।", "bad");
      }

      const date = prompt(
        "Restock Date (YYYY-MM-DD):",
        restock.date || ""
      );

      if (date === null) return;

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return notice("সঠিক Date দাও।", "bad");
      }

      try {

        await updateDoc(
          doc(db, "restocks", restock.id),
          {
            quantity,
            date
          }
        );

        notice("Restock আপডেট হয়েছে।", "good");

        await refreshAll();

      } catch (e) {
        notice(friendly(e), "bad");
      }
    });
  });


  // DELETE RESTOCK

  document.querySelectorAll("[data-delete-restock]").forEach(b => {

    b.addEventListener("click", async () => {

      if (!perms("stockDelete")) {
        return notice("Stock delete permission নেই।", "bad");
      }

      if (!confirm("এই Restock Entry Delete করবে?")) return;

      try {

        await deleteDoc(
          doc(db, "restocks", b.dataset.deleteRestock)
        );

        notice("Restock Entry Delete হয়েছে।", "good");

        await refreshAll();

      } catch (e) {
        notice(friendly(e), "bad");
      }
    });
  });

  renderSaleProductPicker();
}

      
// ==========================================
// DAILY + PRODUCT-WISE REPORTS
// ==========================================

function renderReports() {

  if (!$("reportList")) return;

  const groups = {};
  const productTotals = {};
const dailyProductTotals = {};

  sales.forEach(sale => {

    const date = sale.date || "Unknown";

    // DAILY TOTALS

    groups[date] ??= {
  count: 0,
  order: 0,
  b2c: 0,
  delivery: 0,
  cash: 0,
  credit: 0,
  dueCollection: 0,
  collection: 0,
  cancelled: 0,
  shopCount: 0
};

groups[date].count++;

[
  "order",
  "b2c",
  "delivery",
  "cash",
  "credit",
  "dueCollection",
  "totalCollection",
  "cancelled",
  "shopCount"
].forEach(key => {
  const reportKey =
    key === "totalCollection" ? "collection" : key;

  groups[date][reportKey] +=
    Number(sale[key] || 0);
});


// PRODUCT TOTALS + DATE-WISE PRODUCT TOTALS

dailyProductTotals[date] ??= {};

getSaleItems(sale).forEach(item => {

  const key =
    item.productId ||
    `${item.name}-${item.variant}`;

  productTotals[key] ??= {
    name: item.name || "Unknown",
    variant: item.variant || "",
    quantity: 0
  };

  productTotals[key].quantity +=
    Number(item.quantity || 0);

  dailyProductTotals[date][key] ??= {
    name: item.name || "Unknown",
    variant: item.variant || "",
    quantity: 0
  };

  dailyProductTotals[date][key].quantity +=
    Number(item.quantity || 0);

}); 
    }); 


  // DAILY REPORT HTML

  const dailyHTML = Object.entries(groups)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, x]) => `

      <div class="item">

        <b>${esc(date)}</b><br>

        Entries: ${x.count}<br>

        Order: ${money(x.order)}<br>

B2C: ${money(x.b2c)}<br>

Shop Count: ${x.shopCount}<br>

Delivery: ${money(x.delivery)}<br>

Cash: ${money(x.cash)}<br>

Credit: ${money(x.credit)}<br>

Due Collection: ${money(x.dueCollection)}<br>

Total Collection: ${money(x.collection)}<br>

Cancelled: ${money(x.cancelled)}

<br><br>

<b>Product Sold:</b>

${
  Object.values(dailyProductTotals[date] || {})
    .map(item => `
      <div style="margin-left:10px; margin-top:5px">
        ${esc(item.name)} — ${esc(item.variant)}:
        <b>${item.quantity} pcs</b>
      </div>
    `).join("") ||
    `<div class="muted">কোনো Product বিক্রি হয়নি।</div>`
}

      </div>

    `).join("");


  // OVERALL PRODUCT REPORT

  const productHTML = Object.values(productTotals)
    .sort((a, b) =>
      a.name.localeCompare(b.name)
    )
    .map(item => `

      <div class="item">

        <b>
          ${esc(item.name)} — ${esc(item.variant)}
        </b>

        <span class="pill">
          Sold: ${item.quantity}
        </span>

      </div>

    `).join("");


  $("reportList").innerHTML = `

    <h3>Daily Sales Reports</h3>

    ${
      dailyHTML ||
      "কোনো sales report নেই।"
    }

    <h3 style="margin-top:20px">
      Product-wise Sales
    </h3>

    ${
      productHTML ||
      "এখনো কোনো Product বিক্রির তথ্য নেই।"
    }

  `;
}


// ==========================================
// OWNER: REGISTRATION REQUESTS
// ==========================================

async function renderRequests() {

  if (profile?.role !== "owner") return;

  const req = await readCol("registrationRequests");

  if (!$("requestsList")) return;

  $("requestsList").innerHTML =
    req
      .filter(r => r.status === "pending")
      .map(r => `

        <div class="item">

          <b>${esc(r.name)}</b><br>

          ${esc(r.email)}

          <div class="row">

            <button data-approve="${esc(r.id)}">
              Approve
            </button>

            <button
              class="danger"
              data-reject="${esc(r.id)}"
            >
              Reject
            </button>

          </div>

        </div>

      `).join("") ||
      "কোনো pending request নেই।";


  // APPROVE

  document.querySelectorAll("[data-approve]").forEach(b => {

    b.addEventListener("click", async () => {

      if (profile?.role !== "owner") {
        return notice("শুধু Owner অনুমোদন দিতে পারবেন।", "bad");
      }

      const r = req.find(
        x => x.id === b.dataset.approve
      );

      if (!r) return;

      try {

        await setDoc(
          doc(db, "users", r.uid),
          {
            name: r.name,
            username: r.username,
            email: r.email,
            role: "staff",
            active: true,

            permissions: {
              salesRead: true,
              salesCreate: false,
              salesEdit: false,
              salesDelete: false,

              stockRead: true,
              stockCreate: false,
              stockEdit: false,
              stockDelete: false,

              reportsRead: true,
              usersManage: false
            }
          }
        );

        await updateDoc(
          doc(db, "registrationRequests", r.id),
          {
            status: "approved",
            approvedAt: serverTimestamp(),
            approvedBy: currentUser.uid
          }
        );

        notice(
          "ব্যবহারকারী অনুমোদিত হয়েছে।",
          "good"
        );

        await renderRequests();

      } catch (e) {
        notice(friendly(e), "bad");
      }
    });
  });


  // REJECT

  document.querySelectorAll("[data-reject]").forEach(b => {

    b.addEventListener("click", async () => {

      if (profile?.role !== "owner") {
        return notice("শুধু Owner request reject করতে পারবেন।", "bad");
      }

      if (!confirm("Request reject করবে?")) return;

      try {

        await updateDoc(
          doc(db, "registrationRequests", b.dataset.reject),
          {
            status: "rejected",
            reviewedAt: serverTimestamp()
          }
        );

        notice("Request reject করা হয়েছে।", "good");

        await renderRequests();

      } catch (e) {
        notice(friendly(e), "bad");
      }
    });
  });
}


// ==========================================
// INITIALIZE PRODUCT PICKER
// ==========================================

setupSaleProductPicker();


// ==========================================
// SERVICE WORKER
// ==========================================

if ("serviceWorker" in navigator) {

  window.addEventListener("load", () => {

    navigator.serviceWorker
      .register("./sw.js")
      .catch(e =>
        console.warn("Service Worker:", e)
      );

  });

}
