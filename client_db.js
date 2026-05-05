// ══════════════════════════════════════════════════════════════════
//  Client Database (IndexedDB)
// ══════════════════════════════════════════════════════════════════
let clientDB;

function initClientDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("SmartCareClientDB", 1);

    request.onupgradeneeded = (event) => {
      clientDB = event.target.result;
      if (!clientDB.objectStoreNames.contains("applications")) {
        const store = clientDB.createObjectStore("applications", { keyPath: "id" });
        store.createIndex("phone", "phone", { unique: false });
        store.createIndex("status", "status", { unique: false });
      }
    };

    request.onsuccess = (event) => {
      clientDB = event.target.result;
      resolve();
    };

    request.onerror = (event) => {
      console.error("Client Database Error:", event.target.errorCode);
      reject(event.target.error);
    };
  });
}

// Save a new application
function saveApplication(appData) {
  return new Promise((resolve, reject) => {
    if (!clientDB) return reject("Database not initialized");
    const tx = clientDB.transaction("applications", "readwrite");
    const store = tx.objectStore("applications");
    
    // Auto-generate ID if not provided
    if (!appData.id) appData.id = "APP-" + Date.now();
    if (!appData.status) appData.status = "Pending";
    if (!appData.date) appData.date = new Date().toISOString();

    const request = store.add(appData);

    request.onsuccess = () => resolve(appData.id);
    request.onerror = (e) => reject(e.target.error);
  });
}

// Fetch application by phone number
function getApplicationsByPhone(phone) {
  return new Promise((resolve, reject) => {
    if (!clientDB) return reject("Database not initialized");
    const tx = clientDB.transaction("applications", "readonly");
    const store = tx.objectStore("applications");
    const index = store.index("phone");
    const request = index.getAll(phone);

    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

// Fetch all applications (for admin use later)
function getAllApplications() {
  return new Promise((resolve, reject) => {
    if (!clientDB) return reject("Database not initialized");
    const tx = clientDB.transaction("applications", "readonly");
    const store = tx.objectStore("applications");
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

// Show toast notification (reused logic)
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.style.background = type === 'success' ? 'var(--success)' : 'var(--error)';
  toast.style.color = '#0b0f1a';
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}
