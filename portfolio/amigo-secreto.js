(() => {
  "use strict";

  const APP = "nollie-amigo-secreto";
  const VERSION = 1;
  const LABEL = new TextEncoder().encode("nollie-amigo-secreto-v1");
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const $ = id => document.getElementById(id);
  let myPublicCode = null;
  let participants = [];
  let sealedDraw = null;
  let privateFileData = null;
  let sharedDrawData = null;
  const supportsCrypto = Boolean(window.isSecureContext && window.crypto?.subtle);

  function encode64(bytes) {
    let binary = "";
    for (let start = 0; start < bytes.length; start += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
    }
    return btoa(binary);
  }

  function decode64(value) {
    if (typeof value !== "string" || value.length > 16000) throw Error("O arquivo contém dados inválidos.");
    const binary = atob(value);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  }

  function setError(id, message) {
    const box = $(id);
    box.textContent = message;
    box.hidden = !message;
  }

  function downloadFile(fileName, json) {
    const blob = new Blob([JSON.stringify(json, null, 2)], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  async function readJsonFile(file, maxBytes = 64_000) {
    if (!file || file.size > maxBytes) throw Error("Esse arquivo está maior que o esperado. Escolha o arquivo JSON do sorteio.");
    try {
      return JSON.parse(await file.text());
    } catch {
      throw Error("Não consegui abrir este arquivo JSON. Peça à pessoa que enviou para salvar e mandar novamente.");
    }
  }

  function randomBelow(limit) {
    const ceiling = Math.floor(0x100000000 / limit) * limit;
    const sample = new Uint32Array(1);
    let value;
    do {
      crypto.getRandomValues(sample);
      value = sample[0];
    } while (value >= ceiling);
    return value % limit;
  }

  function shuffled(list) {
    const result = [...list];
    for (let index = result.length - 1; index > 0; index--) {
      const other = randomBelow(index + 1);
      [result[index], result[other]] = [result[other], result[index]];
    }
    return result;
  }

  function makePairs(players) {
    for (let attempt = 0; attempt < 512; attempt++) {
      const draw = shuffled(players);
      if (players.every((person, index) => person.id !== draw[index].id)) return draw;
    }
    throw Error("Tente fazer o sorteio outra vez. Não encontrei uma combinação válida desta vez.");
  }

  function importStatus() {
    const error = $("draw-error");
    error.hidden = true;
    if (participants.length < 2) {
      error.textContent = "Inclua os códigos públicos de pelo menos duas pessoas.";
      error.hidden = false;
      $("draw-button").disabled = true;
      return;
    }
    $("draw-button").disabled = false;
  }

  function renderParticipants() {
    const list = $("player-list");
    list.replaceChildren();
    for (const person of participants) {
      const item = document.createElement("li");
      const mark = document.createElement("i");
      mark.setAttribute("aria-hidden", "true");
      const name = document.createElement("span");
      name.textContent = person.name;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove-person";
      remove.setAttribute("aria-label", "Remover " + person.name + " do sorteio");
      remove.title = remove.getAttribute("aria-label");
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        participants = participants.filter(entry => entry.id !== person.id);
        clearDraw();
        renderParticipants();
        importStatus();
      });
      item.append(mark, name, remove);
      list.append(item);
    }
    $("dropzone").classList.toggle("has-people", participants.length > 0);
    $("draw-button").disabled = participants.length < 2;
  }

  function clearDraw() {
    sealedDraw = null;
    $("draw-ready").hidden = true;
    $("draw-error").hidden = true;
  }

  async function validPublicCode(value) {
    if (!value || value.app !== APP || value.version !== VERSION || value.type !== "public-key" ||
      typeof value.name !== "string" || !value.name.trim() || value.name.length > 48 ||
      !/^[a-f0-9]{64}$/.test(value.id) || typeof value.publicKey !== "string") {
      throw Error("Um dos arquivos não é um código público de participante deste sorteador.");
    }
    const publicBytes = decode64(value.publicKey);
    const fingerprint = new Uint8Array(await crypto.subtle.digest("SHA-256", publicBytes));
    const expectedId = Array.from(fingerprint, byte => byte.toString(16).padStart(2, "0")).join("");
    if (expectedId !== value.id) throw Error("Este código público foi alterado. Peça à pessoa que gere um novo.");
    const publicKey = await crypto.subtle.importKey(
      "spki",
      publicBytes,
      {name: "RSA-OAEP", hash: "SHA-256"},
      false,
      ["encrypt"]
    );
    return {
      id: value.id,
      name: value.name.trim(),
      publicKey
    };
  }

  async function addPublicCode(code) {
    if (participants.length >= 80) throw Error("Este sorteador comporta até 80 pessoas.");
    const person = await validPublicCode(code);
    if (participants.some(entry => entry.id === person.id)) throw Error("Esse código já entrou na lista.");
    const sameName = person.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
    if (participants.some(entry =>
      entry.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR") === sameName
    )) throw Error("Há duas pessoas com o mesmo nome. Peça a elas um sobrenome ou apelido diferente no código público.");
    participants.push(person);
  }

  async function readPrivateFile(file) {
    const value = await readJsonFile(file);
    if (!value || value.app !== APP || value.version !== VERSION || value.type !== "private-key" ||
      typeof value.name !== "string" || !value.name.trim() || value.name.length > 48 ||
      !/^[a-f0-9]{64}$/.test(value.id) || typeof value.privateKey !== "string" ||
      typeof value.publicKey !== "string") {
      throw Error("Este arquivo não parece ser a chave privada que você preparou no sorteador.");
    }
    const publicBytes = decode64(value.publicKey);
    const fingerprint = encode64(new Uint8Array(await crypto.subtle.digest("SHA-256", publicBytes)));
    const fingerprintHex = Array.from(decode64(fingerprint), byte => byte.toString(16).padStart(2, "0")).join("");
    if (fingerprintHex !== value.id) throw Error("Esta chave pessoal está incompleta. Use a cópia original que você salvou.");
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      decode64(value.privateKey),
      {name: "RSA-OAEP", hash: "SHA-256"},
      false,
      ["decrypt"]
    );
    return {id: value.id, name: value.name.trim(), privateKey};
  }

  $("key-form").addEventListener("submit", async event => {
    event.preventDefault();
    setError("key-error", "");
    if (!supportsCrypto) {
      setError("key-error", "Abra este sorteador em um navegador atualizado com conexão segura. No site da Nollie, o cadeado ao lado do endereço confirma a conexão.");
      return;
    }
    const name = $("player-name").value.trim();
    if (!name) {
      $("player-name").focus();
      setError("key-error", "Digite seu nome antes de gerar a chave.");
      return;
    }
    if (name.length > 48) {
      setError("key-error", "Use um nome com até 48 caracteres.");
      return;
    }
    const button = event.currentTarget.querySelector("button[type=submit]");
    button.disabled = true;
    button.firstElementChild.textContent = "Criando sua chave…";
    try {
      const pair = await crypto.subtle.generateKey(
        {name: "RSA-OAEP", modulusLength: 3072, publicExponent: Uint8Array.of(1, 0, 1), hash: "SHA-256"},
        true,
        ["encrypt", "decrypt"]
      );
      const publicBytes = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
      const privateBytes = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
      const fingerprint = new Uint8Array(await crypto.subtle.digest("SHA-256", publicBytes));
      const id = Array.from(fingerprint, byte => byte.toString(16).padStart(2, "0")).join("");
      myPublicCode = {app: APP, version: VERSION, type: "public-key", name, id, publicKey: encode64(publicBytes)};
      const privateCard = {app: APP, version: VERSION, type: "private-key", name, id, publicKey: encode64(publicBytes), privateKey: encode64(privateBytes)};
      $("public-code").value = JSON.stringify(myPublicCode);
      $("key-issued").hidden = false;
      $("save-private").onclick = () => {
        downloadFile("minha-chave-amigo-secreto.json", privateCard);
        $("save-private").textContent = "✓ Chave pessoal salva";
      };
      $("download-public").onclick = () => downloadFile("codigo-publico-" + safeSlug(name) + ".json", myPublicCode);
      $("copy-public").onclick = async () => {
        try {
          await navigator.clipboard.writeText(JSON.stringify(myPublicCode));
          $("copy-public").textContent = "✓ Código copiado";
        } catch {
          $("public-code").focus();
          $("public-code").select();
          $("copy-public").textContent = "Selecione e copie o código";
        }
      };
      $("key-issued").scrollIntoView({behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "nearest"});
    } catch (error) {
      setError("key-error", "Não consegui preparar essa chave. Verifique o espaço do celular e tente outra vez.");
      console.error("Falha local ao gerar a chave:", error);
    } finally {
      button.disabled = false;
      button.firstElementChild.textContent = "Gerar chave no meu aparelho";
    }
  });

  function safeSlug(value) {
    return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 35) || "amigo-secreto";
  }

  $("public-files").addEventListener("change", async event => {
    setError("draw-error", "");
    clearDraw();
    const files = Array.from(event.currentTarget.files || []);
    event.currentTarget.value = "";
    if (files.length + participants.length > 80) {
      setError("draw-error", "Este sorteador comporta até 80 participantes em um único sorteio.");
      return;
    }
    let added = 0;
    for (const file of files) {
      try {
        const code = await readJsonFile(file, 32_000);
        await addPublicCode(code);
        added++;
      } catch (error) {
        setError("draw-error", error.message || "Não consegui ler um dos códigos.");
      }
    }
    renderParticipants();
    if (added) {
      $("draw-ready").hidden = true;
      setError("draw-error", "");
    }
    importStatus();
  });

  $("add-pasted").addEventListener("click", async () => {
    setError("draw-error", "");
    clearDraw();
    const codes = $("public-paste").value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (!codes.length) {
      setError("draw-error", "Cole um código JSON público antes de adicionar.");
      $("public-paste").focus();
      return;
    }
    if (codes.length + participants.length > 80) {
      setError("draw-error", "Este sorteador comporta até 80 participantes em um único sorteio.");
      return;
    }
    let added = 0;
    for (const line of codes) {
      try {
        if (line.length > 32_000) throw Error("Um dos códigos colados está incompleto. Peça para reenviar.");
        await addPublicCode(JSON.parse(line));
        added++;
      } catch (error) {
        setError("draw-error", error instanceof SyntaxError
          ? "Separe cada código público JSON por uma quebra de linha e cole novamente."
          : error.message || "Não consegui ler um dos códigos.");
      }
    }
    if (added) $("public-paste").value = "";
    renderParticipants();
    importStatus();
  });

  $("draw-button").addEventListener("click", async event => {
    setError("draw-error", "");
    clearDraw();
    if (participants.length < 2) {
      setError("draw-error", "Inclua ao menos duas pessoas para começar o sorteio.");
      return;
    }
    const button = event.currentTarget;
    button.disabled = true;
    button.firstElementChild.textContent = "Cifrando cada envelope…";
    try {
      const recipients = makePairs(participants);
      const title = $("draw-title").value.trim().slice(0, 64);
      const drawId = encode64(crypto.getRandomValues(new Uint8Array(18))).replace(/[+/=]/g, "").slice(0, 24);
      const envelopes = [];
      for (let index = 0; index < participants.length; index++) {
        const giver = participants[index];
        const rawSecret = crypto.getRandomValues(new Uint8Array(32));
        const aesKey = await crypto.subtle.importKey("raw", rawSecret, "AES-GCM", false, ["encrypt"]);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const message = encoder.encode(JSON.stringify({
          app: APP,
          version: VERSION,
          drawId,
          title,
          participantId: giver.id,
          participantName: giver.name,
          recipientName: recipients[index].name
        }));
        const ciphertext = await crypto.subtle.encrypt(
          {name: "AES-GCM", iv, additionalData: LABEL, tagLength: 128},
          aesKey,
          message
        );
        const wrappedSecret = await crypto.subtle.encrypt(
          {name: "RSA-OAEP", label: LABEL},
          giver.publicKey,
          rawSecret
        );
        envelopes.push({
          recipientKeyId: giver.id,
          wrappedKey: encode64(new Uint8Array(wrappedSecret)),
          iv: encode64(iv),
          encryptedMessage: encode64(new Uint8Array(ciphertext))
        });
        rawSecret.fill(0);
        message.fill(0);
      }
      sealedDraw = {
        app: APP,
        version: VERSION,
        type: "sealed-draw",
        id: drawId,
        title,
        envelopeCount: envelopes.length,
        envelopes: shuffled(envelopes)
      };
      $("draw-count").textContent = String(envelopes.length);
      $("draw-ready").hidden = false;
      $("draw-ready").scrollIntoView({behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "nearest"});
    } catch (error) {
      setError("draw-error", error.message || "O sorteio não foi finalizado. Confira os códigos e tente outra vez.");
      console.error("Falha ao gerar o sorteio:", error);
    } finally {
      button.disabled = participants.length < 2;
      button.firstElementChild.textContent = "Lacrar e sortear";
    }
  });

  $("save-draw").addEventListener("click", () => {
    if (!sealedDraw) return;
    downloadFile("amigo-secreto-" + safeSlug(sealedDraw.title || "nollie") + ".json", sealedDraw);
    $("save-draw").textContent = "✓ Arquivo do sorteio salvo";
  });

  function updateRevealButton() {
    $("open-envelope").disabled = !(privateFileData && sharedDrawData);
    $("gift-result").hidden = true;
    setError("open-error", "");
  }

  $("private-file").addEventListener("change", async event => {
    privateFileData = null;
    $("private-file-label").textContent = "Escolha o arquivo pessoal que salvou.";
    updateRevealButton();
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    try {
      privateFileData = await readPrivateFile(file);
      $("private-file-label").textContent = privateFileData.name + " · chave privada carregada";
      updateRevealButton();
    } catch (error) {
      setError("open-error", error.message || "Não consegui ler sua chave pessoal.");
      $("private-file").value = "";
    }
  });

  $("draw-file").addEventListener("change", async event => {
    sharedDrawData = null;
    $("draw-file-label").textContent = "O arquivo comum que recebeu do organizador.";
    updateRevealButton();
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    try {
      const draw = await readJsonFile(file, 8_000_000);
      if (!draw || draw.app !== APP || draw.version !== VERSION || draw.type !== "sealed-draw" ||
        !Array.isArray(draw.envelopes) || draw.envelopeCount !== draw.envelopes.length ||
        draw.envelopes.length < 2 || draw.envelopes.length > 80 ||
        draw.envelopes.some(envelope => !/^[a-f0-9]{64}$/.test(envelope.recipientKeyId))) {
        throw Error("Este arquivo não parece ser um sorteio lacrado da Nollie.");
      }
      sharedDrawData = draw;
      const title = draw.title ? " · " + draw.title : "";
      $("draw-file-label").textContent = draw.envelopeCount + " envelopes" + title;
      updateRevealButton();
    } catch (error) {
      setError("open-error", error.message || "Não consegui ler o arquivo enviado.");
      $("draw-file").value = "";
    }
  });

  $("open-envelope").addEventListener("click", async event => {
    if (!privateFileData || !sharedDrawData) return;
    setError("open-error", "");
    $("gift-result").hidden = true;
    const button = event.currentTarget;
    button.disabled = true;
    button.firstElementChild.textContent = "Abrindo seu envelope…";
    try {
      const envelope = sharedDrawData.envelopes.find(item => item.recipientKeyId === privateFileData.id);
      if (!envelope) throw Error("Esta chave não está entre os participantes deste sorteio. Confira com quem organizou.");
      const rawSecret = new Uint8Array(await crypto.subtle.decrypt(
        {name: "RSA-OAEP", label: LABEL},
        privateFileData.privateKey,
        decode64(envelope.wrappedKey)
      ));
      const aesKey = await crypto.subtle.importKey("raw", rawSecret, "AES-GCM", false, ["decrypt"]);
      rawSecret.fill(0);
      const opened = await crypto.subtle.decrypt(
        {name: "AES-GCM", iv: decode64(envelope.iv), additionalData: LABEL, tagLength: 128},
        aesKey,
        decode64(envelope.encryptedMessage)
      );
      const card = JSON.parse(decoder.decode(opened));
      if (card.app !== APP || card.version !== VERSION ||
        card.participantId !== privateFileData.id || card.participantName !== privateFileData.name ||
        typeof card.recipientName !== "string" || !card.recipientName.trim()) {
        throw Error("Esse envelope não corresponde à sua chave. Confira se escolheu a chave e o sorteio da mesma rodada.");
      }
      $("gift-name").textContent = card.recipientName;
      $("gift-draw-name").textContent = card.title || "Seu amigo secreto";
      $("gift-result").hidden = false;
      $("gift-result").scrollIntoView({behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "nearest"});
    } catch (error) {
      setError("open-error", error.name === "OperationError"
        ? "Essa não é a chave que abre esse envelope. Confira se escolheu seu arquivo pessoal e o sorteio da mesma rodada."
        : error.message || "Não consegui abrir esse envelope. Confira os arquivos e tente outra vez.");
    } finally {
      button.disabled = false;
      button.firstElementChild.textContent = "Abrir meu resultado";
    }
  });

  $("close-result").addEventListener("click", () => {
    $("gift-result").hidden = true;
    $("gift-name").textContent = "";
    $("open-envelope").focus();
  });

  if (!supportsCrypto) {
    $("key-form").setAttribute("data-secure-context", "false");
  }
})();
