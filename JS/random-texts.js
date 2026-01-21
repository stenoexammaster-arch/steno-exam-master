// js/random-texts.js
// ---------------------------------------------
// Yahan se practice / typing-test pages random
// English / Hindi passages lenge.
//
// Design:
//  - Pehle kuch static fallback passages
//  - Agar window.db (Firestore) available hai, to
//    'randomTexts' collection se texts load karke
//    FT_RANDOM_TEXTS ko override/merge kar deta hai.
//
// Firestore collection: randomTexts
// Fields (admin se):
//  - title: string
//  - code: string (optional, unique id-like)
//  - language: "english" | "hindi-mangal" | "hindi-kruti"
//  - text: string
//  - isFree: boolean
// ---------------------------------------------

// Static fallback (optional)
window.FT_RANDOM_TEXTS = {
  english: [
    {
      id: "en-camels",
      title: "Camels in cold places",
      text: `When you think of where camels came from, you probably think of the desert in the Middle East. However, at some point in the past, camels actually lived in much colder places.`,
    },
    {
      id: "en-typing-basics",
      title: "Typing is more than speed",
      text: `Typing tests are not just about speed. They also measure how accurately you can copy a passage without looking at the keyboard again and again.`,
    },
  ],

  "hindi-mangal": [
    {
      id: "hi-vigyan",
      title: "Vigyan aur vikas",
      text: `भारत में विज्ञान और प्रौद्योगिकी की शक्ति में सुधार के लिए भारत सरकार ने अनेक योजनाएं चलाई हैं। इन योजनाओं से आम नागरिक के जीवन स्तर में बदलाव दिखने लगा है।`,
    },
  ],

  "hindi-kruti": [
    {
      id: "kruti-demo1",
      title: "Demo Kruti paragraph 1",
      text: `dsoy lcwrksofFkksa dk le; ls le; rd iz;ksx djus ds fy, ;g Ik"B rS;kj fd;k x;k gSA ;g ijh{kk iz;ksx ds fy, gh ugha cfYd o\`{k ijh{kk ds fy, Hkh mi;ksx fd;k tk ldrk gSA`,
    },
  ],
};

// Random passage by language
window.ftGetRandomText = function (langKey) {
  const store = window.FT_RANDOM_TEXTS || {};
  const list = store[langKey] || store.english || [];

  if (!Array.isArray(list) || !list.length) {
    return "No random passage found for this language. Please add texts in admin panel (Random Texts).";
  }

  const idx = Math.floor(Math.random() * list.length);
  const item = list[idx];

  if (typeof item === "string") return item;
  if (item && typeof item.text === "string") return item.text;

  return "Invalid passage format. Please check random-texts.js.";
};

// Named passage (id ya title se)
window.ftGetNamedText = function (langKey, idOrTitle) {
  const store = window.FT_RANDOM_TEXTS || {};
  const list = store[langKey] || store.english || [];

  if (!Array.isArray(list) || !list.length) {
    return "No passages found. Please add texts in admin panel.";
  }

  if (typeof list[0] === "string") {
    return list[0];
  }

  const item =
    list.find((p) => p.id === idOrTitle) ||
    list.find((p) => p.title === idOrTitle);

  if (item && typeof item.text === "string") {
    return item.text;
  }

  return window.ftGetRandomText(langKey);
};

// ----- Firestore se randomTexts load karke merge karega -----
(function () {
  async function loadFromFirestore() {
    if (!window.db) return; // firebase-config.js ne db banaya ho

    try {
      const snap = await window.db
        .collection("randomTexts")
        .where("isFree", "==", true)
        .get();

      if (snap.empty) {
        console.info("No randomTexts in Firestore, using static FT_RANDOM_TEXTS only.");
        return;
      }

      const byLang = {};

      snap.forEach((doc) => {
        const d = doc.data();
        const lang = d.language || "english";
        if (!byLang[lang]) byLang[lang] = [];
        byLang[lang].push({
          id: d.code || doc.id,
          title: d.title || d.code || doc.id,
          text: d.text || "",
        });
      });

      // Merge / override static data
      Object.keys(byLang).forEach((lang) => {
        window.FT_RANDOM_TEXTS[lang] = byLang[lang];
      });

      console.info("Random texts loaded from Firestore:", byLang);
    } catch (e) {
      console.error("Error loading randomTexts from Firestore:", e);
    }
  }

  // Try immediately; if db not ready, wait for window load
  if (window.db) {
    loadFromFirestore();
  } else {
    window.addEventListener("load", () => {
      if (window.db) loadFromFirestore();
    });
  }
})();