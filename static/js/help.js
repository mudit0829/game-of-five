document.addEventListener("DOMContentLoaded", () => {
  const tabs = document.querySelectorAll(".section-tabs .tab");
  const sections = {
    contact: document.getElementById("section-contact"),
    complaints: document.getElementById("section-complaints"),
  };

  const helpForm = document.getElementById("helpForm");
  const helpStatus = document.getElementById("helpStatus");
  const complaintsList = document.getElementById("complaintsList");

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
      if (tab.dataset.target === "complaints") {
        loadComplaints();
      }
    });
  });

  function esc(v) {
    return String(v || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function createComplaintCard(c) {
    const wrapper = document.createElement("article");
    wrapper.className = "complaint-card";
    wrapper.dataset.id = c.id;

    const updatesHtml = (c.updates || [])
      .map(u => `
        <li>
          <span class="update-time">${esc(u.time)}</span>
          <span class="update-text">${esc(u.message || u.update_type || "")}</span>
        </li>
      `)
      .join("");

    wrapper.innerHTML = `
      <div class="complaint-main">
        <div class="complaint-id">
          ID: <span class="mono">${esc(c.id)}</span>
        </div>
        <div class="complaint-subject">${esc(c.subject)}</div>
        <div class="complaint-meta">
          ${esc(c.category || "General")} • ${esc(c.created_at || "")}
        </div>
      </div>

      <div class="complaint-side">
        <div class="status-pill status-${esc((c.status || "OPEN").toLowerCase())}">
          ${esc(c.status || "OPEN")}
        </div>
        <div class="complaint-updated">
          Last update: ${esc(c.last_reply_at || c.updated_at || "")}
        </div>
        <button class="details-btn" type="button">Details</button>
      </div>

      <div class="complaint-details">
        <div class="details-label">Message</div>
        <div class="details-text">${esc(c.message || "")}</div>

        ${c.attachment_name ? `
          <div class="details-label">Attachment</div>
          <div class="details-text">${esc(c.attachment_name)}</div>
        ` : ""}

        <div class="details-label">Updates</div>
        <ul class="updates-list">
          ${updatesHtml || "<li><span class='update-text'>No updates yet.</span></li>"}
        </ul>
      </div>
    `;

    const detailsBtn = wrapper.querySelector(".details-btn");
    detailsBtn.addEventListener("click", async () => {
      if (!wrapper.dataset.loaded) {
        try {
          const res = await fetch(`/api/help/tickets/${c.id}`);
          const data = await res.json();

          if (res.ok) {
            const updatesList = wrapper.querySelector(".updates-list");
            updatesList.innerHTML = (data.updates || []).length
              ? data.updates.map(u => `
                  <li>
                    <span class="update-time">${esc(u.time)}</span>
                    <span class="update-text">${esc(u.message || u.update_type || "")}</span>
                  </li>
                `).join("")
              : "<li><span class='update-text'>No updates yet.</span></li>";

            wrapper.dataset.loaded = "1";
          }
        } catch (err) {
          console.error("Ticket detail load error:", err);
        }
      }

      wrapper.classList.toggle("show-details");
    });

    return wrapper;
  }

  async function loadComplaints() {
    if (!complaintsList) return;

    complaintsList.innerHTML = `<div class="empty-state">Loading complaints...</div>`;

    try {
      const res = await fetch("/api/help/tickets");
      const data = await res.json();

      if (!res.ok) {
        complaintsList.innerHTML = `<div class="empty-state">Unable to load complaints.</div>`;
        return;
      }

      if (!Array.isArray(data) || data.length === 0) {
        complaintsList.innerHTML = `
          <div class="empty-state">
            No complaints yet.<br>
            Submit a complaint and it will appear here.
          </div>
        `;
        return;
      }

      complaintsList.innerHTML = "";
      data.forEach(c => {
        complaintsList.appendChild(createComplaintCard(c));
      });
    } catch (err) {
      console.error("Complaint list load error:", err);
      complaintsList.innerHTML = `<div class="empty-state">Unable to load complaints.</div>`;
    }
  }

  if (helpForm) {
    helpForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      helpStatus.textContent = "Sending complaint...";

      const formData = new FormData(helpForm);

      try {
        const res = await fetch("/api/help/tickets", {
          method: "POST",
          body: formData,
        });

        const data = await res.json();

        if (!res.ok || !data.success) {
          helpStatus.textContent = data.message || "Unable to submit complaint.";
          return;
        }

        helpStatus.textContent = `Complaint submitted. Your ID is ${data.ticket_id}.`;
        helpForm.reset();

        await loadComplaints();
        showSection("complaints");
      } catch (err) {
        console.error(err);
        helpStatus.textContent = "Network error. Please try again.";
      }
    });
  }

  showSection("contact");
  loadComplaints();
});
