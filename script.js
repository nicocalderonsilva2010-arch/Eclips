const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const STORAGE = {
  settings: "eclipse-settings-v2",
  albums: "eclipse-albums-v2",
  favorites: "eclipse-favorites-v2"
};

// These values live separately from the original settings payload so people who
// already have a local Eclipse library do not lose it when the player grows new
// capabilities.
const ADVANCED_STORAGE = {
  playback: "eclipse-playback-v1",
  history: "eclipse-history-v1",
  deletedTracks: "eclipse-deleted-tracks-v1",
  trackMeta: "eclipse-track-meta-v1",
  notifications: "eclipse-notifications-v1"
};

const DEFAULT_SETTINGS = {
  profileName: "Luna",
  profileImage: "",
  profileImageScale: 1,
  profileImagePositionX: 50,
  profileImagePositionY: 50,
  profileAvatarShape: "circle",
  profileBio: "",
  profileSocial: "",
  favoriteArtists: "",
  profileGallery: [],
  profileBanner: "",
  profileBannerScale: 1,
  profileBannerPositionX: 50,
  profileBannerPositionY: 50,
  background: "",
  theme: "mono",
  dynamicTheme: false,
  animations: true,
  autoplay: true,
  interfaceMode: "mobile",
  interfaceScale: 1,
  language: "es",
  audioQuality: "auto",
  notifications: true,
  soundEffects: true,
  soundEffectsVolume: .35,
  navOrder: ["home", "search", "upload", "library", "friends", "profile"]
};

const THEME_TOKENS = {
  mono: {
    "--paper": "#f6f6f2", "--paper-soft": "#efefea", "--ink": "#141414",
    "--muted": "#777771", "--line": "rgba(20, 20, 20, 0.1)", "--glass": "rgba(255, 255, 252, 0.62)", "--accent": "#60645a"
  },
  wine: {
    "--paper": "#620817", "--paper-soft": "#41070f", "--ink": "#fff5f3",
    "--muted": "#e2a2aa", "--line": "rgba(255, 230, 228, 0.16)", "--glass": "rgba(91, 8, 22, 0.78)", "--accent": "#ff4056"
  },
  dark: {
    "--paper": "#0b1220", "--paper-soft": "#121d2d", "--ink": "#edf5ff",
    "--muted": "#9dafc4", "--line": "rgba(189, 215, 242, 0.13)", "--glass": "rgba(11, 18, 32, 0.78)", "--accent": "#6cc5e8"
  }
};

const COVER_ACCENTS = {
  aurora: "#d5223e",
  ink: "#9d1429",
  mist: "#c31b34",
  lunar: "#b71732",
  lines: "#de2945",
  cloud: "#8e1427"
};

const MUSIC_DATABASE = "eclipse-music-db-v1";
const MUSIC_STORE = "tracks";
const MUSIC_FOLDER_STORE = "folder-access";

const defaultAlbums = [
  { id: "album-after", name: "Después de las 2", mood: "noches lentas", cover: "aurora" },
  { id: "album-cloud", name: "Nubes bajas", mood: "para respirar", cover: "cloud" },
  { id: "album-orbit", name: "En órbita", mood: "mi energía", cover: "lunar" },
  { id: "album-notes", name: "Notas para mí", mood: "pequeños momentos", cover: "lines" }
];

const defaultTracks = [
  { id: "track-1", title: "Luz de domingo", artist: "Eclipse", albumId: "album-after", cover: "aurora", duration: "3:42" },
  { id: "track-2", title: "Cosas que no dije", artist: "Mi colección", albumId: "album-after", cover: "mist", duration: "2:58" },
  { id: "track-3", title: "Vuelta al sol", artist: "Eclipse", albumId: "album-orbit", cover: "lunar", duration: "4:08" },
  { id: "track-4", title: "Más despacio", artist: "Para respirar", albumId: "album-cloud", cover: "cloud", duration: "3:16" },
  { id: "track-5", title: "Cartas pequeñas", artist: "Eclipse", albumId: "album-notes", cover: "lines", duration: "3:27" }
];

let settings = normalizeSettings(load(STORAGE.settings, DEFAULT_SETTINGS));
let customAlbums = load(STORAGE.albums, []);
let favorites = new Set(load(STORAGE.favorites, []));
let sessionTracks = [];
let currentTrack = null;
let selectedAlbumId = null;
let selectedCover = "ink";
let activeFilter = "all";
let toastTimer;
let databasePromise;
let playbackState = normalizePlaybackState(load(ADVANCED_STORAGE.playback, {}));
let listeningHistory = normalizeHistory(load(ADVANCED_STORAGE.history, []));
let deletedTrackIds = new Set(load(ADVANCED_STORAGE.deletedTracks, []));
let trackMetadata = normalizeTrackMetadata(load(ADVANCED_STORAGE.trackMeta, {}));
let appNotifications = normalizeNotifications(load(ADVANCED_STORAGE.notifications, []));
let lastFocusedElement = null;
let accentRequestId = 0;
let touchStart = null;
let supabaseClient = null;
let authenticatedUser = null;
let friendProfiles = new Map();
let searchFilter = "all";
let socialRefreshTimer = null;
let musicFolderHandle = null;
let peopleSearchRequest = 0;
// The onboarding flow begins with registration, then requires a sign-in.
let authMode = "register";

const audio = $("#audio");

function getSupabaseClient() {
  const config = window.ECLIPSE_SUPABASE;
  if (!config || !window.supabase || !config.url?.startsWith("https://") || !config.publishableKey || config.publishableKey.startsWith("TU_")) return null;
  if (!supabaseClient) supabaseClient = window.supabase.createClient(config.url, config.publishableKey);
  return supabaseClient;
}

function setAuthStatus(message = "") { $("#authStatus").textContent = message; }

function renderAuthMode() {
  const registering = authMode === "register";
  $("#authTitle").innerHTML = registering ? "Crea tu<br />espacio." : "Tu música,<br />tu espacio.";
  $("#authCopy").textContent = registering ? "Guarda tu perfil y vuelve a él desde cualquier dispositivo." : "Entra para guardar tu perfil y tu mundo musical.";
  $("#authName").hidden = !registering;
  $("#authNameLabel").hidden = !registering;
  $("#authName").required = registering;
  $("#authSubmit").textContent = registering ? "Crear cuenta" : "Iniciar sesión";
  $("#authSwitch").textContent = registering ? "¿Ya tienes cuenta? Inicia sesión" : "¿No tienes cuenta? Regístrate";
  setAuthStatus();
}

async function syncCloudProfile() {
  const client = getSupabaseClient();
  if (!client || !authenticatedUser) return;
  const profile = {
    id: authenticatedUser.id,
    display_name: settings.profileName,
    avatar_url: settings.profileImage || null,
    avatar_scale: settings.profileImageScale,
    avatar_x: settings.profileImagePositionX,
    avatar_y: settings.profileImagePositionY,
    banner_url: settings.profileBanner || null,
    banner_scale: settings.profileBannerScale,
    banner_x: settings.profileBannerPositionX,
    banner_y: settings.profileBannerPositionY,
    bio: settings.profileBio || null,
    social_handle: settings.profileSocial || null,
    favorite_artists: settings.favoriteArtists || null,
    gallery: settings.profileGallery,
    friend_code: getFriendCode(),
    updated_at: new Date().toISOString()
  };
  const { error } = await client.from("profiles").upsert(profile);
  if (error) console.warn("No pudimos sincronizar el perfil de Eclipse:", error.message);
}

async function loadCloudProfile() {
  const client = getSupabaseClient();
  if (!client || !authenticatedUser) return;
  const { data, error } = await client.from("profiles").select("*").eq("id", authenticatedUser.id).maybeSingle();
  if (error) return console.warn("No pudimos cargar tu perfil de Eclipse:", error.message);
  const accountName = String(authenticatedUser.user_metadata?.display_name || "").trim();
  if (!data) {
    settings.profileName = accountName || settings.profileName;
    await syncCloudProfile();
    return;
  }
  // El perfil remoto gana siempre: así un equipo nuevo no muestra datos locales viejos.
  // "Luna" was the old visual placeholder. Do not let it replace the name
  // a person chose when creating their account.
  settings.profileName = data.display_name && !(data.display_name === "Luna" && accountName && accountName !== "Luna")
    ? data.display_name
    : accountName || "Luna";
  settings.profileImage = data.avatar_url || "";
  settings.profileImageScale = Number(data.avatar_scale) || 1;
  settings.profileImagePositionX = Number(data.avatar_x) || 50;
  settings.profileImagePositionY = Number(data.avatar_y) || 50;
  settings.profileBanner = data.banner_url || "";
  settings.profileBannerScale = Number(data.banner_scale) || 1;
  settings.profileBannerPositionX = Number(data.banner_x) || 50;
  settings.profileBannerPositionY = Number(data.banner_y) || 50;
  settings.profileBio = data.bio || "";
  settings.profileSocial = data.social_handle || "";
  settings.favoriteArtists = data.favorite_artists || "";
  settings.profileGallery = Array.isArray(data.gallery) ? data.gallery.slice(0, 3) : [];
  if (data.friend_code) localStorage.setItem(`eclipse-friend-code-${authenticatedUser.id}`, data.friend_code);
  save(STORAGE.settings, settings);
  applySettings();
}

async function initialiseAuth() {
  const client = getSupabaseClient();
  const gate = $("#authGate");
  if (!client) {
    gate.hidden = false;
    return;
  }
  // Supabase persists the session locally. Keep it through refreshes and only
  // return to access when the person deliberately signs out.
  const { data: { session } } = await client.auth.getSession();
  if (!session?.user) {
    authenticatedUser = null;
    gate.hidden = false;
    return;
  }
  authenticatedUser = session.user;
  await loadCloudProfile();
  applySettings();
  renderFriends();
  startSocialUpdates();
  gate.hidden = true;
  openFriendLinkIfPresent();
}

function showLoginGate(message = "") {
  closeSheets();
  audio.pause();
  authenticatedUser = null;
  if (socialRefreshTimer) window.clearInterval(socialRefreshTimer);
  authMode = "login";
  $("#authForm").reset();
  renderAuthMode();
  const gate = $("#authGate");
  gate.classList.remove("is-leaving");
  gate.hidden = false;
  setAuthStatus(message);
}

function hideLoginGate() {
  const gate = $("#authGate");
  gate.classList.add("is-leaving");
  window.setTimeout(() => {
    gate.hidden = true;
    gate.classList.remove("is-leaving");
  }, 340);
}
let interfaceAudioContext = null;
let interfaceAudioUnlocked = false;
let lastHoverSoundAt = 0;

function load(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function normalizeSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const scale = Number(source.interfaceScale);
  const profileScale = Number(source.profileImageScale);
  const soundEffectsVolume = Number(source.soundEffectsVolume);
  const bannerScale = Number(source.profileBannerScale);
  return {
    ...DEFAULT_SETTINGS,
    ...source,
    theme: THEME_TOKENS[source.theme] ? source.theme : DEFAULT_SETTINGS.theme,
    dynamicTheme: source.dynamicTheme !== false,
    animations: source.animations !== false,
    autoplay: source.autoplay !== false,
    interfaceMode: source.interfaceMode === "desktop" ? "desktop" : "mobile",
    interfaceScale: Number.isFinite(scale) ? Math.min(1.2, Math.max(.85, scale)) : 1,
    language: typeof source.language === "string" ? source.language : "es",
    audioQuality: typeof source.audioQuality === "string" ? source.audioQuality : "auto",
    notifications: source.notifications !== false,
    profileImageScale: Number.isFinite(profileScale) ? Math.min(1.8, Math.max(1, profileScale)) : 1,
    profileImagePositionX: Number.isFinite(Number(source.profileImagePositionX)) ? Math.min(100, Math.max(0, Number(source.profileImagePositionX))) : 50,
    profileImagePositionY: Number.isFinite(Number(source.profileImagePositionY)) ? Math.min(100, Math.max(0, Number(source.profileImagePositionY))) : 50,
    profileAvatarShape: ["circle", "soft", "square"].includes(source.profileAvatarShape) ? source.profileAvatarShape : "circle",
    profileBio: typeof source.profileBio === "string" ? source.profileBio.slice(0, 120) : "",
    profileSocial: typeof source.profileSocial === "string" ? source.profileSocial.slice(0, 50) : "",
    favoriteArtists: typeof source.favoriteArtists === "string" ? source.favoriteArtists.slice(0, 100) : "",
    profileGallery: Array.isArray(source.profileGallery) ? source.profileGallery.filter(image => typeof image === "string").slice(0, 3) : [],
    profileBanner: typeof source.profileBanner === "string" ? source.profileBanner : "",
    profileBannerScale: Number.isFinite(bannerScale) ? Math.min(1.8, Math.max(1, bannerScale)) : 1,
    profileBannerPositionX: Number.isFinite(Number(source.profileBannerPositionX)) ? Math.min(100, Math.max(0, Number(source.profileBannerPositionX))) : 50,
    profileBannerPositionY: Number.isFinite(Number(source.profileBannerPositionY)) ? Math.min(100, Math.max(0, Number(source.profileBannerPositionY))) : 50,
    soundEffects: source.soundEffects !== false,
    soundEffectsVolume: Number.isFinite(soundEffectsVolume) ? Math.min(1, Math.max(0, soundEffectsVolume)) : .35,
    navOrder: Array.isArray(source.navOrder) && source.navOrder.length === 6 ? source.navOrder.filter(id => ["home", "search", "upload", "library", "friends", "profile"].includes(id)) : ["home", "search", "upload", "library", "friends", "profile"]
  };
}

function normalizePlaybackState(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    shuffle: Boolean(source.shuffle),
    repeat: ["off", "all", "one"].includes(source.repeat) ? source.repeat : "off",
    volume: Number.isFinite(Number(source.volume)) ? Math.min(1, Math.max(0, Number(source.volume))) : .8,
    speed: Number.isFinite(Number(source.speed)) ? Math.min(3, Math.max(.5, Number(source.speed))) : 1,
    queue: Array.isArray(source.queue) ? [...new Set(source.queue.filter(id => typeof id === "string"))].slice(0, 100) : []
  };
}

function normalizeHistory(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => item && typeof item.id === "string")
    .map(item => ({ id: item.id, playedAt: Number(item.playedAt) || Date.now() }))
    .slice(0, 50);
}

function normalizeTrackMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([id, meta]) => typeof id === "string" && meta && typeof meta === "object")
    .map(([id, meta]) => [id, {
      title: typeof meta.title === "string" ? meta.title.slice(0, 120) : undefined,
      artist: typeof meta.artist === "string" ? meta.artist.slice(0, 120) : undefined,
      genre: typeof meta.genre === "string" ? meta.genre.slice(0, 60) : undefined,
      description: typeof meta.description === "string" ? meta.description.slice(0, 500) : undefined,
      albumId: typeof meta.albumId === "string" ? meta.albumId : undefined,
      cover: typeof meta.cover === "string" ? meta.cover : undefined
    }]));
}

function normalizeNotifications(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => item && typeof item.message === "string")
    .map(item => ({
      id: typeof item.id === "string" ? item.id : `notice-${Date.now()}`,
      message: item.message.slice(0, 240),
      createdAt: Number(item.createdAt) || Date.now(),
      read: Boolean(item.read)
    }))
    .slice(0, 30);
}

function persistPlaybackState() {
  save(ADVANCED_STORAGE.playback, playbackState);
}

function openMusicDatabase() {
  if (!("indexedDB" in window)) return Promise.resolve(null);
  if (databasePromise) return databasePromise;
  databasePromise = new Promise(resolve => {
    const request = indexedDB.open(MUSIC_DATABASE, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(MUSIC_STORE)) {
        request.result.createObjectStore(MUSIC_STORE, { keyPath: "id" });
      }
      if (!request.result.objectStoreNames.contains(MUSIC_FOLDER_STORE)) {
        request.result.createObjectStore(MUSIC_FOLDER_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
  return databasePromise;
}

async function saveUploadedTrack(track, file) {
  const database = await openMusicDatabase();
  if (!database) return false;
  return new Promise(resolve => {
    const transaction = database.transaction(MUSIC_STORE, "readwrite");
    transaction.objectStore(MUSIC_STORE).put({
      id: track.id,
      title: track.title,
      artist: track.artist,
      albumId: track.albumId,
      cover: track.cover,
      duration: track.duration,
      sourceKey: track.sourceKey || null,
      file
    });
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => resolve(false);
    transaction.onabort = () => resolve(false);
  });
}

async function loadUploadedTracks() {
  const database = await openMusicDatabase();
  if (!database) return [];
  return new Promise(resolve => {
    const transaction = database.transaction(MUSIC_STORE, "readonly");
    const request = transaction.objectStore(MUSIC_STORE).getAll();
    request.onsuccess = () => {
      const tracks = request.result
        .filter(item => item.file instanceof Blob)
        .map(item => ({
          id: item.id,
          title: item.title,
          artist: item.artist,
          albumId: item.albumId,
          cover: item.cover || "ink",
          duration: item.duration || "—",
          sourceKey: item.sourceKey || null,
          src: URL.createObjectURL(item.file)
        }));
      resolve(tracks);
    };
    request.onerror = () => resolve([]);
  });
}

function getAlbums() {
  return [...defaultAlbums, ...customAlbums];
}

function getAllTracks() {
  return [...defaultTracks, ...sessionTracks].map(track => ({
    ...track,
    ...(trackMetadata[track.id] || {})
  }));
}

function getTracks() {
  return getAllTracks().filter(track => !deletedTrackIds.has(track.id));
}

function getTrackById(trackId, includeDeleted = false) {
  const tracks = includeDeleted ? getAllTracks() : getTracks();
  return tracks.find(track => track.id === trackId) || null;
}

function getQueueTracks() {
  const available = new Map(getTracks().map(track => [track.id, track]));
  const queue = playbackState.queue
    .map(trackId => available.get(trackId))
    .filter(Boolean);
  const validIds = queue.map(track => track.id);
  if (validIds.length !== playbackState.queue.length) {
    playbackState.queue = validIds;
    persistPlaybackState();
  }
  return queue;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[char]));
}

// Eclipse accepts a small, safe color prefix such as <#F00>Manchi. The prefix
// is stored so the color survives devices, but is never rendered as text.
function displayName(value, fallback = "Luna") {
  const raw = String(value || "").trim();
  const match = raw.match(/^<\s*#([0-9a-f]{3}|[0-9a-f]{6})\s*>\s*(.*)$/i);
  const name = (match ? match[2] : raw).trim() || fallback;
  return { name, color: match ? `#${match[1]}` : "" };
}

function displayNameMarkup(value, fallback = "Usuario de Eclipse") {
  const formatted = displayName(value, fallback);
  const color = formatted.color ? ` style="color:${formatted.color}"` : "";
  return `<span${color}>${escapeHtml(formatted.name)}</span>`;
}

function updateNameColorPreview(value = $("#profileNameInput")?.value) {
  const preview = $("#nameColorPreview");
  if (!preview) return;
  const formatted = displayName(value, "Luna");
  preview.textContent = formatted.name;
  preview.style.color = formatted.color;
}

function coverClass(cover) {
  return cover && cover.startsWith("data:") ? "cover-custom" : `cover-${cover || "ink"}`;
}

function coverStyle(cover) {
  return cover && cover.startsWith("data:") ? `style="--custom-cover: url('${cover}')"` : "";
}

function icon(name) {
  return `<i data-lucide="${name}"></i>`;
}

function drawIcons() {
  if (window.lucide) window.lucide.createIcons();
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

// Browsers only allow generated audio after a real user gesture.  We unlock the
// context on the first click/touch and keep hover feedback intentionally soft.
function unlockInterfaceSound() {
  if (!settings.soundEffects || interfaceAudioUnlocked) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    interfaceAudioContext = interfaceAudioContext || new AudioContextClass();
    if (interfaceAudioContext.state === "suspended") interfaceAudioContext.resume();
    interfaceAudioUnlocked = interfaceAudioContext.state === "running";
  } catch {
    interfaceAudioUnlocked = false;
  }
}

function playSwitchHoverSound() {
  if (!settings.soundEffects || !interfaceAudioUnlocked || !interfaceAudioContext) return;
  const now = performance.now();
  if (now - lastHoverSoundAt < 90) return;
  lastHoverSoundAt = now;
  try {
    const oscillator = interfaceAudioContext.createOscillator();
    const gain = interfaceAudioContext.createGain();
    const start = interfaceAudioContext.currentTime;
    const volume = Math.min(.07, Math.max(.004, settings.soundEffectsVolume * .055));
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(740, start);
    oscillator.frequency.exponentialRampToValueAtTime(520, start + .045);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(.0001, start + .06);
    oscillator.connect(gain).connect(interfaceAudioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + .065);
  } catch {
    // Interface feedback is optional; it must never affect controls.
  }
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

function setClock() {
  const now = new Date();
  $("#clock").textContent = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const date = $("#homeDate");
  if (date) date.textContent = `· ${now.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "short" })}`;
}

function getFriendCode() {
  const key = `eclipse-friend-code-${authenticatedUser?.id || "local"}`;
  let code = localStorage.getItem(key);
  if (!code) {
    const seed = (authenticatedUser?.id || crypto.randomUUID()).replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase();
    code = `ECLIPSE-${seed}`;
    localStorage.setItem(key, code);
  }
  return code;
}

function normalizeFriendCode(value = "") {
  const raw = String(value).trim().toUpperCase().replace(/\s+/g, "");
  const match = raw.match(/ECLIPSE-([A-Z0-9]{4,30})/);
  return match ? `ECLIPSE-${match[1]}` : raw;
}

function getFriendShareLink() {
  const url = new URL(window.location.href);
  url.searchParams.set("friend", getFriendCode());
  return url.toString();
}

function openFriendLinkIfPresent() {
  const code = normalizeFriendCode(new URLSearchParams(window.location.search).get("friend"));
  if (!code || !authenticatedUser || !$("#friendCodeInput")) return;
  $("#friendCodeInput").value = code;
  switchView("friends");
  showToast("Código de amistad listo. Confirma para enviar la solicitud.");
}

async function renderFriends() {
  const client = getSupabaseClient();
  const list = $("#friendsList");
  if (!list) return;
  if (!client || !authenticatedUser) {
    $("#friendsCount").textContent = "0";
    return;
  }
  const { data: connections, error } = await client.from("friendships")
    .select("id, user_id, friend_id, status, created_at")
    .or(`user_id.eq.${authenticatedUser.id},friend_id.eq.${authenticatedUser.id}`);
  if (error) return console.warn("No pudimos cargar tus friends:", error.message);
  const accepted = connections.filter(item => item.status === "accepted");
  const incoming = connections.filter(item => item.status === "pending" && item.friend_id === authenticatedUser.id);
  const friendConnections = accepted.map(item => ({
    connectionId: item.id,
    profileId: item.user_id === authenticatedUser.id ? item.friend_id : item.user_id
  }));
  const friendIds = friendConnections.map(item => item.profileId);
  const incomingIds = incoming.map(item => item.user_id);
  const visibleIds = [...new Set([...friendIds, ...incomingIds])];
  let profiles = [];
  if (visibleIds.length) {
    const result = await client.from("profiles").select("id, display_name, avatar_url, banner_url, bio, favorite_artists, gallery").in("id", visibleIds);
    profiles = result.data || [];
  }
  $("#friendsCount").textContent = String(accepted.length);
  if ($("#sideFriendsCount")) $("#sideFriendsCount").textContent = String(accepted.length);
  const profileById = new Map(profiles.map(profile => [profile.id, profile]));
  friendProfiles = profileById;
  const friendsMarkup = friendConnections.map(({ connectionId, profileId }) => {
    const profile = profileById.get(profileId);
    const rawName = profile?.display_name || "Friend de Eclipse";
    const name = displayName(rawName, "Friend de Eclipse").name;
    const avatar = profile?.avatar_url ? `<img src="${escapeHtml(profile.avatar_url)}" alt="" />` : escapeHtml(name.slice(0, 1).toUpperCase());
    return `<article class="friend-row"><button class="friend-open" type="button" data-open-friend="${profileId}"><span class="friend-avatar">${avatar}</span><span><strong>${displayNameMarkup(rawName, "Friend de Eclipse")}</strong><small>En su propia órbita</small></span><i data-lucide="chevron-right"></i></button><button class="remove-friend" type="button" data-remove-friend="${connectionId}" aria-label="Eliminar a ${escapeHtml(name)}" title="Eliminar friend"><i data-lucide="user-minus"></i></button></article>`;
  });
  const incomingMarkup = incoming.map(item => {
    const sender = profileById.get(item.user_id)?.display_name || "Alguien";
    return `<article class="friend-request"><span><i data-lucide="user-plus"></i></span><p><b>${displayNameMarkup(sender, "Alguien")}</b> te envió una solicitud.<small>Acéptala para ver su perfil decorado.</small></p><span class="friend-request-actions"><button type="button" data-accept-friend="${item.id}">Aceptar</button><button class="decline" type="button" data-decline-friend="${item.id}" aria-label="Rechazar solicitud">×</button></span></article>`;
  });
  list.innerHTML = [...incomingMarkup, ...friendsMarkup].join("") || `<div class="empty-state"><i data-lucide="users-round"></i><strong>Aún no tienes friends</strong><span>Comparte tu código para empezar a descubrir sus espacios.</span></div>`;
  appNotifications = incoming.map(item => ({ id: `friend-${item.id}`, message: `${displayName(profileById.get(item.user_id)?.display_name, "Alguien").name} te envió una solicitud de amistad.`, createdAt: new Date(item.created_at || Date.now()).getTime(), read: false }));
  renderNotifications();
  const bell = $("#openNotifications");
  bell?.classList.toggle("has-notification", incoming.length > 0);
  bell?.setAttribute("aria-label", incoming.length ? `Abrir notificaciones: ${incoming.length} nuevas` : "Abrir notificaciones");
  const { count } = await client.from("follows").select("*", { count: "exact", head: true }).eq("following_id", authenticatedUser.id);
  if ($("#followerCount")) $("#followerCount").textContent = String(count || 0);
  if ($("#sideFollowerCount")) $("#sideFollowerCount").textContent = String(count || 0);
  drawIcons();
}

function startSocialUpdates() {
  if (socialRefreshTimer) window.clearInterval(socialRefreshTimer);
  socialRefreshTimer = window.setInterval(() => authenticatedUser && renderFriends(), 30000);
  const client = getSupabaseClient();
  if (!client || !authenticatedUser) return;
  client.removeAllChannels?.();
  client.channel(`eclipse-social-${authenticatedUser.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "friendships", filter: `friend_id=eq.${authenticatedUser.id}` }, () => renderFriends())
    .subscribe();
}

function openFriendProfile(friend) {
  if (!friend) return;
  const friendName = displayName(friend.display_name, "Friend de Eclipse");
  $("#friendProfileName").textContent = friendName.name;
  $("#friendProfileName").style.color = friendName.color;
  $("#friendProfileBio").textContent = friend.bio || "Este friend todavía no ha añadido una biografía.";
  $("#friendProfileAvatar").src = friend.avatar_url || $("#profileImage").src;
  $("#friendProfileBanner").style.backgroundImage = friend.banner_url ? `url('${friend.banner_url}')` : "";
  const artists = String(friend.favorite_artists || "").split(",").map(artist => artist.trim()).filter(Boolean).slice(0, 5);
  $("#friendProfileArtists").innerHTML = artists.length
    ? artists.map(artist => `<span><i data-lucide="music-2"></i>${escapeHtml(artist)}</span>`).join("")
    : `<span class="profile-empty-chip">Aún no compartió artistas favoritos.</span>`;
  const gallery = Array.isArray(friend.gallery) ? friend.gallery.slice(0, 3) : [];
  $("#friendProfileGallery").innerHTML = gallery.length
    ? gallery.map((image, index) => `<img src="${escapeHtml(image)}" alt="Foto ${index + 1}" />`).join("")
    : `<span class="profile-gallery-empty"><i data-lucide="image"></i> Aún no tiene fotos públicas.</span>`;
  openSheet("friendProfileSheet");
  drawIcons();
}

function applySettings() {
  const fallback = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'%3E%3Crect width='120' height='120' rx='60' fill='%23e9e9e2'/%3E%3Ccircle cx='60' cy='45' r='22' fill='%23222222'/%3E%3Cpath d='M18 120c6-29 24-44 42-44s36 15 42 44' fill='%23222222'/%3E%3C/svg%3E";
  const profileImage = settings.profileImage || fallback;
  const ownName = displayName(settings.profileName, "Luna");
  $("#profileName").textContent = ownName.name;
  $("#profileName").style.color = ownName.color;
  $("#friendCode").textContent = getFriendCode();
  $("#profileNameInput").value = settings.profileName || "Luna";
  updateNameColorPreview(settings.profileName);
  $("#profileImage").src = profileImage;
  $("#profileImageLarge").src = profileImage;
  const avatarStyle = { "--avatar-scale": settings.profileImageScale, "--avatar-x": `${settings.profileImagePositionX}%`, "--avatar-y": `${settings.profileImagePositionY}%` };
  [$("#profileImage"), $("#profileImageLarge")].forEach(image => Object.entries(avatarStyle).forEach(([key, value]) => image.style.setProperty(key, value)));
  const banner = $("#profileBanner");
  banner.style.backgroundImage = settings.profileBanner ? `url('${settings.profileBanner}')` : "";
  banner.style.setProperty("--banner-size", `${settings.profileBannerScale * 100}%`);
  banner.style.setProperty("--banner-x", `${settings.profileBannerPositionX}%`);
  banner.style.setProperty("--banner-y", `${settings.profileBannerPositionY}%`);
  $("#profileBioInput").value = settings.profileBio || "";
  $("#profileSocialInput").value = settings.profileSocial || "";
  $("#favoriteArtistsInput").value = settings.favoriteArtists || "";
  $("#profileBioPreview").textContent = settings.profileBio || "Tu historia musical empieza aquí.";
  const artists = settings.favoriteArtists.split(",").map(artist => artist.trim()).filter(Boolean).slice(0, 5);
  $("#profileArtistsPreview").innerHTML = artists.length
    ? artists.map(artist => `<span><i data-lucide="music-2"></i>${escapeHtml(artist)}</span>`).join("")
    : `<span class="profile-empty-chip">Tus artistas favoritos aparecerán aquí.</span>`;
  $("#profileGalleryPreview").innerHTML = settings.profileGallery.length
    ? settings.profileGallery.map((image, index) => `<img src="${image}" alt="Decoración ${index + 1} de tu perfil" />`).join("")
    : `<span class="profile-gallery-empty"><i data-lucide="image"></i> Tu galería personal</span>`;
  const surface = $("#appSurface");
  surface.style.backgroundImage = settings.background
    ? `url('${settings.background}')`
    : "linear-gradient(145deg, rgba(255,255,255,.85), rgba(235,235,228,.74))";
  surface.classList.toggle("has-custom-background", Boolean(settings.background));
  applyVisualPreferences();
  syncSettingControls();
  applyNavigationOrder();
  drawIcons();
}

function applyNavigationOrder() {
  const nav = $(".tab-bar");
  if (!nav) return;
  const labels = { home: "Inicio", search: "Buscar", upload: "Subir", library: "Biblioteca", friends: "Friends", profile: "Perfil" };
  settings.navOrder.forEach(id => nav.querySelector(id === "upload" ? "#tabUpload" : id === "profile" ? "#tabProfile" : `[data-target='${id}']`) && nav.append(nav.querySelector(id === "upload" ? "#tabUpload" : id === "profile" ? "#tabProfile" : `[data-target='${id}']`)));
  const organizer = $("#navOrganizer");
  if (!organizer) return;
  organizer.innerHTML = settings.navOrder.map((id, index) => `<div class="nav-organizer-row"><span>${labels[id]}</span><span><button type="button" data-move-nav="${id}" data-direction="-1" ${index === 0 ? "disabled" : ""} aria-label="Subir ${labels[id]}">↑</button><button type="button" data-move-nav="${id}" data-direction="1" ${index === settings.navOrder.length - 1 ? "disabled" : ""} aria-label="Bajar ${labels[id]}">↓</button></span></div>`).join("");
}

function applyVisualPreferences() {
  const root = document.documentElement;
  const tokens = THEME_TOKENS[settings.theme] || THEME_TOKENS.mono;
  Object.entries(tokens).forEach(([property, value]) => root.style.setProperty(property, value));
  root.dataset.theme = settings.theme;
  root.dataset.interfaceMode = settings.interfaceMode;
  root.dataset.interfaceScale = String(settings.interfaceScale);
  root.dataset.language = settings.language;
  root.classList.toggle("reduce-motion", !settings.animations);
  root.style.setProperty("--interface-scale", String(settings.interfaceScale));

  const phone = $("#phone");
  if (phone) phone.dataset.interfaceMode = settings.interfaceMode;
  const surface = $("#appSurface");
  if (surface) surface.dataset.interfaceMode = settings.interfaceMode;
  if (!settings.dynamicTheme) clearDynamicAccent();
  else if (currentTrack) applyDynamicAccent(currentTrack);
}

function syncSettingControls() {
  const controls = $$('[data-setting]');
  controls.forEach(control => {
    const key = control.dataset.setting;
    if (!(key in settings)) return;
    const value = settings[key];
    if (control.matches('input[type="checkbox"], input[type="radio"]')) {
      control.checked = Boolean(value);
    } else if (control.matches("select, input[type=range], input[type=text], input[type=number]")) {
      control.value = String(value);
    }
    if (control.matches("button, [role=button]")) {
      const expected = control.dataset.value ?? control.dataset.settingValue;
      const active = expected === undefined ? Boolean(value) : String(value) === expected;
      control.setAttribute("aria-pressed", String(active));
      control.classList.toggle("is-active", active);
    }
  });

  const fallbackControls = {
    autoplay: ["#autoplayToggle", "#autoplay"],
    animations: ["#animationsToggle", "#animationToggle"],
    interfaceScale: ["#interfaceScale", "#uiScale"],
    language: ["#languageSelect"],
    audioQuality: ["#audioQualitySelect"],
    notifications: ["#notificationsToggle"],
    dynamicTheme: ["#dynamicThemeToggle"]
  };
  Object.entries(fallbackControls).forEach(([key, selectors]) => selectors.forEach(selector => {
    const control = $(selector);
    if (!control) return;
    if (control.matches('input[type="checkbox"], input[type="radio"]')) control.checked = Boolean(settings[key]);
    else if ("value" in control) control.value = String(settings[key]);
  }));
  $$('[data-theme]').forEach(button => {
    const active = button.dataset.theme === settings.theme;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $("#soundEffectsToggle").checked = Boolean(settings.soundEffects);
  $("#soundEffectsVolume").value = String(Math.round(settings.soundEffectsVolume * 100));
  $("#soundEffectsVolumeValue").textContent = `${Math.round(settings.soundEffectsVolume * 100)}%`;
  ["profileImageScale", "profileImagePositionX", "profileImagePositionY"].forEach(key => {
    const control = $(`#${key}`);
    if (control) control.value = String(settings[key]);
  });
  const profileScaleValue = $("#profileImageScaleValue");
  if (profileScaleValue) profileScaleValue.textContent = `${Math.round(settings.profileImageScale * 100)}%`;
  ["profileBannerPositionX", "profileBannerPositionY"].forEach(key => {
    const control = $(`#${key}`);
    if (control) control.value = String(settings[key]);
  });
  const bannerScaleControl = $("#profileBannerScale");
  if (bannerScaleControl) bannerScaleControl.value = String(Math.round(settings.profileBannerScale * 100));
  const bannerScaleValue = $("#profileBannerScaleValue");
  if (bannerScaleValue) bannerScaleValue.textContent = `${Math.round(settings.profileBannerScale * 100)}%`;
  $$("[data-avatar-shape]").forEach(button => button.classList.toggle("is-active", button.dataset.avatarShape === settings.profileAvatarShape));
}

function removeOrphanedFavorites() {
  const validIds = new Set(getTracks().map(track => track.id));
  const cleaned = [...favorites].filter(id => validIds.has(id));
  if (cleaned.length !== favorites.size) {
    favorites = new Set(cleaned);
    save(STORAGE.favorites, cleaned);
  }
}

function albumArtwork(album, extraClass = "") {
  return `<span class="${extraClass} ${coverClass(album.cover)}" ${coverStyle(album.cover)}></span>`;
}

function renderAlbums() {
  const albums = getAlbums();
  $("#albumRail").innerHTML = albums.map(album => `
    <button class="album-card" type="button" data-album-id="${album.id}">
      ${albumArtwork(album, "album-cover")}
      <span><strong>${escapeHtml(album.name)}</strong><small>${escapeHtml(album.mood || "mi colección")}</small></span>
    </button>
  `).join("");

  $("#libraryAlbums").innerHTML = albums.map(album => {
    const count = getTracks().filter(track => track.albumId === album.id).length;
    return `
      <button class="library-album-row" type="button" data-album-id="${album.id}">
        ${albumArtwork(album, "album-cover")}
        <span><strong>${escapeHtml(album.name)}</strong><small>${count} ${count === 1 ? "canción" : "canciones"} · ${escapeHtml(album.mood || "mi colección")}</small></span>
        ${icon("chevron-right")}
      </button>`;
  }).join("") || `<div class="empty-state">Todavía no hay álbumes. Crea uno para empezar a ordenar tu música.</div>`;

  $("#albumCount").textContent = albums.length;
  renderAlbumPicker(albums);
  drawIcons();
}

function renderAlbumPicker(albums = getAlbums()) {
  const select = $("#musicAlbumSelect");
  if (!select) return;
  const previousValue = select.value;
  select.innerHTML = `<option value="">Mis canciones · crear colección automática</option>${albums.map(album => `<option value="${album.id}">${escapeHtml(album.name)}</option>`).join("")}`;
  if (["", ...albums.map(album => album.id)].includes(previousValue)) select.value = previousValue;
}

function trackRow(track, index, inAlbum = false) {
  const active = currentTrack?.id === track.id ? " is-current" : "";
  const favorited = favorites.has(track.id) ? " is-favorite" : "";
  const trackNumber = inAlbum ? String(index + 1).padStart(2, "0") : icon("music-2");
  return `
    <article class="track-row${active}" data-track-id="${track.id}" tabindex="0" role="button" aria-label="Reproducir ${escapeHtml(track.title)}">
      <span class="track-number">${trackNumber}</span>
      <span class="track-thumb ${coverClass(track.cover)}" ${coverStyle(track.cover)}></span>
      <span class="track-info"><strong>${escapeHtml(track.title)}</strong><small>${escapeHtml(track.artist)}</small></span>
      <span class="track-duration">${track.duration || "—"}</span>
      <button class="track-favorite${favorited}" type="button" data-favorite-id="${track.id}" aria-label="Marcar ${escapeHtml(track.title)} como favorita">${icon("heart")}</button>
    </article>`;
}

function filteredTracks() {
  const tracks = getTracks();
  if (activeFilter === "favorite") return tracks.filter(track => favorites.has(track.id));
  if (activeFilter === "recent") return [...tracks].reverse();
  return tracks;
}

function renderTracks() {
  const tracks = filteredTracks();
  $("#homeTrackList").innerHTML = tracks.length
    ? tracks.slice(0, 5).map((track, index) => trackRow(track, index)).join("")
    : `<div class="empty-state">No hay canciones en esta vista todavía.</div>`;
  $("#songCount").textContent = getTracks().length;
  if ($("#sideSongCount")) $("#sideSongCount").textContent = getTracks().length;
  $("#favoriteCount").textContent = getTracks().filter(track => favorites.has(track.id)).length;
  renderSearch();
  renderSupplementalLists();
  drawIcons();
}

async function renderSearch() {
  const query = $("#searchInput").value.trim().toLowerCase();
  if (searchFilter === "people") {
    const requestId = ++peopleSearchRequest;
    const client = getSupabaseClient();
    if (!query) {
      $("#searchLabel").textContent = "Escribe un nombre de usuario para encontrar personas.";
      $("#searchResults").innerHTML = `<div class="empty-state">Busca a alguien por su nombre de usuario.</div>`;
      return;
    }
    if (!client || !authenticatedUser) return;
    const { data, error } = await client.rpc("search_eclipse_people", { search_term: query });
    if (requestId !== peopleSearchRequest) return;
    if (error) {
      $("#searchLabel").textContent = "No pudimos buscar personas todavía.";
      $("#searchResults").innerHTML = `<div class="empty-state">Ejecuta la actualización de Supabase para activar la búsqueda de personas.</div>`;
      return;
    }
    const people = data || [];
    $("#searchLabel").textContent = `${people.length} ${people.length === 1 ? "persona encontrada" : "personas encontradas"}.`;
    $("#searchResults").innerHTML = people.length ? people.map(person => {
      const personName = displayName(person.display_name, "Usuario de Eclipse");
      const avatar = person.avatar_url ? `<img src="${escapeHtml(person.avatar_url)}" alt="" />` : escapeHtml(personName.name.slice(0, 1).toUpperCase());
      return `<article class="person-result"><span class="friend-avatar">${avatar}</span><span><strong>${displayNameMarkup(person.display_name, "Usuario de Eclipse")}</strong><small>${escapeHtml(person.bio || "En Eclipse")}</small><em>${Number(person.follower_count || 0)} seguidores</em></span><button type="button" class="follow-button${person.is_following ? " is-following" : ""}" data-follow-user="${escapeHtml(person.id)}">${person.is_following ? "Siguiendo" : "Seguir"}</button></article>`;
    }).join("") : `<div class="empty-state">No encontramos personas con ese usuario.</div>`;
    drawIcons();
    return;
  }
  const tracks = getTracks().filter(track => {
    const album = getAlbums().find(item => item.id === track.albumId);
    const searchable = `${track.title} ${track.artist} ${album?.name || ""}`.toLowerCase();
    return !query || searchable.includes(query);
  });
  $("#searchLabel").textContent = query
    ? `${tracks.length} ${tracks.length === 1 ? "resultado" : "resultados"} para “${query}”.`
    : "Todo lo que guardes aparecerá aquí.";
  $("#searchResults").innerHTML = tracks.length
    ? tracks.map((track, index) => trackRow(track, index)).join("")
    : `<div class="empty-state">No encontramos nada con ese nombre. Prueba con otra búsqueda.</div>`;
  drawIcons();
}

function renderSupplementalLists() {
  renderQueue();
  renderHistory();
  renderDeletedTracks();
  renderNotifications();
}

function optionalTrackList(container, tracks, emptyMessage, options = {}) {
  if (!container) return;
  const { action = "", includeRestore = false } = options;
  if (!tracks.length) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
    return;
  }
  container.innerHTML = tracks.map((track, index) => `
    <article class="track-row${currentTrack?.id === track.id ? " is-current" : ""}" data-track-id="${escapeHtml(track.id)}" tabindex="0" role="button">
      <span class="track-number">${String(index + 1).padStart(2, "0")}</span>
      <span class="track-thumb ${coverClass(track.cover)}" ${coverStyle(track.cover)}></span>
      <span class="track-info"><strong>${escapeHtml(track.title)}</strong><small>${escapeHtml(track.artist)}</small></span>
      ${action ? `<button type="button" class="track-favorite" data-track-action="${action}" data-track-id="${escapeHtml(track.id)}" aria-label="${includeRestore ? "Recover" : "Remove"} ${escapeHtml(track.title)}">${icon(includeRestore ? "rotate-ccw" : "x")}</button>` : ""}
    </article>`).join("");
  drawIcons();
}

function renderQueue() {
  const containers = [$("#queueList"), $("[data-queue-list]")].filter(Boolean);
  if (!containers.length) return;
  const queue = getQueueTracks();
  containers.forEach(container => optionalTrackList(container, queue, "Your queue is empty.", { action: "remove-from-queue" }));
  $$('[data-queue-count]').forEach(element => { element.textContent = queue.length; });
}

function renderHistory() {
  const containers = [$("#historyList"), $("[data-history-list]")].filter(Boolean);
  if (!containers.length) return;
  const historyTracks = listeningHistory
    .map(entry => getTrackById(entry.id))
    .filter(Boolean)
    .filter((track, index, list) => list.findIndex(item => item.id === track.id) === index)
    .slice(0, 20);
  containers.forEach(container => optionalTrackList(container, historyTracks, "There are no songs in your history yet."));
}

function renderDeletedTracks() {
  const containers = [$("#deletedTracksList"), $("[data-deleted-tracks-list]")].filter(Boolean);
  if (!containers.length) return;
  const deleted = getAllTracks().filter(track => deletedTrackIds.has(track.id));
  containers.forEach(container => optionalTrackList(container, deleted, "You have no deleted songs.", { action: "restore", includeRestore: true }));
}

function renderNotifications() {
  const containers = [$("#notificationList"), $("[data-notification-list]")].filter(Boolean);
  const unread = appNotifications.filter(item => !item.read).length;
  $$('[data-notification-count]').forEach(element => {
    element.textContent = unread;
    element.hidden = unread === 0;
  });
  if (!containers.length) return;
  containers.forEach(container => {
    container.innerHTML = appNotifications.length
      ? appNotifications.map(note => `<button class="notification-item${note.read ? " is-read" : ""}" type="button" data-notification-id="${escapeHtml(note.id)}"><span class="notification-icon">${icon("user-plus")}</span><p>${escapeHtml(note.message)}<small>${formatRelativeTime(note.createdAt)}</small></p></button>`).join("")
      : `<div class="empty-state">No tienes notificaciones nuevas.</div>`;
  });
}

function formatRelativeTime(timestamp) {
  const difference = Math.max(0, Date.now() - timestamp);
  if (difference < 60 * 1000) return "now";
  if (difference < 60 * 60 * 1000) return `${Math.floor(difference / 60000)} min`;
  if (difference < 24 * 60 * 60 * 1000) return `${Math.floor(difference / 3600000)} h`;
  return `${Math.floor(difference / 86400000)} d`;
}

function updatePlayerUI() {
  const track = currentTrack;
  const isFavorite = track && favorites.has(track.id);
  const hasTrack = Boolean(track);
  const title = track?.title || "Tu música te espera";
  const artist = track?.artist || "Sube una canción para comenzar";
  const cover = track?.cover || "ink";
  const playing = hasTrack && !audio.paused;

  [["#miniTitle", title], ["#miniArtist", artist], ["#heroTrack", title], ["#heroArtist", artist], ["#playerTitle", title], ["#playerArtist", artist]].forEach(([selector, text]) => {
    $(selector).textContent = text;
  });
  ["#miniArt", "#heroArt", "#playerArt"].forEach(selector => {
    const el = $(selector);
    el.className = `${selector === "#miniArt" ? "mini-art" : selector === "#heroArt" ? "daily-art" : "player-art"} ${coverClass(cover)}`;
    if (cover.startsWith?.("data:")) el.style.setProperty("--custom-cover", `url('${cover}')`);
    else el.style.removeProperty("--custom-cover");
  });

  $("#miniPlayer").classList.toggle("is-empty", !hasTrack);
  $("#favoriteCurrent").classList.toggle("is-favorite", Boolean(isFavorite));
  $("#heroPlayIcon").innerHTML = icon(playing ? "pause" : "play");
  ["#togglePlay", "#togglePlaySheet"].forEach(selector => {
    const button = $(selector);
    button.setAttribute("aria-label", playing ? "Pausar" : "Reproducir");
    button.innerHTML = icon(playing ? "pause" : "play");
  });
  updatePlaybackControlUI();
  updateMediaSessionState();
  drawIcons();
}

function updatePlaybackControlUI() {
  const repeatLabels = { off: "Repeat off", all: "Repeat playlist", one: "Repeat current song" };
  const shuffleSelectors = '[data-player-action="shuffle"], [data-shuffle], #shuffleButton, #toggleShuffle, .player-controls button[aria-label*="Aleatorio"]';
  const repeatSelectors = '[data-player-action="repeat"], [data-repeat], #repeatButton, #toggleRepeat, .player-controls button[aria-label*="Repetir"]';
  $$(shuffleSelectors).forEach(button => {
    button.classList.toggle("is-active", playbackState.shuffle);
    button.setAttribute("aria-pressed", String(playbackState.shuffle));
    button.setAttribute("aria-label", playbackState.shuffle ? "Aleatorio activado" : "Aleatorio desactivado");
  });
  $$(repeatSelectors).forEach(button => {
    button.classList.toggle("is-active", playbackState.repeat !== "off");
    button.dataset.repeatMode = playbackState.repeat;
    button.setAttribute("aria-pressed", String(playbackState.repeat !== "off"));
    button.setAttribute("aria-label", repeatLabels[playbackState.repeat]);
    const iconName = playbackState.repeat === "one" ? "repeat-1" : "repeat-2";
    const iconElement = button.querySelector("i[data-lucide]");
    if (iconElement && iconElement.dataset.lucide !== iconName) button.innerHTML = icon(iconName);
  });
  $$('[data-player-action="speed"], [data-playback-speed], #playbackSpeed').forEach(control => {
    if ("value" in control && !control.matches("button")) control.value = String(playbackState.speed);
    if (control.matches("button, [role=button]")) control.textContent = `${playbackState.speed}x`;
  });
  $$('[data-player-action="queue"], [data-queue-toggle]').forEach(button => {
    button.setAttribute("aria-label", `Cola de reproduccion, ${getQueueTracks().length} canciones`);
  });
}

function toggleShuffle() {
  playbackState.shuffle = !playbackState.shuffle;
  persistPlaybackState();
  updatePlaybackControlUI();
  showToast(playbackState.shuffle ? "Modo aleatorio activado." : "Modo aleatorio desactivado.");
}

function cycleRepeatMode() {
  playbackState.repeat = playbackState.repeat === "off" ? "all" : playbackState.repeat === "all" ? "one" : "off";
  persistPlaybackState();
  updatePlaybackControlUI();
  const messages = { off: "Repeticion desactivada.", all: "Se repetira la lista.", one: "Se repetira esta cancion." };
  showToast(messages[playbackState.repeat]);
}

function setPlaybackSpeed(value) {
  const speed = Number(value);
  if (!Number.isFinite(speed)) return;
  playbackState.speed = Math.min(3, Math.max(.5, speed));
  audio.playbackRate = playbackState.speed;
  persistPlaybackState();
  updatePlaybackControlUI();
}

function addTrackToQueue(trackId) {
  const track = getTrackById(trackId);
  if (!track) return;
  if (track.id === currentTrack?.id) {
    showToast("Esa cancion ya esta sonando.");
    return;
  }
  if (playbackState.queue.includes(track.id)) {
    showToast("Esa cancion ya esta en tu cola.");
    return;
  }
  playbackState.queue.push(track.id);
  persistPlaybackState();
  renderQueue();
  updatePlaybackControlUI();
  showToast(`"${track.title}" se anadio a la cola.`);
}

function removeTrackFromQueue(trackId) {
  const before = playbackState.queue.length;
  playbackState.queue = playbackState.queue.filter(id => id !== trackId);
  if (before === playbackState.queue.length) return;
  persistPlaybackState();
  renderQueue();
  updatePlaybackControlUI();
}

function recordHistory(track) {
  if (!track?.id) return;
  listeningHistory = [{ id: track.id, playedAt: Date.now() }, ...listeningHistory.filter(item => item.id !== track.id)].slice(0, 50);
  save(ADVANCED_STORAGE.history, listeningHistory);
  renderHistory();
}

function deleteTrack(trackId) {
  const track = getTrackById(trackId, true);
  if (!track || deletedTrackIds.has(trackId)) return;
  deletedTrackIds.add(trackId);
  save(ADVANCED_STORAGE.deletedTracks, [...deletedTrackIds]);
  removeTrackFromQueue(trackId);
  if (currentTrack?.id === trackId) {
    audio.pause();
    const replacement = getTracks()[0] || null;
    currentTrack = null;
    if (replacement) setCurrentTrack(replacement, false, { recordHistory: false });
  }
  renderAlbums();
  renderTracks();
  showToast(`"${track.title}" se movio a eliminadas.`);
}

function restoreTrack(trackId) {
  const track = getTrackById(trackId, true);
  if (!track || !deletedTrackIds.has(trackId)) return;
  deletedTrackIds.delete(trackId);
  save(ADVANCED_STORAGE.deletedTracks, [...deletedTrackIds]);
  renderAlbums();
  renderTracks();
  showToast(`"${track.title}" se recupero.`);
}

function saveTrackMetadata(trackId, values = {}) {
  const track = getTrackById(trackId, true);
  if (!track) return false;
  const allowed = ["title", "artist", "genre", "description", "albumId", "cover"];
  const next = { ...(trackMetadata[trackId] || {}) };
  allowed.forEach(key => {
    if (typeof values[key] === "string") next[key] = values[key].trim();
  });
  if (next.albumId && !getAlbums().some(album => album.id === next.albumId)) delete next.albumId;
  trackMetadata[trackId] = next;
  if (!save(ADVANCED_STORAGE.trackMeta, trackMetadata)) return false;
  if (currentTrack?.id === trackId) currentTrack = getTrackById(trackId, true);
  renderAlbums();
  renderTracks();
  updatePlayerUI();
  return true;
}

function setDynamicAccent(color) {
  const root = document.documentElement;
  root.style.setProperty("--track-accent", color);
  root.style.setProperty("--dynamic-accent", color);
  root.dataset.dynamicAccent = "true";
}

function clearDynamicAccent() {
  const root = document.documentElement;
  root.style.removeProperty("--track-accent");
  root.style.removeProperty("--dynamic-accent");
  delete root.dataset.dynamicAccent;
}

function colorFromImage(source, fallback) {
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d", { willReadFrequently: true });
        canvas.width = 24;
        canvas.height = 24;
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let red = 0;
        let green = 0;
        let blue = 0;
        let count = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          const alpha = pixels[index + 3];
          const max = Math.max(pixels[index], pixels[index + 1], pixels[index + 2]);
          const min = Math.min(pixels[index], pixels[index + 1], pixels[index + 2]);
          if (alpha < 180 || max - min < 10) continue;
          red += pixels[index];
          green += pixels[index + 1];
          blue += pixels[index + 2];
          count += 1;
        }
        if (!count) return resolve(fallback);
        const mix = value => Math.round(value / count * .72 + 255 * .28);
        resolve(`#${[mix(red), mix(green), mix(blue)].map(value => value.toString(16).padStart(2, "0")).join("")}`);
      } catch {
        resolve(fallback);
      }
    };
    image.onerror = () => resolve(fallback);
    image.src = source;
  });
}

function applyDynamicAccent(track) {
  if (!settings.dynamicTheme || !track) return clearDynamicAccent();
  const fallback = COVER_ACCENTS[track.cover] || COVER_ACCENTS.ink;
  const requestId = ++accentRequestId;
  if (!track.cover?.startsWith("data:")) {
    setDynamicAccent(fallback);
    return;
  }
  colorFromImage(track.cover, fallback).then(color => {
    if (requestId === accentRequestId && settings.dynamicTheme && currentTrack?.id === track.id) setDynamicAccent(color);
  });
}

function updateMediaSessionState() {
  if (!("mediaSession" in navigator)) return;
  try {
    if (currentTrack && "MediaMetadata" in window) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist,
        album: getAlbums().find(album => album.id === currentTrack.albumId)?.name || "Eclipse",
        artwork: currentTrack.cover?.startsWith("data:") ? [{ src: currentTrack.cover, sizes: "512x512", type: "image/jpeg" }] : []
      });
    }
    navigator.mediaSession.playbackState = currentTrack && !audio.paused ? "playing" : "paused";
  } catch {
    // Media Session is a progressive enhancement and should never block playback.
  }
}

function installMediaSessionHandlers() {
  if (!("mediaSession" in navigator)) return;
  const handlers = {
    play: () => togglePlay(),
    pause: () => audio.pause(),
    previoustrack: () => nextTrack(-1),
    nexttrack: () => nextTrack(1),
    seekbackward: details => seekBy(-(details.seekOffset || 10)),
    seekforward: details => seekBy(details.seekOffset || 10)
  };
  Object.entries(handlers).forEach(([action, handler]) => {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* Unsupported action. */ }
  });
}

function seekBy(seconds) {
  if (!audio.duration || !Number.isFinite(audio.duration)) return;
  audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + seconds));
}

function setCurrentTrack(track, autoplay = true, options = {}) {
  if (!track) return;
  currentTrack = track;
  if (options.recordHistory !== false) recordHistory(track);
  const shouldUseAudio = Boolean(track.src);
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  updatePlayerUI();
  renderTracks();

  if (shouldUseAudio) {
    audio.src = track.src;
    audio.volume = Number($("#volume").value);
    audio.playbackRate = playbackState.speed;
    if (autoplay) {
      audio.play().catch(() => showToast("Toca reproducir para iniciar la canción."));
    }
  } else if (autoplay) {
    showToast("Esta es una canción de ejemplo. Sube un audio para escucharlo aquí.");
  }
}

function togglePlay() {
  if (!currentTrack) {
    const firstUploaded = sessionTracks[0];
    if (firstUploaded) setCurrentTrack(firstUploaded, true);
    else showToast("Primero sube una canción desde tu biblioteca.");
    return;
  }
  if (!currentTrack.src) {
    showToast("Esta canción es una portada de muestra. Sube tus audios para reproducirlos.");
    return;
  }
  if (audio.paused) audio.play().catch(() => showToast("No pudimos iniciar ese archivo de audio."));
  else audio.pause();
}

function openSheet(id) {
  const sheet = document.getElementById(id);
  if (!sheet) return;
  $$(".sheet.open").forEach(item => {
    item.classList.remove("open");
    item.setAttribute("aria-hidden", "true");
    item.inert = true;
  });
  sheet.classList.add("open");
  sheet.setAttribute("aria-hidden", "false");
  sheet.inert = false;
  $("#sheetBackdrop").classList.add("visible");
  requestAnimationFrame(() => sheet.querySelector("button, input, select")?.focus());
}

function closeSheets() {
  $$(".sheet.open").forEach(item => {
    item.classList.remove("open");
    item.setAttribute("aria-hidden", "true");
    item.inert = true;
  });
  $("#sheetBackdrop").classList.remove("visible");
}

function switchView(viewName) {
  $$(".view").forEach(view => view.classList.toggle("active", view.dataset.view === viewName));
  $$(".tab").forEach(tab => tab.classList.toggle("active", tab.dataset.target === viewName));
  if (viewName === "search") setTimeout(() => $("#searchInput").focus(), 160);
  if (viewName === "friends") renderFriends();
}

function openAlbum(albumId) {
  const album = getAlbums().find(item => item.id === albumId);
  if (!album) return;
  selectedAlbumId = album.id;
  const tracks = getTracks().filter(track => track.albumId === album.id);
  const cover = $("#albumDetailCover");
  cover.className = `album-detail-cover ${coverClass(album.cover)}`;
  if (album.cover?.startsWith("data:")) cover.style.setProperty("--custom-cover", `url('${album.cover}')`);
  else cover.style.removeProperty("--custom-cover");
  $("#albumDetailMood").textContent = (album.mood || "colección").toUpperCase();
  $("#albumDetailName").textContent = album.name;
  $("#albumDetailMeta").textContent = `${tracks.length} ${tracks.length === 1 ? "canción" : "canciones"}`;
  $("#albumTrackList").innerHTML = tracks.length
    ? tracks.map((track, index) => trackRow(track, index, true)).join("")
    : `<div class="empty-state">Este álbum está listo. Sube canciones y será tuyo por completo.</div>`;
  $("#deleteAlbum").style.visibility = customAlbums.some(item => item.id === album.id) ? "visible" : "hidden";
  openSheet("albumSheet");
  drawIcons();
}

function readImage(file, callback) {
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    showToast("Elige una imagen válida.");
    return;
  }
  const reader = new FileReader();
  reader.onload = async () => callback(file.type === "image/gif" ? reader.result : await optimizeImage(reader.result));
  reader.readAsDataURL(file);
}

function optimizeImage(dataUrl) {
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => {
      const maxDimension = 1280;
      const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", .84));
    };
    image.onerror = () => resolve(dataUrl);
    image.src = dataUrl;
  });
}

function getUntitledAlbum() {
  let album = getAlbums().find(item => item.id === "album-personal");
  if (!album) {
    album = { id: "album-personal", name: "Mis canciones", mood: "subidas por mí", cover: "ink" };
    customAlbums.push(album);
    save(STORAGE.albums, customAlbums);
    renderAlbums();
  }
  return album;
}

function getUploadAlbum() {
  const requestedId = $("#musicAlbumSelect").value;
  return getAlbums().find(album => album.id === requestedId) || getUntitledAlbum();
}

async function uploadMusic(files, options = {}) {
  const validFiles = [...files].filter(isAudioFile);
  if (!validFiles.length) {
    showToast("Selecciona al menos un archivo de audio.");
    return;
  }
  const sourceKeys = options.sourceKeys || [];
  const entries = validFiles.map((file, index) => ({ file, sourceKey: sourceKeys[index] || null }))
    .filter(entry => !entry.sourceKey || !sessionTracks.some(track => track.sourceKey === entry.sourceKey));
  if (!entries.length) return 0;
  const album = getUploadAlbum();
  const existingCount = sessionTracks.length;
  const newTracks = entries.map(({ file, sourceKey }, index) => {
    const name = file.name.replace(/\.[^/.]+$/, "");
    return {
      id: `upload-${Date.now()}-${index}`,
      title: name || "Canción sin título",
      artist: "Mi archivo",
      albumId: album.id,
      cover: ["ink", "mist", "cloud", "lines"][((existingCount + index) % 4)],
      duration: "—",
      sourceKey,
      src: URL.createObjectURL(file)
    };
  });
  const saved = await Promise.all(newTracks.map((track, index) => saveUploadedTrack(track, entries[index].file)));
  sessionTracks.push(...newTracks);
  renderAlbums();
  renderTracks();
  if (!currentTrack) setCurrentTrack(sessionTracks[0], false);
  if (saved.every(Boolean)) {
    showToast(`${validFiles.length} ${validFiles.length === 1 ? "canción añadida" : "canciones añadidas"} a tu biblioteca.`);
  } else {
    showToast("Las canciones están listas; algunas solo quedarán disponibles en esta sesión.");
  }
  return entries.length;
}

function isAudioFile(file) {
  return file.type.startsWith("audio/") || /\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i.test(file.name);
}

async function getSavedMusicFolder() {
  const database = await openMusicDatabase();
  if (!database) return null;
  return new Promise(resolve => {
    const request = database.transaction(MUSIC_FOLDER_STORE, "readonly").objectStore(MUSIC_FOLDER_STORE).get("main");
    request.onsuccess = () => resolve(request.result?.handle || null);
    request.onerror = () => resolve(null);
  });
}

async function saveMusicFolder(handle) {
  const database = await openMusicDatabase();
  if (!database) return false;
  return new Promise(resolve => {
    const transaction = database.transaction(MUSIC_FOLDER_STORE, "readwrite");
    transaction.objectStore(MUSIC_FOLDER_STORE).put({ id: "main", handle });
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => resolve(false);
  });
}

async function collectMusicFiles(folder, path = "") {
  const found = [];
  for await (const handle of folder.values()) {
    const location = path ? `${path}/${handle.name}` : handle.name;
    if (handle.kind === "directory") found.push(...await collectMusicFiles(handle, location));
    else if (handle.kind === "file") {
      const file = await handle.getFile();
      if (isAudioFile(file)) found.push({ file, sourceKey: location });
    }
  }
  return found;
}

async function syncMusicFolder(handle = musicFolderHandle, silent = false) {
  if (!handle) return 0;
  const permission = await handle.queryPermission({ mode: "read" });
  if (permission !== "granted") return 0;
  const files = await collectMusicFiles(handle);
  const added = await uploadMusic(files.map(item => item.file), { sourceKeys: files.map(item => item.sourceKey) });
  if (!silent && !added) showToast("Tu carpeta ya está sincronizada. No hay canciones nuevas.");
  return added;
}

async function chooseMusicFolder() {
  if (!window.showDirectoryPicker) {
    showToast("La sincronización de carpetas funciona en Chrome o Edge de computador.");
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: "read", startIn: "music" });
    if (await handle.requestPermission({ mode: "read" }) !== "granted") return showToast("Necesitamos permiso para leer esa carpeta.");
    musicFolderHandle = handle;
    await saveMusicFolder(handle);
    const button = $("#syncMusicFolder");
    if (button) button.classList.add("is-synced");
    const added = await syncMusicFolder(handle);
    if (added) showToast(`Carpeta conectada: ${added} canciones nuevas en tu biblioteca.`);
  } catch (error) {
    if (error?.name !== "AbortError") showToast("No pudimos conectar esa carpeta de música.");
  }
}

async function restoreMusicFolder() {
  if (!window.showDirectoryPicker) return;
  musicFolderHandle = await getSavedMusicFolder();
  if (!musicFolderHandle) return;
  const permission = await musicFolderHandle.queryPermission({ mode: "read" });
  if (permission === "granted") {
    $("#syncMusicFolder")?.classList.add("is-synced");
    await syncMusicFolder(musicFolderHandle, true);
  }
}

function createAlbum(event) {
  event.preventDefault();
  const name = $("#albumNameInput").value.trim();
  const mood = $("#albumMoodInput").value.trim();
  if (!name) return;
  const album = {
    id: `album-custom-${Date.now()}`,
    name,
    mood: mood || "mi colección",
    cover: selectedCover
  };
  customAlbums.push(album);
  if (!save(STORAGE.albums, customAlbums)) {
    customAlbums.pop();
    showToast("No hubo espacio para guardar ese álbum. Prueba con una portada más ligera.");
    return;
  }
  $("#albumForm").reset();
  selectedCover = "ink";
  renderAlbums();
  $("#musicAlbumSelect").value = album.id;
  closeSheets();
  showToast(`“${name}” ya vive en tu biblioteca.`);
}

function toggleFavorite(trackId) {
  if (favorites.has(trackId)) favorites.delete(trackId);
  else favorites.add(trackId);
  save(STORAGE.favorites, [...favorites]);
  renderTracks();
  if (selectedAlbumId && $("#albumSheet").classList.contains("open")) openAlbum(selectedAlbumId);
  updatePlayerUI();
}

function deleteSelectedAlbum() {
  if (!selectedAlbumId || !customAlbums.some(album => album.id === selectedAlbumId)) return;
  const album = customAlbums.find(item => item.id === selectedAlbumId);
  const hasUploadedSongs = sessionTracks.some(track => track.albumId === selectedAlbumId);
  if (hasUploadedSongs) {
    showToast("Este álbum tiene canciones subidas. Por ahora conserva la colección.");
    return;
  }
  customAlbums = customAlbums.filter(item => item.id !== selectedAlbumId);
  save(STORAGE.albums, customAlbums);
  selectedAlbumId = null;
  renderAlbums();
  closeSheets();
  showToast(`Se eliminó “${album.name}”.`);
}

function nextTrack(direction, respectRepeat = false) {
  const tracks = getTracks();
  if (!tracks.length) return;
  const queuedTracks = getQueueTracks();
  if (direction > 0 && queuedTracks.length) {
    const queued = queuedTracks[0];
    playbackState.queue.shift();
    persistPlaybackState();
    setCurrentTrack(queued, true);
    renderQueue();
    return;
  }
  if (playbackState.shuffle && tracks.length > 1) {
    const alternatives = tracks.filter(track => track.id !== currentTrack?.id);
    setCurrentTrack(alternatives[Math.floor(Math.random() * alternatives.length)], true);
    return;
  }
  const currentIndex = Math.max(0, tracks.findIndex(track => track.id === currentTrack?.id));
  const rawIndex = currentIndex + direction;
  if (respectRepeat && rawIndex >= tracks.length && playbackState.repeat !== "all") {
    audio.pause();
    audio.currentTime = 0;
    updatePlayerUI();
    return;
  }
  const newIndex = (rawIndex + tracks.length) % tracks.length;
  setCurrentTrack(tracks[newIndex], true);
}

function bindEvents() {
  $("#authSwitch").addEventListener("click", () => { authMode = authMode === "login" ? "register" : "login"; renderAuthMode(); });
  $("#authForm").addEventListener("submit", async event => {
    event.preventDefault();
    const client = getSupabaseClient();
    if (!client) return setAuthStatus("Configura Supabase primero.");
    const email = $("#authEmail").value.trim(), password = $("#authPassword").value, submit = $("#authSubmit");
    submit.disabled = true; setAuthStatus("Un momento…");
    const result = authMode === "register"
      ? await client.auth.signUp({ email, password, options: { data: { display_name: $("#authName").value.trim() } } })
      : await client.auth.signInWithPassword({ email, password });
    submit.disabled = false;
    if (result.error) return setAuthStatus(result.error.message);
    if (authMode === "register") {
      // A new account always proceeds to the sign-in step before entering Eclipse.
      const displayName = $("#authName").value.trim();
      if (displayName) {
        settings.profileName = displayName;
        save(STORAGE.settings, settings);
      }
      if (result.data.session) await client.auth.signOut();
      authMode = "login";
      renderAuthMode();
      $("#authEmail").value = email;
      $("#authPassword").value = "";
      return setAuthStatus("Cuenta creada. Ahora inicia sesión para entrar.");
    }
    if (!result.data.session) return setAuthStatus("Revisa tu correo para confirmar la cuenta y luego inicia sesión.");
    authenticatedUser = result.data.user;
    if (authMode === "register" && $("#authName").value.trim()) settings.profileName = $("#authName").value.trim();
    // Primero recuperamos la nube: nunca sobrescribas el perfil existente con
    // los valores locales de este dispositivo al iniciar sesión.
    await loadCloudProfile();
    applySettings();
    renderFriends();
    startSocialUpdates();
    hideLoginGate();
    openFriendLinkIfPresent();
  });
  // Hover sounds are available after the first deliberate interaction, which is
  // the only way to comply with browser audio policies.
  document.addEventListener("pointerdown", unlockInterfaceSound, { once: true });
  document.addEventListener("keydown", unlockInterfaceSound, { once: true });
  $$(".setting-toggle").forEach(toggle => {
    toggle.addEventListener("pointerenter", event => {
      if (event.pointerType === "mouse") playSwitchHoverSound();
    });
  });
  $("#openCustomize").addEventListener("click", () => openSheet("settingsSheet"));
  $("#desktopCustomize").addEventListener("click", () => openSheet("settingsSheet"));
  $("#openProfile").addEventListener("click", () => openSheet("profileSheet"));
  $("#openAbout")?.addEventListener("click", () => openSheet("aboutSheet"));
  $("#openAboutFromProfile")?.addEventListener("click", () => openSheet("aboutSheet"));
  $("#copyFriendCode").addEventListener("click", async () => {
    const code = getFriendCode();
    try {
      await navigator.clipboard.writeText(code);
      showToast("Código copiado. Compártelo con tus friends.");
    } catch {
      showToast(`Tu código es ${code}`);
    }
  });
  $("#addFriend").addEventListener("click", async () => {
    const code = normalizeFriendCode($("#friendCodeInput").value);
    if (!code) return showToast("Escribe el código de tu friend.");
    if (!/^ECLIPSE-[A-Z0-9]{4,30}$/.test(code)) return showToast("Revisa el código: debe empezar por ECLIPSE-.");
    if (code === getFriendCode()) return showToast("Ese es tu propio código.");
    const client = getSupabaseClient();
    if (!client || !authenticatedUser) return showToast("Inicia sesión para agregar friends.");
    const button = $("#addFriend");
    button.disabled = true;
    const { error } = await client.rpc("send_friend_request", { requested_code: code });
    button.disabled = false;
    if (error) return showToast(error.message);
    $("#friendCodeInput").value = "";
    $("#friendSentCode").textContent = code;
    openSheet("friendSentSheet");
    renderFriends();
  });
  $("#refreshFriends").addEventListener("click", renderFriends);
  $("#friendsList").addEventListener("click", async event => {
    const removeButton = event.target.closest("[data-remove-friend]");
    if (removeButton) {
      if (!window.confirm("¿Eliminar a este friend? Podrán enviarse una nueva solicitud cuando quieran.")) return;
      const client = getSupabaseClient();
      if (!client) return;
      removeButton.disabled = true;
      const { error } = await client.from("friendships").delete().eq("id", removeButton.dataset.removeFriend);
      if (error) { removeButton.disabled = false; return showToast(error.message); }
      showToast("Friend eliminado de tu círculo.");
      return renderFriends();
    }
    const friendButton = event.target.closest("[data-open-friend]");
    if (friendButton) return openFriendProfile(friendProfiles.get(friendButton.dataset.openFriend));
    const button = event.target.closest("[data-accept-friend], [data-decline-friend]");
    if (!button) return;
    const client = getSupabaseClient();
    if (!client) return;
    button.disabled = true;
    const requestId = button.dataset.acceptFriend || button.dataset.declineFriend;
    const { error } = button.dataset.acceptFriend
      ? await client.from("friendships").update({ status: "accepted", accepted_at: new Date().toISOString() }).eq("id", requestId)
      : await client.from("friendships").delete().eq("id", requestId);
    if (error) return showToast(error.message);
    showToast(button.dataset.acceptFriend ? "Ahora son friends. Ya puedes ver su espacio." : "Solicitud rechazada.");
    renderFriends();
  });
  $("#showFriendQr").addEventListener("click", async () => {
    const code = getFriendCode();
    $("#friendQrCode").textContent = code;
    const image = $("#friendQrImage");
    if (window.QRCode?.toDataURL) {
      try {
        image.src = await window.QRCode.toDataURL(getFriendShareLink(), { width: 240, margin: 2, color: { dark: "#141414", light: "#f6f6f2" } });
      } catch {
        image.removeAttribute("src");
        showToast("No pudimos generar el QR. Usa el código de arriba.");
      }
    } else {
      image.removeAttribute("src");
      showToast("No pudimos cargar el generador QR. Usa el código de arriba.");
    }
    openSheet("friendQrSheet");
  });
  $("#openPlayer").addEventListener("click", () => openSheet("playerSheet"));
  $("#openPlayerFromMini").addEventListener("click", () => openSheet("playerSheet"));
  $("#openAlbumCreator").addEventListener("click", () => openSheet("creatorSheet"));
  $("#openLibraryActions").addEventListener("click", () => openSheet("libraryActionsSheet"));
  $("#uploadMusicCta").addEventListener("click", () => $("#musicInput").click());
  $("#syncMusicFolder")?.addEventListener("click", chooseMusicFolder);
  $("#chooseMusic").addEventListener("click", () => { closeSheets(); $("#musicInput").click(); });
  $("#chooseAlbum").addEventListener("click", () => { closeSheets(); openSheet("creatorSheet"); });
  $("#sheetBackdrop").addEventListener("click", closeSheets);
  $$('[data-close-sheet]').forEach(button => button.addEventListener("click", closeSheets));

  $$(".tab").forEach(tab => tab.addEventListener("click", () => tab.dataset.target && switchView(tab.dataset.target)));
  $$(".tab-sheet").forEach(tab => tab.addEventListener("click", () => tab.dataset.sheet && openSheet(tab.dataset.sheet)));
  $("#tabUpload").addEventListener("click", () => $("#musicInput").click());
  $("#navOrganizer").addEventListener("click", event => {
    const button = event.target.closest("[data-move-nav]");
    if (!button) return;
    const index = settings.navOrder.indexOf(button.dataset.moveNav);
    const nextIndex = index + Number(button.dataset.direction);
    if (nextIndex < 0 || nextIndex >= settings.navOrder.length) return;
    [settings.navOrder[index], settings.navOrder[nextIndex]] = [settings.navOrder[nextIndex], settings.navOrder[index]];
    save(STORAGE.settings, settings);
    applyNavigationOrder();
  });
  $("#quickUpload").addEventListener("click", () => $("#musicInput").click());
  $("#quickThemes").addEventListener("click", () => openSheet("settingsSheet"));
  $("#quickRadio").addEventListener("click", () => { const tracks = getTracks(); if (tracks.length) setCurrentTrack(tracks[Math.floor(Math.random() * tracks.length)], true); });
  $("#explorePeople")?.addEventListener("click", () => {
    switchView("search");
    document.querySelector("[data-search-filter='people']")?.click();
    $("#searchInput").focus();
  });
  $("#openHistory").addEventListener("click", () => {
    switchView("library");
    document.querySelector("[data-library-view='history']")?.click();
  });
  $("#openNotifications").addEventListener("click", () => openSheet("notificationsSheet"));
  $("#openQueue").addEventListener("click", () => { renderQueue(); openSheet("queueSheet"); });
  $("#openLyrics").addEventListener("click", () => { $("#lyricsTrack").textContent = currentTrack?.title || "Sigue la canción"; openSheet("lyricsSheet"); });
  $("#openFullScreen").addEventListener("click", () => $("#playerSheet").requestFullscreen?.().catch(() => {}));
  $("#shuffleToggle").addEventListener("click", toggleShuffle);
  $("#repeatToggle").addEventListener("click", cycleRepeatMode);
  $$("[data-theme]").forEach(button => button.addEventListener("click", () => { settings.theme = button.dataset.theme; save(STORAGE.settings, settings); applySettings(); showToast("Tema actualizado."); }));
  $$("[data-setting='interface-mode']").forEach(button => button.addEventListener("click", () => { settings.interfaceMode = button.dataset.value; save(STORAGE.settings, settings); applySettings(); }));
  $("#interfaceScale").addEventListener("input", event => { settings.interfaceScale = Number(event.target.value) / 100; $("#interfaceScaleValue").textContent = `${event.target.value}%`; save(STORAGE.settings, settings); applyVisualPreferences(); });
  ["dynamic-theme", "animations", "autoplay", "notifications", "sound-effects"].forEach(key => { const control = document.querySelector(`[data-setting='${key}']`); control?.addEventListener("change", () => { const settingKey = key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()); settings[settingKey] = control.checked; save(STORAGE.settings, settings); applySettings(); }); });
  $("#soundEffectsVolume").addEventListener("input", event => {
    settings.soundEffectsVolume = Number(event.target.value) / 100;
    $("#soundEffectsVolumeValue").textContent = `${event.target.value}%`;
    save(STORAGE.settings, settings);
  });
  $("#audioQuality").addEventListener("change", event => { settings.audioQuality = event.target.value; save(STORAGE.settings, settings); });
  $("#resetPalette").addEventListener("click", () => { settings.theme = "mono"; save(STORAGE.settings, settings); applySettings(); });
  ["#accentColor", "#paperColor"].forEach(selector => $(selector).addEventListener("input", event => document.documentElement.style.setProperty(selector === "#accentColor" ? "--accent" : "--paper", event.target.value)));
  $("#changeProfileBanner").addEventListener("click", () => $("#profileBannerInput").click());
  $("#profileBannerInput").addEventListener("change", event => readImage(event.target.files[0], image => {
    settings.profileBanner = image;
    save(STORAGE.settings, settings);
    applySettings();
    syncCloudProfile();
  }));
  $$(".chip").forEach(chip => chip.addEventListener("click", () => {
    activeFilter = chip.dataset.filter;
    $$(".chip").forEach(item => item.classList.toggle("active", item === chip));
    renderTracks();
  }));

  $("#searchInput").addEventListener("input", renderSearch);
  $("#profileNameInput")?.addEventListener("input", event => updateNameColorPreview(event.target.value));
  $$(".search-filter").forEach(button => button.addEventListener("click", () => {
    $$(".search-filter").forEach(item => item.classList.toggle("active", item === button));
    searchFilter = button.dataset.searchFilter;
    renderSearch();
  }));
  $$(".library-switch").forEach(button => button.addEventListener("click", () => {
    const mode = button.dataset.libraryView;
    $$(".library-switch").forEach(item => item.classList.toggle("active", item === button));
    const albums = $("#libraryAlbums"), secondary = $("#librarySecondaryList");
    if (mode === "albums") { albums.hidden = false; secondary.hidden = true; return; }
    albums.hidden = true; secondary.hidden = false;
    const tracks = mode === "favorites" ? getTracks().filter(track => favorites.has(track.id)) : listeningHistory.map(item => getTracks().find(track => track.id === item.id)).filter(Boolean);
    secondary.innerHTML = tracks.length ? tracks.map((track, index) => trackRow(track, index)).join("") : `<div class="empty-state">Todavía no hay canciones aquí.</div>`;
    drawIcons();
  }));
  $("#togglePlay").addEventListener("click", togglePlay);
  $("#togglePlaySheet").addEventListener("click", togglePlay);
  $("#favoriteCurrent").addEventListener("click", () => currentTrack && toggleFavorite(currentTrack.id));
  $("#previousTrack").addEventListener("click", () => nextTrack(-1));
  $("#nextTrack").addEventListener("click", () => nextTrack(1));
  $("#playAlbum").addEventListener("click", () => {
    const first = getTracks().find(track => track.albumId === selectedAlbumId);
    if (first) setCurrentTrack(first, true);
    else showToast("Añade canciones a este álbum para reproducirlo.");
  });
  $("#deleteAlbum").addEventListener("click", deleteSelectedAlbum);

  // Desktop convenience: drop audio files anywhere in the library instead of
  // having to find the upload button each time.
  ["dragenter", "dragover"].forEach(type => document.addEventListener(type, event => {
    if ([...event.dataTransfer.types].includes("Files")) {
      event.preventDefault();
      document.body.classList.add("is-dragging-files");
    }
  }));
  ["dragleave", "drop"].forEach(type => document.addEventListener(type, event => {
    if (type === "drop") {
      event.preventDefault();
      const files = [...event.dataTransfer.files].filter(file => file.type.startsWith("audio/"));
      if (files.length) uploadMusic(files);
    }
    document.body.classList.remove("is-dragging-files");
  }));

  $("#backgroundInput").addEventListener("change", event => readImage(event.target.files[0], image => {
    const previous = settings.background;
    settings.background = image;
    if (save(STORAGE.settings, settings)) {
      applySettings();
      showToast("Tu nuevo fondo ya está puesto.");
    } else {
      settings.background = previous;
      applySettings();
      showToast("La imagen es muy grande para guardarla. Prueba otra más ligera.");
    }
  }));
  $("#resetBackground").addEventListener("click", () => {
    settings.background = "";
    if (save(STORAGE.settings, settings)) {
      applySettings();
      showToast("Volvimos al fondo blanco y negro.");
    }
  });
  $("#profileInput").addEventListener("change", event => readImage(event.target.files[0], image => {
    const previous = settings.profileImage;
    settings.profileImage = image;
    if (save(STORAGE.settings, settings)) {
      applySettings();
      syncCloudProfile();
      showToast("Tu foto de perfil está lista.");
    } else {
      settings.profileImage = previous;
      applySettings();
      showToast("La foto es muy grande para guardarla. Prueba otra más ligera.");
    }
  }));
  $("#musicInput").addEventListener("change", event => {
    uploadMusic(event.target.files);
    event.target.value = "";
  });
  $("#saveProfile").addEventListener("click", () => {
    const previous = { ...settings };
    settings.profileName = $("#profileNameInput").value.trim() || "Luna";
    settings.profileBio = $("#profileBioInput").value.trim();
    settings.profileSocial = $("#profileSocialInput").value.trim();
    settings.favoriteArtists = $("#favoriteArtistsInput").value.trim();
    if (save(STORAGE.settings, settings)) {
      applySettings();
      syncCloudProfile();
      closeSheets();
      showToast("Tu perfil se actualizó.");
    } else {
      settings = previous;
      showToast("No pudimos guardar tu perfil en este dispositivo.");
    }
  });
  $("#profileGalleryInput").addEventListener("change", event => {
    const files = [...event.target.files].slice(0, 3);
    if (!files.length) return;
    const gallery = [];
    files.forEach((file, index) => readImage(file, image => {
      gallery[index] = image;
      if (gallery.filter(Boolean).length !== files.length) return;
      settings.profileGallery = gallery;
      if (save(STORAGE.settings, settings)) {
        applySettings();
        syncCloudProfile();
        showToast("Tu galería ya está decorando el perfil.");
      } else {
        showToast("Las fotos son muy grandes para guardarlas. Prueba imágenes más ligeras.");
      }
    }));
    event.target.value = "";
  });
  const closeSession = async event => {
    const button = event.currentTarget;
    $$("#signOut, #mobileSignOut").forEach(item => { item.disabled = true; });
    const client = getSupabaseClient();
    if (client) {
      const { error } = await client.auth.signOut();
      if (error) {
        $$("#signOut, #mobileSignOut").forEach(item => { item.disabled = false; });
        return showToast(error.message);
      }
    }
    $$("#signOut, #mobileSignOut").forEach(item => { item.disabled = false; });
    showLoginGate("Sesión cerrada. Inicia sesión para volver a entrar.");
  };
  $$("#signOut, #mobileSignOut").forEach(button => button.addEventListener("click", closeSession));
  $("#profileImageScale")?.addEventListener("input", event => {
    settings.profileImageScale = Number(event.target.value) / 100;
    const valueLabel = $("#profileImageScaleValue");
    if (valueLabel) valueLabel.textContent = `${event.target.value}%`;
    save(STORAGE.settings, settings);
    applySettings();
  });
  $("#profileImageScale")?.addEventListener("change", syncCloudProfile);
  ["profileImagePositionX", "profileImagePositionY"].forEach(key => {
    $(`#${key}`)?.addEventListener("input", event => {
      settings[key] = Number(event.target.value);
      save(STORAGE.settings, settings);
      applySettings();
      syncCloudProfile();
    });
  });
  $$(".avatar-style-row [data-avatar-shape]").forEach(button => button.addEventListener("click", () => {
    settings.profileAvatarShape = button.dataset.avatarShape;
    save(STORAGE.settings, settings);
    applySettings();
  }));
  $("#resetProfilePhoto")?.addEventListener("click", () => {
    settings.profileImage = "";
    settings.profileImageScale = 1;
    settings.profileImagePositionX = 50;
    settings.profileImagePositionY = 50;
    settings.profileAvatarShape = "circle";
    save(STORAGE.settings, settings);
    applySettings();
    syncCloudProfile();
    showToast("Restauramos tu foto de perfil.");
  });
  [["profileBannerScale", "profileBannerScaleValue"], ["profileBannerPositionX"], ["profileBannerPositionY"]].forEach(([key, label]) => {
    $(`#${key}`)?.addEventListener("input", event => {
      settings[key] = key === "profileBannerScale" ? Number(event.target.value) / 100 : Number(event.target.value);
      if (label) $(`#${label}`).textContent = `${event.target.value}%`;
      save(STORAGE.settings, settings);
      applySettings();
      syncCloudProfile();
    });
  });
  $("#resetProfileBanner")?.addEventListener("click", () => {
    settings.profileBanner = "";
    settings.profileBannerScale = 1;
    settings.profileBannerPositionX = 50;
    settings.profileBannerPositionY = 50;
    save(STORAGE.settings, settings);
    applySettings();
    syncCloudProfile();
  });
  $("#albumForm").addEventListener("submit", createAlbum);
  $("#albumCoverInput").addEventListener("change", event => readImage(event.target.files[0], image => {
    selectedCover = image;
    $(".cover-upload span").textContent = "Portada lista para tu álbum";
  }));

  document.addEventListener("click", event => {
    const followButton = event.target.closest("[data-follow-user]");
    if (followButton) {
      const client = getSupabaseClient();
      if (!client || !authenticatedUser) return;
      followButton.disabled = true;
      const target = followButton.dataset.followUser;
      const request = followButton.classList.contains("is-following")
        ? client.from("follows").delete().eq("follower_id", authenticatedUser.id).eq("following_id", target)
        : client.from("follows").insert({ follower_id: authenticatedUser.id, following_id: target });
      request.then(({ error }) => {
        if (error) showToast(error.message);
        else { showToast(followButton.classList.contains("is-following") ? "Ya no sigues a esta persona." : "Ahora sigues a esta persona."); renderSearch(); }
      });
      return;
    }
    const favoriteButton = event.target.closest("[data-favorite-id]");
    if (favoriteButton) {
      event.stopPropagation();
      toggleFavorite(favoriteButton.dataset.favoriteId);
      return;
    }
    const albumButton = event.target.closest("[data-album-id]");
    if (albumButton) {
      openAlbum(albumButton.dataset.albumId);
      return;
    }
    const trackButton = event.target.closest("[data-track-id]");
    if (trackButton) {
      const track = getTracks().find(item => item.id === trackButton.dataset.trackId);
      setCurrentTrack(track, true);
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeSheets();
    if (event.key === " " && !event.target.matches("input, textarea, select, button")) {
      event.preventDefault();
      togglePlay();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "u") {
      event.preventDefault();
      $("#musicInput").click();
    }
    if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-track-id]")) {
      event.preventDefault();
      const track = getTracks().find(item => item.id === event.target.dataset.trackId);
      setCurrentTrack(track, true);
    }
  });

  audio.addEventListener("play", updatePlayerUI);
  audio.addEventListener("pause", updatePlayerUI);
  audio.addEventListener("loadedmetadata", () => {
    if (currentTrack) {
      currentTrack.duration = formatTime(audio.duration);
      renderTracks();
    }
    $("#duration").textContent = formatTime(audio.duration);
  });
  audio.addEventListener("timeupdate", () => {
    const percent = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
    $("#seekBar").value = percent;
    $("#seekBar").style.setProperty("--progress", `${percent}%`);
    $("#miniProgress").style.width = `${percent}%`;
    $("#currentTime").textContent = formatTime(audio.currentTime);
  });
  audio.addEventListener("ended", () => {
    if (playbackState.repeat === "one") {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    } else if (settings.autoplay) {
      nextTrack(1, true);
    } else {
      updatePlayerUI();
    }
  });
  audio.addEventListener("error", () => {
    if (audio.currentSrc) showToast("No pudimos leer ese archivo de audio.");
  });
  $("#seekBar").addEventListener("input", event => {
    const percent = Number(event.target.value);
    event.target.style.setProperty("--progress", `${percent}%`);
    if (audio.duration) audio.currentTime = (percent / 100) * audio.duration;
  });
  $("#volume").addEventListener("input", event => { audio.volume = Number(event.target.value); });
}

async function init() {
  setClock();
  setInterval(setClock, 30000);
  $$(".sheet").forEach(sheet => { sheet.inert = true; });
  sessionTracks = await loadUploadedTracks();
  await restoreMusicFolder();
  removeOrphanedFavorites();
  applySettings();
  renderAlbums();
  renderTracks();
  updatePlayerUI();
  bindEvents();
  drawIcons();
  renderAuthMode();
  await initialiseAuth();
}

document.addEventListener("DOMContentLoaded", init);
