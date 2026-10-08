(() => {
  const homeScreen = document.querySelector("#home-screen");
  const roomScreen = document.querySelector("#room-screen");
  const joinForm = document.querySelector("#join-form");
  const joinError = document.querySelector("#join-error");
  const roomInput = document.querySelector("#room-link");
  const nameInput = document.querySelector("#display-name");
  const passwordInput = document.querySelector("#room-password");
  const participantCount = document.querySelector("#participant-count");
  const screenGrid = document.querySelector("#screen-grid");
  const emptyState = document.querySelector("#empty-state");
  const chatMessages = document.querySelector("#chat-messages");
  const chatForm = document.querySelector("#chat-form");
  const chatInput = document.querySelector("#chat-input");
  const startButtons = [document.querySelector("#start-share"), document.querySelector("#start-share-empty")];
  const stopButton = document.querySelector("#stop-share");
  const includeAudio = document.querySelector("#include-audio");
  const shareStatus = document.querySelector("#share-status");

  const members = new Map();
  const connections = new Map();
  const calls = new Map();
  let peer = null;
  let roomId = "";
  let displayName = "";
  let roomPassword = "";
  let localStream = null;
  let isHost = false;

  function getRoomId(value) {
    const input = value.trim();
    if (!input) return "";
    try {
      const url = new URL(input);
      return decodeURIComponent(url.hash.slice(1));
    } catch {
      return input.replace(/^#/, "").replace(/^\/+|\/+$/g, "");
    }
  }

  function hostPeerId(id) {
    return `telalivre-${id}`;
  }

  function showError(message) {
    joinError.textContent = message;
    joinError.hidden = false;
  }

  function setBusy(busy) {
    joinForm.querySelector('button[type="submit"]').disabled = busy;
    document.querySelector("#create-room").disabled = busy;
  }

  function updateParticipantCount(count = members.size || 1) {
    participantCount.textContent = `${count} ${count === 1 ? "pessoa" : "pessoas"}`;
  }

  function updateRoomAddress(id) {
    const url = new URL(location.href);
    url.hash = id;
    history.replaceState(null, "", url);
    roomInput.value = url.href;
  }

  function showRoom(id) {
    roomId = id;
    homeScreen.hidden = true;
    roomScreen.hidden = false;
    document.querySelector("#room-name").textContent = `Sala ${id}`;
    document.querySelector("#room-code-label").textContent = `Código: ${id}`;
    updateRoomAddress(id);
    chatInput.focus();
  }

  function addChatMessage(name, text, time = new Date().toISOString()) {
    chatMessages.querySelector(".chat-welcome")?.remove();
    const message = document.createElement("div");
    message.className = "message";
    const meta = document.createElement("div");
    meta.className = "message-meta";
    const author = document.createElement("strong");
    author.textContent = name;
    const timestamp = document.createElement("time");
    timestamp.textContent = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(time));
    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    bubble.textContent = text;
    meta.append(author, timestamp);
    message.append(meta, bubble);
    chatMessages.append(message);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function announceParticipant(name) {
    addChatMessage("Sala", `${name} entrou na sala`);
  }

  function syncScreenView() {
    const hasScreens = screenGrid.childElementCount > 0;
    screenGrid.hidden = !hasScreens;
    emptyState.hidden = hasScreens;
    document.querySelector(".live-indicator").classList.toggle("active", Boolean(localStream));
    shareStatus.textContent = localStream ? "Sua tela está sendo compartilhada" : "Você está na sala";
  }

  function makeTile(id, name, stream, isLocal) {
    screenGrid.querySelector(`[data-peer-id="${CSS.escape(id)}"]`)?.remove();
    const tile = document.createElement("article");
    tile.className = "screen-tile";
    tile.dataset.peerId = id;
    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.muted = isLocal;
    video.srcObject = stream;
    const caption = document.createElement("div");
    caption.className = "tile-caption";
    const person = document.createElement("span");
    person.textContent = isLocal ? `${name} (você)` : name;
    const kind = document.createElement("span");
    kind.textContent = "Compartilhando a tela";
    caption.append(person, kind);
    tile.append(video, caption);
    screenGrid.append(tile);
    syncScreenView();
  }

  function addMember(member) {
    if (!member?.id || member.id === peer?.id || members.has(member.id)) return;
    members.set(member.id, { id: member.id, name: member.name || "Participante" });
    updateParticipantCount();
    announceParticipant(member.name || "Participante");
    if (localStream) callPeer(member.id, member.name);
  }

  function removeMember(id, notify = true) {
    const member = members.get(id);
    if (!member) return;
    members.delete(id);
    const connection = connections.get(id);
    if (connection) {
      connection.close();
      connections.delete(id);
    }
    closeCall(id);
    updateParticipantCount();
    if (notify) addChatMessage("Sala", `${member.name} saiu da sala`);
  }

  function sendToRoom(message) {
    for (const [id, connection] of connections) {
      if (connection.open) connection.send(message);
      else if (id !== peer?.id) removeMember(id, false);
    }
  }

  function handleHostMessage(connection, message) {
    if (!message || typeof message !== "object") return;
    if (message.type === "join") {
      if (members.size >= 6) {
        connection.send({ type: "room-error", text: "Esta sala já atingiu o limite de 6 pessoas." });
        window.setTimeout(() => connection.close(), 500);
        return;
      }
      if ((message.password || "") !== roomPassword) {
        connection.send({ type: "room-error", text: "Senha incorreta para esta sala." });
        window.setTimeout(() => connection.close(), 500);
        return;
      }

      const member = { id: connection.peer, name: message.name || "Participante" };
      connections.set(member.id, connection);
      members.set(member.id, member);
      const sendRoster = () => {
        if (connection.open) {
          connection.send({ type: "roster", members: [...members.values()] });
          connection.send({ type: "participant-count", count: members.size });
        }
      };
      sendRoster();
      window.setTimeout(sendRoster, 300);
      for (const [id, otherConnection] of connections) {
        if (id !== member.id && otherConnection.open) {
          otherConnection.send({ type: "participant-joined", member });
          otherConnection.send({ type: "participant-count", count: members.size });
        }
      }
      updateParticipantCount();
      announceParticipant(member.name);
      if (localStream) callPeer(member.id, member.name);
      return;
    }

    if (message.type === "chat" && typeof message.text === "string") {
      const text = message.text.trim().slice(0, 1000);
      if (!text) return;
      addChatMessage(members.get(connection.peer)?.name || "Participante", text, message.time);
      for (const [id, otherConnection] of connections) {
        if (id !== connection.peer && otherConnection.open) {
          otherConnection.send({ ...message, name: members.get(connection.peer)?.name || "Participante", text });
        }
        return;
      }

      if (message.type === "leave") {
        connection.close();
      }
    }
  }

  function handleMemberMessage(message) {
    if (!message || typeof message !== "object") return;
    if (message.type === "roster" && Array.isArray(message.members)) {
      members.clear();
      for (const member of message.members) {
        if (member.id !== peer.id) members.set(member.id, member);
      }
      updateParticipantCount();
      for (const member of members.values()) {
        if (member.id !== hostPeerId(roomId) && localStream) callPeer(member.id, member.name);
      }
      return;
    }
    if (message.type === "participant-joined") {
      addMember(message.member);
      return;
    }
    if (message.type === "participant-left") {
      removeMember(message.id);
      return;
    }
    if (message.type === "participant-count" && Number.isInteger(message.count)) {
      updateParticipantCount(message.count);
      return;
    }
    if (message.type === "chat" && typeof message.text === "string") {
      addChatMessage(message.name || "Participante", message.text, message.time);
      return;
    }
    if (message.type === "room-error") {
      showError(message.text || "Não foi possível entrar na sala.");
      resetRoom();
    }
  }

  function handleConnection(connection) {
    connection.on("data", (message) => {
      if (isHost) handleHostMessage(connection, message);
      else handleMemberMessage(message);
    });
    connection.on("close", () => {
      if (isHost) {
        const member = members.get(connection.peer);
        if (member) {
          members.delete(connection.peer);
          connections.delete(connection.peer);
          closeCall(connection.peer);
          updateParticipantCount();
          sendToRoom({ type: "participant-left", id: connection.peer });
          addChatMessage("Sala", `${member.name} saiu da sala`);
        }
      } else if (connection.peer === hostPeerId(roomId) && roomId) {
        shareStatus.textContent = "A pessoa que criou a sala se desconectou.";
      }
    });
  }

  function createPeer(options = {}) {
    if (typeof Peer !== "function") {
      throw new Error("Não foi possível carregar a conexão PeerJS. Verifique sua internet e recarregue a página.");
    }
    peer = new Peer(options.id, { debug: 1 });
    peer.on("connection", (connection) => {
      if (isHost) {
        handleConnection(connection);
      } else {
        connection.close();
      }
    });
    peer.on("call", (call) => {
      call.answer();
      watchCall(call, call.metadata?.name || members.get(call.peer)?.name || "Participante");
    });
    peer.on("error", (error) => {
      const message = error.type === "peer-unavailable"
        ? "Não encontramos essa sala. Confira o link ou peça para a pessoa anfitriã criar a sala novamente."
        : error.type === "unavailable-id"
          ? "O código desta sala já está em uso. Crie outra sala e envie o novo link."
          : `Falha na conexão: ${error.message || error.type}.`;
      shareStatus.textContent = message;
      if (homeScreen.hidden && !members.size) {
        showError(message);
        resetRoom();
      } else if (!homeScreen.hidden) {
        setBusy(false);
        showError(message);
        peer?.destroy();
        peer = null;
      }
    });
    peer.on("disconnected", () => {
      if (roomId) shareStatus.textContent = "Reconectando ao serviço de conexão...";
    });
    return peer;
  }

  function connectToHost(id, password) {
    displayName = nameInput.value.trim();
    roomPassword = password;
    isHost = false;
    setBusy(true);
    joinError.hidden = true;
    try {
      const newPeer = createPeer();
      newPeer.on("open", () => {
        const connection = newPeer.connect(hostPeerId(id), {
          reliable: true,
        });
        connections.set(hostPeerId(id), connection);
        handleConnection(connection);
        connection.on("open", () => {
          connection.send({ type: "join", name: displayName, password: roomPassword });
        });
      });
      showRoom(id);
    } catch (error) {
      setBusy(false);
      showError(error.message);
    }
  }

  function createRoom() {
    displayName = nameInput.value.trim();
    if (!displayName) {
      nameInput.focus();
      nameInput.setCustomValidity("Digite seu nome antes de criar uma sala.");
      nameInput.reportValidity();
      nameInput.addEventListener("input", () => nameInput.setCustomValidity(""), { once: true });
      return;
    }
    const id = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
    roomPassword = passwordInput.value;
    isHost = true;
    members.clear();
    connections.clear();
    setBusy(true);
    joinError.hidden = true;
    try {
      const newPeer = createPeer({ id: hostPeerId(id) });
      newPeer.on("open", () => {
        members.set(newPeer.id, { id: newPeer.id, name: displayName });
        updateParticipantCount();
        setBusy(false);
        showRoom(id);
      });
    } catch (error) {
      setBusy(false);
      showError(error.message);
    }
  }

  function callPeer(peerId, name) {
    if (!localStream || !peer || calls.has(peerId)) return;
    const call = peer.call(peerId, localStream, { metadata: { name: displayName } });
    if (call) watchCall(call, name || members.get(peerId)?.name || "Participante");
  }

  function watchCall(call, name) {
    calls.set(call.peer, call);
    call.on("stream", (stream) => makeTile(call.peer, name, stream, false));
    call.on("close", () => {
      if (calls.get(call.peer) === call) {
        calls.delete(call.peer);
        screenGrid.querySelector(`[data-peer-id="${CSS.escape(call.peer)}"]`)?.remove();
        syncScreenView();
      }
    });
    call.on("error", (error) => {
      console.error("Erro ao conectar o vídeo:", error);
      if (calls.get(call.peer) === call) calls.delete(call.peer);
    });
  }

  function closeCall(id) {
    const call = calls.get(id);
    if (!call) return;
    calls.delete(id);
    call.close();
    screenGrid.querySelector(`[data-peer-id="${CSS.escape(id)}"]`)?.remove();
    syncScreenView();
  }

  async function startSharing() {
    if (localStream || !roomId) return;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      shareStatus.textContent = "Use uma versão recente do Chrome, Edge ou Firefox para compartilhar.";
      return;
    }
    startButtons.forEach((button) => { button.disabled = true; });
    try {
      localStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 30 } },
        audio: includeAudio.checked,
      });
      const videoTrack = localStream.getVideoTracks()[0];
      if (!videoTrack) throw new Error("Nenhuma tela foi selecionada.");
      videoTrack.addEventListener("ended", stopSharing, { once: true });
      makeTile(peer.id, displayName, localStream, true);
      startButtons.forEach((button) => { button.hidden = true; });
      stopButton.hidden = false;
      syncScreenView();
      for (const [id, member] of members) {
        if (id !== peer.id) callPeer(id, member.name);
      }
      if (includeAudio.checked && !localStream.getAudioTracks().length) {
        shareStatus.textContent = "Tela compartilhada (este navegador não forneceu áudio)";
      }
    } catch (error) {
      localStream?.getTracks().forEach((track) => track.stop());
      localStream = null;
      if (error.name !== "NotAllowedError" && error.name !== "AbortError") {
        shareStatus.textContent = error.message || "Não foi possível iniciar o compartilhamento.";
      }
    } finally {
      startButtons.forEach((button) => { button.disabled = false; });
    }
  }

  async function stopSharing() {
    if (!localStream) return;
    const stream = localStream;
    localStream = null;
    stream.getTracks().forEach((track) => track.stop());
    for (const call of calls.values()) call.close();
    calls.clear();
    screenGrid.querySelector(`[data-peer-id="${CSS.escape(peer?.id || "")}"]`)?.remove();
    startButtons.forEach((button) => { button.hidden = false; });
    stopButton.hidden = true;
    syncScreenView();
  }

  function resetRoom() {
    if (localStream) {
      const stream = localStream;
      localStream = null;
      stream.getTracks().forEach((track) => track.stop());
    }
    for (const call of calls.values()) call.close();
    for (const connection of connections.values()) connection.close();
    calls.clear();
    connections.clear();
    members.clear();
    peer?.destroy();
    peer = null;
    roomId = "";
    isHost = false;
    screenGrid.replaceChildren();
    syncScreenView();
    startButtons.forEach((button) => { button.hidden = false; });
    stopButton.hidden = true;
    roomScreen.hidden = true;
    homeScreen.hidden = false;
    setBusy(false);
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    passwordInput.value = "";
  }

  function leaveRoom() {
    if (!roomId) return;
    if (isHost) {
      sendToRoom({ type: "room-error", text: "A pessoa que criou a sala encerrou a sessão." });
      window.setTimeout(resetRoom, 300);
      return;
    } else {
      connections.get(hostPeerId(roomId))?.send({ type: "leave" });
    }
    resetRoom();
  }

  joinForm.addEventListener("submit", (event) => {
    event.preventDefault();
    displayName = nameInput.value.trim();
    const id = getRoomId(roomInput.value);
    if (!/^[a-zA-Z0-9-]{4,48}$/.test(id)) {
      showError("Digite um link de convite ou código de sala válido.");
      return;
    }
    connectToHost(id, passwordInput.value);
  });

  document.querySelector("#create-room").addEventListener("click", createRoom);
  startButtons.forEach((button) => button.addEventListener("click", startSharing));
  stopButton.addEventListener("click", stopSharing);
  document.querySelector("#leave-room").addEventListener("click", leaveRoom);
  document.querySelector("#leave-room-bottom").addEventListener("click", leaveRoom);
  document.querySelector("#copy-link").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    try {
      await navigator.clipboard.writeText(location.href);
      button.innerHTML = "<span aria-hidden=\"true\">✓</span> Link copiado";
      window.setTimeout(() => { button.innerHTML = "<span aria-hidden=\"true\">▣</span> Copiar convite"; }, 1800);
    } catch {
      window.prompt("Copie o link da sala:", location.href);
    }
  });

  chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = chatInput.value.trim().slice(0, 1000);
    if (!text || !roomId) return;
    const message = { type: "chat", text, time: new Date().toISOString() };
    if (isHost) {
      addChatMessage(displayName, text, message.time);
      sendToRoom({ ...message, name: displayName });
    } else {
      addChatMessage(displayName, text, message.time);
      connections.get(hostPeerId(roomId))?.send(message);
    }
    chatInput.value = "";
    chatInput.focus();
  });

  const linkedRoom = getRoomId(location.href);
  if (linkedRoom && /^[a-zA-Z0-9-]{4,48}$/.test(linkedRoom)) {
    roomInput.value = location.href;
  }
})();
