import net from "node:net";
const HERDR_ENV = process.env.HERDR_ENV;
const socketPath = process.env.HERDR_SOCKET_PATH;
const socketEndpoint = process.platform === "win32" && socketPath ? `\\\\.\\pipe\\${socketPath}` : socketPath;
const paneId = process.env.HERDR_PANE_ID;
const source = "herdr:pi";
function enabled() {
  return HERDR_ENV === "1" && !!socketPath && !!paneId;
}
function sendRequestAttempt(request, timeoutMs) {
  if (!enabled()) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let done = false;
    let timeout;
    const finish = (delivered) => {
      if (done) return;
      done = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      socket.destroy();
      resolve(delivered);
    };
    const socket = net.createConnection(socketEndpoint);
    socket.on("error", () => finish(false));
    socket.on("connect", () => socket.write(`${JSON.stringify(request)}
`));
    socket.on("data", () => finish(true));
    socket.on("end", () => finish(false));
    timeout = setTimeout(() => finish(false), timeoutMs);
    timeout.unref?.();
  });
}
async function sendRequest(request) {
  if (await sendRequestAttempt(request, 500)) {
    return;
  }
  await sendRequestAttempt(request, 1500);
}
let reportSeq = Date.now() * 1e3;
let currentAgentSessionId;
let currentAgentSessionPath;
function nextReportSeq() {
  reportSeq += 1;
  return reportSeq;
}
function updateSessionRef(ctx) {
  try {
    const file = ctx?.sessionManager?.getSessionFile?.();
    currentAgentSessionPath = typeof file === "string" && file.startsWith("/") ? file : void 0;
  } catch {
    currentAgentSessionPath = void 0;
  }
  try {
    const id = ctx?.sessionManager?.getSessionId?.();
    currentAgentSessionId = typeof id === "string" && id.length > 0 ? id : void 0;
  } catch {
    currentAgentSessionId = void 0;
  }
}
function withSessionRef(params) {
  if (currentAgentSessionPath) {
    return { ...params, agent_session_path: currentAgentSessionPath };
  }
  if (currentAgentSessionId) {
    return { ...params, agent_session_id: currentAgentSessionId };
  }
  return params;
}
function currentSessionRef() {
  if (currentAgentSessionPath) {
    return { agent_session_path: currentAgentSessionPath };
  }
  if (currentAgentSessionId) {
    return { agent_session_id: currentAgentSessionId };
  }
  return void 0;
}
function reportSession(sessionStartSource) {
  const sessionRef = currentSessionRef();
  if (!sessionRef) {
    return Promise.resolve();
  }
  return sendRequest({
    id: `${source}:session:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    method: "pane.report_agent_session",
    params: {
      pane_id: paneId,
      source,
      agent: "pi",
      seq: nextReportSeq(),
      session_start_source: sessionStartSource,
      ...sessionRef
    }
  });
}
function sendState(state, message, seq = nextReportSeq()) {
  return sendRequest({
    id: `${source}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    method: "pane.report_agent",
    params: withSessionRef({
      pane_id: paneId,
      source,
      agent: "pi",
      state,
      message,
      seq
    })
  });
}
let sendInFlight = false;
let queuedState;
function queueState(state, message) {
  queuedState = { state, message, seq: nextReportSeq() };
  if (!sendInFlight) {
    void drainStateQueue();
  }
}
async function drainStateQueue() {
  if (sendInFlight) {
    return;
  }
  sendInFlight = true;
  try {
    while (queuedState) {
      const next = queuedState;
      queuedState = void 0;
      await sendState(next.state, next.message, next.seq);
    }
  } finally {
    sendInFlight = false;
    if (queuedState) {
      void drainStateQueue();
    }
  }
}
function herdr_agent_state_default(pi) {
  if (!enabled()) {
    return;
  }
  let agentActive = false;
  let blockedCount = 0;
  let blockedMessage;
  let lastState;
  let lastMessage;
  let rootSession = false;
  function desiredState() {
    if (blockedCount > 0) {
      return { state: "blocked", message: blockedMessage };
    }
    if (agentActive) {
      return { state: "working", message: void 0 };
    }
    return { state: "idle", message: void 0 };
  }
  function publishState(force = false) {
    const next = desiredState();
    if (!force && next.state === lastState && next.message === lastMessage) {
      return;
    }
    lastState = next.state;
    lastMessage = next.message;
    queueState(next.state, next.message);
  }
  pi.events.on("herdr:blocked", (data) => {
    if (!rootSession) {
      return;
    }
    if (!data?.active) {
      blockedCount = Math.max(0, blockedCount - 1);
      if (blockedCount === 0) {
        blockedMessage = void 0;
      }
      publishState();
      return;
    }
    blockedCount += 1;
    blockedMessage = data.label;
    publishState();
  });
  pi.on("session_start", async (event, ctx) => {
    if (ctx?.mode !== "tui") {
      return;
    }
    rootSession = true;
    updateSessionRef(ctx);
    await reportSession(event?.reason);
    agentActive = ctx?.isIdle?.() === false;
    publishState(true);
  });
  pi.on("agent_start", (_event, ctx) => {
    if (!rootSession) {
      return;
    }
    updateSessionRef(ctx);
    void reportSession();
    agentActive = true;
    publishState();
  });
  pi.on("agent_settled", (_event, ctx) => {
    if (!rootSession || ctx?.isIdle?.() !== true) {
      return;
    }
    agentActive = false;
    publishState();
  });
}
export {
  herdr_agent_state_default as default
};
