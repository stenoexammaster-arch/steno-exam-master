document.addEventListener("DOMContentLoaded", () => {
  const languageSelect = document.getElementById("tt-language");
  const lessonSelect = document.getElementById("tt-lesson");
  const randomBtn = document.getElementById("tt-random");
  const startBtn = document.getElementById("tt-start");
  const timeSelect = document.getElementById("tt-time");
  const customWrap = document.getElementById("custom-time-wrap");

  // Example lesson source connection (replace with real source if already exists)
  const lessons = {
    english: ["Lesson 1", "Lesson 2", "Lesson 3"],
    hindi: ["पाठ 1", "पाठ 2", "पाठ 3"]
  };

  function loadLessons() {
    const lang = languageSelect.value;
    lessonSelect.innerHTML = "";
    lessons[lang].forEach((lesson) => {
      const opt = document.createElement("option");
      opt.value = lesson;
      opt.textContent = lesson;
      lessonSelect.appendChild(opt);
    });
  }

  languageSelect.addEventListener("change", loadLessons);

  randomBtn.addEventListener("click", () => {
    const lang = languageSelect.value;
    const list = lessons[lang];
    const randomIndex = Math.floor(Math.random() * list.length);
    lessonSelect.value = list[randomIndex];
  });

  timeSelect.addEventListener("change", () => {
    if (timeSelect.value === "custom") {
      customWrap.classList.remove("hidden");
    } else {
      customWrap.classList.add("hidden");
    }
  });

  startBtn.addEventListener("click", () => {
    window.location.href = "typing-test.html";
  });

  loadLessons();
});
