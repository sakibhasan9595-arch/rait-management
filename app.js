import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
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
  enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

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

let currentUser = null;
let profile = null;
let products = [];
let sales = [];
let restocks = [];

const perms = p =>
  profile?.role === "owner" ||
  profile?.permissions?.[p] === true;

const money = n =>
  "৳" + Number(n || 0).toLocaleString("en-BD");

function today() {
  return new Date().toISOString().slice(0, 10);
}

if ($("sDate")) $("sDate").value = today();
if ($("rDate")) $("rDate").value = today();

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
  const email = val("regEmail").trim();
  const pass = val("regPass");

  if (!name || !email || pass.length < 6) {
    return notice(
      "নাম, ইমেইল ও কমপক্ষে ৬ অক্ষরের পাসওয়ার্ড দাও।",
      "bad"
    );
  }

  try {
    const cred = await createUserWithEmailAndPassword(
      auth,
      email,
      pass
    );

    await setDoc(
      doc(db, "registrationRequests", cred.user.uid),
      {
        uid: cred.user.uid,
        name,
        email,
        status: "pending",
        createdAt: serverTimestamp()
      }
    );

    notice("Registration request পাঠানো হয়েছে।", "good");

  } catch (e) {
    notice(friendly(e), "bad");
  }
});


// LOGOUT

$("logoutBtn")?.addEventListener("click", () => signOut(auth));
$("pendingLogout")?.addEventListener("click", () => signOut(auth));


// OWNER PROFILE DIAGNOSTIC

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
    const snap = await getDoc(userRef);

    const diagnostic = {
      signedInUid: user.uid,
      email: user.email,
      profileDocumentExists: snap.exists(),
      profileDocumentId: user.uid
    };

    console.info("Rait profile check:", diagnostic);

    if (!snap.exists()) {
      show("pendingView");

      notice(
        "Profile document পাওয়া যায়নি। Auth UID: " + user.uid,
        "bad"
      );

      return;
    }

    profile = snap.data();

    diagnostic.role = profile.role;
    diagnostic.active = profile.active;
    diagnostic.activeType = typeof profile.active;
    diagnostic.permissionsExists = !!profile.permissions;

    console.info("Rait profile values:", diagnostic);

    if (profile.active !== true) {
      show("pendingView");

      notice(
        `Approval সমস্যা: active=${String(profile.active)} (${typeof profile.active}), role=${String(profile.role)}. UID: ${user.uid}`,
        "bad"
      );

      return;
    }

    if (!$("welcome") || !$("roleText")) {
      throw new Error(
        "index.html-এ welcome অথবা roleText পাওয়া যায়নি।"
      );
    }

    $("welcome").textContent =
      profile.name || user.email;

    $("roleText").textContent =
      profile.role === "owner"
        ? "Owner / Super Admin"
        : "Approved Staff";

    show("appView");

    if (profile.role === "owner") {
      show("usersTab");
    }

    await refreshAll();

  } catch (e) {
    console.error("Profile load failed:", e);
    show("pendingView");
    notice("Profile পরীক্ষা ব্যর্থ: " + friendly(e), "bad");
  }
});


// TAB NAVIGATION

document.querySelectorAll("[data-tab]").forEach(b => {
  b.addEventListener("click", () => {
    [
      "salesPanel",
      "stockPanel",
      "reportsPanel",
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


// REFRESH

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
  }

  if (profile?.role === "owner") {
    await renderRequests();
  }
}


// SALES ENTRY

$("saveSale")?.addEventListener("click", async () => {

  if (!perms("salesCreate")) {
    return notice("Sales entry permission নেই।", "bad");
  }

  try {
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
      productsText: val("sProducts"),
      createdBy: currentUser.uid,
      createdAt: serverTimestamp()
    };

    await addDoc(collection(db, "sales"), data);

    notice("Sales entry সংরক্ষিত হয়েছে।", "good");
    await refreshAll();

  } catch (e) {
    notice(friendly(e), "bad");
  }
});


// SALES LIST

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
      .map(s => `
        <div class="item">
          <b>${esc(s.date || "")}</b>
          · Order ${money(s.order)}
          · Collection ${money(s.totalCollection)}
          <button class="secondary" data-del-sale="${s.id}">
            Delete
          </button>
        </div>
      `)
      .join("");

  document.querySelectorAll("[data-del-sale]").forEach(b => {
    b.addEventListener("click", async () => {

      if (!perms("salesDelete")) {
        return notice("Delete permission নেই।", "bad");
      }

      if (!confirm("এই entry delete করবে?")) return;

      try {
        await deleteDoc(doc(db, "sales", b.dataset.delSale));
        await refreshAll();
      } catch (e) {
        notice(friendly(e), "bad");
      }
    });
  });
}


// ADD PRODUCT

$("addProduct")?.addEventListener("click", async () => {

  if (!perms("stockCreate")) {
    return notice("Stock create permission নেই।", "bad");
  }

  const name = val("pName").trim();
  const variant = val("pVariant").trim();

  if (!name || !variant) {
    return notice("Product name ও variant দাও।", "bad");
  }

  try {
    await addDoc(collection(db, "products"), {
      name,
      variant,
      opening: num("pOpening"),
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


// ADD RESTOCK

$("addRestock")?.addEventListener("click", async () => {

  if (!perms("stockCreate")) {
    return notice("Restock permission নেই।", "bad");
  }

  if (!val("rProduct") || num("rQty") < 1) {
    return notice("Product ও quantity নির্বাচন করো।", "bad");
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


// REMAINING STOCK

function remaining(p) {
  const rest = restocks
    .filter(r => r.productId === p.id)
    .reduce((a, r) => a + Number(r.quantity || 0), 0);

  return Number(p.opening || 0) + rest;
}


// PRODUCT LIST

function renderProducts() {

  if ($("rProduct")) {
    $("rProduct").innerHTML = products.map(p => `
      <option value="${p.id}">
        ${esc(p.name)} — ${esc(p.variant)}
      </option>
    `).join("");
  }

  if ($("productsList")) {
    $("productsList").innerHTML =
      products.map(p => `
        <div class="item">
          <b>${esc(p.name)}</b>
          · ${esc(p.variant)}
          <span class="pill">Remaining: ${remaining(p)}</span>
        </div>
      `).join("") ||
      "এখনো কোনো product যোগ করা হয়নি।";
  }
}


// DAILY REPORT

function renderReports() {
  if (!$("reportList")) return;

  const groups = {};

  sales.forEach(s => {
    const d = s.date || "Unknown";

    groups[d] ??= {
      count: 0,
      order: 0,
      b2c: 0,
      collection: 0,
      cancelled: 0
    };

    groups[d].count++;
    groups[d].order += Number(s.order || 0);
    groups[d].b2c += Number(s.b2c || 0);
    groups[d].collection += Number(s.totalCollection || 0);
    groups[d].cancelled += Number(s.cancelled || 0);
  });

  $("reportList").innerHTML =
    Object.entries(groups)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([d, x]) => `
        <div class="item">
          <b>${d}</b><br>
          Entries: ${x.count}
          · Order: ${money(x.order)}
          · B2C: ${money(x.b2c)}
          · Collection: ${money(x.collection)}
          · Cancelled: ${money(x.cancelled)}
        </div>
      `)
      .join("") || "কোনো sales report নেই।";
}


// OWNER: REGISTRATION REQUESTS

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
            <button data-approve="${r.id}">Approve</button>
            <button class="danger" data-reject="${r.id}">
              Reject
            </button>
          </div>
        </div>
      `)
      .join("") || "কোনো pending request নেই।";


  // APPROVE

  document.querySelectorAll("[data-approve]").forEach(b => {
    b.addEventListener("click", async () => {

      const r = req.find(x => x.id === b.dataset.approve);
      if (!r) return;

      try {
        await setDoc(doc(db, "users", r.uid), {
          name: r.name,
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
        });

        await updateDoc(
          doc(db, "registrationRequests", r.id),
          {
            status: "approved",
            approvedAt: serverTimestamp(),
            approvedBy: currentUser.uid
          }
        );

        notice("ব্যবহারকারী অনুমোদিত হয়েছে।", "good");
        await renderRequests();

      } catch (e) {
        notice(friendly(e), "bad");
      }
    });
  });


  // REJECT

  document.querySelectorAll("[data-reject]").forEach(b => {
    b.addEventListener("click", async () => {

      if (!confirm("Request reject করবে?")) return;

      try {
        await updateDoc(
          doc(db, "registrationRequests", b.dataset.reject),
          {
            status: "rejected",
            reviewedAt: serverTimestamp()
          }
        );

        await renderRequests();

      } catch (e) {
        notice(friendly(e), "bad");
      }
    });
  });
}


// HTML ESCAPE

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}


// SERVICE WORKER

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .catch(e => console.warn("Service Worker:", e));
  });
  }
                       
