// ═══════════════════════════════════════════════════════════════
//  MediBot AI — Advanced Medical Chatbot
//  APIs: OpenFDA (drug labels) + RxNorm (NIH) + Wikipedia
// ═══════════════════════════════════════════════════════════════

// ── API Endpoints ────────────────────────────────────────────────
const API = {
  fdaLabel:   q => `https://api.fda.gov/drug/label.json?search=${encodeURIComponent(q)}&limit=1`,
  fdaBrand:   n => `https://api.fda.gov/drug/label.json?search=openfda.brand_name:"${encodeURIComponent(n)}"&limit=1`,
  fdaGeneric: n => `https://api.fda.gov/drug/label.json?search=openfda.generic_name:"${encodeURIComponent(n)}"&limit=1`,
  rxNorm:     n => `https://rxnav.nlm.nih.gov/REST/drugs.json?name=${encodeURIComponent(n)}`,
  rxSpell:    n => `https://rxnav.nlm.nih.gov/REST/spellingsuggestions.json?name=${encodeURIComponent(n)}`,
  wikiSearch: q => `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=1&srsearch=${encodeURIComponent(q+' medicine pharmacology')}`,
  wikiSum:    t => `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t)}`,
};

// ── IndexedDB ────────────────────────────────────────────────────
const DB_NAME = 'SmartCareDB', DB_VERSION = 1;
let db;

function initDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('appointments')) {
        const s = d.createObjectStore('appointments', { keyPath: 'id', autoIncrement: true });
        s.createIndex('name',   'name',   { unique: false });
        s.createIndex('date',   'date',   { unique: false });
        s.createIndex('doctor', 'doctor', { unique: false });
        s.createIndex('status', 'status', { unique: false });
      }
      if (!d.objectStoreNames.contains('chatLogs'))
        d.createObjectStore('chatLogs', { keyPath: 'id', autoIncrement: true });
    };
    r.onsuccess = e => { db = e.target.result; res(db); };
    r.onerror   = e => rej(e.target.error);
  });
}

function dbAdd(store, data) {
  return new Promise((res, rej) => {
    if (!db) return rej('DB not ready');
    const tx = db.transaction(store, 'readwrite');
    const r  = tx.objectStore(store).add(data);
    r.onsuccess = () => res(r.result);
    r.onerror   = () => rej(r.error);
  });
}

// ── Toast ─────────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  const colors = { success:'#1a7a3c', warn:'#7a5000', error:'#7a001a' };
  t.style.background = colors[type] || colors.success;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3800);
}

// ── Appointment Booking ───────────────────────────────────────────
async function bookAppointment() {
  const get = id => document.getElementById(id)?.value.trim() || '';
  const name   = get('apptName');
  const phone  = get('apptPhone');
  const email  = get('apptEmail');
  const date   = get('apptDate');
  const doctor = get('apptDoctor');
  const reason = get('apptReason');

  if (!name)   return showToast('⚠️ Please enter your name.', 'warn');
  if (!phone)  return showToast('⚠️ Please enter phone number.', 'warn');
  if (!date)   return showToast('⚠️ Please select a date.', 'warn');
  if (!doctor) return showToast('⚠️ Please select a doctor.', 'warn');

  try {
    await dbAdd('appointments', { name, phone, email, date, doctor, reason, bookedAt: new Date().toISOString(), status: 'Pending' });
    showToast(`✅ Appointment confirmed with ${doctor}!`, 'success');
    ['apptName','apptPhone','apptEmail','apptDate','apptReason'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const sel = document.getElementById('apptDoctor');
    if (sel) sel.value = '';
  } catch {
    showToast('❌ Failed to save. Please try again.', 'error');
  }
}

// ══════════════════════════════════════════════════════════════════
//  ML-STYLE INTENT CLASSIFIER
//  Uses weighted keyword scoring to classify user intent
// ══════════════════════════════════════════════════════════════════
const INTENTS = {
  MEDICINE_INFO: {
    keywords: ['medicine','tablet','tablet','capsule','syrup','drug','pill','dose','dosage','mg','ml','paracetamol','ibuprofen','amoxicillin','aspirin','metformin','omeprazole','cetirizine','azithromycin','dolo','crocin','combiflam','pantoprazole','atorvastatin','amlodipine','metoprolol','ciprofloxacin','diazepam','lorazepam','sertraline','fluoxetine','risperidone','levothyroxine','insulin'],
    weight: 3
  },
  SIDE_EFFECTS: {
    keywords: ['side effect','side-effect','adverse','reaction','allergy','allergic','harm','dangerous','warning','precaution','overdose','toxicity','contraindication'],
    weight: 3
  },
  SYMPTOMS: {
    keywords: ['symptom','feel','fever','pain','headache','cough','cold','flu','nausea','vomit','diarrhea','constipation','rash','itch','fatigue','tired','dizzy','breathe','chest','stomach','back','joint','swollen','bleed','infection','wound'],
    weight: 2
  },
  DISEASE_INFO: {
    keywords: ['disease','condition','diabetes','cancer','hypertension','asthma','arthritis','thyroid','depression','anxiety','malaria','tuberculosis','hepatitis','dengue','covid','heart','kidney','liver','epilepsy','alzheimer','parkinson'],
    weight: 2
  },
  CLINIC: {
    keywords: ['appointment','book','doctor','timing','hours','open','close','location','address','contact','phone','email','emergency','fee','cost','price'],
    weight: 4
  },
  GREETING: {
    keywords: ['hi','hello','hey','helo','good morning','good afternoon','good evening','howdy','greetings'],
    weight: 5
  }
};

function classifyIntent(text) {
  const lower = text.toLowerCase();

  // If the user mentions ANY drug from our local database, it's definitely medicine info.
  if (typeof LOCAL_DRUG_DB !== 'undefined') {
    const isLocalDrug = Object.keys(LOCAL_DRUG_DB).some(k => lower.includes(k));
    if (isLocalDrug) return 'MEDICINE_INFO';
  }

  const scores = {};
  for (const [intent, config] of Object.entries(INTENTS)) {
    scores[intent] = config.keywords.reduce((acc, kw) => acc + (lower.includes(kw) ? config.weight : 0), 0);
  }
  const top = Object.entries(scores).sort((a,b) => b[1] - a[1])[0];
  return top[1] > 0 ? top[0] : 'UNKNOWN';
}

// Extract medicine/drug name from text
function extractDrugName(text) {
  const lower = text.toLowerCase();
  
  // If the text contains a known drug, extract that exact name
  if (typeof LOCAL_DRUG_DB !== 'undefined') {
    const matchedKey = Object.keys(LOCAL_DRUG_DB).find(k => lower.includes(k));
    if (matchedKey) return matchedKey;
  }

  // Fallback: Remove common filler words and return likely drug name
  const cleaned = text
    .replace(/\b(what is|tell me about|information on|info about|about|how does|works|used for|uses of|side effects of|dosage of|dose of|mg|ml|tablets?|capsules?|syrups?|medicine|drug|pill|medication|can i take|should i take|is|the|a|an)\b/gi, '')
    .trim()
    .replace(/\s+/g, ' ');
  return cleaned || text;
}

// ══════════════════════════════════════════════════════════════════
//  OPENFDA — Fetch drug label information
// ══════════════════════════════════════════════════════════════════
async function fetchFDA(drugName) {
  const clean = n => (Array.isArray(n) ? n[0] : n || '').replace(/<[^>]+>/g, '').trim();
  const short  = text => text ? text.split('. ').slice(0, 3).join('. ') + '.' : '';

  // Try brand name first, then generic, then general search
  const endpoints = [
    API.fdaBrand(drugName),
    API.fdaGeneric(drugName),
    API.fdaLabel(drugName),
  ];

  for (const url of endpoints) {
    try {
      const res  = await fetch(url);
      const data = await res.json();
      const r    = data?.results?.[0];
      if (!r) continue;

      const brandNames   = r.openfda?.brand_name   || [];
      const genericNames = r.openfda?.generic_name  || [];
      const manufacturer = r.openfda?.manufacturer_name?.[0] || 'N/A';
      const substance    = r.openfda?.substance_name || [];
      const route        = r.openfda?.route          || [];
      const indications  = clean(r.indications_and_usage?.[0]);
      const dosage       = clean(r.dosage_and_administration?.[0]);
      const warnings     = clean(r.warnings?.[0] || r.warnings_and_cautions?.[0]);
      const sideEffects  = clean(r.adverse_reactions?.[0]);
      const description  = clean(r.description?.[0]);
      const contraind    = clean(r.contraindications?.[0]);
      const storage      = clean(r.storage_and_handling?.[0]);

      return {
        found: true,
        brandName:    brandNames.slice(0,3).join(', ') || drugName,
        genericName:  genericNames.slice(0,3).join(', ') || 'N/A',
        manufacturer,
        substance:    substance.slice(0,3).join(', ') || 'N/A',
        route:        route.join(', ') || 'N/A',
        description:  short(description),
        indications:  short(indications),
        dosage:       short(dosage),
        warnings:     short(warnings),
        sideEffects:  short(sideEffects),
        contraind:    short(contraind),
        storage:      short(storage),
      };
    } catch { continue; }
  }
  return { found: false };
}

// ══════════════════════════════════════════════════════════════════
//  RxNorm — NIH Drug Database
// ══════════════════════════════════════════════════════════════════
async function fetchRxNorm(drugName) {
  try {
    const res  = await fetch(API.rxNorm(drugName));
    const data = await res.json();
    const groups = data?.drugGroup?.conceptGroup;
    if (!groups) return null;

    const results = [];
    for (const g of groups) {
      if (!g.conceptProperties) continue;
      for (const p of g.conceptProperties.slice(0, 3)) {
        results.push({ name: p.name, rxcui: p.rxcui, tty: g.tty });
      }
    }
    return results.length ? results : null;
  } catch { return null; }
}

// ══════════════════════════════════════════════════════════════════
//  Wikipedia — Medical Fallback
// ══════════════════════════════════════════════════════════════════
async function fetchWikipedia(query) {
  try {
    const sRes  = await fetch(API.wikiSearch(query));
    const sData = await sRes.json();
    const hits  = sData?.query?.search;
    if (!hits?.length) return null;

    const title  = hits[0].title;
    const sumRes = await fetch(API.wikiSum(title));
    const sum    = await sumRes.json();
    if (!sum.extract || sum.type === 'disambiguation') return null;

    const sentences = sum.extract.split('. ').slice(0, 4).join('. ') + '.';
    return { title, summary: sentences, url: sum.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}` };
  } catch { return null; }
}

// ══════════════════════════════════════════════════════════════════
//  Gemini API Integration
// ══════════════════════════════════════════════════════════════════
let geminiKey = localStorage.getItem('geminiApiKey') || '';

function openSettings() {
  const m = document.getElementById('settings-modal');
  if(m) { 
    m.classList.remove('hidden'); 
    document.getElementById('geminiApiKey').value = geminiKey; 
  }
}

function closeSettings() {
  const m = document.getElementById('settings-modal');
  if(m) m.classList.add('hidden');
}

function saveSettings() {
  const val = document.getElementById('geminiApiKey').value.trim();
  geminiKey = val;
  localStorage.setItem('geminiApiKey', val);
  closeSettings();
  showToast('✅ Gemini AI Enabled!', 'success');
}

async function fetchGemini(promptText) {
  if (!geminiKey) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
  const payload = {
    contents: [{
      role: "user",
      parts: [{
        text: "You are MediBot, a highly knowledgeable AI medical assistant for SmartCare Clinic. Provide concise, accurate, and easy-to-understand medical information. Use emojis. Do not use markdown headers (like # or ##) just use bolding for emphasis. Always include a disclaimer that you are an AI and they should consult a doctor. User query: " + promptText
      }]
    }]
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.candidates && data.candidates[0].content.parts[0].text) {
      return data.candidates[0].content.parts[0].text;
    }
    return null;
  } catch (err) {
    console.error('Gemini Error:', err);
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════
//  FORMAT RESPONSES
// ══════════════════════════════════════════════════════════════════
function formatFDAResponse(info, query) {
  let msg = `💊 **${info.brandName}**\n`;
  if (info.genericName !== 'N/A') msg += `Generic: _${info.genericName}_\n`;
  if (info.route !== 'N/A') msg += `Form/Route: ${info.route}\n`;
  msg += '\n';

  if (info.description) msg += `📋 **Description**\n${info.description}\n\n`;
  if (info.indications) msg += `✅ **What it treats**\n${info.indications}\n\n`;
  if (info.dosage)      msg += `💉 **Dosage**\n${info.dosage}\n\n`;
  if (info.sideEffects) msg += `⚠️ **Side Effects**\n${info.sideEffects}\n\n`;
  if (info.warnings)    msg += `🚨 **Warnings**\n${info.warnings}\n\n`;
  if (info.contraind)   msg += `🚫 **Do NOT use if**\n${info.contraind}\n\n`;
  if (info.storage)     msg += `📦 **Storage**\n${info.storage}\n\n`;

  msg += `_Source: FDA Drug Database_\n⚕️ Always consult a qualified doctor before taking any medication.`;
  return msg;
}

function formatRxNormResponse(drugs) {
  let msg = `🔬 **RxNorm Drug Matches**\n\n`;
  drugs.forEach(d => { msg += `• **${d.name}** (RxCUI: ${d.rxcui}) — Type: ${d.tty}\n`; });
  msg += `\n_Source: NIH RxNorm Database_`;
  return msg;
}

// ══════════════════════════════════════════════════════════════════
//  QUICK (CLINIC) REPLIES
// ══════════════════════════════════════════════════════════════════
function getClinicReply(text) {
  const l = text.toLowerCase();
  if (/\b(hi|hello|hey)\b/.test(l))
    return "👋 Hello! I'm **MediBot**, your AI health assistant.\n\nI can help you with:\n• 💊 Medicines, tablets, syrups & dosages\n• 🦠 Diseases & symptoms\n• 📅 Clinic appointments & timings\n\nJust ask me anything!";
  if (l.includes('appointment')||l.includes('book'))
    return "📅 Use the **Book Appointment** form on this page. Fill in your name, date, and preferred doctor!";
  if (l.includes('timing')||l.includes('hours')||l.includes('open'))
    return "🕘 **Clinic Hours:** Mon–Sat, 9 AM – 8 PM\n🚨 Emergency services available **24/7**";
  if (l.includes('contact')||l.includes('phone'))
    return "📞 **+91 98765 43210**\n✉️ **care@smartcare.in**\n📍 123 Health Street, Mumbai";
  if (l.includes('emergency'))
    return "🚨 Call **+91 98765 43210** immediately. Emergency services run 24/7.";
  if (l.includes('doctor')||l.includes('specialist'))
    return "Our doctors:\n👨‍⚕️ Dr. Arjun Mehta — Cardiology\n👩‍⚕️ Dr. Priya Sharma — Pediatrics\n👨‍⚕️ Dr. Rahul Verma — Neurology\n👩‍⚕️ Dr. Sunita Rao — Dentistry";
  if (l.includes('thank'))
    return "You're welcome! 😊 Stay healthy. Is there anything else I can help with?";
  return null;
}

// ══════════════════════════════════════════════════════════════════
//  CHAT UI
// ══════════════════════════════════════════════════════════════════
function addMsg(text, role) {
  const msgs = document.getElementById('chat-messages');
  const div  = document.createElement('div');
  div.className = `msg ${role}`;
  if (role === 'bot') {
    div.innerHTML = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/_(.*?)_/g, '<em>$1</em>')
      .replace(/\n/g, '<br>');
  } else {
    div.textContent = text;
  }
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}

function showTyping(txt = '🔍 Searching medical databases...') {
  return addMsg(txt, 'bot typing');
}

// ══════════════════════════════════════════════════════════════════
//  MAIN SEND HANDLER
// ══════════════════════════════════════════════════════════════════
async function sendMessage() {
  const input = document.getElementById('userInput');
  const text  = (input?.value || '').trim();
  if (!text) return;

  addMsg(text, 'user');
  input.value = '';

  if (db) dbAdd('chatLogs', { sender: 'user', text, timestamp: new Date().toISOString() }).catch(() => {});

  const intent = classifyIntent(text);

  // ── Clinic / Greeting queries (instant) ─────────────────────────
  if (intent === 'GREETING' || intent === 'CLINIC') {
    const reply = getClinicReply(text);
    if (reply) {
      await new Promise(r => setTimeout(r, 350));
      addMsg(reply, 'bot');
      return;
    }
  }

  // ── Medicine / Drug queries ──────────────────────────────────────
  if (intent === 'MEDICINE_INFO' || intent === 'SIDE_EFFECTS') {
    const drugName = extractDrugName(text);
    const typing   = showTyping(`💊 Searching medical databases for "${drugName}"...`);

    // Check Local Database First (Instant, rich data)
    if (typeof LOCAL_DRUG_DB !== 'undefined') {
      const lowerDrug = drugName.toLowerCase();
      const matchedKey = Object.keys(LOCAL_DRUG_DB).find(k => lowerDrug.includes(k) || k.includes(lowerDrug));
      
      if (matchedKey) {
        typing.remove();
        const d = LOCAL_DRUG_DB[matchedKey];
        let msg = `💊 **${d.name}**\n`;
        msg += `Class: _${d.class}_\n\n`;
        msg += `📋 **What it is:**\n${d.what}\n\n`;
        msg += `⚙️ **How it works:**\n${d.how}\n\n`;
        msg += `✅ **Uses:**\n${d.uses}\n\n`;
        msg += `⚠️ **Side Effects:**\n${d.side_effects}\n\n`;
        msg += `_Source: SmartCare Medical Database_\n⚕️ Always consult a qualified doctor before taking any medication.`;
        addMsg(msg, 'bot');
        return;
      }
    }

    // Try FDA first (most detailed)
    const fdaInfo = await fetchFDA(drugName);
    if (fdaInfo.found) {
      typing.remove();
      addMsg(formatFDAResponse(fdaInfo, drugName), 'bot');
      return;
    }

    // Try RxNorm
    const rxData = await fetchRxNorm(drugName);
    if (rxData) {
      typing.remove();
      addMsg(formatRxNormResponse(rxData), 'bot');
      // Also fetch Wikipedia for more detail
      const wiki = await fetchWikipedia(drugName + ' drug');
      if (wiki) addMsg(`📖 **More info: ${wiki.title}**\n\n${wiki.summary}\n\n🔗 <a href="${wiki.url}" target="_blank">Read full article</a>`, 'bot');
      return;
    }

    // Fallback to Gemini first, then Wikipedia
    if (geminiKey) {
      const geminiReply = await fetchGemini(`Provide medical information on the drug "${drugName}". Include what it is, uses, and side effects.`);
      if (geminiReply) {
        typing.remove();
        addMsg(geminiReply, 'bot');
        return;
      }
    }

    const wiki = await fetchWikipedia(drugName + ' drug medicine pharmacology');
    typing.remove();
    if (wiki) {
      addMsg(`📖 **${wiki.title}**\n\n${wiki.summary}\n\n🔗 <a href="${wiki.url}" target="_blank">Read full article</a>\n\n⚕️ Always consult a doctor before taking any medication.`, 'bot');
    } else {
      addMsg(`I couldn't find specific information about **"${drugName}"** in our databases.\n\nTry the full medicine name (e.g., "paracetamol", "ibuprofen", "amoxicillin") or ask our pharmacist.`, 'bot');
    }
    return;
  }

  // ── Symptoms / Disease queries ───────────────────────────────────
  if (intent === 'SYMPTOMS' || intent === 'DISEASE_INFO') {
    const typing = showTyping('🔍 Searching medical knowledge base...');
    // Try Gemini first
    if (geminiKey) {
      const geminiReply = await fetchGemini(`The user is asking about a symptom or disease: "${text}". Provide a professional, concise medical summary. Remind them to consult a doctor for diagnosis.`);
      if (geminiReply) {
        typing.remove();
        addMsg(geminiReply, 'bot');
        return;
      }
    }

    const wiki   = await fetchWikipedia(text);
    typing.remove();
    if (wiki) {
      addMsg(`🩺 **${wiki.title}**\n\n${wiki.summary}\n\n🔗 <a href="${wiki.url}" target="_blank">Read full article</a>\n\n⚠️ This is general information. Please consult a doctor for personal medical advice.`, 'bot');
    } else {
      addMsg("Please describe your symptoms more specifically, or consult one of our doctors for a proper diagnosis.", 'bot');
    }
    return;
  }

  // ── General / Unknown ────────────────────────────────────────────
  // Try clinic reply, then Wikipedia
  const clinicReply = getClinicReply(text);
  if (clinicReply) {
    await new Promise(r => setTimeout(r, 350));
    addMsg(clinicReply, 'bot');
    return;
  }

  const typing = showTyping('🔍 Searching...');

  // Try Gemini first for general conversation
  if (geminiKey) {
    const geminiReply = await fetchGemini(`The user said: "${text}". Respond as a helpful medical clinic AI assistant.`);
    if (geminiReply) {
      typing.remove();
      addMsg(geminiReply, 'bot');
      return;
    }
  }

  const wiki   = await fetchWikipedia(text);
  typing.remove();
  if (wiki) {
    addMsg(`📖 **${wiki.title}**\n\n${wiki.summary}\n\n🔗 <a href="${wiki.url}" target="_blank">Read more on Wikipedia</a>`, 'bot');
  } else {
    addMsg("I can help with:\n• 💊 Medicine / tablet / syrup information\n• 🦠 Disease & symptom information\n• 📅 Clinic appointments & timings\n\nTry asking: _\"What is paracetamol used for?\"_ or _\"symptoms of diabetes\"_", 'bot');
  }
}

// ── Toggle chatbot panel ─────────────────────────────────────────
function toggleChat() {
  const bot = document.getElementById('chatbot');
  const fab = document.getElementById('chat-fab');
  if (!bot) return;
  const isHidden = bot.classList.toggle('hidden');
  if (fab) fab.style.display = isHidden ? 'flex' : 'none';
}

// ── Init ─────────────────────────────────────────────────────────
initDB().then(() => {
  setTimeout(() => {
    addMsg(
      "👋 Hello! I'm **MediBot AI** — powered by FDA & NIH drug databases.\n\n" +
      "I can tell you about:\n" +
      "• 💊 Any medicine, tablet, or syrup (dosage, uses, side effects)\n" +
      "• 🦠 Diseases, symptoms & conditions\n" +
      "• 📅 Clinic appointments, doctors & timings\n\n" +
      "Try asking: _\"What is ibuprofen?\"_ or _\"side effects of amoxicillin\"_",
      'bot'
    );
  }, 900);
});
