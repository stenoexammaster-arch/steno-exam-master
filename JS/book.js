// js/book.js
// Book + chapter typing using TestEngine with trial & preview rules

const TRIAL_DAYS = 6;

let currentBook = null;
let chapterEngine = null;
let currentLanguageForChapter = "english";
let accessState = {
  subscribed: false,
  trialExpired: false,
  daysLeft: 0
};

window.addEventListener("DOMContentLoaded", () => {
  const loginWarningEl = document.getElementById("login-warning");
  const booksAreaEl = document.getElementById("books-area");
  const booksListEl = document.getElementById("books-list");
  const trialBannerEl = document.getElementById("trial-banner");
  const paywallEl = document.getElementById("paywall");

  firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) {
      loginWarningEl.classList.remove("hidden");
      booksAreaEl.classList.add("hidden");
      trialBannerEl.classList.add("hidden");
      paywallEl.classList.add("hidden");
      return;
    }

    loginWarningEl.classList.add("hidden");
    booksAreaEl.classList.remove("hidden");

    // Load / ensure user trial data
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

    accessState = evaluateTrial(data);
    updateTrialUI(accessState, trialBannerEl, paywallEl);

    loadBooksList(booksListEl);
  });
});

// ---------- TRIAL LOGIC ----------

function evaluateTrial(userData) {
  const subscribed = !!userData.subscribed;
  if (subscribed) {
    return { subscribed: true, trialExpired: false, daysLeft: 0 };
  }

  let startDate;
  if (userData.trialStart && userData.trialStart.toDate) {
    startDate = userData.trialStart.toDate();
  } else {
    startDate = new Date();
  }

  const now = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
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

// ---------- LOAD BOOKS ----------

async function loadBooksList(containerEl) {
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

    containerEl.innerHTML = "";
    snapshot.forEach((doc) => {
      const book = doc.data();
      const isPaid = !!book.isPaid;

      let accessLabel;
      if (!isPaid) {
        accessLabel = "Free";
      } else if (accessState.subscribed || !accessState.trialExpired) {
        accessLabel = "Paid (full access)";
      } else {
        accessLabel = "Paid (2-minute preview)";
      }

      const div = document.createElement("div");
      div.className = "book-card";
      div.innerHTML = `
        <h3>${book.title || "Untitled book"}</h3>
        <p>${book.description || ""}</p>
        <p class="label">
          Language: ${formatLanguage(book.language)} • ${accessLabel}
        </p>
        <button class="btn small" data-book-id="${doc.id}">Open book</button>
      `;
      containerEl.appendChild(div);
    });

    containerEl.onclick = async (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const bookId = btn.getAttribute("data-book-id");
      if (!bookId) return;

      const doc = await window.db.collection("books").doc(bookId).get();
      const book = doc.data();
      openBook(bookId, book);
    };
  } catch (err) {
    console.error("Error loading books:", err);
    containerEl.innerHTML = "<p>Error loading books: " + err.message + "</p>";
  }
}

function openBook(bookId, book) {
  currentBook = { id: bookId, ...book };
  currentLanguageForChapter = book.language || "english";

  const chaptersAreaEl = document.getElementById("chapters-area");
  const chaptersTitleEl = document.getElementById("chapters-title");
  const chaptersSubtitleEl = document.getElementById("chapters-subtitle");

  chaptersTitleEl.textContent = "Chapters for: " + (book.title || "Untitled book");
  chaptersSubtitleEl.textContent = `Language: ${formatLanguage(book.language)}`;

  chaptersAreaEl.classList.remove("hidden");

  // Reset chapter typing section
  const typingSectionEl = document.getElementById("chapter-typing-section");
  typingSectionEl.classList.add("hidden");
  const inputEl = document.getElementById("chapter-typing-input");
  inputEl.value = "";
  resetChapterStats();

  loadChaptersList(bookId, currentLanguageForChapter);
}

// ---------- LOAD CHAPTERS ----------

async function loadChaptersList(bookId, language) {
  const listEl = document.getElementById("chapters-list");
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
  metaEl.textContent = `Book: ${currentBook.title || "Untitled book"}${labelPart} • ${formatLanguage(
    language
  )}`;

  // Set font
  textEl.classList.remove("font-english", "font-hindi-mangal", "font-hindi-kruti");
  inputEl.classList.remove("font-english", "font-hindi-mangal", "font-hindi-kruti");

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

  // Cancel previous engine
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

  // Preview logic: if book is paid AND trial expired AND not subscribed -> 2-minute limit
  const isPaid = !!currentBook.isPaid;
  const previewMode =
    isPaid && accessState.trialExpired && !accessState.subscribed;
  const timeLimitSeconds = previewMode ? 120 : 0;

  chapterEngine = TestEngine.create({
    originalText,
    inputEl,
    displayTextEl: textEl,
    timeLimitSeconds,
    allowBackspace: true, // later add UI if needed
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
  const errorsWordsEl = document.getElementById("chapter-result-errors-words");
  const errorsCharsEl = document.getElementById("chapter-result-errors-chars");
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