// history.js – handles switching between "Current Games" and "Game History" tabs

document.addEventListener("DOMContentLoaded", () => {
  const tabs = document.querySelectorAll(".section-tabs .tab");
  const sectionCurrent = document.getElementById("section-current");
  const sectionHistory = document.getElementById("section-history");

  const sections = {
    current: sectionCurrent,
    history: sectionHistory,
  };

  function showSection(name) {
    // hide all sections
    Object.values(sections).forEach((sec) => {
      if (!sec) return;
      sec.classList.remove("active-section");
    });

    // show selected section
    if (sections[name]) {
      sections[name].classList.add("active-section");
    }

    // update tab active state
    tabs.forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.target === name);
    });
  }

  // attach click handlers to tabs
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.target; // "current" or "history"
      showSection(target);
    });
  });

  // default: show Current Games when page loads
  showSection("current");
});
