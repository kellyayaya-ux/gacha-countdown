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
const supabaseUrl = "https://scayfogjajkyruiyyzku.supabase.co";
const supabaseKey = "sb_publishable_sYTOwlEQ1WufVHZ46E6txw_8gTV9tuz";
const supabaseImageBucket = "gacha-images";
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
let supabaseClient = null;
let lastCloudUpdatedAt = "";
let cloudPullTimer = null;

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
      getPhasePools(data, key).forEach((pool, index) => {
      if (pool.image && pool.image.startsWith("data:")) {
        const imageKey = makeImageKey(game, `${key}:${index}`);
        migrations.push(
          imageDbSet(imageKey, pool.image).then(() => {
            pool.imageKey = imageKey;
            pool.image = "";
          }),
        );
      }
      });
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
    if (!Array.isArray(nextState.byGame[game].currentExtra)) nextState.byGame[game].currentExtra = [];
    if (!Array.isArray(nextState.byGame[game].nextExtra)) nextState.byGame[game].nextExtra = [];
    phases.forEach(({ key }) => {
      nextState.byGame[game][key] = {
        ...createPool(key),
        ...(nextState.byGame[game][key] || {}),
      };
      normalizePool(nextState.byGame[game][key], key);
    });
    nextState.byGame[game].currentExtra = nextState.byGame[game].currentExtra.map((pool) => normalizePool({ ...createPool("current"), ...pool }, "current"));
    nextState.byGame[game].nextExtra = nextState.byGame[game].nextExtra.map((pool) => normalizePool({ ...createPool("next"), ...pool }, "next"));
    phases.forEach(({ key }) => {
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

function normalizePool(pool, phase) {
  pool.phase = phase;
  pool.startTbd = Boolean(pool.startTbd);
  pool.endTbd = Boolean(pool.endTbd);
  return pool;
}

function isKnownPoolGroup(value) {
  return value && typeof value === "object" && (value.current || value.next);
}

function createGameData() {
  return {
    current: createPool("current"),
    next: createPool("next"),
    currentExtra: [],
    nextExtra: [],
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
    startTbd: false,
    endTbd: false,
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
      getPhasePools(snapshot.byGame[game], key).forEach((pool) => {
      if (!pool) return;
      if (pool.imageKey || stripInlineImages) pool.image = "";
      });
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
  if (urlRoom) {
    cloudConfig.roomId = urlRoom;
    localStorage.setItem(cloudConfigKey, JSON.stringify(cloudConfig));
  } else if (cloudConfig.roomId) {
    ensureRoomUrl(cloudConfig.roomId);
  }
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

function getSupabaseClient() {
  if (!window.supabase?.createClient) throw new Error("Supabase 脚本没有加载成功，请刷新页面。");
  if (!supabaseClient) supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);
  return supabaseClient;
}

async function connectCloud() {
  if (!cloudConfig.roomId) {
    setCloudStatus("请先创建共享房间，或粘贴房间 ID。");
    return;
  }
  try {
    const client = getSupabaseClient();
    cloudConnected = true;
    setCloudStatus("正在连接云端房间...");
    const { data, error } = await client.from("gacha_rooms").select("data, updated_at").eq("id", cloudConfig.roomId).maybeSingle();
    if (error) throw error;
    if (isValidRemoteState(data?.data)) {
      lastCloudUpdatedAt = data.updated_at || "";
      applyRemoteState(data.data);    } else {
      setCloudStatus("这是一个空看板。整理好本机数据后，再点上传本机数据。");
    }
    clearInterval(cloudPullTimer);
    cloudPullTimer = setInterval(pullCloudState, 5000);
    setCloudStatus(`已连接共享房间：${cloudConfig.roomId}`);
  } catch (error) {
    cloudConnected = false;
    setCloudStatus(`连接失败：${error.message || "请确认 Supabase 初始化 SQL 已运行"}`);
  }
}

async function pullCloudState() {
  if (!cloudConnected || !cloudConfig.roomId || applyingRemoteState) return;
  try {
    const client = getSupabaseClient();
    const { data, error } = await client.from("gacha_rooms").select("data, updated_at").eq("id", cloudConfig.roomId).maybeSingle();
    if (error) throw error;
    if (!isValidRemoteState(data?.data) || data.updated_at === lastCloudUpdatedAt) return;
    lastCloudUpdatedAt = data.updated_at || "";
    applyRemoteState(data.data);
  } catch (error) {
    setCloudStatus(`拉取失败：${error.message || "云端暂时不可用"}`);
  }
}

async function pushCloudState(message = "已同步") {
  if (!cloudConnected || !cloudConfig.roomId || applyingRemoteState) return;
  try {
    const client = getSupabaseClient();
    setCloudStatus("正在上传到云端...");
    const snapshot = await createSupabaseSnapshot();
    const updatedAt = new Date().toISOString();
    const { error } = await client.from("gacha_rooms").upsert({
      id: cloudConfig.roomId,
      data: snapshot,
      updated_at: updatedAt,
    });
    if (error) throw error;
    lastCloudUpdatedAt = updatedAt;
    setCloudStatus(`${message}：图片、文字和时间已保存到云端。`);
  } catch (error) {
    setCloudStatus(`同步失败：${error.message || "请确认 Supabase 初始化 SQL 已运行"}`);
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
    ensureRoomUrl(id);
    const client = getSupabaseClient();
    const { error } = await client.from("gacha_rooms").upsert({
      id,
      data: {},
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    cloudConnected = true;
    clearInterval(cloudPullTimer);
    cloudPullTimer = setInterval(pullCloudState, 5000);
    setCloudStatus("共享房间已创建。整理好卡池后，再点“上传本机数据”。");
  } catch (error) {
    cloudConnected = false;
    setCloudStatus(`创建失败：${error.message || "请确认 Supabase 初始化 SQL 已运行"}`);
  }
}
function copyShareUrl() {
  const value = shareLink.value;
  if (!value) return;
  navigator.clipboard?.writeText(value);
  setCloudStatus("分享链接已复制。");
}

function isValidRemoteState(data) {
  return Boolean(data && Array.isArray(data.games) && data.games.length && data.byGame);
}

function ensureRoomUrl(id) {
  const target = buildShareUrl(id);
  if (window.location.href !== target) window.history.replaceState({}, "", target);
}
function buildShareUrl(id) {
  const base = window.location.href.split("?")[0];
  return `${base}?room=${encodeURIComponent(id)}`;
}

async function createCloudSnapshot() {
  const snapshot = JSON.parse(JSON.stringify(state));
  for (const game of snapshot.games) {
    for (const { key } of phases) {
      for (const pool of getPhasePools(snapshot.byGame[game], key)) {
        if (pool?.imageKey && !pool.image) pool.image = await imageDbGet(pool.imageKey).catch(() => "");
      }
    }
    const logo = snapshot.logos[game];
    if (logo && !logo.startsWith("data:") && !logo.startsWith("assets/")) snapshot.logos[game] = await imageDbGet(logo).catch(() => logo);
  }
  return snapshot;
}

async function createSupabaseSnapshot() {
  const snapshot = JSON.parse(JSON.stringify(state));
  for (const game of snapshot.games) {
    for (const { key } of phases) {
      const pools = getPhasePools(snapshot.byGame[game], key);
      for (const [index, pool] of pools.entries()) {
        if (!pool) continue;
        let image = pool.image || "";
        if (!image && pool.imageKey) image = await imageDbGet(pool.imageKey).catch(() => "");
        if (image?.startsWith("data:")) image = await uploadCloudImage(image, imagePathPrefix(game, `${key}-${index}`));
        pool.image = image || "";
        pool.imageKey = "";
      }
    }
    let logo = snapshot.logos[game] || "";
    if (logo && !logo.startsWith("data:") && !logo.startsWith("assets/") && !isRemoteImage(logo)) {
      logo = await imageDbGet(logo).catch(() => logo);
    }
    if (logo?.startsWith("data:")) logo = await uploadCloudImage(logo, imagePathPrefix(game, "logo"));
    snapshot.logos[game] = logo;
  }
  return snapshot;
}

async function uploadCloudImage(dataUrl, pathPrefix) {
  const client = getSupabaseClient();
  const blob = dataUrlToBlob(dataUrl);
  const extension = blob.type.includes("jpeg") ? "jpg" : blob.type.includes("webp") ? "webp" : "png";
  const safePrefix = String(pathPrefix).replace(/[^a-z0-9/_-]/gi, "-");
  const path = `${cloudConfig.roomId}/${safePrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
  const { error } = await client.storage.from(supabaseImageBucket).upload(path, blob, {
    cacheControl: "31536000",
    upsert: true,
    contentType: blob.type || "image/png",
  });
  if (error) throw error;
  const { data } = client.storage.from(supabaseImageBucket).getPublicUrl(path);
  return data.publicUrl;
}

function imagePathPrefix(game, slot) {
  const gameIndex = Math.max(0, state.games.indexOf(game));
  return `game-${gameIndex}/${slot}`;
}

function dataUrlToBlob(dataUrl) {
  const [header, body] = dataUrl.split(",");
  const mime = header.match(/data:([^;]+)/)?.[1] || "image/png";
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

function isRemoteImage(value) {
  return /^https?:\/\//.test(value || "");
}

function createCloudSyncSnapshot() {
  const snapshot = createStorageSnapshot();
  snapshot.games.forEach((game) => {
    phases.forEach(({ key }) => {
      getPhasePools(snapshot.byGame[game], key).forEach((pool) => {
        if (!pool) return;
        pool.image = "";
        pool.imageKey = "";
      });
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
  if (!isValidRemoteState(remoteData)) {
    setCloudStatus("云端房间还是空的，没有覆盖本机数据。");
    return;
  }
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
  const nextPools = getPhasePools(data, "next");
  const promotable = nextPools.filter((pool) => isFilled(pool) && !pool.startTbd && partsToDate(pool.start).getTime() <= Date.now());
  if (!promotable.length && (isFilled(data.current) || !nextPools.some(isFilled))) return;
  if (!promotable.length && !isFilled(data.current) && nextPools.some(isFilled)) promotable.push(...nextPools.filter(isFilled));
  if (!promotable.length) return;
  data.current = { ...promotable[0], phase: "current" };
  data.currentExtra = promotable.slice(1).map((pool) => ({ ...pool, phase: "current" }));
  data.next = createPool("next");
  data.nextExtra = [];
}

function getPhasePools(data, phase) {
  const base = data?.[phase] ? [data[phase]] : [];
  const extra = Array.isArray(data?.[`${phase}Extra`]) ? data[`${phase}Extra`] : [];
  return [...base, ...extra];
}

function getPoolRef(game, phase, index) {
  const data = state.byGame[game];
  if (Number(index) === 0) return data[phase];
  const list = data[`${phase}Extra`];
  return list[Number(index) - 1];
}

function isFilled(pool) {
  return Boolean(pool?.name || pool?.image || pool?.imageKey);
}

function addGame() {
  const name = newGameName.value.trim();
  if (!name || state.games.includes(name)) return;
  state.games.push(name);
  state.byGame[name] = createGameData();
  state.logos[name] = "";
  state.autoUpdate[name] = { sourceUrl: "", tempUrl: "", lastChecked: "", status: "" };
  state.pendingUpdates[name] = [];
  state.ignoredUpdates[name] = [];
  state.game = name;
  newGameName.value = "";
  saveAndRender();
}

function renameCurrentGame() {
  const oldName = state.game;
  const newName = renameGameInput.value.trim();
  if (!newName || newName === oldName || state.games.includes(newName)) return;
  state.games = state.games.map((game) => (game === oldName ? newName : game));
  state.byGame[newName] = state.byGame[oldName];
  delete state.byGame[oldName];
  state.logos[newName] = state.logos[oldName] || "";
  delete state.logos[oldName];
  state.autoUpdate[newName] = state.autoUpdate[oldName] || { sourceUrl: "", tempUrl: "", lastChecked: "", status: "" };
  delete state.autoUpdate[oldName];
  state.pendingUpdates[newName] = state.pendingUpdates[oldName] || [];
  delete state.pendingUpdates[oldName];
  state.ignoredUpdates[newName] = state.ignoredUpdates[oldName] || [];
  delete state.ignoredUpdates[oldName];
  state.game = newName;
  saveAndRender();
}

function deleteCurrentGame() {
  if (state.games.length <= 1) return;
  const name = state.game;
  if (!confirm(`确定删除“${name}”吗？`)) return;
  state.games = state.games.filter((game) => game !== name);
  delete state.byGame[name];
  delete state.logos[name];
  delete state.autoUpdate[name];
  delete state.pendingUpdates[name];
  delete state.ignoredUpdates[name];
  state.game = state.games[0];
  saveAndRender();
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
      const countdownPool = getCountdownTargetPool(game);
      const filled = isFilled(countdownPool);
      const logo = getGameLogo(game);
      const subtitle = getBoardSubtitle(data);
      return `
        <button class="game-card ${game === state.game ? "active" : ""} ${
          filled && endsInThreeDays(countdownPool) ? "soon" : ""
        }" data-game="${escapeHtml(game)}" type="button">
          <span class="game-mark" data-logo-game="${escapeHtml(game)}">${renderLogoMarkup(game, logo)}</span>
          <span>
            <strong>${escapeHtml(game)}</strong>
            <p>${escapeHtml(subtitle)}</p>
          </span>
          <span class="game-days">${filled ? formatCountdown(countdownPool) : "--"}</span>
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
      const pool = getCountdownTargetPool(game);
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
  const currentName = getPoolNames(getPhasePools(data, "current"));
  const nextName = getPoolNames(getPhasePools(data, "next"));
  if (currentName && nextName) return `${currentName} → ${nextName}`;
  if (currentName) return currentName;
  if (nextName) return `待开启 → ${nextName}`;
  return "未录入";
}

function getPoolNames(pools) {
  return pools
    .filter(isFilled)
    .map((pool) => pool.name || "未命名卡池")
    .join(" / ");
}

function renderDetail() {
  const game = state.game;
  const data = state.byGame[game];
  const mainPool = getMainPool(game);
  const countdownPool = getCountdownTargetPool(game);
  const mainFilled = isFilled(mainPool);
  selectedGameTitle.textContent = game;
  renameGameInput.value = game;
  renderLogoDrop();
  renderCloudPanel();
  phaseLabel.textContent = mainFilled ? (mainPool.phase === "current" ? "当期 UP" : "下期 UP") : "当前游戏";
  eventTitle.textContent = mainFilled ? mainPool.name || "未命名卡池" : "等待卡池信息";
  mainCountdown.textContent = isFilled(countdownPool) ? formatCountdown(countdownPool) : "--";
  mainCountdown.classList.toggle("danger", isFilled(countdownPool) && endsInThreeDays(countdownPool));
  dateRange.textContent = mainFilled ? formatRangeText(mainPool) : "填写当期或下期 UP 后自动计算倒计时。";
  heroImage.dataset.phase = mainPool.phase || "current";
  heroImage.dataset.poolIndex = "0";
  renderImage(heroImage, mainPool, "点击后直接粘贴图片");
  poolGrid.innerHTML = "";
  renderPendingUpdates();
  phases.forEach(({ key, label }) => {
    const pools = getPhasePools(data, key);
    const group = document.createElement("section");
    group.className = "pool-phase-group";
    group.innerHTML = `<div class="pool-phase-title"><h3>${label}</h3><button class="ghost-button" data-add-pool="${key}" type="button">新增卡池</button></div>`;
    pools.forEach((pool, index) => group.appendChild(createPoolCard(key, label, pool, index)));
    poolGrid.appendChild(group);
  });
  poolGrid.querySelectorAll("[data-add-pool]").forEach((button) => {
    button.addEventListener("click", () => addPool(button.dataset.addPool));
  });
}

function addPool(phase) {
  state.byGame[state.game][`${phase}Extra`].push(createPool(phase));
  saveAndRender();
}

function removePool(phase, index) {
  if (Number(index) === 0) {
    state.byGame[state.game][phase] = createPool(phase);
  } else {
    state.byGame[state.game][`${phase}Extra`].splice(Number(index) - 1, 1);
  }
  saveAndRender();
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
}

async function checkAllSavedSources() {}

function renderPendingUpdates() {
  pendingPanel.innerHTML = "";
}

function applyPendingUpdate() {}

function ignorePendingUpdate() {}

function getMainPool(game) {
  const data = state.byGame[game];
  const currentPools = getPhasePools(data, "current").filter(isFilled);
  const timedCurrent = currentPools.filter((pool) => !pool.endTbd);
  if (timedCurrent.length) return timedCurrent.sort((a, b) => partsToDate(a.end) - partsToDate(b.end))[0];
  if (currentPools.length) return currentPools[0];
  const nextPools = getPhasePools(data, "next").filter(isFilled);
  const timedNext = nextPools.filter((pool) => !pool.endTbd);
  if (timedNext.length) return timedNext.sort((a, b) => partsToDate(a.end) - partsToDate(b.end))[0];
  return nextPools[0] || data.current;
}

function getCountdownTargetPool(game) {
  const data = state.byGame[game];
  const now = Date.now();
  const nextPools = getPhasePools(data, "next")
    .filter((pool) => isFilled(pool) && !pool.startTbd)
    .filter((pool) => partsToDate(pool.start).getTime() >= now)
    .sort((a, b) => partsToDate(a.start) - partsToDate(b.start));
  if (nextPools.length) return nextPools[0];
  return getMainPool(game);
}

function createPoolCard(phase, label, pool, index) {
  const node = poolTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.phase = phase;
  node.dataset.poolIndex = String(index);
  node.querySelector('[data-role="phase"]').textContent = `${label}${index ? ` #${index + 1}` : ""}`;
  node.querySelector('[data-role="title"]').textContent = pool.name || "未命名卡池";

  const imageButton = node.querySelector('[data-role="image"]');
  imageButton.dataset.phase = phase;
  imageButton.dataset.poolIndex = String(index);
  renderImage(imageButton, pool, `点击后 Ctrl+V 粘贴${label}图片`);

  const nameInput = node.querySelector('[data-field="name"]');
  nameInput.value = pool.name || "";
  nameInput.addEventListener("input", () => {
    pool.name = nameInput.value;
    node.querySelector('[data-role="title"]').textContent = pool.name || "未命名卡池";
    saveStateOnly();
  });
  nameInput.addEventListener("change", saveAndRender);

  const timeGrid = node.querySelector(".time-input-grid");
  timeGrid.innerHTML = "";
  timeGrid.appendChild(createDateEditor(pool, "start", "开始时间"));
  timeGrid.appendChild(createDateEditor(pool, "end", "结束时间"));

  const preview = node.querySelector('[data-role="rangePreview"]');
  preview.textContent = formatRangeText(pool);

  node.querySelector('[data-action="clear"]').textContent = index ? "删除" : "清空";
  node.querySelector('[data-action="clear"]').addEventListener("click", () => removePool(phase, index));
  return node;
}

function createDateEditor(pool, key, label) {
  const wrapper = document.createElement("div");
  wrapper.className = "date-parts";
  const tbdKey = `${key}Tbd`;
  wrapper.innerHTML = `
    <div class="date-parts-head">
      <span>${label}</span>
      <label class="tbd-toggle"><input type="checkbox" ${pool[tbdKey] ? "checked" : ""} /> 待定</label>
    </div>
    <div class="date-part-grid">
      ${createNumberInput("year", pool[key].year, 2024, 2035, "年")}
      ${createNumberInput("month", pool[key].month, 1, 12, "月")}
      ${createNumberInput("day", pool[key].day, 1, 31, "日")}
      ${createNumberInput("hour", pool[key].hour, 0, 23, "时")}
    </div>
  `;
  const checkbox = wrapper.querySelector('input[type="checkbox"]');
  const inputs = [...wrapper.querySelectorAll('input[type="number"]')];
  const syncDisabled = () => {
    inputs.forEach((input) => {
      input.disabled = checkbox.checked;
    });
  };
  checkbox.addEventListener("change", () => {
    pool[tbdKey] = checkbox.checked;
    syncDisabled();
    saveAndRender();
  });
  inputs.forEach((input) => {
    input.addEventListener("change", () => {
      const part = input.dataset.part;
      const min = Number(input.min);
      const max = Number(input.max);
      const value = Math.min(max, Math.max(min, Number(input.value || min)));
      input.value = value;
      pool[key][part] = value;
      if (part === "year" || part === "month") {
        pool[key].day = Math.min(pool[key].day, daysInMonth(pool[key].year, pool[key].month));
      }
      pool[key].minute = 0;
      pool[`${key}Text`] = formatInputDate(pool[key]);
      pool.rangeText = formatRangeText(pool);
      saveAndRender();
    });
  });
  syncDisabled();
  return wrapper;
}

function createNumberInput(part, value, min, max, suffix) {
  return `
    <label>
      <input data-part="${part}" type="number" min="${min}" max="${max}" step="1" value="${value}" inputmode="numeric" />
      <span>${suffix}</span>
    </label>
  `;
}

function isActive(pool) {
  if (pool.startTbd || pool.endTbd) return false;
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
      const phase = target.dataset.phase || target.dataset.slot || "current";
      const poolIndex = target.dataset.poolIndex || "0";
      const pool = getPoolRef(state.game, phase, poolIndex);
      const imageKey = makeImageKey(state.game, `${phase}:${poolIndex}`);
      await imageDbSet(imageKey, reader.result);
      pool.imageKey = imageKey;
      pool.image = "";
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
  if (logo.startsWith("data:") || logo.startsWith("assets/") || isRemoteImage(logo)) {
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
  if (logo.startsWith("data:") || logo.startsWith("assets/") || isRemoteImage(logo)) {
    return `<img src="${escapeHtml(logo)}" alt="${escapeHtml(game)}" onerror="this.replaceWith(document.createTextNode('${escapeHtml(game.slice(0, 1))}'))" />`;
  }
  return escapeHtml(game.slice(0, 1));
}

function hydrateGameLogos() {
  gameBoard.querySelectorAll("[data-logo-game]").forEach((node) => {
    const game = node.dataset.logoGame;
    const logo = getGameLogo(game);
    if (!logo || logo.startsWith("data:") || logo.startsWith("assets/") || isRemoteImage(logo)) return;
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
  if (pool.phase !== "next" && pool.endTbd) return "待定";
  const days = getCountdownDays(pool);
  if (days > 0) return `${days}天`;
  if (days === 0) return "今天";
  return "已结束";
}

function getCountdownDays(pool) {
  if (pool.phase !== "next" && pool.endTbd) return Number.POSITIVE_INFINITY;
  const now = Date.now();
  const start = pool.startTbd ? now : partsToDate(pool.start).getTime();
  const end = pool.endTbd ? start : partsToDate(pool.end).getTime();
  const target = now < start ? start : end;
  return Math.ceil((target - now) / 86400000);
}

function endsInThreeDays(pool) {
  if (!pool || (pool.phase !== "next" && pool.endTbd)) return false;
  const days = getCountdownDays(pool);
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
  return new Date(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0);
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
  const start = pool.startTbd ? "开始待定" : formatDate(partsToDate(pool.start));
  const end = pool.endTbd ? "结束待定" : formatDate(partsToDate(pool.end));
  return `${start} - ${end}`;
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
