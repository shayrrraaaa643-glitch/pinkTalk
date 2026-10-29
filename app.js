
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  updateProfile,
  signOut
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  set,
  get,
  push,
  update,
  onValue,
  onChildAdded
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBnKAp58DtL2GpmZ4804GSlrJ5eDf3w0MU",
  authDomain: "pinktalk-18623.firebaseapp.com",
  databaseURL: "https://pinktalk-18623-default-rtdb.firebaseio.com",
  projectId: "pinktalk-18623",
  storageBucket: "pinktalk-18623.firebasestorage.app",
  messagingSenderId: "723659169372",
  appId: "1:723659169372:web:59b6372a08e05aaa181099",
  measurementId: "G-1LM1F3Q67B"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getDatabase(firebaseApp);

const $ = id => document.getElementById(id);

const hidden = (id, value) =>
  $(id).classList.toggle("hidden", value);

const escapeHTML = value =>
  String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));

const initials = name =>
  (name || "?").trim().split(/\s+/).slice(0, 2)
    .map(part => part[0] || "").join("").toUpperCase();

const timeLabel = value =>
  new Date(value || Date.now()).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });

let user = null;
let profile = {};
let people = {};
let activeUid = null;
let activeChatId = null;

let messagesUnsubscribe = null;
let peopleUnsubscribe = null;
let callUnsubscribe = null;
let incomingUnsubscribe = null;
let incomingCallId = null;

let pc = null;
let localStream = null;
let remoteStream = null;
let currentCallId = null;
let currentCallType = "audio";
let callListeners = [];
let audioMuted = false;
let cameraOff = false;
let callHistory = [];

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.remove("hidden");

  clearTimeout(toast.timer);

  toast.timer = setTimeout(() => {
    el.classList.add("hidden");
  }, 3000);
}

// LOGIN AND SIGNUP

let signupMode = false;

$("switchAuth").addEventListener("click", () => {
  signupMode = !signupMode;

  hidden("nameGroup", !signupMode);
  $("displayName").required = signupMode;

  $("authTitle").textContent = signupMode
    ? "Create your account"
    : "Welcome back!";

  $("authDescription").textContent = signupMode
    ? "Make a little space for your favorite people."
    : "Sign in to chat with your people.";

  $("authSubmit").textContent = signupMode
    ? "Create account →"
    : "Sign in →";

  $("switchLabel").textContent = signupMode
    ? "Already have an account?"
    : "New to PinkTalk?";

  $("switchAuth").textContent = signupMode
    ? "Sign in"
    : "Create account";

  $("authError").textContent = "";
});

$("authForm").addEventListener("submit", async event => {
  event.preventDefault();

  $("authError").textContent = "";
  $("authSubmit").disabled = true;

  try {
    const email = $("email").value.trim().toLowerCase();
    const password = $("password").value;

    if (signupMode) {
      const name = $("displayName").value.trim();

      if (!name) {
        throw new Error("Please enter your name.");
      }

      const result = await createUserWithEmailAndPassword(
        auth, email, password
      );

      await updateProfile(result.user, {
        displayName: name
      });

      await set(ref(db, `users/${result.user.uid}`), {
        uid: result.user.uid,
        name,
        email,
        createdAt: Date.now()
      });

    } else {
      await signInWithEmailAndPassword(
        auth, email, password
      );
    }

  } catch (error) {
    console.error("Login/signup error:", error);

    $("authError").textContent =
      friendlyAuthError(error);

  } finally {
    $("authSubmit").disabled = false;
  }
});

function friendlyAuthError(error) {
  const errors = {
    "auth/email-already-in-use":
      "This email already has an account. Please sign in.",

    "auth/invalid-email":
      "Please enter a valid email address.",

    "auth/invalid-credential":
      "Email or password is incorrect.",

    "auth/weak-password":
      "Choose a password with at least 6 characters.",

    "auth/network-request-failed":
      "Network error. Please check your connection.",

    "auth/operation-not-allowed":
      "Enable Email/Password sign-in in Firebase Authentication.",

    "auth/too-many-requests":
      "Too many attempts. Please try again later.",

    "PERMISSION_DENIED":
      "Database permission denied. Check Firebase Database Rules."
  };

  return errors[error.code] ||
    error.message ||
    "Something went wrong. Please try again.";
}

$("logoutBtn").addEventListener("click", async () => {
  if (currentCallId) {
    await finishCall();
  }

  await signOut(auth);
});

// USER PROFILE AND CONTACTS

onAuthStateChanged(auth, async signedInUser => {
  if (!signedInUser) {
    user = null;
    cleanupSubscriptions();

    hidden("authScreen", false);
    hidden("appScreen", true);
    hidden("callOverlay", true);
    hidden("incomingOverlay", true);

    return;
  }

  user = signedInUser;

  try {
    const userRef = ref(db, `users/${user.uid}`);
    const snapshot = await get(userRef);

    if (!snapshot.exists()) {
      const userProfile = {
        uid: user.uid,
        name: user.displayName ||
          (user.email || "user").split("@")[0],
        email: user.email || "",
        createdAt: Date.now()
      };

      await set(userRef, userProfile);
    }

    const profileSnapshot = await get(userRef);
    profile = profileSnapshot.val() || {};

    $("myName").textContent =
      profile.name || user.displayName || "PinkTalk user";

    $("myEmail").textContent = user.email || "";

    $("myAvatar").textContent =
      initials(profile.name || user.displayName);

    hidden("authScreen", true);
    hidden("appScreen", false);

    subscribePeople();
    subscribeIncomingCalls();
    subscribeCallHistory();

  } catch (error) {
    console.error("PinkTalk database error:", error);

    hidden("authScreen", false);
    hidden("appScreen", true);

    $("authError").textContent =
      "Firebase Database error: " +
      (error.message || "Check Database Rules and configuration.");
  }
});

function cleanupSubscriptions() {
  if (peopleUnsubscribe) peopleUnsubscribe();
  if (messagesUnsubscribe) messagesUnsubscribe();
  if (callUnsubscribe) callUnsubscribe();
  if (incomingUnsubscribe) incomingUnsubscribe();

  if (currentCallId) finishCall();

  peopleUnsubscribe = null;
  messagesUnsubscribe = null;
  callUnsubscribe = null;
  incomingUnsubscribe = null;

  activeUid = null;
  activeChatId = null;
  people = {};
}

function subscribePeople() {
  if (peopleUnsubscribe) peopleUnsubscribe();

  peopleUnsubscribe = onValue(
    ref(db, "users"),
    snapshot => {
      people = snapshot.val() || {};

      delete people[user.uid];

      renderPeople();
      renderPeopleGrid();
    },
    error => {
      toast("Could not load contacts: " + error.message);
    }
  );
}

$("peopleSearch").addEventListener("input", renderPeople);

function renderPeople() {
  const q = $("peopleSearch").value.trim().toLowerCase();

  const list = Object.values(people).filter(person =>
    (person.name || "").toLowerCase().includes(q) ||
    (person.email || "").toLowerCase().includes(q)
  );

  $("peopleList").innerHTML = list.length
    ? list.map(person => `
      <button class="person-item ${
        person.uid === activeUid ? "selected" : ""
      }" data-person="${escapeHTML(person.uid)}">

        <div class="avatar">
          ${escapeHTML(initials(person.name))}
        </div>

        <div class="person-copy">
          <strong>${escapeHTML(person.name)}</strong>
          <small>${escapeHTML(person.email || "")}</small>
        </div>
      </button>
    `).join("")
    : '<p class="hint">No people found. Ask a friend to create an account.</p>';

  $("peopleList").querySelectorAll("[data-person]")
    .forEach(button => {
      button.addEventListener("click", () => {
        openChat(button.dataset.person);
      });
    });
}

function renderPeopleGrid() {
  const list = Object.values(people);

  $("peopleGrid").innerHTML = list.length
    ? list.map(person => `
      <article class="person-card">
        <div class="avatar">
          ${escapeHTML(initials(person.name))}
        </div>

        <h3>${escapeHTML(person.name)}</h3>
        <p>${escapeHTML(person.email || "")}</p>

        <button class="primary"
          data-message-person="${escapeHTML(person.uid)}">
          Message
        </button>
      </article>
    `).join("")
    : '<p class="hint">Your people will appear here after they create accounts.</p>';

  $("peopleGrid")
    .querySelectorAll("[data-message-person]")
    .forEach(button => {
      button.addEventListener("click", () => {
        showPage("messages");
        openChat(button.dataset.messagePerson);
      });
    });
}

// REAL-TIME CHAT

function getChatId(uid1, uid2) {
  return [uid1, uid2].sort().join("_");
}

async function openChat(otherUid) {
  if (!user || !people[otherUid]) return;

  activeUid = otherUid;

  const person = people[otherUid];

  activeChatId = getChatId(user.uid, otherUid);

  $("chatName").textContent = person.name || "PinkTalk friend";
  $("chatEmail").textContent = person.email || "";
  $("chatAvatar").textContent = initials(person.name);

  hidden("welcomeChat", true);
  hidden("activeChat", false);

  renderPeople();

  try {
    const chatRef = ref(db, `chats/${activeChatId}`);
    const chatSnapshot = await get(chatRef);

    if (!chatSnapshot.exists()) {
      await set(chatRef, {
        members: {
          [user.uid]: true,
          [otherUid]: true
        },
        createdAt: Date.now()
      });
    }

    if (messagesUnsubscribe) messagesUnsubscribe();

    messagesUnsubscribe = onValue(
      ref(db, `chats/${activeChatId}/messages`),
      snapshot => {
        const messages = snapshot.val() || {};

        const sorted = Object.values(messages).sort(
          (a, b) => a.createdAt - b.createdAt
        );

        $("messages").innerHTML = sorted.map(message => `
          <div class="message ${
            message.sender === user.uid ? "mine" : ""
          }">
            <div class="bubble">${
              escapeHTML(message.text).replace(/\n/g, "<br>")
            }</div>
            <time>${escapeHTML(timeLabel(message.createdAt))}</time>
          </div>
        `).join("");

        $("messages").scrollTop = $("messages").scrollHeight;
      },
      error => toast("Could not load messages: " + error.message)
    );

  } catch (error) {
    toast("Could not open chat: " + error.message);
  }
}

$("messageForm").addEventListener("submit", async event => {
  event.preventDefault();

  const messageText = $("messageInput").value.trim();

  if (!messageText || !activeChatId || !activeUid) {
    if (!activeUid) toast("Choose a person first.");
    return;
  }

  $("messageInput").value = "";

  try {
    const messagesRef = ref(
      db, `chats/${activeChatId}/messages`
    );

    await set(push(messagesRef), {
      text: messageText,
      sender: user.uid,
      createdAt: Date.now()
    });

  } catch (error) {
    toast("Message failed to send: " + error.message);
    $("messageInput").value = messageText;
  }
});

// PAGE NAVIGATION

function showPage(page) {
  const titles = {
    messages: "Your messages",
    people: "People on PinkTalk",
    calls: "Call history"
  };

  ["messages", "people", "calls"].forEach(name => {
    hidden(name + "Page", name !== page);
  });

  $("pageHeading").textContent = titles[page] || "PinkTalk";

  document.querySelectorAll(".nav-btn").forEach(button => {
    button.classList.toggle(
      "active", button.dataset.page === page
    );
  });
}

document.querySelectorAll(".nav-btn").forEach(button => {
  button.addEventListener("click", () => {
    showPage(button.dataset.page);
  });
});

// WEBRTC AUDIO AND VIDEO CALLS

function createPeerConnection(callId, callerSide) {
  pc = new RTCPeerConnection(rtcConfig);
  remoteStream = new MediaStream();

  $("remoteVideo").srcObject = remoteStream;
  $("localVideo").srcObject = localStream;

  pc.ontrack = event => {
    event.streams[0].getTracks().forEach(track => {
      if (!remoteStream.getTracks().some(
        existing => existing.id === track.id
      )) {
        remoteStream.addTrack(track);
      }
    });

    $("remoteVideo").play().catch(() => {});
  };

  pc.onicecandidate = async event => {
    if (!event.candidate || !currentCallId) return;

    const side = callerSide
      ? "callerCandidates"
      : "calleeCandidates";

    try {
      await set(
        push(ref(db, `calls/${callId}/${side}`)),
        event.candidate.toJSON()
      );
    } catch (error) {
      console.error("Could not save ICE candidate:", error);
    }
  };

  pc.onconnectionstatechange = () => {
    if (!pc) return;

    if (pc.connectionState === "connected") {
      $("callStatus").textContent = "Connected 💗";
    } else if (
      ["failed", "disconnected"].includes(pc.connectionState)
    ) {
      $("callStatus").textContent =
        "Connection interrupted. Check network.";
    }
  };

  return pc;
}

async function getMedia(type) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      "Camera and microphone need HTTPS or localhost in a supported browser."
    );
  }

  return navigator.mediaDevices.getUserMedia({
    audio: true,
    video: type === "video"
  });
}

async function startCall(type) {
  if (!activeUid || !user) {
    return toast("Choose a person to call first.");
  }

  if (currentCallId) {
    return toast("A call is already active.");
  }

  const person = people[activeUid];

  if (!person) {
    return toast("This person is no longer available.");
  }

  try {
    currentCallType = type;

    localStream = await getMedia(type);

    $("localVideo").srcObject = localStream;

    hidden("localVideo", type !== "video");
    hidden("remoteVideoWrap", type !== "video");

    const callRef = push(ref(db, "calls"));
    currentCallId = callRef.key;

    const peer = createPeerConnection(currentCallId, true);

    localStream.getTracks().forEach(track => {
      peer.addTrack(track, localStream);
    });

    const offer = await peer.createOffer();

    await peer.setLocalDescription(offer);

    await set(callRef, {
      caller: user.uid,
      callee: activeUid,
      type,
      offer: {
        type: offer.type,
        sdp: offer.sdp
      },
      status: "ringing",
      createdAt: Date.now()
    });

    showCallScreen(
      person.name, type, "Calling " + person.name + "..."
    );

    listenForCallAnswer(currentCallId);
    listenForCandidates(
      currentCallId, "calleeCandidates", true
    );
    listenForCallEnd(currentCallId);

  } catch (error) {
    toast("Could not start call: " + error.message);
    await finishCall(false);
  }
}

function showCallScreen(name, type, status) {
  $("callName").textContent = name;
  $("callAvatar").textContent = initials(name);

  $("callTypeLabel").textContent =
    type === "video" ? "VIDEO CALL" : "AUDIO CALL";

  $("callStatus").textContent = status;

  hidden("callOverlay", false);
}

function listenForCallAnswer(callId) {
  const answerRef = ref(db, `calls/${callId}/answer`);

  const unsubscribe = onValue(answerRef, async snapshot => {
    if (!snapshot.exists() || !pc || pc.currentRemoteDescription) {
      return;
    }

    try {
      await pc.setRemoteDescription(
        new RTCSessionDescription(snapshot.val())
      );

      $("callStatus").textContent =
        "Answer received. Connecting...";

    } catch (error) {
      console.error("Setting remote answer failed", error);
    }
  });

  callListeners.push(unsubscribe);
}

function listenForCandidates(callId, candidatePath) {
  const unsubscribe = onChildAdded(
    ref(db, `calls/${callId}/${candidatePath}`),
    async snapshot => {
      if (!pc || !snapshot.exists()) return;

      try {
        await pc.addIceCandidate(
          new RTCIceCandidate(snapshot.val())
        );
      } catch (error) {
        console.warn("ICE candidate error:", error);
      }
    }
  );

  callListeners.push(unsubscribe);
}

function listenForCallEnd(callId) {
  const unsubscribe = onValue(
    ref(db, `calls/${callId}/status`),
    snapshot => {
      if (
        snapshot.val() === "ended" &&
        currentCallId === callId
      ) {
        finishCall(false);
        toast("Call ended.");
      }
    }
  );

  callListeners.push(unsubscribe);
}

// INCOMING CALLS

function subscribeIncomingCalls() {
  if (incomingUnsubscribe) incomingUnsubscribe();

  incomingUnsubscribe = onValue(
    ref(db, "calls"),
    snapshot => {
      if (!user || currentCallId) return;

      const allCalls = snapshot.val() || {};

      const entry = Object.entries(allCalls).find(
        ([, call]) =>
          call.callee === user.uid &&
          call.status === "ringing" &&
          Date.now() - (call.createdAt || 0) < 120000
      );

      if (!entry || incomingCallId) return;

      incomingCallId = entry[0];

      const call = entry[1];

      const caller = people[call.caller] || {
        name: "PinkTalk friend"
      };

      $("incomingName").textContent = caller.name;
      $("incomingAvatar").textContent = initials(caller.name);

      $("incomingType").textContent =
        call.type === "video"
          ? "Incoming video call"
          : "Incoming audio call";

      hidden("incomingOverlay", false);
    },
    error => toast("Incoming calls error: " + error.message)
  );
}

$("acceptBtn").addEventListener("click", acceptCall);

$("declineBtn").addEventListener("click", async () => {
  try {
    if (incomingCallId) {
      await update(
        ref(db, `calls/${incomingCallId}`),
        { status: "ended" }
      );
    }
  } catch (error) {
    toast("Could not decline call: " + error.message);
  }

  incomingCallId = null;
  hidden("incomingOverlay", true);
});

async function acceptCall() {
  const callId = incomingCallId;

  if (!callId) return;

  try {
    const snapshot = await get(ref(db, `calls/${callId}`));
    const call = snapshot.val();

    if (!call || call.status !== "ringing") {
      throw new Error("This call is no longer available.");
    }

    const caller = people[call.caller] || {
      name: "PinkTalk friend"
    };

    currentCallId = callId;
    currentCallType = call.type;
    activeUid = call.caller;

    localStream = await getMedia(call.type);

    $("localVideo").srcObject = localStream;

    hidden("localVideo", call.type !== "video");
    hidden("remoteVideoWrap", call.type !== "video");
    hidden("incomingOverlay", true);

    const peer = createPeerConnection(callId, false);

    localStream.getTracks().forEach(track => {
      peer.addTrack(track, localStream);
    });

    await peer.setRemoteDescription(
      new RTCSessionDescription(call.offer)
    );

    const answer = await peer.createAnswer();

    await peer.setLocalDescription(answer);

    await update(ref(db, `calls/${callId}`), {
      answer: {
        type: answer.type,
        sdp: answer.sdp
      },
      status: "accepted",
      acceptedAt: Date.now()
    });

    showCallScreen(caller.name, call.type, "Connecting...");

    listenForCandidates(
      callId, "callerCandidates"
    );

    listenForCallEnd(callId);

    incomingCallId = null;

  } catch (error) {
    toast("Could not accept call: " + error.message);

    incomingCallId = null;
    hidden("incomingOverlay", true);

    await finishCall(false);
  }
}

// END CALL AND CLEANUP

async function finishCall(updateRemote = true) {
  const id = currentCallId;

  if (updateRemote && id) {
    try {
      await update(ref(db, `calls/${id}`), {
        status: "ended",
        endedAt: Date.now()
      });
    } catch (error) {
      console.warn("Could not update call status", error);
    }
  }

  callListeners.forEach(unsubscribe => unsubscribe());
  callListeners = [];

  if (pc) {
    pc.ontrack = null;
    pc.onicecandidate = null;
    pc.close();
    pc = null;
  }

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  remoteStream = null;
  currentCallId = null;

  $("remoteVideo").srcObject = null;
  $("localVideo").srcObject = null;

  hidden("callOverlay", true);
  hidden("incomingOverlay", true);
}

$("audioBtn").addEventListener("click", () => {
  startCall("audio");
});

$("videoBtn").addEventListener("click", () => {
  startCall("video");
});

$("endCallBtn").addEventListener("click", () => {
  finishCall(true);
});

$("closeCall").addEventListener("click", () => {
  finishCall(true);
});

$("muteBtn").addEventListener("click", () => {
  if (!localStream) return;

  audioMuted = !audioMuted;

  localStream.getAudioTracks().forEach(track => {
    track.enabled = !audioMuted;
  });

  $("muteBtn").innerHTML = audioMuted
    ? "🔇<small>Unmute</small>"
    : "🎙<small>Mute</small>";
});

$("cameraBtn").addEventListener("click", () => {
  if (!localStream) return;

  cameraOff = !cameraOff;

  localStream.getVideoTracks().forEach(track => {
    track.enabled = !cameraOff;
  });

  $("cameraBtn").innerHTML = cameraOff
    ? "🚫<small>Camera off</small>"
    : "▣<small>Camera</small>";
});

// CALL HISTORY

function subscribeCallHistory() {
  if (callUnsubscribe) callUnsubscribe();

  callUnsubscribe = onValue(
    ref(db, "calls"),
    snapshot => {
      if (!user) return;

      const allCalls = snapshot.val() || {};

      callHistory = Object.entries(allCalls)
        .filter(([, call]) =>
          (call.caller === user.uid ||
           call.callee === user.uid) &&
          call.status === "ended"
        )
        .sort((a, b) =>
          (b[1].createdAt || 0) -
          (a[1].createdAt || 0)
        )
        .slice(0, 30);

      renderCallHistory();
    },
    error => toast("Call history error: " + error.message)
  );
}

function renderCallHistory() {
  $("callHistory").innerHTML = callHistory.length
    ? callHistory.map(([id, call]) => {
        const otherUid = call.caller === user.uid
          ? call.callee
          : call.caller;

        const person = people[otherUid] || {
          name: "PinkTalk friend"
        };

        return `
          <div class="call-history-row">
            <div class="avatar">
              ${escapeHTML(initials(person.name))}
            </div>

            <div>
              <strong>${escapeHTML(person.name)}</strong>
              <small>
                ${escapeHTML(call.type || "audio")} call ·
                ${escapeHTML(
                  new Date(call.createdAt || Date.now())
                    .toLocaleString()
                )}
              </small>
            </div>

            <button data-recall="${escapeHTML(otherUid)}">
              Call again
            </button>
          </div>
        `;
      }).join("")
    : '<p class="hint">No completed calls yet.</p>';

  $("callHistory").querySelectorAll("[data-recall]")
    .forEach(button => {
      button.addEventListener("click", () => {
        const uid = button.dataset.recall;

        if (people[uid]) {
          activeUid = uid;
          showPage("messages");
          startCall("audio");
        } else {
          toast("That user is no longer available.");
        }
      });
    });
}
