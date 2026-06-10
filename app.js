const defaultGames = ["原神", "崩铁", "绝区零", "终末地", "异环", "重返未来1999", "无期迷途", "物华弥新", "鸣潮"];
const defaultLogos = {
  原神: "assets/logos/genshin.png",
  崩铁: "assets/logos/hsr.png",
  绝区零: "assets/logos/zzz.png",
  终末地: "assets/logos/endfield.png",
  异环: "assets/logos/ananta.png",
  重返未来1999: "assets/logos/reverse1999.png",
  无期迷途: "assets/logos/ptn.png",
  物华弥新: "assets/logos/wuhua.png",
  鸣潮: "assets/logos/wuwa.png",
};
const renamedGames = {
  物化: "物华弥新",
};
const storageKey = "gacha-countdown-manual-v2";
const legacyStorageKeys = ["gacha-countdown-manual-v1", "gacha-countdown-board-v3", "gacha-countdown-home-v2", "gacha-countdown-home-v1"];
const imageDbName = "gacha-countdown-images-v1";
const imageStoreName = "images";
const cloudConfigKey = "gacha-countdown-cloud-config-v1";
const gunPeers = [
  "https://relay.peer.ooo/gun",
  "https://gun-manhattan.herokuapp.com/gun",
  "https://gunjs.herokuapp.com/gun",
];
const phases = [
  { key: "current", label: "当期 UP" },
  { key: "next", label: "下期 UP" },
];

const state = loadState();
let games = state.games;
const gameSelect = document.querySelector("#gameSelect");
const gameBoard = document.querySelector("#gameBoard");
const newGameName = document.querySelector("#newGameName");
const addGameButton = document.querySelector("#addGameButton");
const todayLabel = document.querySelector("#todayLabel");
const phaseLabel = document.querySelector("#phaseLabel");
const selectedGameTitle = document.querySelector("#selectedGameTitle");
const renameGameInput = document.querySelector("#renameGameInput");
const renameGameButton = document.querySelector("#renameGameButton");
const deleteGameButton = document.querySelector("#deleteGameButton");
const logoDrop = document.querySelector("#logoDrop");
const eventTitle = document.querySelector("#eventTitle");
const mainCountdown = document.querySelector("#mainCountdown");
const dateRange = document.querySelector("#dateRange");
const heroImage = document.querySelector("#heroImage");
const poolGrid = document.querySelector("#poolGrid");
const poolTemplate = document.querySelector("#poolTemplate");
const roomId = document.querySelector("#roomId");
const shareLink = document.querySelector("#shareLink");
const createRoomButton = document.querySelector("#createRoomButton");
const connectCloudButton = document.querySelector("#connectCloudButton");
const pushCloudButton = document.querySelector("#pushCloudButton");
const copyShareButton = document.querySelector("#copyShareButton");
const exportDataButton = document.querySelector("#exportDataButton");
const importDataButton = document.querySelector("#importDataButton");
const importDataFile = document.querySelector("#importDataFile");
const cloudStatus = document.querySelector("#cloudStatus");
const autoSourceUrl = document.querySelector("#autoSourceUrl");
const tempArticleUrl = document.querySelector("#tempArticleUrl");
const checkUpdateButton = document.querySelector("#checkUpdateButton");
const saveSourceButton = document.querySelector("#saveSourceButton");
const autoUpdateStatus = document.querySelector("#autoUpdateStatus");
const pendingPanel = document.querySelector("#pendingPanel");

let imageDbPromise;
let imageDbAvailable = true;
let cloudConnected = false;
let cloudPushTimer = null;
let applyingRemoteState = false;
let cloudConfig = { roomId: "" };
let gun = null;
let gunNode = null;
let lastCloudUpdatedAt = "";
let cloudListenRoom = "";

games.forEach((game) => {
  const option = document.createElement("option");
  option.value = game;
  option.textContent = game;
  gameSelect.appendChild(option);
});

gameSelect.value = state.game || games[0];
gameSelect.addEventListener("change", () => {
  state.game = gameSelect.value;
  saveAndRender();
});
addGameButton.addEventListener("click", addGame);
newGameName.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addGame();
});
renameGameButton.addEventListener("click", renameCurrentGame);
deleteGameButton.addEventListener("click", deleteCurrentGame);
createRoomButton.addEventListener("click", createSharedRoom);
connectCloudButton.addEventListener("click", connectCloudFromInputs);
pushCloudButton.addEventListener("click", () => pushCloudState("手动上传完成"));
copyShareButton.addEventListener("click", copyShareUrl);
exportDataButton?.addEventListener("click", exportMigrationPack);
importDataButton?.addEventListener("click", () => importDataFile?.click());
importDataFile?.addEventListener("change", importMigrationPack);
saveSourceButton.addEventListener("click", saveAutoSource);
checkUpdateButton.addEventListener("click", checkCurrentGameUpdates);

document.addEventListener("paste", handlePaste);
loadCloudConfig();
initImages()
  .catch(() => {
    state.imageStorageLimited = true;
  })
  .finally(() => {
    render();
    autoConnectCloud();
    setTimeout(checkAllSavedSources, 1200);
  });
setInterval(() => {
  promoteAllGames();
  render();
}, 60000);
setInterval(checkAllSavedSources, 6 * 60 * 60 * 1000);

function openImageDb() {
  if (!window.indexedDB) {
    imageDbAvailable = false;
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  if (imageDbPromise) return imageDbPromise;
  imageDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(imageDbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(imageStoreName);
    request.onsuccess = () => {
      imageDbAvailable = true;
      resolve(request.result);
    };
    request.onerror = () => {
      imageDbAvailable = false;
      reject(request.error);
    };
    request.onblocked = () => {
      imageDbAvailable = false;
      reject(new Error("IndexedDB blocked"));
    };
  });
  return imageDbPromise;
}

async function imageDbSet(key, value) {
  const db = await openImageDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(imageStoreName, "readwrite");
    tx.objectStore(imageStoreName).put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function imageDbGet(key) {
  const db = await openImageDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(imageStoreName, "readonly");
    const request = tx.objectStore(imageStoreName).get(key);
    request.onsuccess = () => resolve(request.result || "");
    request.onerror = () => reject(request.error);
  });
}

async function imageDbDelete(key) {
  const db = await openImageDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(imageStoreName, "readwrite");
    tx.objectStore(imageStoreName).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function initImages() {
  await openImageDb();
  const migrations = [];
  games.forEach((game) => {
    const data = state.byGame[game];
    phases.forEach(({ key }) => {
      const pool = data[key];
      if (pool.image && pool.image.startsWith("data:")) {
        const imageKey = makeImageKey(game, key);
        migrations.push(
          imageDbSet(imageKey, pool.image).then(() => {
            pool.imageKey = imageKey;
            pool.image = "";
          }),
        );
      }
    });
    if (state.logos[game] && state.logos[game].startsWith("data:")) {
      const logoKey = makeLogoKey(game);
      migrations.push(
        imageDbSet(logoKey, state.logos[game]).then(() => {
          state.logos[game] = logoKey;
        }),
      );
    }
  });
  await Promise.all(migrations);
  if (migrations.length) saveStateOnly();
}

function loadState() {
  const loaded = [storageKey, ...legacyStorageKeys]
    .map((key) => readSavedState(key))
    .filter(Boolean)
    .map(normalizeState);
  if (!loaded.length) return normalizeState({});

  const merged = loaded.slice(1).reduce((result, legacy) => mergeState(result, legacy), loaded[0]);
  if (loaded.length > 1) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(createStorageSnapshot(merged)));
    } catch {}
  }
  return merged;
}

function cleanupLegacyStorage() {
  legacyStorageKeys.forEach((key) => {
    try {
      localStorage.removeItem(key);
    } catch {}
  });
}

function readSavedState(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function mergeState(current, legacy) {
  const merged = normalizeState(current);
  merged.games.forEach((game) => {
    phases.forEach(({ key }) => {
      const target = merged.byGame[game][key];
      const source = legacy.byGame?.[game]?.[key];
      if (!source) return;
      if (!isPoolWorthKeeping(target) && isPoolWorthKeeping(source)) {
        merged.byGame[game][key] = { ...target, ...source };
        return;
      }
      if (!target.name && source.name) target.name = source.name;
      if (!target.image && source.image) target.image = source.image;
      if (!target.imageKey && source.imageKey) target.imageKey = source.imageKey;
      if (!target.startText && source.startText) target.startText = source.startText;
      if (!target.endText && source.endText) target.endText = source.endText;
      if (!target.rangeText && source.rangeText) target.rangeText = source.rangeText;
    });
    if (!merged.logos[game] && legacy.logos?.[game]) merged.logos[game] = legacy.logos[game];
  });
  if (!merged.game && legacy.game) merged.game = legacy.game;
  return normalizeState(merged);
}

function isPoolWorthKeeping(pool) {
  return Boolean(pool && (pool.name || pool.image || pool.imageKey));
}

function normalizeState(input) {
  const incomingByGame = { ...(input.byGame || {}) };
  Object.entries(renamedGames).forEach(([oldName, newName]) => {
    if (incomingByGame[oldName] && !incomingByGame[newName]) incomingByGame[newName] = incomingByGame[oldName];
  });
  const incomingLogos = { ...(input.logos || {}) };
  Object.entries(renamedGames).forEach(([oldName, newName]) => {
    if (incomingLogos[oldName] && !incomingLogos[newName]) incomingLogos[newName] = incomingLogos[oldName];
  });
  const inputGames = Array.isArray(input.games) && input.games.length ? input.games : defaultGames;
  const normalizedGames = [...new Set(inputGames.map((game) => renamedGames[game] || game).filter(Boolean))];
  Object.keys(incomingByGame).forEach((game) => {
    const name = renamedGames[game] || game;
    if (!normalizedGames.includes(name) && isKnownPoolGroup(incomingByGame[game])) normalizedGames.push(name);
  });

  const nextState = {
    game: renamedGames[input.game] || (input.game && normalizedGames.includes(input.game) ? input.game : normalizedGames[0]),
    games: normalizedGames,
    byGame: incomingByGame,
    logos: incomingLogos,
    autoUpdate: input.autoUpdate || {},
    pendingUpdates: input.pendingUpdates || {},
    ignoredUpdates: input.ignoredUpdates || {},
  };
  nextState.games.forEach((game) => {
    if (!nextState.byGame[game]) nextState.byGame[game] = createGameData();
    if (!nextState.pendingUpdates[game]) nextState.pendingUpdates[game] = [];
    if (!nextState.ignoredUpdates[game]) nextState.ignoredUpdates[game] = [];
    if (!nextState.autoUpdate[game]) nextState.autoUpdate[game] = { sourceUrl: "", tempUrl: "", lastChecked: "", status: "" };
    phases.forEach(({ key }) => {
      nextState.byGame[game][key] = {
        ...createPool(key),
        ...(nextState.byGame[game][key] || {}),
      };
      nextState.byGame[game][key].rangeText =
        nextState.byGame[game][key].rangeText || formatRangeText(nextState.byGame[game][key]);
      nextState.byGame[game][key].startText =
        nextState.byGame[game][key].startText || formatInputDate(nextState.byGame[game][key].start);
      nextState.byGame[game][key].endText =
        nextState.byGame[game][key].endText || formatInputDate(nextState.byGame[game][key].end);
    });
  });
  return nextState;
}

function isKnownPoolGroup(value) {
  return value && typeof value === "object" && (value.current || value.next);
}

function createGameData() {
  return {
    current: createPool("current"),
    next: createPool("next"),
  };
}

function createPool(phase) {
  const now = new Date();
  const start = new Date(now);
  if (phase === "next") start.setDate(start.getDate() + 21);
  const end = new Date(now);
  end.setDate(now.getDate() + (phase === "current" ? 21 : 42));
  return {
    phase,
    name: "",
    start: toDateParts(start),
    end: toDateParts(end),
    rangeText: "",
    startText: "",
    endText: "",
    image: "",
    imageKey: "",
  };
}

function saveAndRender() {
  promoteAllGames();
  persistState();
  render();
}

function saveStateOnly() {
  persistState();
}

function persistState() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(createStorageSnapshot()));
    cleanupLegacyStorage();
    scheduleCloudPush();
  } catch (error) {
    try {
      cleanupLegacyStorage();
      localStorage.setItem(storageKey, JSON.stringify(createStorageSnapshot(state, true)));
      scheduleCloudPush();
      return;
    } catch {}
    alert("保存失败：浏览器本地存储空间不足。请先刷新页面一次，再点“上传本机数据”。");
    throw error;
  }
}

function createStorageSnapshot(source = state, stripInlineImages = false) {
  const snapshot = JSON.parse(JSON.stringify(source));
  snapshot.games.forEach((game) => {
    phases.forEach(({ key }) => {
      const pool = snapshot.byGame[game]?.[key];
      if (!pool) return;
      if (pool.imageKey || stripInlineImages) pool.image = "";
    });
    if (stripInlineImages && snapshot.logos[game]?.startsWith("data:")) snapshot.logos[game] = "";
  });
  return snapshot;
}
function loadCloudConfig() {
  try {
    cloudConfig = { ...cloudConfig, ...(JSON.parse(localStorage.getItem(cloudConfigKey)) || {}) };
  } catch {}
  const urlRoom = new URLSearchParams(window.location.search).get("room");
  if (urlRoom) cloudConfig.roomId = urlRoom;
  roomId.value = cloudConfig.roomId || "";
  shareLink.value = cloudConfig.roomId ? buildShareUrl(cloudConfig.roomId) : "";
}

function saveCloudConfig() {
  cloudConfig = { roomId: roomId.value.trim() };
  localStorage.setItem(cloudConfigKey, JSON.stringify(cloudConfig));
  shareLink.value = cloudConfig.roomId ? buildShareUrl(cloudConfig.roomId) : "";
}

function autoConnectCloud() {
  if (cloudConfig.roomId) connectCloud();
}

function connectCloudFromInputs() {
  saveCloudConfig();
  connectCloud();
}

async function connectCloud() {
  if (!cloudConfig.roomId) {
    setCloudStatus("请先创建共享房间，或粘贴房间 ID。");
    return;
  }
  if (!window.Gun) {
    setCloudStatus("同步脚本没有加载成功。请刷新页面，或检查网络后再试。");
    return;
  }
  cloudConnected = true;
  if (!gun) gun = window.Gun({ peers: gunPeers });
  gunNode = gun.get("gacha-countdown").get(cloudConfig.roomId);

  if (cloudListenRoom !== cloudConfig.roomId) {
    cloudListenRoom = cloudConfig.roomId;
    gunNode.get("state").on((remote) => {
      if (!remote || !remote.payload || applyingRemoteState) return;
      if (remote.updatedAt && remote.updatedAt === lastCloudUpdatedAt) return;
      lastCloudUpdatedAt = remote.updatedAt || "";
      try {
        applyRemoteState(JSON.parse(remote.payload));
      } catch (error) {
        setCloudStatus("云端数据读取失败，请让对方重新上传一次。");
      }
    });
  }

  setCloudStatus(`已连接共享房间：${cloudConfig.roomId}`);
}

async function pullCloudState() {
  if (!cloudConnected) await connectCloud();
  setCloudStatus("已连接。云端有更新时会自动拉取。");
}

async function pushCloudState(message = "已同步") {
  if (!cloudConnected || !cloudConfig.roomId || applyingRemoteState) return;
  if (!gunNode) {
    await connectCloud();
    if (!gunNode) return;
  }
  try {
    const snapshot = createCloudSyncSnapshot();
    const updatedAt = new Date().toISOString();
    lastCloudUpdatedAt = updatedAt;
    gunNode.get("state").put(
      {
        payload: JSON.stringify(snapshot),
        updatedAt,
      },
      (ack) => {
        if (ack?.err) {
          setCloudStatus("同步失败：公共同步节点暂时不可用，稍后再试。");
          return;
        }
        setCloudStatus(message);
      },
    );
  } catch (error) {
    setCloudStatus(`同步失败：${error.message || "图片可能太大，请稍后再试"}`);
  }
}

function scheduleCloudPush() {
  if (!cloudConnected || applyingRemoteState) return;
  clearTimeout(cloudPushTimer);
  cloudPushTimer = setTimeout(() => pushCloudState("已自动同步"), 900);
}

async function createSharedRoom() {
  try {
    setCloudStatus("正在创建共享房间...");
    const id = `gacha-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    roomId.value = id;
    saveCloudConfig();
    shareLink.value = buildShareUrl(id);
    await connectCloud();
    await pushCloudState("共享房间已创建，复制链接发给朋友即可。");
  } catch (error) {
    setCloudStatus(`创建失败：${error.message || "公共同步节点暂时不可用"}`);
  }
}
function copyShareUrl() {
  const value = shareLink.value;
  if (!value) return;
  navigator.clipboard?.writeText(value);
  setCloudStatus("分享链接已复制。");
}


function buildShareUrl(id) {
  const base = window.location.href.split("?")[0];
  return `${base}?room=${encodeURIComponent(id)}`;
}

async function createCloudSnapshot() {
  const snapshot = JSON.parse(JSON.stringify(state));
  for (const game of snapshot.games) {
    for (const { key } of phases) {
      const pool = snapshot.byGame[game]?.[key];
      if (pool?.imageKey && !pool.image) pool.image = await imageDbGet(pool.imageKey).catch(() => "");
    }
    const logo = snapshot.logos[game];
    if (logo && !logo.startsWith("data:") && !logo.startsWith("assets/")) snapshot.logos[game] = await imageDbGet(logo).catch(() => logo);
  }
  return snapshot;
}

function createCloudSyncSnapshot() {
  const snapshot = createStorageSnapshot();
  snapshot.games.forEach((game) => {
    phases.forEach(({ key }) => {
      const pool = snapshot.byGame[game]?.[key];
      if (!pool) return;
      pool.image = "";
      pool.imageKey = "";
    });
    const logo = snapshot.logos[game];
    if (logo && !logo.startsWith("assets/")) snapshot.logos[game] = defaultLogos[game] || "";
  });
  return snapshot;
}

async function exportMigrationPack() {
  try {
    setCloudStatus("正在打包迁移包...");
    const data = await createCloudSnapshot();
    const pack = {
      type: "gacha-countdown-migration",
      version: 1,
      exportedAt: new Date().toISOString(),
      data,
    };
    const blob = new Blob([JSON.stringify(pack)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `gacha-countdown-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setCloudStatus("迁移包已下载。到在线版点“导入迁移包”即可。");
  } catch (error) {
    setCloudStatus(`导出失败：${error.message || "图片读取失败"}`);
  }
}

function importMigrationPack(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const data = parsed?.data || parsed;
      if (!data?.byGame || !Array.isArray(data.games)) throw new Error("文件不是卡池迁移包");
      applyRemoteState(data);
      setCloudStatus("迁移包已导入，图片正在写入本机。");
    } catch (error) {
      setCloudStatus(`导入失败：${error.message || "文件读取失败"}`);
    } finally {
      event.target.value = "";
    }
  };
  reader.onerror = () => {
    setCloudStatus("导入失败：文件读取失败。");
    event.target.value = "";
  };
  reader.readAsText(file);
}

function applyRemoteState(remoteData) {
  applyingRemoteState = true;
  const selected = state.game;
  const normalized = normalizeState(remoteData);
  Object.keys(state).forEach((key) => delete state[key]);
  Object.assign(state, normalized);
  if (state.games.includes(selected)) state.game = selected;
  games = state.games;
  persistState();
  initImages()
    .catch(() => {})
    .finally(() => {
      applyingRemoteState = false;
      render();
      setCloudStatus(`已接收云端更新 ${formatDate(new Date())}`);
    });
}

function setCloudStatus(message) {
  cloudStatus.textContent = message;
}

function renderCloudPanel() {
  const config = state.autoUpdate[state.game] || { sourceUrl: "", tempUrl: "", lastChecked: "", status: "" };
  autoSourceUrl.value = config.sourceUrl || "";
  tempArticleUrl.value = config.tempUrl || "";
  const checked = config.lastChecked ? ` 最近检查：${formatDate(new Date(config.lastChecked))}` : "";
  autoUpdateStatus.textContent = `${config.status || "尚未检查。"}${checked}`;
}

function promoteAllGames() {
  games.forEach((game) => promoteGame(game));
}

function promoteGame(game) {
  const data = state.byGame[game];
  const current = data.current;
  const next = data.next;
  const now = Date.now();
  const nextStart = partsToDate(next.start).getTime();

  if (isFilled(next) && nextStart <= now) {
    data.current = { ...next, phase: "current" };
    data.next = createPool("next");
  } else if (!isFilled(current) && isFilled(next)) {
    data.current = { ...next, phase: "current" };
    data.next = createPool("next");
  }
}

function isFilled(pool) {
  return Boolean(pool.name || pool.image || pool.imageKey);
}

function addGame() {
  const name = newGameName.value.trim();
  if (!name || state.games.includes(name)) return;
  state.games.push(name);
  state.byGame[name] = createGameData();
  state.logos[name] = state.logos[name] || "";
  state.autoUpdate[name] = { sourceUrl: "", tempUrl: "", lastChecked: "", status: "" };
  state.pendingUpdates[name] = [];
  state.ignoredUpdates[name] = [];
  state.game = name;
  newGameName.value = "";
  saveAndRender();
  pushCloudState("新增游戏已同步");
}

function renameCurrentGame() {
  const oldName = state.game;
  const newName = renameGameInput.value.trim();
  if (!newName || newName === oldName || state.games.includes(newName)) return;
  state.games = state.games.map((game) => (game === oldName ? newName : game));
  state.byGame[newName] = state.byGame[oldName] || createGameData();
  delete state.byGame[oldName];
  if (state.logos[oldName]) state.logos[newName] = state.logos[oldName];
  delete state.logos[oldName];
  state.autoUpdate[newName] = state.autoUpdate[oldName] || { sourceUrl: "", tempUrl: "", lastChecked: "", status: "" };
  delete state.autoUpdate[oldName];
  state.pendingUpdates[newName] = state.pendingUpdates[oldName] || [];
  delete state.pendingUpdates[oldName];
  state.ignoredUpdates[newName] = state.ignoredUpdates[oldName] || [];
  delete state.ignoredUpdates[oldName];
  state.game = newName;
  saveAndRender();
  pushCloudState("游戏改名已同步");
}

function deleteCurrentGame() {
  if (state.games.length <= 1) return;
  const name = state.game;
  if (!confirm(`确定删除「${name}」吗？这个游戏的卡池和图片引用也会从看板移除。`)) return;
  state.games = state.games.filter((game) => game !== name);
  delete state.byGame[name];
  delete state.logos[name];
  delete state.autoUpdate[name];
  delete state.pendingUpdates[name];
  delete state.ignoredUpdates[name];
  state.game = state.games[0];
  saveAndRender();
  pushCloudState("删除游戏已同步");
}

function render() {
  syncGamesFromState();
  renderGameOptions();
  gameSelect.value = state.game;
  todayLabel.textContent = `系统时间 ${formatDate(new Date())}`;
  renderGameBoard();
  renderDetail();
}

function syncGamesFromState() {
  games = state.games;
  if (!games.includes(state.game)) state.game = games[0];
}

function renderGameOptions() {
  const current = gameSelect.value || state.game;
  gameSelect.innerHTML = "";
  games.forEach((game) => {
    const option = document.createElement("option");
    option.value = game;
    option.textContent = game;
    gameSelect.appendChild(option);
  });
  gameSelect.value = games.includes(current) ? current : state.game;
}

function renderGameBoard() {
  gameBoard.innerHTML = getSortedGames()
    .map((game) => {
      const data = state.byGame[game];
      const pool = getMainPool(game);
      const filled = isFilled(pool);
      const logo = getGameLogo(game);
      const subtitle = getBoardSubtitle(data);
      return `
        <button class="game-card ${game === state.game ? "active" : ""} ${
          filled && endsInThreeDays(pool) ? "soon" : ""
        }" data-game="${escapeHtml(game)}" type="button">
          <span class="game-mark" data-logo-game="${escapeHtml(game)}">${renderLogoMarkup(game, logo)}</span>
          <span>
            <strong>${escapeHtml(game)}</strong>
            <p>${escapeHtml(subtitle)}</p>
          </span>
          <span class="game-days">${filled ? formatCountdown(pool) : "--"}</span>
        </button>
      `;
    })
    .join("");

  hydrateGameLogos();

  gameBoard.querySelectorAll(".game-card").forEach((button) => {
    button.addEventListener("click", () => {
      state.game = button.dataset.game;
      saveAndRender();
    });
  });
}

function getSortedGames() {
  return games
    .map((game, index) => {
      const pool = getMainPool(game);
      return {
        game,
        index,
        sortDays: isFilled(pool) ? getCountdownDays(pool) : Number.POSITIVE_INFINITY,
      };
    })
    .sort((a, b) => a.sortDays - b.sortDays || a.index - b.index)
    .map((item) => item.game);
}

function getBoardSubtitle(data) {
  const currentName = isFilled(data.current) ? data.current.name || "未命名卡池" : "";
  const nextName = isFilled(data.next) ? data.next.name || "未命名卡池" : "";
  if (currentName && nextName) return `${currentName} → ${nextName}`;
  if (currentName) return currentName;
  if (nextName) return `待开启 → ${nextName}`;
  return "未录入";
}

function renderDetail() {
  const game = state.game;
  const data = state.byGame[game];
  const mainPool = getMainPool(game);
  const mainFilled = isFilled(mainPool);

  selectedGameTitle.textContent = game;
  renameGameInput.value = game;
  renderLogoDrop();
  renderCloudPanel();
  phaseLabel.textContent = mainFilled ? (mainPool.phase === "current" ? "当期 UP" : "下期 UP") : "当前游戏";
  eventTitle.textContent = mainFilled ? mainPool.name || "未命名卡池" : "等待卡池信息";
  mainCountdown.textContent = mainFilled ? formatCountdown(mainPool) : "--";
  mainCountdown.classList.toggle("danger", mainFilled && endsInThreeDays(mainPool));
  dateRange.textContent = mainFilled
    ? `${formatDate(partsToDate(mainPool.start))} - ${formatDate(partsToDate(mainPool.end))}`
    : "填写当期或下期 UP 后自动计算倒计时。";
  heroImage.dataset.slot = mainPool.phase;
  renderImage(heroImage, mainPool, "点击后直接粘贴图片");

  poolGrid.innerHTML = "";
  renderPendingUpdates();
  phases.forEach(({ key, label }) => poolGrid.appendChild(createPoolCard(key, label, data[key])));
}

function saveAutoSource() {
  const config = state.autoUpdate[state.game];
  config.sourceUrl = autoSourceUrl.value.trim();
  config.tempUrl = tempArticleUrl.value.trim();
  config.status = "来源已保存。";
  saveAndRender();
}

async function checkCurrentGameUpdates() {
  saveAutoSource();
  await checkGameUpdates(state.game, true);
}

async function checkAllSavedSources() {
  for (const game of state.games) {
    const url = state.autoUpdate[game]?.sourceUrl;
    if (url) await checkGameUpdates(game, false);
  }
}

async function checkGameUpdates(game, includeTemp) {
  const config = state.autoUpdate[game];
  const urls = [includeTemp ? config.tempUrl : "", config.sourceUrl].filter(Boolean);
  if (!urls.length) {
    config.status = "没有可检查的链接。";
    saveAndRender();
    return;
  }

  config.status = "正在检查...";
  config.lastChecked = new Date().toISOString();
  if (game === state.game) renderCloudPanel();

  let foundCount = 0;
  for (const url of urls) {
    try {
      const raw = await fetchArticleText(url);
      const candidates = parseUpdateCandidates(raw, url);
      candidates.forEach((candidate) => {
        if (addPendingUpdate(game, candidate)) foundCount += 1;
      });
    } catch (error) {
      config.status = `检查失败：${error.message || "链接读取失败"}`;
    }
  }

  config.status = foundCount ? `发现 ${foundCount} 条待确认更新。` : config.status === "正在检查..." ? "没有发现新的可确认更新。" : config.status;
  saveAndRender();
}

async function fetchArticleText(url) {
  const clean = url.replace(/^https?:\/\//, "");
  const candidates = [url, `https://r.jina.ai/http://${clean}`, `https://r.jina.ai/http://https://${clean}`];
  let lastError = new Error("读取失败");
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate);
      if (!response.ok) throw new Error(`返回 ${response.status}`);
      const text = await response.text();
      if (text.trim().length < 80) throw new Error("内容太短");
      return text;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function parseUpdateCandidates(raw, sourceUrl) {
  const text = cleanArticleText(raw);
  const range = parseRangeText(text);
  if (!range) return [];
  const images = extractArticleImages(raw);
  return [
    {
      id: stableUpdateId(sourceUrl, range.start, range.end),
      name: inferUpdateName(text),
      start: toDateParts(range.start),
      end: toDateParts(range.end),
      startText: formatInputDate(toDateParts(range.start)),
      endText: formatInputDate(toDateParts(range.end)),
      rangeText: `${formatDate(range.start)} - ${formatDate(range.end)}`,
      image: images[0] || "",
      sourceUrl,
      createdAt: new Date().toISOString(),
    },
  ];
}

function addPendingUpdate(game, candidate) {
  const ignored = state.ignoredUpdates[game] || [];
  const pending = state.pendingUpdates[game] || [];
  if (ignored.includes(candidate.id) || pending.some((item) => item.id === candidate.id)) return false;
  state.pendingUpdates[game] = [candidate, ...pending].slice(0, 8);
  return true;
}

function renderPendingUpdates() {
  const pending = state.pendingUpdates[state.game] || [];
  if (!pending.length) {
    pendingPanel.innerHTML = "";
    return;
  }
  pendingPanel.innerHTML = pending
    .map(
      (item) => `
        <article class="pending-card" data-update-id="${escapeHtml(item.id)}">
          ${item.image ? `<img src="${escapeHtml(item.image)}" alt="候选卡池图" />` : ""}
          <div>
            <p class="kicker">待确认更新</p>
            <h3>${escapeHtml(item.name || "未命名卡池")}</h3>
            <p>${escapeHtml(item.rangeText)}</p>
            <p>${escapeHtml(item.sourceUrl)}</p>
          </div>
          <div class="pending-actions">
            <button data-apply="current" type="button">应用到当期</button>
            <button data-apply="next" type="button">应用到下期</button>
            <button class="ghost-button" data-ignore="true" type="button">忽略</button>
          </div>
        </article>
      `,
    )
    .join("");

  pendingPanel.querySelectorAll("[data-apply]").forEach((button) => {
    button.addEventListener("click", () => applyPendingUpdate(button.closest(".pending-card").dataset.updateId, button.dataset.apply));
  });
  pendingPanel.querySelectorAll("[data-ignore]").forEach((button) => {
    button.addEventListener("click", () => ignorePendingUpdate(button.closest(".pending-card").dataset.updateId));
  });
}

function applyPendingUpdate(id, phase) {
  const pending = state.pendingUpdates[state.game] || [];
  const item = pending.find((candidate) => candidate.id === id);
  if (!item) return;
  const pool = state.byGame[state.game][phase];
  pool.name = item.name || pool.name;
  pool.start = item.start;
  pool.end = item.end;
  pool.startText = item.startText;
  pool.endText = item.endText;
  pool.rangeText = item.rangeText;
  if (item.image) {
    pool.image = item.image;
    pool.imageKey = "";
  }
  state.pendingUpdates[state.game] = pending.filter((candidate) => candidate.id !== id);
  saveAndRender();
}

function ignorePendingUpdate(id) {
  state.pendingUpdates[state.game] = (state.pendingUpdates[state.game] || []).filter((candidate) => candidate.id !== id);
  state.ignoredUpdates[state.game] = [...(state.ignoredUpdates[state.game] || []), id].slice(-80);
  saveAndRender();
}

function cleanArticleText(raw) {
  return String(raw || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function inferUpdateName(text) {
  const quoted = [...text.matchAll(/[「『《【“]([^」』》】”]{2,24})[」』》】”]/g)].map((match) => match[1]);
  return quoted.at(-1) || "自动识别卡池";
}

function extractArticleImages(raw) {
  const urls = new Set();
  const patterns = [
    /<img[^>]+(?:data-src|src)=["']([^"']+)["']/gi,
    /!\[[^\]]*]\((https?:\/\/[^)]+)\)/g,
    /(?:cdn_url|msg_cdn_url|cover|url)["']?\s*[:=]\s*["'](https?:\\?\/\\?\/[^"'\\]+)["']/gi,
  ];
  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(raw))) {
      const url = match[1].replace(/\\\//g, "/").replace(/^\/\//, "https://");
      if (/^https?:\/\//.test(url) && !/\.(svg|gif)$/i.test(url)) urls.add(url);
    }
  });
  return [...urls].slice(0, 6);
}

function stableUpdateId(sourceUrl, start, end) {
  return `${sourceUrl}|${start.getTime()}|${end.getTime()}`;
}

function createPoolCard(phase, label, pool) {
  const node = poolTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.phase = phase;
  node.querySelector('[data-role="phase"]').textContent = label;
  node.querySelector('[data-role="title"]').textContent = pool.name || "未命名卡池";

  const imageButton = node.querySelector('[data-role="image"]');
  imageButton.dataset.slot = phase;
  renderImage(imageButton, pool, `点击后 Ctrl+V 粘贴${label}图片`);

  const nameInput = node.querySelector('[data-field="name"]');
  nameInput.value = pool.name || "";
  nameInput.addEventListener("input", () => {
    pool.name = nameInput.value;
    saveStateOnly();
    node.querySelector('[data-role="title"]').textContent = pool.name || "未命名卡池";
  });

  const startInput = node.querySelector('[data-field="startText"]');
  const endInput = node.querySelector('[data-field="endText"]');
  const rangePreview = node.querySelector('[data-role="rangePreview"]');
  startInput.value = pool.startText || "";
  endInput.value = pool.endText || "";
  rangePreview.textContent = formatRangeText(pool);
  bindTimeInput(startInput, pool, "start");
  bindTimeInput(endInput, pool, "end");

  node.querySelector('[data-action="clear"]').addEventListener("click", () => {
    if (state.byGame[state.game][phase].imageKey) imageDbDelete(state.byGame[state.game][phase].imageKey);
    state.byGame[state.game][phase] = createPool(phase);
    saveAndRender();
  });

  return node;
}

function bindTimeInput(input, pool, key) {
  input.addEventListener("input", () => {
    pool[`${key}Text`] = input.value;
    saveStateOnly();
  });
  input.addEventListener("change", () => commitSingleTime(pool, key, input.value));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      input.blur();
    }
  });
}

function commitSingleTime(pool, key, value) {
  pool[`${key}Text`] = value.trim();
  const parsed = parseSingleTimeText(value, key === "end");
  if (!parsed) {
    saveStateOnly();
    return;
  }

  pool[key] = toDateParts(parsed);
  const start = partsToDate(pool.start);
  const end = partsToDate(pool.end);
  if (end < start) end.setFullYear(end.getFullYear() + 1);
  pool.end = toDateParts(end);
  pool.rangeText = formatRangeText(pool);
  saveAndRender();
}

function applyRangeText(pool, value) {
  pool.rangeText = value.trim();
  const parsed = parseRangeText(pool.rangeText);
  if (!parsed) return;
  pool.start = toDateParts(parsed.start);
  pool.end = toDateParts(parsed.end);
  pool.rangeText = formatRangeText(pool);
}

function parseRangeText(value) {
  const normalized = normalizeRangeInput(value);
  const natural = parseNaturalRange(normalized);
  if (natural) return natural;

  const match = normalized.match(/(.+?)\s*-\s*(.+)/);
  if (!match) return null;
  const fallbackYear = new Date().getFullYear();
  const start = parseDatePhrase(match[1], fallbackYear);
  const end = parseDatePhrase(match[2], start ? start.getFullYear() : fallbackYear, true);
  if (!start || !end) return null;
  if (end < start) end.setFullYear(end.getFullYear() + 1);
  return { start, end };
}

function parseSingleTimeText(value, defaultEndOfDay = false) {
  const normalized = normalizeRangeInput(value);
  return parseDatePhrase(normalized, new Date().getFullYear(), defaultEndOfDay);
}

function normalizeRangeInput(value) {
  return String(value || "")
    .replace(/[（(]\s*[^）)]*服务器时间\s*[）)]/g, "")
    .replace(/\s*(至|到)\s*/g, " - ")
    .replace(/[－﹣−–—~～]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNaturalRange(value) {
  const pieces = [...value.matchAll(/(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日?([^，。,；;]*)/g)].map((match) => ({
    year: match[1],
    month: match[2],
    day: match[3],
    tail: match[4] || "",
    index: match.index,
  }));
  if (pieces.length < 2) return null;

  const startPiece =
    pieces.find((piece) => /开启|开始|上线|开放|启动/.test(piece.tail) || /开启|开始|上线|开放|启动/.test(value.slice(piece.index, piece.index + 40))) ||
    pieces[0];
  const endPiece =
    pieces.find((piece) => piece !== startPiece && (/结束|截止|关闭|下架/.test(piece.tail) || /结束|截止|关闭|下架/.test(value.slice(piece.index, piece.index + 40)))) ||
    pieces.find((piece) => piece !== startPiece) ||
    pieces[1];

  const fallbackYear = Number(startPiece.year || new Date().getFullYear());
  const start = dateFromNaturalPiece(startPiece, fallbackYear, false);
  const end = dateFromNaturalPiece(endPiece, start.getFullYear(), true);
  if (end < start) end.setFullYear(end.getFullYear() + 1);
  return { start, end };
}

function dateFromNaturalPiece(piece, fallbackYear, defaultEndOfDay) {
  const time = parseChineseTime(piece.tail, defaultEndOfDay);
  return new Date(Number(piece.year || fallbackYear), Number(piece.month) - 1, Number(piece.day), time.hour, time.minute);
}

function parseChineseTime(text, defaultEndOfDay) {
  const compact = String(text || "").replace(/\s+/g, "");
  const colon = compact.match(/(上午|早上|中午|下午|晚上|晚间|凌晨)?(\d{1,2})[:：](\d{1,2})/);
  if (colon) return normalizeHour(colon[2], colon[3], colon[1]);

  const chinese = compact.match(/(上午|早上|中午|下午|晚上|晚间|凌晨)?(\d{1,2})点(?:半|(\d{1,2})分?)?/);
  if (chinese) return normalizeHour(chinese[2], chinese[3] || (compact.includes("半") ? 30 : 0), chinese[1]);

  return { hour: defaultEndOfDay ? 23 : 0, minute: defaultEndOfDay ? 59 : 0 };
}

function normalizeHour(hourValue, minuteValue, period = "") {
  let hour = Number(hourValue);
  const minute = Number(minuteValue || 0);
  if (/下午|晚上|晚间/.test(period) && hour < 12) hour += 12;
  if (/中午/.test(period) && hour < 11) hour += 12;
  if (/凌晨/.test(period) && hour === 12) hour = 0;
  return { hour, minute };
}

function parseDatePhrase(phrase, fallbackYear, defaultEndOfDay = false) {
  const clean = String(phrase || "").replace(/\s+/g, "").replace(/：/g, ":");
  const match = clean.match(/(?:(20\d{2})[年./-])?(\d{1,2})(?:月|[./-])(\d{1,2})日?(.*)?/);
  if (!match) return null;
  const time = parseChineseTime(match[4] || "", defaultEndOfDay);
  return new Date(
    Number(match[1] || fallbackYear),
    Number(match[2]) - 1,
    Number(match[3]),
    time.hour,
    time.minute,
  );
}

function getMainPool(game) {
  const data = state.byGame[game];
  if (isActive(data.current) || isFilled(data.current)) return data.current;
  if (isFilled(data.next)) return data.next;
  return data.current;
}

function isActive(pool) {
  const now = Date.now();
  return partsToDate(pool.start).getTime() <= now && now <= partsToDate(pool.end).getTime();
}

function handlePaste(event) {
  const target = event.target.closest?.(".paste-target");
  if (!target) return;

  const imageItem = [...event.clipboardData.items].find((item) => item.type.startsWith("image/"));
  if (!imageItem) return;

  const file = imageItem.getAsFile();
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      if (target.dataset.logo) {
        const logoKey = makeLogoKey(state.game);
        await imageDbSet(logoKey, reader.result);
        state.logos[state.game] = logoKey;
        saveAndRender();
        return;
      }
      const slot = target.dataset.slot || "current";
      const imageKey = makeImageKey(state.game, slot);
      await imageDbSet(imageKey, reader.result);
      state.byGame[state.game][slot].imageKey = imageKey;
      state.byGame[state.game][slot].image = "";
      saveAndRender();
    } catch {
      alert("图片存储暂时不可用。请用 http://127.0.0.1:8787 打开页面，或刷新后再试。");
    }
  };
  reader.readAsDataURL(file);
  event.preventDefault();
}

function renderImage(target, pool, fallback) {
  const key = pool.imageKey;
  const inlineImage = pool.image;
  if (!key && !inlineImage) {
    target.innerHTML = `<span>${escapeHtml(fallback)}</span>`;
    return;
  }
  if (inlineImage) {
    target.innerHTML = `<img src="${escapeHtml(inlineImage)}" alt="卡池图片" />`;
    return;
  }
  target.innerHTML = "<span>图片加载中</span>";
  imageDbGet(key)
    .then((image) => {
      target.innerHTML = image ? `<img src="${escapeHtml(image)}" alt="卡池图片" />` : `<span>${escapeHtml(fallback)}</span>`;
    })
    .catch(() => {
      target.innerHTML = `<span>${escapeHtml(fallback)}</span>`;
    });
}

function renderLogoDrop() {
  const logo = getGameLogo(state.game);
  if (!logo) {
    logoDrop.innerHTML = "<span>粘贴 Logo</span>";
    return;
  }
  if (logo.startsWith("data:") || logo.startsWith("assets/")) {
    logoDrop.innerHTML = `<img src="${escapeHtml(logo)}" alt="${escapeHtml(state.game)} Logo" onerror="this.replaceWith(document.createTextNode('Logo'))" />`;
    return;
  }
  logoDrop.innerHTML = "<span>Logo</span>";
  imageDbGet(logo)
    .then((image) => {
      logoDrop.innerHTML = image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(state.game)} Logo" />` : "<span>粘贴 Logo</span>";
    })
    .catch(() => {
      logoDrop.innerHTML = "<span>粘贴 Logo</span>";
    });
}

function getGameLogo(game) {
  return state.logos[game] || defaultLogos[game] || "";
}

function renderLogoMarkup(game, logo) {
  if (!logo) return escapeHtml(game.slice(0, 1));
  if (logo.startsWith("data:") || logo.startsWith("assets/")) {
    return `<img src="${escapeHtml(logo)}" alt="${escapeHtml(game)}" onerror="this.replaceWith(document.createTextNode('${escapeHtml(game.slice(0, 1))}'))" />`;
  }
  return escapeHtml(game.slice(0, 1));
}

function hydrateGameLogos() {
  gameBoard.querySelectorAll("[data-logo-game]").forEach((node) => {
    const game = node.dataset.logoGame;
    const logo = getGameLogo(game);
    if (!logo || logo.startsWith("data:") || logo.startsWith("assets/")) return;
    imageDbGet(logo)
      .then((image) => {
        if (image) node.innerHTML = `<img src="${escapeHtml(image)}" alt="${escapeHtml(game)}" />`;
      })
      .catch(() => {});
  });
}

function makeImageKey(game, phase) {
  return `pool:${game}:${phase}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function makeLogoKey(game) {
  return `logo:${game}`;
}

function formatCountdown(pool) {
  const days = getCountdownDays(pool);
  if (days > 0) return `${days}天`;
  if (days === 0) return "今天";
  return "已结束";
}

function getCountdownDays(pool) {
  const now = Date.now();
  const start = partsToDate(pool.start).getTime();
  const end = partsToDate(pool.end).getTime();
  const target = now < start ? start : end;
  return Math.ceil((target - now) / 86400000);
}

function endsInThreeDays(pool) {
  const days = Math.ceil((partsToDate(pool.end).getTime() - Date.now()) / 86400000);
  return days >= 0 && days <= 3;
}

function toDateParts(date) {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
  };
}

function partsToDate(parts) {
  return new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function formatDate(date) {
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRangeText(pool) {
  return `${formatDate(partsToDate(pool.start))} - ${formatDate(partsToDate(pool.end))}`;
}

function formatInputDate(parts) {
  const date = partsToDate(parts);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
