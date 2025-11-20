// help.js – tabs + submit complaint + show details

document.addEventListener("DOMContentLoaded", () => {
  // ===== MAIN TABS =====
  const tabs = document.querySelectorAll(".section-tabs .tab");
  const sections = {
    contact: document.getElementById("section-contact"),
    complaints: document.getElementById("section-complaints"),
  };

  function showSection(name) {
    Object.values(sections).forEach(sec => {
      if (!sec) return;
      sec.classList.remove("active-section");
    });
    if (sections[name]) {
      sections[name].classList.add("active-section");
    }

    tabs.forEach(tab => {
      tab.classList.toggle("active", tab.dataset.target === name);
    });
  }

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      showSection(tab.dataset.target);
    });
  });

  showSection("contact");

  // ===== SUBMIT COMPLAINT =====
  const helpForm = document.getElementById("helpForm");
  const helpStatus = document.getElementById("helpStatus");
  const complaintsList = document.getElementById("complaintsList");

  function createComplaintCard(c) {
    const wrapper = document.createElement("article");
    wrapper.className = "complaint-card";
    wrapper.dataset.id = c.id;

    const updatesHtml = (c.updates || [])
      .map(
        u =>
          `<li><span class="update-time">${u.time}</span><span class="update-text">${u.text}</span></li>`
      )
      .join("");

    wrapper.innerHTML = `
      <div class="complaint-main">
        <div class="complaint-id">
          ID: <span class="mono">${c.id}</span>
        </div>
        <div class="complaint-subject">${c.subject}</div>
        <div class="complaint-meta">
          ${c.category} • ${c.created_at}
        </div>
      </div>
      <div class="complaint-side">
        <div class="status-pill status-${(c.status || "Open").toLowerCase()}">
          ${c.status}
        </div>
        <div class="complaint-updated">
          Last update: ${c.last_update}
        </div>
        <button class="details-btn" type="button">Details</button>
      </div>
      <div class="complaint-details">
        <div class="details-label">Message</div>
        <div class="details-text">${c.message}</div>
        ${
          c.original_filename
            ? `<div class="details-label">Attachment</div>
               <div class="details-text">${c.original_filename}</div>`
            : ""
        }
        <div class="details-label">Updates</div>
        <ul class="updates-list">
          ${updatesHtml}
        </ul>
      </div>
    `;

    // toggle details
    const detailsBtn = wrapper.querySelector(".details-btn");
    detailsBtn.addEventListener("click", () => {
      wrapper.classList.toggle("show-details");
    });

    return wrapper;
  }

  if (helpForm) {
    helpForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      helpStatus.textContent = "Sending complaint...";

      const formData = new FormData(helpForm);

      try {
        const res = await fetch("/help/submit", {
          method: "POST",
          body: formData,
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          helpStatus.textContent = data.message || "Unable to submit complaint.";
          return;
        }

        helpStatus.textContent = `Complaint submitted. Your ID is ${data.complaint.id}.`;
        helpForm.reset();

        // remove "no complaints" message if present
        const empty = complaintsList.querySelector(".empty-state");
        if (empty) empty.remove();

        const card = createComplaintCard(data.complaint);
        complaintsList.prepend(card);

        // auto-switch to complaints tab
        showSection("complaints");
      } catch (err) {
        console.error(err);
        helpStatus.textContent = "Network error. Please try again.";
      }
    });
  }

  // Existing complaint cards (server-rendered) – add toggle behavior
  complaintsList.querySelectorAll(".complaint-card").forEach(card => {
    const btn = card.querySelector(".details-btn");
    if (!btn) return;
    btn.addEventListener("click", () => {
      card.classList.toggle("show-details");
    });
  });
});
