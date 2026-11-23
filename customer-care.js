const careLogin = document.querySelector("#careLogin");
const careWorkspace = document.querySelector("#careWorkspace");
const careLoginForm = document.querySelector("#careLoginForm");
const careFeedback = document.querySelector("#careFeedback");
const careThreadList = document.querySelector("#careThreadList");
const careEmpty = document.querySelector("#careEmpty");
const careChat = document.querySelector("#careChat");
const careMessageForm = document.querySelector("#careMessageForm");
const careRemoteAudio = document.querySelector("#careRemoteAudio");
let careSelectedId = "";
let careThreads = [];
let carePollTimer = null;
let carePollPending = false;
let careSelectedThread = null;
let careCallPeer = null;
let careLocalAudio = null;
let careCallId = "";
let careCallGeneration = 0;
let careLastHeartbeatAt = 0;
let careSeenSignals = new Set();
let carePendingCandidates = [];

async function careRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...options.headers }
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("The customer care app could not read the server response. Try again.");
  }
  if (!response.ok) {
    const error = new Error(result.error || "The request could not be completed.");
    error.status = response.status;
    throw error;
  }
  return result;
}

function showCareFeedback(message, isError = false) {
  careFeedback.textContent = message;
  careFeedback.classList.toggle("error", isError);
}

function showCareLogin(message = "") {
  window.clearInterval(carePollTimer);
  carePollTimer = null;
  closeCareCall();
  careCallId = "";
  careLogin.hidden = false;
  careWorkspace.hidden = true;
  document.querySelector("#careSignOut").hidden = true;
  if (message) showCareFeedback(message, true);
}

function showCareWorkspace() {
  careLogin.hidden = true;
  careWorkspace.hidden = false;
  document.querySelector("#careSignOut").hidden = false;
  loadCareInbox().catch(error => showCareFeedback(error.message, true));
  window.clearInterval(carePollTimer);
  carePollTimer = window.setInterval(() => {
    loadCareInbox().catch(error => showCareFeedback(error.message, true));
  }, 2500);
}

function formatCareDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const recent = Date.now() - date.getTime() < 24 * 60 * 60 * 1000;
  return recent
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString();
}

function renderCareThreads() {
  careThreadList.replaceChildren();
  const summary = document.querySelector("#careInboxSummary");
  summary.textContent = `${careThreads.length} conversation${careThreads.length === 1 ? "" : "s"}`;
  if (!careThreads.length) {
    const empty = document.createElement("p");
    empty.className = "care-inbox-summary";
    empty.textContent = "Customer conversations will appear here.";
    careThreadList.append(empty);
    return;
  }
  careThreads.forEach(thread => {
    const button = document.createElement("button");
    const head = document.createElement("span");
    const name = document.createElement("strong");
    const date = document.createElement("time");
    const message = document.createElement("p");
    button.type = "button";
    button.className = `care-thread-button ${thread.customerId === careSelectedId ? "active" : ""}`;
    name.textContent = thread.customerName;
    date.textContent = formatCareDate(thread.lastMessageAt || thread.updatedAt);
    head.className = "care-thread-button-head";
    head.append(name, date);
    message.textContent = thread.lastMessage || thread.customerEmail;
    button.append(head, message);
    if (thread.callStatus) {
      const callStatus = document.createElement("span");
      callStatus.className = "care-thread-call";
      callStatus.textContent = thread.callStatus === "ringing" ? "Incoming call" : "Call in progress";
      button.append(callStatus);
    }
    button.addEventListener("click", () => selectCareThread(thread.customerId));
    careThreadList.append(button);
  });
}

function renderCareMessages(thread) {
  const list = document.querySelector("#careMessages");
  list.replaceChildren();
  if (!thread.messages.length) {
    const empty = document.createElement("p");
    empty.className = "care-empty";
    empty.textContent = "No messages yet. Send a reply when you are ready.";
    list.append(empty);
    return;
  }
  thread.messages.forEach(message => {
    const bubble = document.createElement("article");
    const sender = document.createElement("strong");
    const text = document.createElement("p");
    const time = document.createElement("time");
    bubble.className = `care-message ${message.senderRole === "admin" ? "mine" : ""}`;
    sender.textContent = message.senderRole === "admin" ? "You · Customer care" : message.senderName || thread.customerName;
    text.textContent = message.text;
    time.dateTime = message.createdAt;
    time.textContent = new Date(message.createdAt).toLocaleString();
    bubble.append(sender, text, time);
    list.append(bubble);
  });
  list.scrollTop = list.scrollHeight;
}

async function selectCareThread(customerId) {
  careSelectedId = customerId;
  renderCareThreads();
  careEmpty.hidden = true;
  careChat.hidden = false;
  try {
    await loadSelectedCareThread();
  } catch (error) {
    showCareFeedback(error.message, true);
  }
}

async function loadSelectedCareThread() {
  if (!careSelectedId) return;
  const result = await careRequest(`/api/admin/support/${encodeURIComponent(careSelectedId)}`);
  careSelectedThread = result.thread;
  document.querySelector("#careCustomerName").textContent = careSelectedThread.customerName;
  document.querySelector("#careCustomerContact").textContent =
    `${careSelectedThread.customerEmail}${careSelectedThread.customerPhone ? ` · ${careSelectedThread.customerPhone}` : ""}`;
  renderCareMessages(careSelectedThread);
  await updateCareCall(careSelectedThread);
  if (careSelectedThread.call && careSelectedThread.call.status === "active" && careCallPeer &&
      ["connecting", "connected"].includes(careCallPeer.connectionState) &&
      Date.now() - careLastHeartbeatAt >= 10000) {
    careLastHeartbeatAt = Date.now();
    await careRequest("/api/support/calls", {
      method: "POST",
      body: JSON.stringify({
        action: "heartbeat",
        callId: careSelectedThread.call.id,
        customerId: careSelectedId
      })
    });
  }
}

async function loadCareInbox() {
  if (carePollPending || careWorkspace.hidden) return;
  carePollPending = true;
  try {
    careThreads = await careRequest("/api/admin/support");
    renderCareThreads();
    const selectedThread = careThreads.find(thread => thread.customerId === careSelectedId);
    const incomingCall = careThreads.find(thread => thread.callStatus === "ringing");
    if (incomingCall && incomingCall.customerId !== careSelectedId &&
        (!selectedThread || !selectedThread.callStatus) && !careCallPeer) {
      await selectCareThread(incomingCall.customerId);
    } else if (selectedThread) {
      await loadSelectedCareThread();
    } else if (careSelectedId) {
      careSelectedId = "";
      careSelectedThread = null;
      careChat.hidden = true;
      careEmpty.hidden = false;
    }
  } catch (error) {
    if (error.status === 403) showCareLogin("Your admin session has ended. Sign in again.");
    else showCareFeedback(error.message, true);
  } finally {
    carePollPending = false;
  }
}

function closeCareCall() {
  careCallGeneration += 1;
  if (careCallPeer) {
    careCallPeer.onicecandidate = null;
    careCallPeer.ontrack = null;
    careCallPeer.close();
    careCallPeer = null;
  }
  if (careLocalAudio) {
    careLocalAudio.getTracks().forEach(track => track.stop());
    careLocalAudio = null;
  }
  careRemoteAudio.srcObject = null;
  carePendingCandidates = [];
  document.querySelector("#answerCareCall").hidden = true;
  document.querySelector("#endCareCall").hidden = true;
}

function sendCareSignal(callId, type, payload) {
  const query = new URLSearchParams({ customerId: careSelectedId });
  return careRequest(`/api/support/calls/${encodeURIComponent(callId)}/signals?${query}`, {
    method: "POST",
    body: JSON.stringify({ type, payload })
  });
}

function createCarePeer(callId) {
  careCallPeer = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });
  careCallPeer.onicecandidate = event => {
    if (!event.candidate) return;
    sendCareSignal(callId, "candidate", event.candidate.toJSON())
      .catch(error => showCareFeedback(error.message, true));
  };
  careCallPeer.ontrack = event => {
    careRemoteAudio.srcObject = event.streams[0];
  };
  careCallPeer.onconnectionstatechange = () => {
    if (careCallPeer && careCallPeer.connectionState === "connected") {
      document.querySelector("#careCallStatus").textContent = "Connected to the customer.";
    }
    if (careCallPeer && ["failed", "disconnected"].includes(careCallPeer.connectionState)) {
      document.querySelector("#careCallStatus").textContent = "Call connection lost. End the call and try again.";
    }
  };
}

async function addCareRemoteCandidate(candidate) {
  if (!careCallPeer || !careCallPeer.remoteDescription) {
    carePendingCandidates.push(candidate);
    return;
  }
  await careCallPeer.addIceCandidate(new RTCIceCandidate(candidate));
}

async function updateCareCall(thread) {
  const call = thread.call;
  const answerButton = document.querySelector("#answerCareCall");
  const endButton = document.querySelector("#endCareCall");
  const status = document.querySelector("#careCallStatus");
  if (careCallId && (!call || careCallId !== call.id)) closeCareCall();
  if (!call || call.status === "ended") {
    if (careCallId) closeCareCall();
    careCallId = "";
    status.textContent = call ? "Call ended." : "No active call";
    return;
  }
  if (careCallId !== call.id) careSeenSignals = new Set();
  careCallId = call.id;
  endButton.hidden = false;
  const offer = call.signals.find(signal => signal.type === "offer" && signal.senderRole === "customer");
  answerButton.hidden = !(call.status === "ringing" && offer && !careCallPeer);
  status.textContent = call.status === "ringing"
    ? offer ? "Incoming customer call" : "Customer is calling..."
    : "Audio call in progress";
  for (const signal of call.signals) {
    if (signal.senderRole === "admin" || careSeenSignals.has(signal.id)) continue;
    careSeenSignals.add(signal.id);
    if (signal.type === "candidate") await addCareRemoteCandidate(signal.payload);
  }
}

document.querySelector("#answerCareCall").addEventListener("click", async event => {
  const button = event.currentTarget;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.RTCPeerConnection) {
    showCareFeedback("Audio calling needs a supported browser and a secure HTTPS connection.", true);
    return;
  }
  if (!careSelectedThread || !careSelectedThread.call) return;
  const call = careSelectedThread.call;
  const offer = call.signals.find(signal => signal.type === "offer" && signal.senderRole === "customer");
  if (!offer) return;
  const customerId = careSelectedId;
  const setupGeneration = ++careCallGeneration;
  let localAudio = null;
  let peer = null;
  button.disabled = true;
  try {
    localAudio = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    if (setupGeneration !== careCallGeneration || customerId !== careSelectedId) {
      localAudio.getTracks().forEach(track => track.stop());
      return;
    }
    careLocalAudio = localAudio;
    careCallId = call.id;
    createCarePeer(call.id);
    peer = careCallPeer;
    localAudio.getTracks().forEach(track => peer.addTrack(track, localAudio));
    await peer.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: offer.payload }));
    if (setupGeneration !== careCallGeneration || careCallPeer !== peer) return;
    const candidates = carePendingCandidates;
    carePendingCandidates = [];
    for (const candidate of candidates) await addCareRemoteCandidate(candidate);
    if (setupGeneration !== careCallGeneration || careCallPeer !== peer) return;
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    if (setupGeneration !== careCallGeneration || careCallPeer !== peer) return;
    await sendCareSignal(call.id, "answer", answer.sdp);
    if (setupGeneration !== careCallGeneration || careCallPeer !== peer) return;
    document.querySelector("#careCallStatus").textContent = "Connecting to the customer...";
    button.hidden = true;
    showCareFeedback("");
  } catch (error) {
    if (setupGeneration !== careCallGeneration) {
      if (localAudio && localAudio !== careLocalAudio) {
        localAudio.getTracks().forEach(track => track.stop());
      }
      return;
    }
    closeCareCall();
    try {
      await careRequest("/api/support/calls", {
        method: "POST",
        body: JSON.stringify({ action: "end", callId: call.id, customerId })
      });
    } catch (cleanupError) {
      console.error("Could not end the support call after answering failed:", cleanupError);
    }
    careCallId = "";
    showCareFeedback(error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#endCareCall").addEventListener("click", async () => {
  const callId = careCallId;
  closeCareCall();
  if (!callId || !careSelectedId) return;
  try {
    await careRequest("/api/support/calls", {
      method: "POST",
      body: JSON.stringify({ action: "end", callId, customerId: careSelectedId })
    });
    careCallId = "";
    document.querySelector("#careCallStatus").textContent = "Call ended.";
  } catch (error) {
    showCareFeedback(error.message, true);
  }
});

careMessageForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!careSelectedId) return;
  const input = careMessageForm.elements.namedItem("text");
  const button = careMessageForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await careRequest("/api/admin/support/messages", {
      method: "POST",
      body: JSON.stringify({ customerId: careSelectedId, text: input.value })
    });
    input.value = "";
    showCareFeedback("");
    await loadSelectedCareThread();
  } catch (error) {
    showCareFeedback(error.message, true);
  } finally {
    button.disabled = false;
  }
});

careLoginForm.addEventListener("submit", async event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(careLoginForm));
  try {
    const result = await careRequest("/api/admin/login", {
      method: "POST",
      body: JSON.stringify(values)
    });
    if (!result.user || result.user.role !== "admin") {
      await careRequest("/api/auth/logout", { method: "POST", body: "{}" });
      throw new Error("Sign in with the store admin account to access customer care.");
    }
    careLoginForm.reset();
    showCareFeedback("");
    showCareWorkspace();
  } catch (error) {
    showCareFeedback(error.message, true);
  }
});

document.querySelector("#careRefresh").addEventListener("click", () => {
  loadCareInbox().catch(error => showCareFeedback(error.message, true));
});

document.querySelector("#careSignOut").addEventListener("click", async () => {
  try {
    if (careCallId && careSelectedId) {
      try {
        await careRequest("/api/support/calls", {
          method: "POST",
          body: JSON.stringify({ action: "end", callId: careCallId, customerId: careSelectedId })
        });
      } catch (callError) {
        console.error("Could not end the support call before signing out:", callError);
      }
      careCallId = "";
    }
    await careRequest("/api/auth/logout", { method: "POST", body: "{}" });
    showCareLogin("You have signed out.");
  } catch (error) {
    showCareFeedback(error.message, true);
  }
});

careRequest("/api/auth/session")
  .then(result => {
    if (result.user && result.user.role === "admin") showCareWorkspace();
    else if (result.user) showCareLogin("This area is for the store admin. Sign out of your other account first.");
    else showCareLogin();
  })
  .catch(error => showCareLogin(error.message));
