// js/book.js
// Books + chapters typing using TestEngine with trial & preview rules
// + Subscription UI + UPI payment request modal (manual verification)

// 🔁 Change this to your real UPI ID
const UPI_ID = "yourupi@bank";

const TRIAL_DAYS = 6;

let currentBook = null;
let chapterEngine = null;
let currentLanguageForChapter = "english";
let currentUser = null;
let currentUserProfile = null;

let accessState = {
  subscribed: false,
  trialExpired: false,
  daysLeft: 0
};

// ✅ Updated prices
const PLAN_CONFIG = {
  monthly: {
    key: "monthly",
    name: "Monthly Plan",
    amount: 69
  },
  "3m": {
    key: "3m",
    name: "3‑Month Plan",
    amount: 149
  },
  yearly: {
    key: "yearly",
    name: "Yearly Plan",
    amount: 399
  }
};

function redirectToLogin(reason) {
  const url = new URL("login.html", window.location.href);
  if (reason) url.searchParams.set("reason", reason);
  window.location.href = url.toString();
}

window.addEventListener("DOMContentLoaded", () => {
  const loginWarningEl = document.getElementById("login-warning");
  const booksAreaEl = document.getElementById("books-area");
  const booksListEl = document.getElementById("books-list");
  const trialBannerEl = document.getElementById("trial-banner");
  const paywallEl = document.getElementById("paywall");

  firebase.auth().onAuthStateChanged(async (user) => {
    // ✅ Guard: book page only for logged-in users
    if (!user) {
      redirectToLogin("not_logged_in");
      return;
    }
    currentUser = user;

    if (loginWarningEl) loginWarningEl.classList.add("hidden");
    if (booksAreaEl) booksAreaEl.classList.remove("hidden");

    // Load / ensure user trial + plan data
    const userRef = window.db.collection("users").doc(user.uid);
    let snap = await userRef.get();
    let data = snap.data() || {};

    // If trialStart missing, set it now
    if (!data.trialStart) {
      await userRef.set(
        {
          trialStart: firebase.firestore.FieldValue.serverTimestamp(),
          subscribed: data.subscribed || false
        },
        { merge: true }
      );
      snap = await userRef.get();
      data = snap.data();
    }

    currentUserProfile = data;

    accessState = evaluateTrialAndPlan(data);
    updateTrialUI(accessState, trialBannerEl, paywallEl);
    updateSubscriptionUI(data, accessState);
    setupPlanButtons();
    await loadLatestPendingRequest(user.uid);

    loadBooksList(booksListEl);
    setupPlanModal();
  });
});

// ---------- TRIAL + PLAN LOGIC ----------

function evaluateTrialAndPlan(userData) {
  const now = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;

  // Plan-based subscription (optional)
  let planActive = false;
  if (
    userData.plan &&
    userData.plan !== "none" &&
    userData.planExpiresAt &&
    userData.planExpiresAt.toDate
  ) {
    const exp = userData.planExpiresAt.toDate();
    planActive = exp > now;
  }

  const subscribed = !!userData.subscribed || planActive;
  if (subscribed) {
    return { subscribed: true, trialExpired: false, daysLeft: 0 };
  }

  // Fallback to trial logic
  let startDate;
  if (userData.trialStart && userData.trialStart.toDate) {
    startDate = userData.trialStart.toDate();
  } else {
    startDate = new Date();
  }

  const diffDays = Math.floor((now - startDate) / msPerDay);

  const trialExpired = diffDays >= TRIAL_DAYS;
  const daysLeft = Math.max(0, TRIAL_DAYS - diffDays);

  return {
    subscribed: false,
    trialExpired,
    daysLeft
  };
}

function updateTrialUI(state, bannerEl, paywallEl) {
  if (!bannerEl || !paywallEl) return;

  if (state.subscribed) {
    bannerEl.classList.remove("hidden");
    bannerEl.textContent =
      "You are on a paid plan. Enjoy unlimited access to all books and chapters.";
    paywallEl.classList.add("hidden");
    return;
  }

  if (!state.trialExpired) {
    bannerEl.classList.remove("hidden");
    bannerEl.textContent = `Free trial active. Days left: ${state.daysLeft}`;
    paywallEl.classList.add("hidden");
  } else {
    bannerEl.classList.add("hidden");
    paywallEl.classList.remove("hidden");
  }
}

// ---------- SUBSCRIPTION UI (status + buttons) ----------

function prettyPlanName(plan) {
  if (plan === "monthly") return "Monthly";
  if (plan === "3m") return "3‑Month";
  if (plan === "yearly") return "Yearly";
  return "Free";
}

function updateSubscriptionUI(userData, accessState) {
  const statusEl = document.getElementById("user-plan-status");
  if (!statusEl) return;

  const now = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;

  const plan = userData.plan || "none";
  const planExpiresAt =
    userData.planExpiresAt && userData.planExpiresAt.toDate
      ? userData.planExpiresAt.toDate()
      : null;

  if (plan !== "none" && planExpiresAt && planExpiresAt > now) {
    const daysLeft = Math.max(
      0,
      Math.ceil((planExpiresAt - now) / msPerDay)
    );
    statusEl.textContent =
      `Your current plan: ${prettyPlanName(plan)} (expires in ${daysLeft} day(s)).`;
  } else if (!accessState.trialExpired) {
    statusEl.textContent =
      `You are on free trial. Days left: ${accessState.daysLeft}. ` +
      `Paid books run in full mode during trial.`;
  } else if (accessState.subscribed) {
    statusEl.textContent =
      "You have an active subscription. Enjoy full access to paid books.";
  } else {
    statusEl.textContent =
      "You are on the free plan. Paid books will run in 2‑minute preview mode until you subscribe.";
  }
}

// Subscribe buttons -> open modal
function setupPlanButtons() {
  const buttons = document.querySelectorAll(".plan-btn[data-plan]");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const planKey = btn.getAttribute("data-plan") || "monthly";
      openPlanModal(planKey);
    });
  });
}

// ---------- UPI PAYMENT REQUEST MODAL LOGIC ----------

let planModalInitialized = false;
let activePlanKey = null;

function setupPlanModal() {
  if (planModalInitialized) return;

  const modal = document.getElementById("plan-modal");
  if (!modal) return;

  const cancelBtn = document.getElementById("plan-modal-cancel");
  const submitBtn = document.getElementById("plan-modal-submit");

  cancelBtn?.addEventListener("click", () => {
    modal.classList.add("hidden");
  });

  submitBtn?.addEventListener("click", submitPaymentRequest);

  planModalInitialized = true;
}

function openPlanModal(planKey) {
  const config = PLAN_CONFIG[planKey] || PLAN_CONFIG["monthly"];
  activePlanKey = config.key;

  const modal = document.getElementById("plan-modal");
  if (!modal) return;

  const titleEl = document.getElementById("plan-modal-title");
  const amountEl = document.getElementById("plan-modal-amount");
  const upiIdEl = document.getElementById("upi-id-text");
  const nameEl = document.getElementById("pr-name");
  const emailEl = document.getElementById("pr-email");
  const phoneEl = document.getElementById("pr-phone");
  const noteEl = document.getElementById("pr-note");
  const txnEl = document.getElementById("pr-txn-id");
  const statusEl = document.getElementById("plan-modal-status");
  const submitBtn = document.getElementById("plan-modal-submit");
  const upiQrEl = document.querySelector(".upi-qr");

  if (titleEl) titleEl.textContent = "Subscribe to " + config.name;
  if (amountEl)
    amountEl.textContent = `Amount: ₹${config.amount} for ${config.name}`;
  if (upiIdEl) upiIdEl.textContent = UPI_ID;

  // ✅ Optional: fixed-amount QR images per plan (better safety)
  //  aap in teen images ko khud generate karke assets/payments me rakho:
  //  - assets/payments/upi-qr-69.png   (Monthly – ₹69, fixed amount QR)
  //  - assets/payments/upi-qr-149.png  (3‑Month – ₹149)
  //  - assets/payments/upi-qr-399.png  (Yearly – ₹399)
  const qrSrcMap = {
    monthly: "assets/payments/upi-qr-69.png",
    "3m": "assets/payments/upi-qr-149.png",
    yearly: "assets/payments/upi-qr-399.png"
  };
  const fallbackQr = "assets/payments/upi-qr.png"; // old generic QR (if you still use it)
  const qrSrc = qrSrcMap[config.key] || fallbackQr;
  if (upiQrEl) upiQrEl.src = qrSrc;

  // Prefill from Firestore profile / auth
  if (currentUserProfile && nameEl) {
    nameEl.value = currentUserProfile.name || "";
  }
  if (currentUser && emailEl) {
    emailEl.value = currentUser.email || currentUserProfile?.email || "";
  }
  if (currentUserProfile && phoneEl) {
    phoneEl.value = currentUserProfile.phone || "";
  }
  if (noteEl) noteEl.value = "";
  if (txnEl) txnEl.value = "";
  if (statusEl) {
    statusEl.textContent = "";
    statusEl.style.color = "#fca5a5";
  }
  if (submitBtn) {
    submitBtn.removeAttribute("disabled");
    submitBtn.classList.remove("is-loading");
  }

  modal.classList.remove("hidden");
}

async function submitPaymentRequest() {
  const modal = document.getElementById("plan-modal");
  const statusEl = document.getElementById("plan-modal-status");
  const nameEl = document.getElementById("pr-name");
  const emailEl = document.getElementById("pr-email");
  const phoneEl = document.getElementById("pr-phone");
  const noteEl = document.getElementById("pr-note");
  const txnEl = document.getElementById("pr-txn-id");
  const submitBtn = document.getElementById("plan-modal-submit");

  if (!statusEl) return;

  if (!currentUser) {
    statusEl.textContent = "You are not logged in. Please log in again.";
    statusEl.style.color = "#fca5a5";
    return;
  }

  if (!window.db) {
    statusEl.textContent = "Database not ready. Please refresh the page.";
    statusEl.style.color = "#fca5a5";
    return;
  }

  const config = PLAN_CONFIG[activePlanKey || "monthly"];
  const name = nameEl?.value.trim() || "";
  const email = emailEl?.value.trim() || "";
  const phone = phoneEl?.value.trim() || "";
  const note = noteEl?.value.trim() || "";
  const txnId = txnEl?.value.trim() || "";

  statusEl.textContent = "";
  statusEl.style.color = "#fca5a5";

  if (!name) {
    statusEl.textContent = "Please enter your full name.";
    nameEl?.focus();
    return;
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    statusEl.textContent = "Please enter a valid email address.";
    emailEl?.focus();
    return;
  }

  if (phone && !/^\+?\d{10,15}$/.test(phone)) {
    statusEl.textContent = "Please enter a valid mobile number.";
    phoneEl?.focus();
    return;
  }

  if (!txnId) {
    statusEl.textContent = "Please enter your UPI transaction ID / UTR.";
    txnEl?.focus();
    return;
  }

  if (txnId.length < 6) {
    statusEl.textContent = "Transaction ID looks too short. Please check again.";
    txnEl?.focus();
    return;
  }

  if (!/^[0-9A-Za-z@._\- ]+$/.test(txnId)) {
    statusEl.textContent = "Transaction ID has invalid characters.";
    txnEl?.focus();
    return;
  }

  const payload = {
    userId: currentUser.uid,
    plan: config.key,
    amount: config.amount,
    upiId: UPI_ID,
    transactionId: txnId,
    status: "pending",
    name: name || null,
    email: email || null,
    phone: phone || null,
    note: note || null,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  try {
    if (submitBtn) {
      submitBtn.setAttribute("disabled", "disabled");
      submitBtn.classList.add("is-loading");
    }
    statusEl.style.color = "#e5e7eb";
    statusEl.textContent = "Submitting your request…";

    await window.db.collection("paymentRequests").add(payload);
    statusEl.style.color = "#bbf7d0";
    statusEl.textContent =
      "Request submitted. Admin will verify your payment and upgrade your plan if confirmed.";

    // Update pending status line immediately
    const pendingEl = document.getElementById("pending-request-status");
    if (pendingEl) {
      pendingEl.textContent =
        "Pending verification for " +
        config.name +
        " (submitted just now).";
    }

    setTimeout(() => {
      if (modal) modal.classList.add("hidden");
      statusEl.textContent = "";
    }, 1500);
  } catch (err) {
    console.error("Payment request error:", err);
    statusEl.style.color = "#fca5a5";
    statusEl.textContent =
      err.message || "Could not submit payment request. Please try again.";
  } finally {
    if (submitBtn) {
      submitBtn.removeAttribute("disabled");
      submitBtn.classList.remove("is-loading");
    }
  }
}

// ---------- Load latest pending request ----------

async function loadLatestPendingRequest(userId) {
  const pendingEl = document.getElementById("pending-request-status");
  if (!pendingEl || !window.db) return;

  try {
    const ref = window.db
      .collection("paymentRequests")
      .where("userId", "==", userId)
      .orderBy("createdAt", "desc")
      .limit(1);

    const snap = await ref.get();
    if (snap.empty) {
      pendingEl.textContent = "";
      return;
    }

    const doc = snap.docs[0];
    const d = doc.data() || {};
    if (d.status === "pending") {
      const planName = prettyPlanName(d.plan || "free");
      const when = formatTimestampForDisplay(d.createdAt);
      pendingEl.textContent =
        "Pending verification for " +
        planName +
        " (submitted on " +
        when +
        ").";
    } else {
      pendingEl.textContent = "";
    }
  } catch (err) {
    console.error("loadLatestPendingRequest error:", err);
    pendingEl.textContent = "";
  }
}

function formatTimestampForDisplay(ts) {
  try {
    let d;
    if (!ts) return "unknown date";
    if (ts.toDate) d = ts.toDate();
    else d = new Date(ts);
    return d.toLocaleDateString();
  } catch {
    return "unknown date";
  }
}

// ---------- BOOK CHAPTER/VOLUME COUNTS ----------

async function getBookChapterStats(bookId) {
  if (!window.db) {
    return { hasChapters: false, chapters: 0, volumes: 0 };
  }
  try {
    const snap = await window.db
      .collection("books")
      .doc(bookId)
      .collection("chapters")
      .get();

    if (snap.empty) {
      return { hasChapters: false, chapters: 0, volumes: 0 };
    }

    let volumesSet = new Set();
    snap.forEach((doc) => {
      const ch = doc.data() || {};
      const volKey =
        ch.volume ?? ch.volumeNo ?? ch.volumeName ?? null;
      if (volKey !== null && volKey !== undefined && volKey !== "") {
        volumesSet.add(String(volKey));
      }
    });

    return {
      hasChapters: true,
      chapters: snap.size,
      volumes: volumesSet.size
    };
  } catch (err) {
    console.error("getBookChapterStats error:", err);
    return { hasChapters: false, chapters: 0, volumes: 0 };
  }
}

// ---------- LOAD BOOKS (no open link, only counts) ----------

async function loadBooksList(containerEl) {
  if (!containerEl) return;
  containerEl.innerHTML = "<p>Loading books...</p>";

  try {
    const snapshot = await window.db
      .collection("books")
      .orderBy("createdAt", "desc")
      .get();

    if (snapshot.empty) {
      containerEl.innerHTML =
        "<p>No books available yet. Ask admin to add some.</p>";
      return;
    }

    const bookDocs = [];
    snapshot.forEach((doc) => bookDocs.push(doc));

    const statsList = await Promise.all(
      bookDocs.map((doc) => getBookChapterStats(doc.id))
    );

    containerEl.innerHTML = "";

    bookDocs.forEach((doc, index) => {
      const book = doc.data();
      const isPaid = !!book.isPaid;
      const stats = statsList[index] || {
        hasChapters: false,
        chapters: 0,
        volumes: 0
      };

      let accessLabel;
      if (!isPaid) {
        accessLabel = "Free book";
      } else if (accessState.subscribed || !accessState.trialExpired) {
        accessLabel = "Paid book (full access)";
      } else {
        accessLabel = "Paid book (2‑minute preview)";
      }

      const langLabel = formatLanguage(book.language);

      const countsParts = [];
      if (stats.volumes > 0) countsParts.push(`Volumes: ${stats.volumes}`);
      if (stats.chapters > 0) countsParts.push(`Chapters: ${stats.chapters}`);
      const countsText = countsParts.length
        ? countsParts.join(" • ")
        : "No volumes/chapters added yet";

      const div = document.createElement("div");
      div.className = "book-card";
      div.innerHTML = `
        <div class="book-card-header">
          <h3>${book.title || "Untitled book"}</h3>
          ${
            isPaid
              ? '<span class="book-pill book-pill-paid">Paid</span>'
              : '<span class="book-pill book-pill-free">Free</span>'
          }
        </div>
        <p class="book-description">
          ${
            book.description ||
            "Practice content from this book for better exam preparation."
          }
        </p>
        <div class="book-meta">
          <span><strong>Language:</strong> ${langLabel}</span>
          <span>${accessLabel}</span>
        </div>
        <div class="book-card-footer">
          <span class="book-counts">${countsText}</span>
        </div>
      `;
      containerEl.appendChild(div);
    });
  } catch (err) {
    console.error("Error loading books:", err);
    containerEl.innerHTML = "<p>Error loading books: " + err.message + "</p>";
  }
}

// ---------- OPEN BOOK / CHAPTERS (inline typing) ----------

function openBook(bookId, book) {
  currentBook = { id: bookId, ...book };
  currentLanguageForChapter = book.language || "english";

  const chaptersAreaEl = document.getElementById("chapters-area");
  const chaptersTitleEl = document.getElementById("chapters-title");
  const chaptersSubtitleEl = document.getElementById("chapters-subtitle");

  if (chaptersTitleEl)
    chaptersTitleEl.textContent =
      "Chapters for: " + (book.title || "Untitled book");
  if (chaptersSubtitleEl)
    chaptersSubtitleEl.textContent = `Language: ${formatLanguage(
      book.language
    )}`;

  chaptersAreaEl.classList.remove("hidden");

  const typingSectionEl = document.getElementById("chapter-typing-section");
  typingSectionEl.classList.add("hidden");
  const inputEl = document.getElementById("chapter-typing-input");
  inputEl.value = "";
  resetChapterStats();

  loadChaptersList(bookId, currentLanguageForChapter);
}

async function loadChaptersList(bookId, language) {
  const listEl = document.getElementById("chapters-list");
  if (!listEl) return;

  listEl.innerHTML = "<p>Loading chapters...</p>";

  try {
    const snapshot = await window.db
      .collection("books")
      .doc(bookId)
      .collection("chapters")
      .orderBy("order", "asc")
      .get();

    if (snapshot.empty) {
      listEl.innerHTML = "<p>No chapters added yet for this book.</p>";
      return;
    }

    listEl.innerHTML = "";
    snapshot.forEach((doc) => {
      const ch = doc.data();
      const div = document.createElement("div");
      div.className = "book-card";
      div.innerHTML = `
        <h3>${ch.name || "Untitled chapter"}</h3>
        <p>${ch.label ? ch.label : ""}</p>
        <p class="label">Order: ${ch.order || 0}</p>
        <button class="btn small" data-chapter-id="${doc.id}">Start typing</button>
      `;
      listEl.appendChild(div);
    });

    listEl.onclick = async (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const chapterId = btn.getAttribute("data-chapter-id");
      if (!chapterId) return;

      const doc = await window.db
        .collection("books")
        .doc(bookId)
        .collection("chapters")
        .doc(chapterId)
        .get();
      const chapter = doc.data();
      openChapterForTyping(bookId, chapterId, chapter, language);
    };
  } catch (err) {
    console.error("Error loading chapters:", err);
    listEl.innerHTML = "<p>Error loading chapters: " + err.message + "</p>";
  }
}

// ---------- TYPING FOR CHAPTER WITH PREVIEW ----------

function openChapterForTyping(bookId, chapterId, chapter, language) {
  const sectionEl = document.getElementById("chapter-typing-section");
  const titleEl = document.getElementById("chapter-title");
  const metaEl = document.getElementById("chapter-meta");
  const textEl = document.getElementById("chapter-typing-text");
  const inputEl = document.getElementById("chapter-typing-input");

  const originalText = chapter.content || "";

  titleEl.textContent = chapter.name || "Untitled chapter";
  const labelPart = chapter.label ? ` • ${chapter.label}` : "";
  metaEl.textContent = `Book: ${
    currentBook.title || "Untitled book"
  }${labelPart} • ${formatLanguage(language)}`;

  textEl.classList.remove(
    "font-english",
    "font-hindi-mangal",
    "font-hindi-kruti"
  );
  inputEl.classList.remove(
    "font-english",
    "font-hindi-mangal",
    "font-hindi-kruti"
  );

  if (language === "hindi-mangal") {
    textEl.classList.add("font-hindi-mangal");
    inputEl.classList.add("font-hindi-mangal");
  } else if (language === "hindi-kruti") {
    textEl.classList.add("font-hindi-kruti");
    inputEl.classList.add("font-hindi-kruti");
  } else {
    textEl.classList.add("font-english");
    inputEl.classList.add("font-english");
  }

  if (chapterEngine) {
    chapterEngine.cancel();
  }

  const timeEl = document.getElementById("chapter-time");
  const wpmEl = document.getElementById("chapter-wpm");
  const accuracyEl = document.getElementById("chapter-accuracy");
  const errorsEl = document.getElementById("chapter-errors");

  timeEl.textContent = "0s";
  wpmEl.textContent = "0";
  accuracyEl.textContent = "100%";
  errorsEl.textContent = "0";

  const isPaid = !!currentBook.isPaid;
  const previewMode =
    isPaid && accessState.trialExpired && !accessState.subscribed;
  const timeLimitSeconds = previewMode ? 120 : 0;

  chapterEngine = TestEngine.create({
    originalText,
    inputEl,
    displayTextEl: textEl,
    timeLimitSeconds,
    allowBackspace: true,
    statsEls: {
      timeEl,
      wpmEl,
      accuracyEl,
      errorsCharEl: errorsEl,
      wordsCountEl: null
    },
    onFinish: (result) => {
      let reason = result.reason || "";
      if (previewMode && result.reason === "Time is over.") {
        reason =
          "Your 2-minute preview for this paid chapter is over. Subscribe after trial to unlock full access.";
      }
      showChapterResultModal({ ...result, reason }, chapter, previewMode);
    }
  });

  chapterEngine.start();
  sectionEl.classList.remove("hidden");
}

function resetChapterStats() {
  document.getElementById("chapter-time").textContent = "0s";
  document.getElementById("chapter-wpm").textContent = "0";
  document.getElementById("chapter-accuracy").textContent = "100%";
  document.getElementById("chapter-errors").textContent = "0";
}

// ---------- RESULT MODAL FOR CHAPTER ----------

function showChapterResultModal(result, chapter, previewMode) {
  const modal = document.getElementById("chapter-result-modal");
  const reasonEl = document.getElementById("chapter-result-reason");
  const timeEl = document.getElementById("chapter-result-time");
  const grossEl = document.getElementById("chapter-result-gross-wpm");
  const netEl = document.getElementById("chapter-result-net-wpm");
  const accEl = document.getElementById("chapter-result-accuracy");
  const wordsTypedEl = document.getElementById("chapter-result-words-typed");
  const wordsTotalEl = document.getElementById("chapter-result-words-total");
  const errorsWordsEl = document.getElementById(
    "chapter-result-errors-words"
  );
  const errorsCharsEl = document.getElementById(
    "chapter-result-errors-chars"
  );
  const closeBtn = document.getElementById("chapter-result-close");

  let reasonText = result.reason || "";
  if (!reasonText && previewMode) {
    reasonText =
      "2-minute preview finished. Subscribe after trial to get full access.";
  }

  reasonEl.textContent = reasonText;
  timeEl.textContent = `${result.formattedTime} (${result.totalSeconds}s)`;
  grossEl.textContent = String(result.grossWpm);
  netEl.textContent = String(result.netWpm);
  accEl.textContent = `${result.accuracy}%`;
  wordsTypedEl.textContent = String(result.typedWordCount);
  wordsTotalEl.textContent = String(result.originalWordCount);
  errorsWordsEl.textContent = String(result.wordErrors);
  errorsCharsEl.textContent = String(result.charErrors);

  modal.classList.remove("hidden");
  closeBtn.onclick = () => {
    modal.classList.add("hidden");
  };
}

// ---------- HELPERS ----------

function formatLanguage(lang) {
  if (lang === "hindi-mangal") return "Hindi (Mangal)";
  if (lang === "hindi-kruti") return "Hindi (Kruti Dev)";
  return "English";
}