const announcementBar = document.querySelector(".announcement");
const announcementMessage = announcementBar && announcementBar.querySelector("p");
const announcementClose = announcementBar && announcementBar.querySelector("button");

if (announcementBar && announcementMessage && announcementClose) {
  announcementMessage.setAttribute("aria-live", "polite");
  announcementMessage.setAttribute("aria-atomic", "true");
  const storefrontAnnouncements = [
    { text: "Shop the latest A&M Gadget arrivals.", href: "index.html#products", label: "Shop now" },
    { text: "Delivery fees are based on your destination." },
    { text: "Interested in delivery work? Apply to ride with A&M Gadget.", href: "rider.html", label: "Apply to ride" }
  ];
  const riderAnnouncements = [
    { text: "Check your dashboard for newly assigned deliveries." },
    { text: "Delivery codes go to the customer; ask for the code only at handoff." },
    { text: "Earn 3% of the delivery fee when a customer confirms delivery." }
  ];
  const announcements = document.body.classList.contains("rider-portal")
    ? riderAnnouncements
    : storefrontAnnouncements;
  let announcementIndex = 0;
  let rotateAnnouncement = null;

  function showAnnouncement() {
    const item = announcements[announcementIndex];
    announcementMessage.replaceChildren(document.createTextNode(item.text));
    if (item.href) {
      announcementMessage.append(document.createTextNode(" "));
      const link = document.createElement("a");
      link.className = "announcement-message-link";
      link.href = item.href;
      link.textContent = item.label;
      announcementMessage.append(link);
    }
  }

  showAnnouncement();
  rotateAnnouncement = window.setInterval(() => {
    announcementIndex = (announcementIndex + 1) % announcements.length;
    showAnnouncement();
  }, 6000);

  announcementClose.addEventListener("click", () => {
    window.clearInterval(rotateAnnouncement);
    announcementBar.remove();
    const header = document.querySelector(".header");
    const nav = document.querySelector(".nav");
    const searchPanel = document.querySelector(".search-panel");
    if (header) header.style.top = "0";
    if (nav) nav.style.top = "82px";
    if (searchPanel) searchPanel.style.top = "82px";
  });
}
