const MAP_SIZE = 2048;
const MAP_PIXELS_PER_MILE = 482.24;
const MAP_ROUTE_EXPORT_SIZE = 6020;

const MAP_SAFE_HAVENS = {
  emberwood: { label: "Emberwood Village", minutes: 120, landmarkId: "EV" },
  eckermanMill: { label: "Eckerman Mill", minutes: 20, landmarkId: "EM" }
};

const MAP_LANDMARKS = [
  { id: "EV", label: "Road to Emberwood Village", x: 1557, y: 1895, type: "safe-haven" },
  { id: "EM", label: "Road to Eckerman Mill", x: 155, y: 358, type: "safe-haven" },
  { id: "01", label: "Academy Gate", x: 700, y: 566 },
  { id: "02", label: "King's Gate", x: 1358, y: 652 },
  { id: "03", label: "Champion's Gate", x: 1111, y: 1095 },
  { id: "04", label: "Temple Gate", x: 767, y: 1109 },
  { id: "05", label: "Shepherd's Gate", x: 628, y: 778 },
  { id: "06", label: "Rat's Nest Tavern", x: 530, y: 858 },
  { id: "07", label: "Reed Manor", x: 697, y: 413 },
  { id: "08", label: "Stick's Ferry", x: 829, y: 1313 },
  { id: "09", label: "Drakkenheim Garrison", x: 687, y: 719 },
  { id: "10", label: "Inscrutable Tower", x: 832, y: 593 },
  { id: "11", label: "Saint Vitruvio's Cathedral", x: 845, y: 915 },
  { id: "12", label: "Cosmological Clocktower", x: 1063, y: 816 },
  { id: "13", label: "Saint Selina's Monastery", x: 987, y: 1157 },
  { id: "14", label: "Slaughterstone Square", x: 1202, y: 711 },
  { id: "15", label: "Marketplace", x: 940, y: 811 },
  { id: "16", label: "Kleinberg Estate", x: 1206, y: 542 },
  { id: "17", label: "Black Ivory Inn", x: 1522, y: 616 },
  { id: "18", label: "Buckledown Row", x: 1520, y: 891 },
  { id: "19", label: "Spokes Smithy", x: 1354, y: 1151 },
  { id: "20", label: "Chapel of Saint Brenna", x: 1246, y: 1428 },
  { id: "21", label: "Rose Theatre", x: 702, y: 918 }
];

const MAP_DEFAULT_LANDMARKS = MAP_LANDMARKS.map((landmark) => ({ ...landmark }));

const MAP_PACE_LABELS = { fast: "Fast", normal: "Normal", slow: "Slow" };
const MAP_TERRAIN_LABELS = { mainRoad: "Main roads", sideRoad: "Side roads / rubble — forced slow pace" };
const MAP_ROUTE_LEG_LABELS = { inbound: "Into Drakkenheim", outbound: "Out of Drakkenheim" };
const MAP_ROUTE_VISIBILITY_LABELS = { all: "All route", inbound: "Into only", outbound: "Out only" };

const MAP_EVENT_TYPES = {
  shortRest: "Short rest",
  searchDelerium: "Search for delerium",
  searchObjective: "Search for a specific thing",
  searchRestSpot: "Search for a short rest spot",
  getLost: "Get lost / wrong turn",
  custom: "Custom note"
};


let mapRoutePoints = [];
let mapRouteSegments = [];
let mapRestSpots = [];
let mapOutsideTrips = [];
let mapEvents = [];
let addingMapRestSpot = false;
let editingMapLandmarks = false;
let selectedMapLandmarkIndex = 0;
let mapPanState = null;
let mapFloatingControlsDragState = null;
let mapFloatingControlsPosition = { leftPercent: 1.2, topPercent: 1.2 };
let isRestoringSavedState = false;
let hasLoadedSavedState = false;
const STANDALONE_STATE_KEY = "drakkenheim-route-mapper-standalone-state-v2";

const byId = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const arrayOrFallback = (value, fallback = []) => Array.isArray(value) ? value : fallback;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function formatMiles(value) {
  const miles = Math.max(0, Number(value) || 0);
  if (miles < 0.01 && miles > 0) return "<0.01 miles";
  const rounded = Math.round(miles * 100) / 100;
  return `${rounded.toLocaleString(undefined, { maximumFractionDigits: 2 })} mile${rounded === 1 ? "" : "s"}`;
}

function formatHoursFromMinutes(minutes) {
  const mins = Math.max(0, Math.round(Number(minutes) || 0));
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
  const hours = Math.floor(mins / 60);
  const remainder = mins % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours} hour${hours === 1 ? "" : "s"}`;
}

function mapEventDuration(event) {
  const duration = Math.floor(Number(event && event.durationMinutes) || 0);
  return Math.max(0, duration);
}

function buildMapEventLabel(event) {
  if (!event) return "Event";
  return String(event.label || MAP_EVENT_TYPES[event.type] || "Event");
}


function parseMapTimeToMinutes(value) {
  const match = String(value || "08:00").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 8 * 60;
  return (Number(match[1]) * 60) + Number(match[2]);
}

function formatMapClock(totalMinutes) {
  const minutes = ((Math.floor(Number(totalMinutes) || 0) % 1440) + 1440) % 1440;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function formatMapTimeRange(startMinutes, durationMinutes) {
  return `${formatMapClock(startMinutes)}–${formatMapClock(startMinutes + durationMinutes)}`;
}

function formatMapNotesClock(totalMinutes) {
  const minutes = ((Math.floor(Number(totalMinutes) || 0) % 1440) + 1440) % 1440;
  const hours24 = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const suffix = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  return mins ? `${hours12}:${String(mins).padStart(2, "0")}${suffix}` : `${hours12}${suffix}`;
}

function formatMapNotesTimeRange(startMinutes, durationMinutes) {
  return `${formatMapNotesClock(startMinutes)} - ${formatMapNotesClock(startMinutes + durationMinutes)}`;
}

function currentMapStartTime() { return byId("mapDayStartTime")?.value || "08:00"; }
function currentMapPace() { const value = byId("mapTravelPace")?.value; return MAP_PACE_LABELS[value] ? value : "normal"; }
function currentMapTerrain() { const value = byId("mapTerrain")?.value; return MAP_TERRAIN_LABELS[value] ? value : "mainRoad"; }
function currentMapRouteLeg() { const value = byId("mapRouteLeg")?.value; return MAP_ROUTE_LEG_LABELS[value] ? value : "inbound"; }
function currentMapRouteVisibility() { const value = byId("mapRouteVisibility")?.value; return MAP_ROUTE_VISIBILITY_LABELS[value] ? value : "all"; }

function syncMapTerrainPaceControl() {
  const paceSelect = byId("mapTravelPace");
  const terrainSelect = byId("mapTerrain");
  if (!paceSelect || !terrainSelect) return;
  const forcedSlow = terrainSelect.value === "sideRoad";

  if (forcedSlow) {
    if (!paceSelect.disabled && MAP_PACE_LABELS[paceSelect.value]) {
      paceSelect.dataset.previousMainRoadPace = paceSelect.value;
    }
    paceSelect.value = "slow";
  } else {
    const restorePace = MAP_PACE_LABELS[paceSelect.dataset.previousMainRoadPace]
      ? paceSelect.dataset.previousMainRoadPace
      : (MAP_PACE_LABELS[paceSelect.value] ? paceSelect.value : "normal");
    if (paceSelect.disabled) paceSelect.value = restorePace;
    if (MAP_PACE_LABELS[paceSelect.value]) paceSelect.dataset.previousMainRoadPace = paceSelect.value;
  }

  paceSelect.disabled = forcedSlow;
  paceSelect.title = forcedSlow ? "Side roads / rubble force slow pace." : "";
  const field = paceSelect.closest("label");
  if (field) field.classList.toggle("forced-pace-field", forcedSlow);
}

function effectiveMapPace(pace = currentMapPace(), terrain = currentMapTerrain()) {
  return terrain === "sideRoad" ? "slow" : (MAP_PACE_LABELS[pace] ? pace : "normal");
}

function mapSpeedMilesPerHour(pace = currentMapPace(), terrain = currentMapTerrain()) {
  const effectivePace = effectiveMapPace(pace, terrain);
  if (effectivePace === "fast") return 1;
  if (effectivePace === "slow") return 0.25;
  return 0.5;
}

function updateMapPaceNote() {
  syncMapTerrainPaceControl();
  const pace = currentMapPace();
  const terrain = currentMapTerrain();
  const effectivePace = effectiveMapPace(pace, terrain);
  const speed = mapSpeedMilesPerHour(pace, terrain);
  const forcedNote = terrain === "sideRoad" ? "; pace selector locked to slow" : "";
  byId("mapPaceNote").textContent = `Next ${MAP_ROUTE_LEG_LABELS[currentMapRouteLeg()].toLowerCase()} route hour allows ${formatMiles(speed)} of travel at ${MAP_PACE_LABELS[effectivePace].toLowerCase()} pace / ${MAP_TERRAIN_LABELS[terrain].toLowerCase()}${forcedNote}.`;
}

function normaliseMapPoint(point) {
  return {
    x: clamp(point?.x, 0, MAP_SIZE),
    y: clamp(point?.y, 0, MAP_SIZE),
    label: point?.label || ""
  };
}

function pointDistance(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function mapSegmentHours(segment) {
  const explicit = Number(segment?.segmentHours);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const pace = MAP_PACE_LABELS[segment?.pace] ? segment.pace : "normal";
  const terrain = MAP_TERRAIN_LABELS[segment?.terrain] ? segment.terrain : "mainRoad";
  return Math.max(0, Number(segment?.distanceMiles) || 0) / Math.max(0.001, mapSpeedMilesPerHour(pace, terrain));
}

function currentMapHourInfo() {
  if (!mapRouteSegments.length) return null;
  const last = mapRouteSegments[mapRouteSegments.length - 1];
  if (last.hourComplete !== false) return null;
  const hourIndex = Number.isFinite(Number(last.hourIndex)) ? Number(last.hourIndex) : 0;
  const hourSegments = mapRouteSegments.filter((segment) => Number(segment.hourIndex) === hourIndex);
  const usedHours = Math.min(1, hourSegments.reduce((total, segment) => total + mapSegmentHours(segment), 0));
  const remainingHours = Math.max(0, 1 - usedHours);
  const currentSpeed = mapSpeedMilesPerHour();
  return { hourIndex, usedHours, remainingHours, currentSpeed, remainingMiles: remainingHours * currentSpeed };
}

function nextMapHourIndex() {
  if (!mapRouteSegments.length) return 0;
  const last = mapRouteSegments[mapRouteSegments.length - 1];
  const lastIndex = Number.isFinite(Number(last.hourIndex)) ? Number(last.hourIndex) : mapRouteSegments.length - 1;
  return last.hourComplete === false ? lastIndex : lastIndex + 1;
}

function mapHourIsComplete(hourIndex) {
  return mapRouteSegments.filter((segment) => Number(segment.hourIndex) === Number(hourIndex)).some((segment) => segment.hourComplete !== false);
}

function getMapHourSummaries() {
  const summaries = [];
  mapRouteSegments.forEach((segment, index) => {
    const hourIndex = Number(segment.hourIndex) || 0;
    let summary = summaries.find((entry) => entry.hourIndex === hourIndex);
    if (!summary) {
      summary = { hourIndex, hourNumber: hourIndex + 1, distanceMiles: 0, usedHours: 0, complete: false, paces: new Set(), terrains: new Set(), legs: new Set(), parts: [] };
      summaries.push(summary);
    }
    const distanceMiles = Number(segment.distanceMiles) || 0;
    const segmentTime = mapSegmentHours(segment);
    const terrain = MAP_TERRAIN_LABELS[segment.terrain] ? segment.terrain : "mainRoad";
    const leg = MAP_ROUTE_LEG_LABELS[segment.leg] ? segment.leg : "inbound";
    const pace = MAP_PACE_LABELS[segment.pace] ? segment.pace : "normal";
    summary.distanceMiles += distanceMiles;
    summary.usedHours += segmentTime;
    summary.complete = summary.complete || segment.hourComplete !== false;
    summary.paces.add(pace);
    summary.terrains.add(terrain);
    summary.legs.add(leg);
    summary.parts.push({ pace, terrain, leg, distanceMiles, segmentHours: segmentTime, segmentIndex: index });
  });
  summaries.forEach((summary) => {
    summary.usedHours = Math.min(1, summary.usedHours);
    summary.remainingHours = Math.max(0, 1 - summary.usedHours);
    summary.pace = summary.paces.size === 1 ? [...summary.paces][0] : "mixed";
    summary.terrain = summary.terrains.size === 1 ? [...summary.terrains][0] : "mixed";
    summary.leg = summary.legs.size === 1 ? [...summary.legs][0] : "mixed";
  });
  summaries.sort((a, b) => a.hourIndex - b.hourIndex);
  return summaries;
}


function mapHourSummaryMinutes(summary) {
  const minutes = Math.round((Number(summary && summary.usedHours) || 0) * 60);
  return Math.max(1, Math.min(60, minutes));
}

function combineConsecutiveMapHourParts(parts) {
  return arrayOrFallback(parts, []).reduce((combined, part) => {
    if (!part) return combined;
    const normalised = {
      pace: MAP_PACE_LABELS[part.pace] ? part.pace : "normal",
      terrain: MAP_TERRAIN_LABELS[part.terrain] ? part.terrain : "mainRoad",
      leg: MAP_ROUTE_LEG_LABELS[part.leg] ? part.leg : "inbound",
      distanceMiles: Number(part.distanceMiles) || 0,
      segmentHours: Number(part.segmentHours) || 0,
      segmentIndex: Number(part.segmentIndex) || 0
    };
    const previous = combined[combined.length - 1];
    if (previous && previous.pace === normalised.pace && previous.terrain === normalised.terrain && previous.leg === normalised.leg) {
      previous.distanceMiles += normalised.distanceMiles;
      previous.segmentHours += normalised.segmentHours;
      previous.endSegmentIndex = normalised.segmentIndex;
    } else {
      combined.push({ ...normalised, endSegmentIndex: normalised.segmentIndex });
    }
    return combined;
  }, []);
}

function formatMapHourPartBreakdown(part) {
  return `${MAP_ROUTE_LEG_LABELS[part.leg] || "Into Drakkenheim"}, ${MAP_PACE_LABELS[part.pace] || "Normal"}, ${MAP_TERRAIN_LABELS[part.terrain] || "Main roads"} ${formatMiles(part.distanceMiles)}`;
}

function activeMapLandmarkById(id) { return MAP_LANDMARKS.find((landmark) => landmark.id === id); }

function selectedMapLandmark() {
  return MAP_LANDMARKS[selectedMapLandmarkIndex] || MAP_LANDMARKS[0] || null;
}

function mapLandmarkOptionLabel(landmark) {
  return `${landmark.id}. ${landmark.label}`;
}

function safeHavenKeyForLandmarkId(id) { return Object.keys(MAP_SAFE_HAVENS).find((key) => MAP_SAFE_HAVENS[key].landmarkId === id) || ""; }

function currentMapSafeHavenKey() {
  const value = byId("mapSafeHaven")?.value;
  return MAP_SAFE_HAVENS[value] ? value : "emberwood";
}

function lastApproachSafeHavenKey() {
  for (let i = mapOutsideTrips.length - 1; i >= 0; i -= 1) {
    const trip = mapOutsideTrips[i];
    if (trip?.type === "approach" && MAP_SAFE_HAVENS[trip.haven]) return trip.haven;
  }
  return "";
}

function startRouteFromSafeHaven(havenKey = currentMapSafeHavenKey(), force = false) {
  const haven = MAP_SAFE_HAVENS[havenKey];
  if (!haven || (mapRoutePoints.length && !force)) return;
  const landmark = activeMapLandmarkById(haven.landmarkId);
  if (!landmark) return;
  mapRoutePoints = [{ x: landmark.x, y: landmark.y, label: `${landmark.id}. ${landmark.label}` }];
  mapRouteSegments = [];
}

function addMapStart(point) {
  mapRoutePoints = [normaliseMapPoint(point)];
  mapRouteSegments = [];
  addingMapRestSpot = false;
  renderMapTools();
}

function addMapSegmentToward(targetPoint, endCurrentHourEarly = false) {
  if (!mapRoutePoints.length) {
    addMapStart(targetPoint);
    return;
  }
  const start = mapRoutePoints[mapRoutePoints.length - 1];
  const target = normaliseMapPoint(targetPoint);
  const distancePixels = pointDistance(start, target);
  if (distancePixels < 4) return;
  const openHour = currentMapHourInfo();
  const hourIndex = openHour ? openHour.hourIndex : nextMapHourIndex();
  const selectedPace = currentMapPace();
  const terrain = currentMapTerrain();
  const pace = effectiveMapPace(selectedPace, terrain);
  const leg = currentMapRouteLeg();
  const speed = Math.max(0.001, mapSpeedMilesPerHour(selectedPace, terrain));
  const remainingHours = openHour ? openHour.remainingHours : 1;
  const remainingPixels = remainingHours * speed * MAP_PIXELS_PER_MILE;
  if (remainingPixels <= 1) return;
  const ratio = Math.min(1, remainingPixels / distancePixels);
  const end = normaliseMapPoint({
    x: start.x + ((target.x - start.x) * ratio),
    y: start.y + ((target.y - start.y) * ratio),
    label: target.label || ""
  });
  const distanceMiles = pointDistance(start, end) / MAP_PIXELS_PER_MILE;
  const segmentHours = distanceMiles / speed;
  const reachedTarget = ratio >= 0.999;
  const hourComplete = endCurrentHourEarly || !reachedTarget || segmentHours >= remainingHours - 0.005;
  mapRoutePoints.push(end);
  mapRouteSegments.push({ pace, terrain, leg, distanceMiles, segmentHours, hourIndex, hourComplete });
  renderMapTools();
}

function endCurrentMapHourAtCurrentMarker(point) {
  const openHour = currentMapHourInfo();
  if (!openHour || !point || !mapRoutePoints.length || !mapRouteSegments.length) return false;
  const currentPoint = mapRoutePoints[mapRoutePoints.length - 1];
  if (pointDistance(currentPoint, normaliseMapPoint(point)) > 18) return false;
  for (let i = mapRouteSegments.length - 1; i >= 0; i -= 1) {
    if (Number(mapRouteSegments[i].hourIndex) === Number(openHour.hourIndex)) {
      mapRouteSegments[i].hourComplete = true;
      renderMapTools();
      return true;
    }
  }
  return false;
}

function pointFromMapCoordinates(event) {
  const surface = byId("mapZoomSurface");
  if (!surface) return null;
  const rect = surface.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const x = ((event.clientX - rect.left) / rect.width) * MAP_SIZE;
  const y = ((event.clientY - rect.top) / rect.height) * MAP_SIZE;
  return normaliseMapPoint({ x, y });
}

function pointFromMapEvent(event) {
  const landmarkElement = event.target.closest ? event.target.closest("[data-landmark-index]") : null;
  if (landmarkElement) {
    const landmark = MAP_LANDMARKS[Number(landmarkElement.dataset.landmarkIndex)];
    if (!landmark) return null;
    return { x: landmark.x, y: landmark.y, label: `${landmark.id}. ${landmark.label}`, landmarkId: landmark.id, safeHavenKey: safeHavenKeyForLandmarkId(landmark.id) };
  }
  return pointFromMapCoordinates(event);
}

function updateLandmarkEditControls() {
  const select = byId("mapLandmarkEditSelect");
  const toggleButton = byId("toggleLandmarkEditMode");
  const note = byId("mapPinEditNote");
  const landmark = selectedMapLandmark();

  if (select) {
    select.innerHTML = MAP_LANDMARKS.map((item, index) => `<option value="${index}">${escapeHtml(mapLandmarkOptionLabel(item))}</option>`).join("");
    select.value = String(Math.max(0, selectedMapLandmarkIndex));
  }
  if (toggleButton) {
    toggleButton.textContent = editingMapLandmarks ? "Stop Moving Pins" : "Move Selected Pin";
    toggleButton.classList.toggle("active", editingMapLandmarks);
  }
  if (note) {
    note.textContent = editingMapLandmarks && landmark
      ? `Pin moving is on. Click the map to move ${mapLandmarkOptionLabel(landmark)}.`
      : "Select a landmark, then enable pin moving and click the map to reposition it.";
  }
}

function moveSelectedMapLandmark(point) {
  const landmark = selectedMapLandmark();
  if (!landmark || !point) return;
  landmark.x = clamp(point.x, 0, MAP_SIZE);
  landmark.y = clamp(point.y, 0, MAP_SIZE);
  renderMapTools();
}

function toggleLandmarkEditMode() {
  editingMapLandmarks = !editingMapLandmarks;
  addingMapRestSpot = false;
  renderMapTools();
}

function resetMapLandmarkPositions() {
  MAP_DEFAULT_LANDMARKS.forEach((defaultLandmark, index) => {
    if (!MAP_LANDMARKS[index]) return;
    MAP_LANDMARKS[index].x = defaultLandmark.x;
    MAP_LANDMARKS[index].y = defaultLandmark.y;
  });
  editingMapLandmarks = false;
  renderMapTools();
}

function buildMapLandmarkDataText() {
  const rows = MAP_LANDMARKS.map((landmark) => {
    const typePart = landmark.type ? `, type: "${landmark.type}"` : "";
    return `  { id: "${landmark.id}", label: "${landmark.label}", x: ${Math.round(landmark.x)}, y: ${Math.round(landmark.y)}${typePart} }`;
  });
  return `const MAP_LANDMARKS = [\n${rows.join(",\n")}\n];`;
}

async function copyMapLandmarkData() {
  const text = buildMapLandmarkDataText();
  try {
    await navigator.clipboard.writeText(text);
    alert("Landmark data copied.");
  } catch (_error) {
    prompt("Copy this landmark data:", text);
  }
}

function handleMapClick(event) {
  if (event.target.closest(".map-zoom-widget") || mapPanState) return;
  if (editingMapLandmarks) {
    const rawPoint = pointFromMapCoordinates(event);
    moveSelectedMapLandmark(rawPoint);
    return;
  }
  const point = pointFromMapEvent(event);
  if (!point) return;
  if (addingMapRestSpot) {
    addMapRestSpot(point);
    return;
  }
  if (point.safeHavenKey && !mapRoutePoints.length) addOutsideTravel("approach", point.safeHavenKey);
  else addMapSegmentToward(point, false);
}

function handleMapDoubleClick(event) {
  event.preventDefault();
  if (event.target.closest(".map-zoom-widget")) return;
  if (editingMapLandmarks) {
    const rawPoint = pointFromMapCoordinates(event);
    moveSelectedMapLandmark(rawPoint);
    return;
  }
  const point = pointFromMapEvent(event);
  if (!point) return;
  if (addingMapRestSpot) addMapRestSpot(point);
  else if (!endCurrentMapHourAtCurrentMarker(point)) addMapSegmentToward(point, true);
}

function preventMapContextMenu(event) { event.preventDefault(); }

function startMapPan(event) {
  if (event.button !== 2 || event.target.closest(".map-zoom-widget") || event.target.closest(".map-floating-route-controls")) return;
  const stage = byId("drakkenheimMapStage");
  if (!stage) return;
  event.preventDefault();
  mapPanState = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, scrollLeft: stage.scrollLeft, scrollTop: stage.scrollTop };
  stage.classList.add("is-panning");
  stage.setPointerCapture(event.pointerId);
}

function moveMapPan(event) {
  const stage = byId("drakkenheimMapStage");
  if (!stage || !mapPanState || mapPanState.pointerId !== event.pointerId) return;
  stage.scrollLeft = mapPanState.scrollLeft - (event.clientX - mapPanState.startX);
  stage.scrollTop = mapPanState.scrollTop - (event.clientY - mapPanState.startY);
}

function endMapPan(event) {
  const stage = byId("drakkenheimMapStage");
  if (!stage || !mapPanState || mapPanState.pointerId !== event.pointerId) return;
  mapPanState = null;
  stage.classList.remove("is-panning");
  if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
}

function setMapZoom(value, originClientX = null, originClientY = null) {
  const input = byId("mapZoom");
  const surface = byId("mapZoomSurface");
  const stage = byId("drakkenheimMapStage");
  if (!input || !surface || !stage) return;

  const newZoom = Math.max(1, Math.min(3, Number(value) || 1));
  const oldRect = surface.getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();
  let focusRatioX = null;
  let focusRatioY = null;
  let focusStageX = null;
  let focusStageY = null;

  if (originClientX !== null && originClientY !== null && oldRect.width && oldRect.height) {
    focusRatioX = (originClientX - oldRect.left) / oldRect.width;
    focusRatioY = (originClientY - oldRect.top) / oldRect.height;
    focusStageX = originClientX - stageRect.left;
    focusStageY = originClientY - stageRect.top;
  }

  input.value = String(newZoom);
  surface.style.transform = "";
  surface.style.width = `${100 * newZoom}%`;
  surface.style.height = "";
  byId("mapZoomValue").textContent = `${Math.round(newZoom * 100)}%`;

  if (focusRatioX !== null && focusRatioY !== null) {
    const newRect = surface.getBoundingClientRect();
    stage.scrollLeft = (newRect.width * focusRatioX) - focusStageX;
    stage.scrollTop = (newRect.height * focusRatioY) - focusStageY;
  }
  saveStandaloneState();
}

function handleMapCtrlWheelZoom(event) {
  if (!event.ctrlKey) return;
  event.preventDefault();
  const current = Number(byId("mapZoom")?.value) || 1;
  const delta = event.deltaY < 0 ? 0.1 : -0.1;
  setMapZoom(current + delta, event.clientX, event.clientY);
}

function showMapTooltip(event) {
  const target = event.target.closest ? event.target.closest("[data-map-tooltip]") : null;
  const tooltip = byId("mapPinTooltip");
  if (!target || !tooltip) return;
  tooltip.textContent = target.dataset.mapTooltip || "";
  tooltip.hidden = false;
  moveMapTooltip(event);
}

function moveMapTooltip(event) {
  const tooltip = byId("mapPinTooltip");
  const wrap = document.querySelector(".map-stage-wrap");
  if (!tooltip || tooltip.hidden || !wrap) return;
  const rect = wrap.getBoundingClientRect();
  tooltip.style.left = `${event.clientX - rect.left + 14}px`;
  tooltip.style.top = `${event.clientY - rect.top + 14}px`;
}
function hideMapTooltip() { const tooltip = byId("mapPinTooltip"); if (tooltip) tooltip.hidden = true; }

function startMapFloatingRouteDrag(event) {
  const controls = byId("mapFloatingRouteControls");
  const wrap = document.querySelector(".map-stage-wrap");
  if (!controls || !wrap || (event.button && event.button !== 0)) return;
  event.preventDefault();
  const controlsRect = controls.getBoundingClientRect();
  mapFloatingControlsDragState = { pointerId: event.pointerId, offsetX: event.clientX - controlsRect.left, offsetY: event.clientY - controlsRect.top };
  controls.setPointerCapture(event.pointerId);
}

function moveMapFloatingRouteDrag(event) {
  const controls = byId("mapFloatingRouteControls");
  const wrap = document.querySelector(".map-stage-wrap");
  if (!controls || !wrap || !mapFloatingControlsDragState || mapFloatingControlsDragState.pointerId !== event.pointerId) return;
  const wrapRect = wrap.getBoundingClientRect();
  const maxLeft = Math.max(0, wrapRect.width - controls.offsetWidth);
  const maxTop = Math.max(0, wrapRect.height - controls.offsetHeight);
  const leftPx = Math.max(0, Math.min(maxLeft, event.clientX - wrapRect.left - mapFloatingControlsDragState.offsetX));
  const topPx = Math.max(0, Math.min(maxTop, event.clientY - wrapRect.top - mapFloatingControlsDragState.offsetY));
  mapFloatingControlsPosition = { leftPercent: wrapRect.width ? (leftPx / wrapRect.width) * 100 : 1.2, topPercent: wrapRect.height ? (topPx / wrapRect.height) * 100 : 1.2 };
  applyMapFloatingRouteControlsPosition();
}

function endMapFloatingRouteDrag(event) {
  const controls = byId("mapFloatingRouteControls");
  if (!controls || !mapFloatingControlsDragState || mapFloatingControlsDragState.pointerId !== event.pointerId) return;
  mapFloatingControlsDragState = null;
  if (controls.hasPointerCapture(event.pointerId)) controls.releasePointerCapture(event.pointerId);
  saveStandaloneState();
}


function normaliseMapFloatingControlsPosition(position) {
  const left = Number(position && position.leftPercent);
  const top = Number(position && position.topPercent);
  return {
    leftPercent: Number.isFinite(left) ? clamp(left, 0, 95) : 1.2,
    topPercent: Number.isFinite(top) ? clamp(top, 0, 95) : 1.2
  };
}

function applyMapFloatingRouteControlsPosition() {
  const controls = byId("mapFloatingRouteControls");
  if (!controls) return;
  controls.style.left = `${mapFloatingControlsPosition.leftPercent}%`;
  controls.style.top = `${mapFloatingControlsPosition.topPercent}%`;
}

function addOutsideTravel(type, forcedHavenKey = null) {
  const havenKey = forcedHavenKey && MAP_SAFE_HAVENS[forcedHavenKey] ? forcedHavenKey : currentMapSafeHavenKey();
  mapOutsideTrips.push({ type, haven: havenKey, minutes: MAP_SAFE_HAVENS[havenKey].minutes });
  if (type === "approach") startRouteFromSafeHaven(havenKey);
  renderMapTools();
}

function clearOutsideTravel() {
  mapOutsideTrips = [];
  renderMapTools();
}

function clearMapRoute() {
  if (!mapRoutePoints.length && !mapRouteSegments.length && !mapEvents.length) return;
  const havenKey = lastApproachSafeHavenKey();
  const resetNote = havenKey ? " The start point will reset to the latest logged approach safe haven." : " No approach is logged, so the next map click will set a new start point.";
  if (!confirm(`Clear the current city route and logged events?${resetNote}`)) return;
  mapRoutePoints = [];
  mapRouteSegments = [];
  mapEvents = [];
  if (havenKey) startRouteFromSafeHaven(havenKey, true);
  renderMapTools();
}

function undoMapSegment() {
  if (!mapRoutePoints.length) return;
  if (mapRoutePoints.length === 1) {
    mapRoutePoints = [];
    mapRouteSegments = [];
  } else if (mapRouteSegments.length) {
    const lastHourIndex = Number(mapRouteSegments[mapRouteSegments.length - 1].hourIndex) || 0;
    while (mapRouteSegments.length && (Number(mapRouteSegments[mapRouteSegments.length - 1].hourIndex) || 0) === lastHourIndex) {
      mapRouteSegments.pop();
      mapRoutePoints.pop();
    }
    if (!mapRouteSegments.length && mapRoutePoints.length > 1) mapRoutePoints = [mapRoutePoints[0]];
  }
  renderMapTools();
}

function updateMapEventNoteField() {
  const select = byId("mapEventType");
  const noteInput = byId("mapEventCustomText");
  if (!select || !noteInput) return;
  const type = MAP_EVENT_TYPES[select.value] ? select.value : "shortRest";
  if (type === "custom") noteInput.placeholder = "Custom event note";
  else if (type === "searchObjective") noteInput.placeholder = "What is being searched for?";
  else noteInput.placeholder = "Optional note";
}

function addMapEvent() {
  const select = byId("mapEventType");
  const customInput = byId("mapEventCustomText");
  const durationInput = byId("mapEventCustomDuration");
  const type = select && MAP_EVENT_TYPES[select.value] ? select.value : "shortRest";
  let label = MAP_EVENT_TYPES[type];
  const customText = customInput ? String(customInput.value || "").trim() : "";
  if ((type === "custom" || type === "searchObjective") && !customText) {
    alert(type === "custom" ? "Enter a custom event note first." : "Enter what is being searched for.");
    return;
  }
  const durationMinutes = Math.max(0, Math.floor(Number(durationInput && durationInput.value) || 0));
  if (!durationMinutes) {
    alert("Enter how many minutes the event takes.");
    return;
  }
  if (type === "searchObjective") label = `${MAP_EVENT_TYPES[type]} — ${customText}`;
  else if (type === "custom") label = customText;
  else if (customText) label = `${MAP_EVENT_TYPES[type]} — ${customText}`;

  const hourCount = getMapHourSummaries().length;
  mapEvents.push({ type, label, afterHours: hourCount, durationMinutes });
  if (customInput) customInput.value = "";
  if (durationInput) durationInput.value = "60";
  renderMapTools();
}

function beginAddShortRestSpot() {
  addingMapRestSpot = !addingMapRestSpot;
  renderMapTools();
}

function addMapRestSpot(point) {
  if (mapRestSpots.length >= 3) {
    alert("You already have 3 saved short rest spots. Delete one before adding another.");
    addingMapRestSpot = false;
    renderMapTools();
    return;
  }
  const name = prompt("Name this short rest spot:", `Short rest spot ${mapRestSpots.length + 1}`) || `Short rest spot ${mapRestSpots.length + 1}`;
  mapRestSpots.push({ ...normaliseMapPoint(point), name: name.trim() || `Short rest spot ${mapRestSpots.length + 1}` });
  addingMapRestSpot = false;
  renderMapTools();
}

function normalisedMapRouteLeg(segment) { return MAP_ROUTE_LEG_LABELS[segment?.leg] ? segment.leg : "inbound"; }
function mapRouteSegmentIsVisible(segment, routeVisibility = currentMapRouteVisibility()) { return routeVisibility === "all" || normalisedMapRouteLeg(segment) === routeVisibility; }
function getVisibleMapRouteSegments(routeVisibility = currentMapRouteVisibility()) {
  return mapRouteSegments.reduce((visible, segment, index) => {
    const leg = normalisedMapRouteLeg(segment);
    if (!mapRouteSegmentIsVisible({ ...segment, leg }, routeVisibility)) return visible;
    const a = mapRoutePoints[index];
    const b = mapRoutePoints[index + 1];
    if (!a || !b) return visible;
    visible.push({ index, a, b, leg, segment: { ...segment, leg }, hourComplete: mapHourIsComplete(segment.hourIndex) });
    return visible;
  }, []);
}

function getMapRouteMarkerData(routeVisibility = currentMapRouteVisibility()) {
  const hourSummaries = getMapHourSummaries();
  const visibleSegmentInfos = getVisibleMapRouteSegments(routeVisibility);
  const markerIndexes = [];
  if (visibleSegmentInfos.length) {
    const firstVisible = visibleSegmentInfos[0];
    markerIndexes.push({ pointIndex: firstVisible.index, label: "S", title: mapRoutePoints[firstVisible.index]?.label || "Visible route start", classes: "start" });
  } else if (mapRoutePoints.length && routeVisibility === "all") {
    markerIndexes.push({ pointIndex: 0, label: "S", title: mapRoutePoints[0].label || "Route start", classes: "start" });
  }
  hourSummaries.forEach((summary) => {
    const visibleParts = summary.parts.filter((part) => routeVisibility === "all" || part.leg === routeVisibility);
    if (!visibleParts.length) return;
    const endpointIndex = Math.max(...visibleParts.map((part) => part.segmentIndex + 1));
    if (!mapRoutePoints[endpointIndex]) return;
    markerIndexes.push({ pointIndex: endpointIndex, label: String(summary.hourNumber), title: `${summary.complete ? "End" : "Current end"} of hour ${summary.hourNumber}`, classes: `${summary.complete ? "complete" : "open-hour-end"}` });
  });
  return markerIndexes;
}

function renderMapLandmarks() {
  const svg = byId("mapLandmarkSvg");
  const list = byId("mapLandmarkList");
  if (svg) {
    svg.innerHTML = MAP_LANDMARKS.map((landmark, index) => `
      <g class="map-landmark-marker ${landmark.type === "safe-haven" ? "safe-haven" : ""} ${editingMapLandmarks && index === selectedMapLandmarkIndex ? "selected" : ""}" data-landmark-index="${index}" data-map-tooltip="${escapeHtml(`${landmark.id}. ${landmark.label}`)}" transform="translate(${landmark.x} ${landmark.y})">
        <circle r="14"></circle>
        <text text-anchor="middle" dominant-baseline="central">${escapeHtml(landmark.id)}</text>
      </g>
    `).join("");
  }
  if (list) {
    const fixedLandmarkButtons = MAP_LANDMARKS.map((landmark, index) => `<button type="button" data-landmark-button="${index}">${escapeHtml(`${landmark.id}. ${landmark.label}`)}</button>`).join("");
    const restButtons = mapRestSpots.map((spot, index) => `<button type="button" data-rest-button="${index}">R${index + 1}. ${escapeHtml(spot.name)} <span class="muted">(short rest)</span></button>`).join("");
    list.innerHTML = `${fixedLandmarkButtons}${restButtons}`;
    list.querySelectorAll("[data-landmark-button]").forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.landmarkButton);
        const landmark = MAP_LANDMARKS[index];
        if (!landmark) return;
        if (editingMapLandmarks) {
          selectedMapLandmarkIndex = index;
          renderMapTools();
          return;
        }
        const safeHavenKey = safeHavenKeyForLandmarkId(landmark.id);
        if (safeHavenKey && !mapRoutePoints.length) addOutsideTravel("approach", safeHavenKey);
        else addMapSegmentToward({ x: landmark.x, y: landmark.y, label: `${landmark.id}. ${landmark.label}` });
      });
    });
    list.querySelectorAll("[data-rest-button]").forEach((button) => {
      button.addEventListener("click", () => {
        const spot = mapRestSpots[Number(button.dataset.restButton)];
        if (!spot) return;
        if (!mapRoutePoints.length) addMapStart(spot);
        else addMapSegmentToward(spot);
      });
    });
  }
  updateLandmarkEditControls();
}

function renderMapRoute() {
  const routeSegmentLayer = byId("mapRouteSegmentSvg");
  const routeMarkerLayer = byId("mapRouteMarkerSvg");
  const restLayer = byId("mapRestSpotSvg");
  const routeVisibility = currentMapRouteVisibility();
  const visibleSegmentInfos = getVisibleMapRouteSegments(routeVisibility);
  const markerIndexes = getMapRouteMarkerData(routeVisibility);
  if (routeSegmentLayer) {
    routeSegmentLayer.innerHTML = visibleSegmentInfos.map(({ a, b, segment, leg, hourComplete }) => {
      const paceClass = MAP_PACE_LABELS[segment.pace] ? `pace-${segment.pace}` : "pace-normal";
      const terrainClass = MAP_TERRAIN_LABELS[segment.terrain] ? `terrain-${segment.terrain}` : "terrain-mainRoad";
      const legClass = `leg-${leg}`;
      const segmentTimeMinutes = Math.round(mapSegmentHours(segment) * 60);
      const tooltip = `Hour ${(Number(segment.hourIndex) || 0) + 1}: ${MAP_ROUTE_LEG_LABELS[leg]} — ${formatMiles(Number(segment.distanceMiles) || 0)} at ${MAP_PACE_LABELS[segment.pace] || "Normal"} pace, ${MAP_TERRAIN_LABELS[segment.terrain] || "Main roads"} (${segmentTimeMinutes} min)`;
      return `<line class="map-route-segment ${paceClass} ${terrainClass} ${legClass} ${hourComplete ? "complete" : "open-hour"}" data-map-tooltip="${escapeHtml(tooltip)}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"></line>`;
    }).join("");
  }
  if (routeMarkerLayer) {
    routeMarkerLayer.innerHTML = markerIndexes.map((marker) => {
      const point = mapRoutePoints[marker.pointIndex];
      if (!point) return "";
      return `<g class="map-route-marker ${marker.classes}" data-map-tooltip="${escapeHtml(point.label || marker.title)}" transform="translate(${point.x} ${point.y})"><circle r="12"></circle><text text-anchor="middle" dominant-baseline="central">${escapeHtml(marker.label)}</text></g>`;
    }).join("");
  }
  if (restLayer) {
    restLayer.innerHTML = mapRestSpots.map((spot, index) => `<g class="map-rest-marker" data-rest-index="${index}" data-map-tooltip="${escapeHtml(`Short rest spot: ${spot.name}`)}" transform="translate(${spot.x} ${spot.y})"><path d="M0,-18 L5,-5 L18,0 L5,5 L0,18 L-5,5 L-18,0 L-5,-5 Z"></path><text text-anchor="middle" dominant-baseline="central">R${index + 1}</text></g>`).join("");
  }
}

function renderOutsideTravel() {
  const list = byId("mapOutsideTravelList");
  if (!list) return;
  if (!mapOutsideTrips.length) {
    list.innerHTML = `<li class="empty-state">No safe-haven approach or return travel added.</li>`;
    return;
  }
  list.innerHTML = mapOutsideTrips.map((trip, index) => {
    const haven = MAP_SAFE_HAVENS[trip.haven];
    const label = trip.type === "return" ? `Return to ${haven.label}` : `Approach from ${haven.label}`;
    return `<li>${escapeHtml(label)} — ${formatHoursFromMinutes(trip.minutes)} <button type="button" data-remove-outside-trip="${index}" aria-label="Remove outside travel">×</button></li>`;
  }).join("");
  list.querySelectorAll("[data-remove-outside-trip]").forEach((button) => button.addEventListener("click", () => { mapOutsideTrips.splice(Number(button.dataset.removeOutsideTrip), 1); renderMapTools(); }));
}

function renderMapRestSpots() {
  const list = byId("mapRestSpotList");
  if (!list) return;
  if (!mapRestSpots.length) {
    list.innerHTML = `<li class="empty-state">No saved short rest spots yet.</li>`;
    return;
  }
  list.innerHTML = mapRestSpots.map((spot, index) => `<li><strong>R${index + 1}</strong> ${escapeHtml(spot.name)} <button type="button" data-delete-rest-spot="${index}">Delete</button></li>`).join("");
  list.querySelectorAll("[data-delete-rest-spot]").forEach((button) => button.addEventListener("click", () => { mapRestSpots.splice(Number(button.dataset.deleteRestSpot), 1); renderMapTools(); }));
}

function renderMapRouteSummary() {
  const summary = byId("mapRouteSummary");
  const segmentList = byId("mapRouteSegmentList");
  if (!summary || !segmentList) return;
  const hourSummaries = getMapHourSummaries();
  const cityHours = hourSummaries.length;
  const cityMinutes = hourSummaries.reduce((total, segment) => total + mapHourSummaryMinutes(segment), 0);
  const cityMiles = hourSummaries.reduce((total, segment) => total + (Number(segment.distanceMiles) || 0), 0);
  const outsideMinutes = mapOutsideTrips.reduce((total, trip) => total + (Number(trip.minutes) || 0), 0);
  const eventMinutes = mapEvents.reduce((total, event) => total + mapEventDuration(event), 0);
  const trackedMinutes = cityMinutes + outsideMinutes + eventMinutes;
  const startMinutes = parseMapTimeToMinutes(currentMapStartTime());
  const openHour = currentMapHourInfo();
  const lines = [];

  if (!mapRoutePoints.length && !mapOutsideTrips.length && !mapEvents.length) {
    summary.classList.add("empty-state");
    summary.textContent = "No route plotted yet. Add an approach or click the map to place the party's starting point.";
  } else {
    summary.classList.remove("empty-state");
    lines.push(`Day starts: ${formatMapClock(startMinutes)}.`);
    if (cityHours || cityMiles) lines.push(`In-Drakkenheim travel: ${formatMiles(cityMiles)} over ${formatHoursFromMinutes(cityMinutes)} (${cityHours} route hour marker${cityHours === 1 ? "" : "s"}).`);
    if (openHour?.remainingMiles > 0.005) lines.push(`Current hour is incomplete: ${Math.round(openHour.usedHours * 60)} minutes used, ${Math.round(openHour.remainingHours * 60)} minutes remaining. Double-click a point to end this hour early.`);
    if (eventMinutes) lines.push(`Logged event time: ${formatHoursFromMinutes(eventMinutes)}.`);
    lines.push(`Tracked time: ${formatHoursFromMinutes(trackedMinutes)}.`);
    lines.push(`Current time: ${formatMapClock(startMinutes + trackedMinutes)}.`);
    lines.push(`Random encounter checks: ${cityHours} city exploration hour${cityHours === 1 ? "" : "s"}.`);
    if (mapEvents.length) lines.push(`Logged events: ${mapEvents.length}.`);
    summary.textContent = lines.join("\n");
  }

  const logItems = [];
  let cursorMinutes = startMinutes;

  mapOutsideTrips.filter((trip) => trip.type !== "return").forEach((trip) => {
    const haven = MAP_SAFE_HAVENS[trip.haven];
    if (!haven) return;
    const label = `Approach from ${haven.label}`;
    logItems.push(`<li><strong>${escapeHtml(formatMapTimeRange(cursorMinutes, trip.minutes))}</strong> — ${escapeHtml(label)} <span class="muted">(${formatHoursFromMinutes(trip.minutes)})</span></li>`);
    cursorMinutes += Number(trip.minutes) || 0;
  });

  mapEvents.forEach((event, index) => {
    if (Number(event.afterHours) <= 0) {
      const duration = mapEventDuration(event);
      logItems.push(`<li><strong>${escapeHtml(formatMapTimeRange(cursorMinutes, duration))}</strong> — ${escapeHtml(buildMapEventLabel(event))} <span class="muted">(${formatHoursFromMinutes(duration)})</span> <button type="button" data-delete-map-event="${index}">Delete</button></li>`);
      cursorMinutes += duration;
    }
  });

  hourSummaries.forEach((segment) => {
    const legLabel = segment.leg === "mixed" ? "Mixed route legs" : (MAP_ROUTE_LEG_LABELS[segment.leg] || "Into Drakkenheim");
    const paceLabel = segment.pace === "mixed" ? "Mixed paces" : (MAP_PACE_LABELS[segment.pace] || "Normal");
    const terrainLabel = segment.terrain === "mixed" ? "Mixed road types" : (MAP_TERRAIN_LABELS[segment.terrain] || "Main roads");
    const uniqueLegs = new Set(segment.parts.map((part) => part.leg || "inbound"));
    const uniquePaces = new Set(segment.parts.map((part) => part.pace));
    const uniqueTerrains = new Set(segment.parts.map((part) => part.terrain || "mainRoad"));
    const combinedParts = combineConsecutiveMapHourParts(segment.parts);
    const partBreakdown = (uniqueLegs.size > 1 || uniquePaces.size > 1 || uniqueTerrains.size > 1) ? ` <span class="muted">(${combinedParts.map(formatMapHourPartBreakdown).join("; ")})</span>` : "";
    const segmentMinutes = mapHourSummaryMinutes(segment);
    const earlyCompletion = segment.complete && segmentMinutes < 60 ? ` <span class="muted">(ended early — ${segmentMinutes} min used)</span>` : "";
    const completion = segment.complete ? earlyCompletion : ` <span class="muted">(in progress — ${Math.round(segment.remainingHours * 60)} min remaining in this hour)</span>`;
    logItems.push(`<li><strong>${escapeHtml(formatMapTimeRange(cursorMinutes, segmentMinutes))}</strong> — Hour ${segment.hourNumber}: ${legLabel}, ${paceLabel}, ${terrainLabel}: ${formatMiles(Number(segment.distanceMiles) || 0)}${partBreakdown}${completion}</li>`);
    cursorMinutes += segmentMinutes;

    mapEvents.forEach((event, index) => {
      if (Number(event.afterHours) === segment.hourNumber) {
        const duration = mapEventDuration(event);
        logItems.push(`<li class="map-log-subitem"><strong>${escapeHtml(formatMapTimeRange(cursorMinutes, duration))}</strong> — ${escapeHtml(buildMapEventLabel(event))} <span class="muted">(${formatHoursFromMinutes(duration)})</span> <button type="button" data-delete-map-event="${index}">Delete</button></li>`);
        cursorMinutes += duration;
      }
    });
  });

  mapOutsideTrips.filter((trip) => trip.type === "return").forEach((trip) => {
    const haven = MAP_SAFE_HAVENS[trip.haven];
    if (!haven) return;
    const duration = Number(trip.minutes) || 0;
    const label = `Return to ${haven.label}`;
    logItems.push(`<li><strong>${escapeHtml(formatMapTimeRange(cursorMinutes, duration))}</strong> — ${escapeHtml(label)} <span class="muted">(${formatHoursFromMinutes(duration)})</span></li>`);
    cursorMinutes += duration;
  });

  segmentList.innerHTML = logItems.length ? logItems.join("") : `<li class="empty-state">No safe-haven travel, exploration hours, or log events recorded yet.</li>`;
  segmentList.querySelectorAll("[data-delete-map-event]").forEach((button) => {
    button.addEventListener("click", () => {
      mapEvents.splice(Number(button.dataset.deleteMapEvent), 1);
      renderMapTools();
    });
  });
}

function notesSafeHavenTravelLabel(trip) {
  const haven = MAP_SAFE_HAVENS[trip?.haven];
  if (!haven) return "TRAVEL OUTSIDE DRAKKENHEIM";
  return trip.type === "return" ? `TRAVEL BACK TO ${haven.label.toUpperCase()}` : `TRAVEL TO DRAKKENHEIM FROM ${haven.label.toUpperCase()}`;
}

function notesExplorationHourLabel(segment) {
  const legText = segment.leg === "outbound" ? "TRAVEL OUT OF DRAKKENHEIM" : segment.leg === "mixed" ? "TRAVEL IN / OUT OF DRAKKENHEIM" : "TRAVEL INTO DRAKKENHEIM";
  const paceText = segment.pace === "mixed" ? "MIXED PACE" : `${(MAP_PACE_LABELS[segment.pace] || "Normal").toUpperCase()} PACE`;
  const terrainText = segment.terrain === "mixed" ? "MIXED ROAD TYPES" : (MAP_TERRAIN_LABELS[segment.terrain] || "Main roads").toUpperCase();
  return `${legText} - ${paceText} - ${terrainText}`;
}

function buildMapExplorationLogText() {
  const hourSummaries = getMapHourSummaries();
  const lines = ["TRAVEL TODAY"];
  let cursorMinutes = parseMapTimeToMinutes(currentMapStartTime());

  mapOutsideTrips.filter((trip) => trip.type !== "return").forEach((trip) => {
    const duration = Number(trip.minutes) || 0;
    lines.push(`${formatMapNotesTimeRange(cursorMinutes, duration)} - ${notesSafeHavenTravelLabel(trip)}`);
    cursorMinutes += duration;
  });

  mapEvents.forEach((event) => {
    if (Number(event.afterHours) <= 0) {
      const duration = mapEventDuration(event);
      lines.push(`${formatMapNotesTimeRange(cursorMinutes, duration)} - ${String(buildMapEventLabel(event)).toUpperCase()}`);
      cursorMinutes += duration;
    }
  });

  hourSummaries.forEach((segment) => {
    const segmentMinutes = mapHourSummaryMinutes(segment);
    lines.push(`${formatMapNotesTimeRange(cursorMinutes, segmentMinutes)} - ${notesExplorationHourLabel(segment)}`);
    cursorMinutes += segmentMinutes;
    mapEvents.forEach((event) => {
      if (Number(event.afterHours) === segment.hourNumber) {
        const duration = mapEventDuration(event);
        lines.push(`  ${formatMapNotesTimeRange(cursorMinutes, duration)} - ${String(buildMapEventLabel(event)).toUpperCase()}`);
        cursorMinutes += duration;
      }
    });
  });

  mapOutsideTrips.filter((trip) => trip.type === "return").forEach((trip) => {
    const duration = Number(trip.minutes) || 0;
    lines.push(`${formatMapNotesTimeRange(cursorMinutes, duration)} - ${notesSafeHavenTravelLabel(trip)}`);
    cursorMinutes += duration;
  });

  if (lines.length === 1) lines.push("NO SAFE-HAVEN TRAVEL, CITY EXPLORATION, OR LOG EVENTS RECORDED.");
  return lines.join("\n");
}

async function copyMapExplorationLog() {
  const text = buildMapExplorationLogText();
  try {
    await navigator.clipboard.writeText(text);
    alert("Exploration log copied.");
  } catch (_error) {
    prompt("Copy this exploration log:", text);
  }
}

function drawMapRouteExportSegment(ctx, visibleInfo) {
  const { a, b, segment, leg, hourComplete } = visibleInfo;
  const pace = MAP_PACE_LABELS[segment.pace] ? segment.pace : "normal";
  const terrain = MAP_TERRAIN_LABELS[segment.terrain] ? segment.terrain : "mainRoad";
  const color = pace === "fast" ? "#f0d28a" : pace === "slow" ? "#56bd86" : "#a25fff";
  const dash = pace === "normal" ? [18, 10] : pace === "slow" ? [4, 10] : [];
  const lineWidth = leg === "outbound" ? 8 : terrain === "sideRoad" ? 5 : 7;
  ctx.save();
  ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.globalAlpha = hourComplete ? (terrain === "sideRoad" ? 0.72 : 1) : 0.82;
  ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.setLineDash(dash); ctx.shadowColor = pace === "normal" || !hourComplete ? "rgba(162, 95, 255, 0.72)" : "rgba(240, 210, 138, 0.65)"; ctx.shadowBlur = hourComplete ? 10 : 12;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.restore();
}

function drawMapRouteExportMarker(ctx, marker) {
  const point = mapRoutePoints[marker.pointIndex];
  if (!point) return;
  const stroke = marker.classes.includes("start") ? "#56bd86" : marker.classes.includes("open-hour-end") ? "#a25fff" : "#f0d28a";
  ctx.save(); ctx.shadowColor = marker.classes.includes("open-hour-end") ? "rgba(162, 95, 255, 0.7)" : "rgba(240, 210, 138, 0.5)"; ctx.shadowBlur = 8; ctx.fillStyle = "rgba(8, 7, 10, 0.88)"; ctx.strokeStyle = stroke; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(point.x, point.y, 12, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
  ctx.save(); ctx.fillStyle = "#fff4d0"; ctx.font = '700 22px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(marker.label), point.x, point.y + 0.5); ctx.restore();
}

function drawMapRestExportMarker(ctx, spot, index) {
  ctx.save(); ctx.shadowColor = "rgba(86, 189, 134, 0.75)"; ctx.shadowBlur = 10; ctx.fillStyle = "rgba(86, 189, 134, 0.82)"; ctx.strokeStyle = "#f5ffe9"; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(spot.x, spot.y - 18); ctx.lineTo(spot.x + 5, spot.y - 5); ctx.lineTo(spot.x + 18, spot.y); ctx.lineTo(spot.x + 5, spot.y + 5); ctx.lineTo(spot.x, spot.y + 18); ctx.lineTo(spot.x - 5, spot.y + 5); ctx.lineTo(spot.x - 18, spot.y); ctx.lineTo(spot.x - 5, spot.y - 5); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  ctx.save(); ctx.fillStyle = "#fff4d0"; ctx.font = '700 22px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(`R${index + 1}`, spot.x, spot.y + 0.5); ctx.restore();
}

function drawMapRouteOverlayBorder(ctx, width, height) {
  const borderInset = Math.max(2, Math.round(Math.min(width, height) * 0.00075));
  const borderWidth = Math.max(2, Math.round(Math.min(width, height) * 0.0009));
  ctx.save(); ctx.strokeStyle = "rgba(240, 210, 138, 0.88)"; ctx.lineWidth = borderWidth; ctx.strokeRect(borderInset, borderInset, width - (borderInset * 2), height - (borderInset * 2)); ctx.restore();
}

function drawMapRouteOverlayToCanvas(ctx, width = MAP_ROUTE_EXPORT_SIZE, height = MAP_ROUTE_EXPORT_SIZE, routeVisibility = currentMapRouteVisibility()) {
  const scaleX = width / MAP_SIZE;
  const scaleY = height / MAP_SIZE;
  ctx.clearRect(0, 0, width, height);
  ctx.save(); ctx.scale(scaleX, scaleY);
  getVisibleMapRouteSegments(routeVisibility).forEach((visibleInfo) => drawMapRouteExportSegment(ctx, visibleInfo));
  mapRestSpots.forEach((spot, index) => drawMapRestExportMarker(ctx, spot, index));
  getMapRouteMarkerData(routeVisibility).forEach((marker) => drawMapRouteExportMarker(ctx, marker));
  ctx.restore(); drawMapRouteOverlayBorder(ctx, width, height);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportMapRouteOverlayPng() {
  if (!mapRoutePoints.length && !mapRestSpots.length) {
    alert("No route or short rest pins to export yet.");
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.width = MAP_ROUTE_EXPORT_SIZE; canvas.height = MAP_ROUTE_EXPORT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) { alert("Your browser could not create the export image."); return; }
  drawMapRouteOverlayToCanvas(ctx, canvas.width, canvas.height, currentMapRouteVisibility());
  const filename = `drakkenheim-route-overlay-${currentMapRouteVisibility()}-${canvas.width}x${canvas.height}.png`;
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (blob) downloadBlob(blob, filename);
}

function renderMapTools() {
  updateMapPaceNote();
  updateMapEventNoteField();
  const addRestButton = byId("addShortRestSpotMode");
  if (addRestButton) {
    addRestButton.textContent = addingMapRestSpot ? "Click Map to Place Rest Spot" : "Add Short Rest Spot";
    addRestButton.disabled = !addingMapRestSpot && mapRestSpots.length >= 3;
  }
  renderMapLandmarks();
  renderMapRoute();
  renderOutsideTravel();
  renderMapRestSpots();
  renderMapRouteSummary();
  saveStandaloneState();
}


function controlValue(id) {
  const element = byId(id);
  return element ? element.value : "";
}

function setControlValue(id, value) {
  const element = byId(id);
  if (!element || value === undefined || value === null) return;
  const valueText = String(value);
  if (element.tagName === "SELECT") {
    const hasOption = Array.from(element.options).some((option) => option.value === valueText);
    if (!hasOption) return;
  }
  element.value = valueText;
}

function normaliseSavedPoint(point, fallbackLabel = "") {
  const clean = normaliseMapPoint(point || {});
  clean.label = point?.label || fallbackLabel || "";
  if (point?.landmarkId) clean.landmarkId = point.landmarkId;
  if (point?.safeHavenKey) clean.safeHavenKey = point.safeHavenKey;
  if (point?.landmarkType) clean.landmarkType = point.landmarkType;
  return clean;
}

function serialiseMapLandmarkPositions() {
  return MAP_LANDMARKS.map((landmark) => ({
    id: landmark.id,
    x: Math.round(Number(landmark.x) || 0),
    y: Math.round(Number(landmark.y) || 0)
  }));
}

function restoreMapLandmarkPositions(savedLandmarks) {
  if (!Array.isArray(savedLandmarks)) return;
  savedLandmarks.forEach((saved) => {
    const landmark = MAP_LANDMARKS.find((item) => item.id === saved?.id);
    if (!landmark) return;
    landmark.x = clamp(saved.x, 0, MAP_SIZE);
    landmark.y = clamp(saved.y, 0, MAP_SIZE);
  });
}

function getCollapsiblePanelState() {
  return Array.from(document.querySelectorAll("details.collapsible-tool")).map((panel, index) => ({
    index,
    open: Boolean(panel.open)
  }));
}

function restoreCollapsiblePanelState(savedPanels) {
  if (!Array.isArray(savedPanels)) return;
  const panels = Array.from(document.querySelectorAll("details.collapsible-tool"));
  savedPanels.forEach((saved) => {
    const panel = panels[Number(saved?.index)];
    if (panel) panel.open = Boolean(saved.open);
  });
}

function saveStandaloneState() {
  if (isRestoringSavedState || !hasLoadedSavedState) return;
  try {
    const paceSelect = byId("mapTravelPace");
    const state = {
      routePoints: mapRoutePoints,
      routeSegments: mapRouteSegments,
      restSpots: mapRestSpots,
      outsideTrips: mapOutsideTrips,
      events: mapEvents,
      landmarks: serialiseMapLandmarkPositions(),
      selectedLandmarkIndex: selectedMapLandmarkIndex,
      floatingControlsPosition: mapFloatingControlsPosition,
      controls: {
        routeLeg: controlValue("mapRouteLeg"),
        routeVisibility: controlValue("mapRouteVisibility"),
        travelPace: controlValue("mapTravelPace"),
        previousMainRoadPace: paceSelect?.dataset.previousMainRoadPace || "",
        terrain: controlValue("mapTerrain"),
        dayStart: controlValue("mapDayStartTime"),
        safeHaven: controlValue("mapSafeHaven"),
        eventType: controlValue("mapEventType"),
        eventText: controlValue("mapEventCustomText"),
        eventDuration: controlValue("mapEventCustomDuration")
      },
      ui: {
        theme: document.documentElement.dataset.theme === "light" ? "light" : "dark",
        compact: document.body.classList.contains("compact"),
        zoom: Number(controlValue("mapZoom")) || 1,
        panels: getCollapsiblePanelState()
      }
    };
    localStorage.setItem(STANDALONE_STATE_KEY, JSON.stringify(state));
  } catch (_error) {
    // Storage can be blocked by browser settings. The mapper still works for the current session.
  }
}

function loadStandaloneState() {
  let state = null;
  try {
    const raw = localStorage.getItem(STANDALONE_STATE_KEY);
    if (!raw) {
      hasLoadedSavedState = true;
      return;
    }
    state = JSON.parse(raw);
  } catch (_error) {
    hasLoadedSavedState = true;
    return;
  }

  isRestoringSavedState = true;
  try {
    mapRoutePoints = arrayOrFallback(state.routePoints).map((point) => normaliseSavedPoint(point));
    mapRouteSegments = arrayOrFallback(state.routeSegments).map((segment) => ({ ...segment }));
    mapRestSpots = arrayOrFallback(state.restSpots).map((spot, index) => ({
      ...normaliseSavedPoint(spot),
      name: spot?.name || `Short rest spot ${index + 1}`
    }));
    mapOutsideTrips = arrayOrFallback(state.outsideTrips).map((trip) => ({
      type: trip?.type === "return" ? "return" : "approach",
      haven: MAP_SAFE_HAVENS[trip?.haven] ? trip.haven : "emberwood",
      minutes: Number(trip?.minutes) || MAP_SAFE_HAVENS.emberwood.minutes
    }));
    mapEvents = arrayOrFallback(state.events).map((event) => ({ ...event }));
    selectedMapLandmarkIndex = Math.max(0, Math.floor(Number(state.selectedLandmarkIndex) || 0));
    mapFloatingControlsPosition = normaliseMapFloatingControlsPosition(state.floatingControlsPosition);

    restoreMapLandmarkPositions(state.landmarks);
    setControlValue("mapRouteLeg", state.controls?.routeLeg);
    setControlValue("mapRouteVisibility", state.controls?.routeVisibility);
    setControlValue("mapTravelPace", state.controls?.travelPace);
    setControlValue("mapTerrain", state.controls?.terrain);
    setControlValue("mapDayStartTime", state.controls?.dayStart);
    setControlValue("mapSafeHaven", state.controls?.safeHaven);
    setControlValue("mapEventType", state.controls?.eventType);
    setControlValue("mapEventCustomText", state.controls?.eventText);
    setControlValue("mapEventCustomDuration", state.controls?.eventDuration);

    const paceSelect = byId("mapTravelPace");
    if (paceSelect && MAP_PACE_LABELS[state.controls?.previousMainRoadPace]) {
      paceSelect.dataset.previousMainRoadPace = state.controls.previousMainRoadPace;
    }

    document.documentElement.dataset.theme = state.ui?.theme === "light" ? "light" : "dark";
    const themeButton = byId("toggleTheme");
    if (themeButton) themeButton.textContent = document.documentElement.dataset.theme === "light" ? "Dark mode" : "Light mode";

    document.body.classList.toggle("compact", Boolean(state.ui?.compact));
    const compactButton = byId("toggleCompact");
    if (compactButton) compactButton.textContent = document.body.classList.contains("compact") ? "Normal spacing" : "Compact mode";

    restoreCollapsiblePanelState(state.ui?.panels);
    applyMapFloatingRouteControlsPosition();
    setMapZoom(state.ui?.zoom || 1);
    syncMapTerrainPaceControl();
    renderMapTools();
  } catch (_error) {
    // Bad or older saved data should not block the initial map render.
  } finally {
    isRestoringSavedState = false;
    hasLoadedSavedState = true;
  }
}

function clearSavedStandaloneState() {
  if (!confirm("Clear saved browser data for this route mapper? This does not affect the current visible route until you refresh or clear the route manually.")) return;
  try {
    localStorage.removeItem(STANDALONE_STATE_KEY);
    alert("Saved browser data cleared.");
  } catch (_error) {
    alert("Could not clear saved browser data in this browser.");
  }
}

function toggleTheme() {
  const root = document.documentElement;
  const isLight = root.dataset.theme === "light";
  root.dataset.theme = isLight ? "dark" : "light";
  byId("toggleTheme").textContent = isLight ? "Light mode" : "Dark mode";
  saveStandaloneState();
}

function toggleCompact() {
  document.body.classList.toggle("compact");
  byId("toggleCompact").textContent = document.body.classList.contains("compact") ? "Normal spacing" : "Compact mode";
  saveStandaloneState();
}


function renderStandaloneStateAfterLoad() {
  renderMapTools();
  requestAnimationFrame(() => {
    applyMapFloatingRouteControlsPosition();
    renderMapTools();
  });
  setTimeout(() => {
    applyMapFloatingRouteControlsPosition();
    renderMapTools();
  }, 50);
}

function init() {
  byId("drakkenheimMapStage").addEventListener("click", handleMapClick);
  byId("drakkenheimMapStage").addEventListener("dblclick", handleMapDoubleClick);
  byId("drakkenheimMapStage").addEventListener("contextmenu", preventMapContextMenu);
  byId("drakkenheimMapStage").addEventListener("pointerdown", startMapPan);
  byId("drakkenheimMapStage").addEventListener("pointermove", moveMapPan);
  byId("drakkenheimMapStage").addEventListener("pointerup", endMapPan);
  byId("drakkenheimMapStage").addEventListener("pointercancel", endMapPan);
  byId("drakkenheimMapStage").addEventListener("wheel", handleMapCtrlWheelZoom, { passive: false });
  byId("mapOverlaySvg").addEventListener("pointerover", showMapTooltip);
  byId("mapOverlaySvg").addEventListener("pointermove", moveMapTooltip);
  byId("mapOverlaySvg").addEventListener("pointerout", hideMapTooltip);
  byId("mapFloatingRouteHandle").addEventListener("pointerdown", startMapFloatingRouteDrag);
  byId("mapFloatingRouteControls").addEventListener("pointermove", moveMapFloatingRouteDrag);
  byId("mapFloatingRouteControls").addEventListener("pointerup", endMapFloatingRouteDrag);
  byId("mapFloatingRouteControls").addEventListener("pointercancel", endMapFloatingRouteDrag);
  byId("mapZoom").addEventListener("input", (event) => setMapZoom(event.target.value));
  byId("resetMapZoom").addEventListener("click", () => setMapZoom(1));
  ["mapRouteLeg", "mapRouteVisibility", "mapTravelPace", "mapDayStartTime"].forEach((id) => byId(id).addEventListener("change", renderMapTools));
  byId("mapTerrain").addEventListener("change", () => {
    syncMapTerrainPaceControl();
    renderMapTools();
  });
  byId("undoMapSegment").addEventListener("click", undoMapSegment);
  byId("clearMapRoute").addEventListener("click", clearMapRoute);
  byId("addApproachTravel").addEventListener("click", () => addOutsideTravel("approach"));
  byId("addReturnTravel").addEventListener("click", () => addOutsideTravel("return"));
  byId("clearOutsideTravel").addEventListener("click", clearOutsideTravel);
  byId("addShortRestSpotMode").addEventListener("click", beginAddShortRestSpot);
  byId("addMapEvent").addEventListener("click", addMapEvent);
  byId("mapEventType").addEventListener("change", updateMapEventNoteField);
  byId("copyMapExplorationLog").addEventListener("click", copyMapExplorationLog);
  byId("exportMapRouteOverlay").addEventListener("click", exportMapRouteOverlayPng);
  byId("mapLandmarkEditSelect").addEventListener("change", (event) => {
    selectedMapLandmarkIndex = Number(event.target.value) || 0;
    renderMapTools();
  });
  byId("toggleLandmarkEditMode").addEventListener("click", toggleLandmarkEditMode);
  byId("resetMapLandmarkPositions").addEventListener("click", resetMapLandmarkPositions);
  byId("copyMapLandmarkData").addEventListener("click", copyMapLandmarkData);
  byId("toggleTheme").addEventListener("click", toggleTheme);
  byId("toggleCompact").addEventListener("click", toggleCompact);
  document.querySelectorAll("details.collapsible-tool").forEach((panel) => {
    panel.addEventListener("toggle", saveStandaloneState);
  });

  isRestoringSavedState = true;
  applyMapFloatingRouteControlsPosition();
  setMapZoom(1);
  isRestoringSavedState = false;

  loadStandaloneState();
  renderStandaloneStateAfterLoad();
  window.addEventListener("load", renderStandaloneStateAfterLoad, { once: true });
  window.addEventListener("beforeunload", saveStandaloneState);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
